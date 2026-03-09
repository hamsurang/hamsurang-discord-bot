import { YoutubeTranscript } from "youtube-transcript";
import { callGemini } from "../lib/ai";
import { isCommunityUrl } from "../utils/url";
import { MAX_CONTENT_LENGTH } from "../constants/fetcher";
import {
  DEFAULT_PROMPT,
  COMMUNITY_PROMPT,
  YOUTUBE_PROMPT,
} from "../constants/prompts";

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

  return callGemini(`${YOUTUBE_PROMPT}\n\n${transcript}`);
}
