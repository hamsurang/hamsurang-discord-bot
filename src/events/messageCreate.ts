import { EmbedBuilder, Message, ThreadAutoArchiveDuration } from "discord.js";
import { GoogleGenAI } from "@google/genai";
import { parse } from "node-html-parser";
import { YoutubeTranscript } from "youtube-transcript";
import { geminiApiKey, allowedChannelIds } from "../../config.json";

const ai = new GoogleGenAI({ apiKey: geminiApiKey });

const URL_REGEX = /https?:\/\/[^\s]+/;
const JINA_READER_PREFIX = "https://r.jina.ai/";
const MAX_CONTENT_LENGTH = 8_000;
const THREAD_NAME_MAX_LENGTH = 100;
const EMBED_COLOR = 0x5865f2;

interface JinaReaderResult {
  title: string | null;
  content: string;
}

async function fetchWithJinaReader(url: string): Promise<JinaReaderResult> {
  const response = await fetch(`${JINA_READER_PREFIX}${url}`, {
    headers: { Accept: "text/markdown" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Jina Reader failed: ${response.status}`);
  }

  const markdown = await response.text();
  const titleMatch = markdown.match(/^Title:\s*(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? null;

  const contentStart = markdown.indexOf("Markdown Content:");
  const content =
    contentStart !== -1
      ? markdown.slice(contentStart + "Markdown Content:".length).trim()
      : markdown;

  return { title, content: content.slice(0, MAX_CONTENT_LENGTH) };
}

async function fetchWithDirectParse(url: string): Promise<JinaReaderResult> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0)" },
    signal: AbortSignal.timeout(10_000),
  });

  const html = await response.text();
  const root = parse(html);

  const ogTitle = root.querySelector('meta[property="og:title"]');
  const titleTag = root.querySelector("title");
  const title = ogTitle?.getAttribute("content") ?? titleTag?.text ?? null;

  root
    .querySelectorAll("script, style, nav, footer, aside")
    .forEach((el) => el.remove());
  const text = root.querySelector("main, article, body")?.text ?? root.text;
  const content = text.replace(/\s+/g, " ").trim().slice(0, 8000);

  return { title, content };
}

const JINA_MAX_RETRIES = 3;
const JINA_RETRY_DELAY_MS = 2_000;

async function fetchPageContent(url: string): Promise<JinaReaderResult> {
  for (let attempt = 1; attempt <= JINA_MAX_RETRIES; attempt++) {
    try {
      const result = await fetchWithJinaReader(url);
      if (result.content.length > 0) return result;
      console.warn(
        `[링크요약] Jina Reader 빈 응답 (${attempt}/${JINA_MAX_RETRIES})`,
      );
    } catch (err) {
      console.warn(
        `[링크요약] Jina Reader 실패 (${attempt}/${JINA_MAX_RETRIES}):`,
        err,
      );
    }
    if (attempt < JINA_MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, JINA_RETRY_DELAY_MS));
    }
  }
  console.warn("[링크요약] Jina Reader 재시도 소진, 직접 파싱 fallback");
  return fetchWithDirectParse(url);
}

const COMMUNITY_HOSTS = [
  "linkedin.com",
  "x.com",
  "twitter.com",
  "reddit.com",
  "news.ycombinator.com",
  "news.hada.io",
];

function isCommunityUrl(url: string): boolean {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  return COMMUNITY_HOSTS.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`),
  );
}

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

async function summarizeContent(content: string, url: string): Promise<string> {
  const prompt = isCommunityUrl(url) ? COMMUNITY_PROMPT : DEFAULT_PROMPT;

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `${prompt}\n\n${content}`,
  });

  return result.text ?? "요약을 생성할 수 없습니다.";
}

function extractYouTubeVideoId(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.hostname.includes("youtube.com")) {
    return parsed.searchParams.get("v");
  }
  if (parsed.hostname === "youtu.be") {
    return parsed.pathname.slice(1);
  }
  return null;
}

