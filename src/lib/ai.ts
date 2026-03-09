import { GoogleGenAI } from "@google/genai";
import { geminiApiKey } from "../../config.json";

const ai = new GoogleGenAI({ apiKey: geminiApiKey });

export async function callGemini(prompt: string): Promise<string> {
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });
  return result.text ?? "요약을 생성할 수 없습니다.";
}
