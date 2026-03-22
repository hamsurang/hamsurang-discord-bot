import { GoogleGenAI } from "@google/genai";
import { geminiApiKey } from "../config";

const ai = new GoogleGenAI({ apiKey: geminiApiKey });

export async function summarizeTranscript(texts: string[]): Promise<string> {
  console.log(
    `[요약] 입력 텍스트 ${texts.length}개, 각 길이: [${texts.map((t) => t.length).join(", ")}]`,
  );
  const fullText = texts.join("\n").slice(0, 100_000);

  if (fullText.trim().length === 0) {
    console.log(
      '[요약] 텍스트가 비어있음 — "음성 내용이 감지되지 않았습니다" 반환',
    );
    return "음성 내용이 감지되지 않았습니다.";
  }

  console.log(`[요약] Gemini API 호출 시작 (텍스트 길이: ${fullText.length})`);
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `아래는 디스코드 음성채널 회의의 음성 인식 텍스트입니다. 주요 논의 내용을 한국어로 요약해주세요.\n\n형식:\n## 회의 요약\n- 핵심 내용 1\n- 핵심 내용 2\n- ...\n\n## 주요 키워드\n키워드1, 키워드2, 키워드3\n\n---\n\n${fullText}`,
  });

  const summary = result.text ?? "요약을 생성할 수 없습니다.";
  console.log(`[요약] Gemini 응답 완료 (길이: ${summary.length})`);
  return summary;
}
