import { ApiError, GoogleGenAI } from "@google/genai";
import { geminiApiKeys } from "../config";

const clients = geminiApiKeys.map((key) => new GoogleGenAI({ apiKey: key }));
let currentIndex = 0;

export async function callGemini(
  prompt: string,
  model = "gemini-2.5-flash",
): Promise<string> {
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
