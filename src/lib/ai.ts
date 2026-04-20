import OpenAI, { APIError } from "openai";
import { openaiApiKey } from "../config";
import { LLM_MAX_RETRIES, LLM_RETRY_DELAY_MS } from "../constants/fetcher";

export class QuotaExhaustedError extends Error {
  constructor() {
    super("OpenAI API 크레딧을 전부 소진했습니다!");
  }
}

const openai = new OpenAI({ apiKey: openaiApiKey });

export async function callLLM(prompt: string): Promise<string> {
  for (let retry = 0; retry <= LLM_MAX_RETRIES; retry++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });

      return (
        response.choices[0]?.message?.content ?? "요약을 생성할 수 없습니다."
      );
    } catch (error) {
      if (error instanceof APIError && error.status === 429) {
        console.error("[LLM] API 크레딧 소진!");
        throw new QuotaExhaustedError();
      }
      if (
        error instanceof APIError &&
        error.status === 503 &&
        retry < LLM_MAX_RETRIES
      ) {
        console.warn(
          `[LLM] 503 과부하 — ${LLM_RETRY_DELAY_MS}ms 후 재시도 (${retry + 1}/${LLM_MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, LLM_RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }

  throw new Error("unreachable");
}
