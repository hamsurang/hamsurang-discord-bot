import { YoutubeTranscript } from "youtube-transcript";
import { callGemini } from "../lib/ai";
import { isCommunityUrl } from "../utils/url";

const MAX_CONTENT_LENGTH = 8_000;

const DEFAULT_PROMPT = `아래 웹페이지 내용을 요약해줘.

규칙:
- 마크다운 리스트(bullet point) 형식으로 작성
- 글의 핵심 내용을 소주제별로 나누어 정리 (최대 3개)
- 각 항목은 "**소주제**: 설명" 형태로, 설명은 1~2문장 이내
- 소주제는 글의 내용에 맞게 자유롭게 구성
- 마지막에 키워드 최대 3개를 쉼표로 나열`;

const COMMUNITY_PROMPT = `아래 커뮤니티 게시글과 댓글/응답을 요약해줘.

규칙:
- 마크다운 리스트(bullet point) 형식으로 작성
- 먼저 원글의 핵심 내용을 1~2문장으로 요약
- 그 다음 "**주요 반응**" 항목으로 댓글/응답 중 인사이트 있는 의견 2~3개를 정리
- 각 반응은 "— 요약 내용" 형태로, 1문장 이내
- 마지막에 키워드 최대 3개를 쉼표로 나열`;

export async function summarizeContent(
  content: string,
  url: string,
): Promise<string> {
  const prompt = isCommunityUrl(url) ? COMMUNITY_PROMPT : DEFAULT_PROMPT;
  return callGemini(`${prompt}\n\n${content}`);
}

export async function summarizeYouTube(videoId: string): Promise<string> {
  let transcript: string;
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    transcript = items
      .map((item) => item.text)
      .join(" ")
      .slice(0, MAX_CONTENT_LENGTH);
  } catch {
    return "자막을 찾을 수 없습니다. 자막이 비활성화되었거나 지원되지 않는 영상입니다.";
  }

  return callGemini(`아래 YouTube 자막 내용을 요약해줘.

규칙:
- 마크다운 리스트(bullet point) 형식으로 작성
- 글의 핵심 내용을 소주제별로 나누어 정리 (최대 3개)
- 각 항목은 "**소주제**: 설명" 형태로, 설명은 1~2문장 이내
- 소주제는 글의 내용에 맞게 자유롭게 구성
- 마지막에 키워드 최대 3개를 쉼표로 나열

${transcript}`);
}