async function fetchOgTitle(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    const html = await response.text();
    const root = parse(html);
    const ogTitle = root.querySelector('meta[property="og:title"]');
    if (ogTitle?.getAttribute("content")) {
      return ogTitle.getAttribute("content")!;
    }
    const titleTag = root.querySelector("title");
    return titleTag?.text ?? null;
  } catch {
    return null;
  }
}

async function fetchAndSummarizeYouTube(videoId: string): Promise<string> {
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

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `아래 YouTube 자막 내용을 요약해줘.

규칙:
- 마크다운 리스트(bullet point) 형식으로 작성
- 글의 핵심 내용을 소주제별로 나누어 정리 (최대 3개)
- 각 항목은 "**소주제**: 설명" 형태로, 설명은 1~2문장 이내
- 소주제는 글의 내용에 맞게 자유롭게 구성
- 마지막에 키워드 최대 3개를 쉼표로 나열

${transcript}`,
  });

  return result.text ?? "요약을 생성할 수 없습니다.";
}

export async function onMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!allowedChannelIds.includes(message.channelId)) return;
  if (!message.channel.isTextBased() || !("threads" in message.channel)) return;

  const match = message.content.match(URL_REGEX);
  if (!match) return;

  const rawUrl = match[0];
  console.log(
    `[링크요약] URL 감지: ${rawUrl} (유저: ${message.author.tag}, 채널: ${message.channelId})`,
  );

  const videoId = extractYouTubeVideoId(rawUrl);
  console.log(`[링크요약] YouTube 여부: ${videoId ? `ID=${videoId}` : "아님"}`);

  // 일반 웹페이지는 Jina Reader → 직접 파싱 fallback으로 fetch
  let pageResult: JinaReaderResult | null = null;
  if (!videoId) {
    try {
      pageResult = await fetchPageContent(rawUrl);
      console.log(
        `[링크요약] 페이지 fetch 성공 (title: "${pageResult.title}")`,
      );
    } catch (err) {
      console.warn("[링크요약] 페이지 fetch 실패:", err);
    }
  }

  let thread;
  try {
    const parsedUrl = new URL(rawUrl);
    const pageTitle = pageResult?.title || (await fetchOgTitle(rawUrl));
    const threadName = (
      pageTitle && pageTitle.length > 0
        ? pageTitle
        : parsedUrl.hostname.replace(/^www\./, "")
    ).slice(0, THREAD_NAME_MAX_LENGTH);
    console.log(`[링크요약] 스레드 이름: "${threadName}"`);
    const channel = message.channel;

    if ("threads" in channel) {
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      });
      console.log(`[링크요약] 스레드 생성 완료: ${thread.id}`);
    }
  } catch (err) {
    console.error("[링크요약] 스레드 생성 실패:", err);
    return;
  }

  if (!thread) return;

  const placeholder = await thread.send("요약중입니다...💭");

  try {
    console.log(
      `[링크요약] 요약 시작 (${videoId ? "YouTube" : "일반 웹페이지"})`,
    );

    let summary: string;
    if (videoId) {
      summary = await fetchAndSummarizeYouTube(videoId);
    } else if (pageResult) {
      summary = await summarizeContent(pageResult.content, rawUrl);
    } else {
      throw new Error("페이지 내용을 가져올 수 없습니다.");
    }

    console.log(`[링크요약] 요약 완료 (길이: ${summary.length})`);
    const keywordMatch = summary.match(/키워드:\s*(.+)/);
    const summaryText = summary.replace(/키워드:\s*.+/, "").trim();
    const keywords = keywordMatch?.[1]
      ?.split(",")
      .map((k) => `\`${k.trim()}\``)
      .join("  ");

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("링크 요약")
      .setURL(rawUrl)
      .setDescription(summaryText)
      .setFooter({ text: rawUrl })
      .setTimestamp();

    if (keywords) {
      embed.addFields({ name: "🏷️ 키워드", value: keywords });
    }
    await placeholder.edit({ content: "", embeds: [embed] });
    console.log(`[링크요약] 임베드 게시 완료: ${rawUrl}`);
  } catch (error) {
    console.error("[링크요약] 요약 실패:", error);
    await placeholder.edit("링크 내용을 읽어오는 데 실패했습니다.");
  }
}
