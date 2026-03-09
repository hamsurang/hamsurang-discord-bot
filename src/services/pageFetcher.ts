import { parse } from "node-html-parser";

const JINA_READER_PREFIX = "https://r.jina.ai/";
const MAX_CONTENT_LENGTH = 8_000;
const JINA_MAX_RETRIES = 3;
const JINA_RETRY_DELAY_MS = 2_000;

export interface PageFetchResult {
  title: string | null;
  content: string;
}

async function fetchWithJinaReader(url: string): Promise<PageFetchResult> {
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

async function fetchWithDirectParse(url: string): Promise<PageFetchResult> {
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
  const content = text.replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT_LENGTH);

  return { title, content };
}

export async function fetchPageContent(url: string): Promise<PageFetchResult> {
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

export async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const { title } = await fetchWithDirectParse(url);
    return title;
  } catch {
    return null;
  }
}
