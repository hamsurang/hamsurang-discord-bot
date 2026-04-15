import { ApiError, GoogleGenAI } from "@google/genai";
import { geminiApiKeys } from "../config";
import {
  GEMINI_503_MAX_RETRIES,
  GEMINI_503_RETRY_DELAY_MS,
} from "../constants/fetcher";

const clients = geminiApiKeys.map((key) => new GoogleGenAI({ apiKey: key }));
let currentIndex = 0;

async function callGeminiOnce(prompt: string, model: string): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < clients.length; attempt++) {
    const idx = (currentIndex + attempt) % clients.length;
    try {
      const result = await clients[idx].models.generateContent({
        model,
        contents: prompt,
      });
      currentIndex = (idx + 1) % clients.length;
      return result.text ?? "요약을 생성할 수 없습니다.";
    } catch (error) {
      lastError = error;
      if (error instanceof ApiError && error.status === 429) {
        console.warn(
          `[Gemini] 키 ${idx + 1}/${clients.length} rate limit — 다음 키로 전환`,
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

export async function callGemini(
  prompt: string,
  model = "gemini-2.5-flash",
): Promise<string> {
  for (let retry = 0; retry <= GEMINI_503_MAX_RETRIES; retry++) {
    try {
      return await callGeminiOnce(prompt, model);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 503 &&
        retry < GEMINI_503_MAX_RETRIES
      ) {
        console.warn(
          `[Gemini] 503 과부하 — ${GEMINI_503_RETRY_DELAY_MS}ms 후 재시도 (${retry + 1}/${GEMINI_503_MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, GEMINI_503_RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }

  throw new Error("unreachable");
}
