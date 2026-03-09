import { EmbedBuilder, Message, ThreadAutoArchiveDuration } from "discord.js";
import { allowedChannelIds } from "../../config.json";
import { URL_REGEX, extractYouTubeVideoId } from "../utils/url";
import {
  fetchPageContent,
  fetchPageTitle,
  PageFetchResult,
} from "../services/pageFetcher";
import { summarizeContent, summarizeYouTube } from "../services/summarizer";

const THREAD_NAME_MAX_LENGTH = 100;
const EMBED_COLOR = 0x5865f2;

async function resolveThreadName(
  url: string,
  pageResult: PageFetchResult | null,
): Promise<string> {
  const title = pageResult?.title || (await fetchPageTitle(url));
  const fallback = new URL(url).hostname.replace(/^www\./, "");
  return (title && title.length > 0 ? title : fallback).slice(
    0,
    THREAD_NAME_MAX_LENGTH,
  );
}

function buildSummaryEmbed(summary: string, url: string): EmbedBuilder {
  const keywordMatch = summary.match(/키워드:\s*(.+)/);
  const summaryText = summary.replace(/키워드:\s*.+/, "").trim();
  const keywords = keywordMatch?.[1]
    ?.split(",")
    .map((k) => `\`${k.trim()}\``)
    .join("  ");

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("링크 요약")
    .setURL(url)
    .setDescription(summaryText)
    .setFooter({ text: url })
    .setTimestamp();

  if (keywords) {
    embed.addFields({ name: "🏷️ 키워드", value: keywords });
  }
  return embed;
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

  let pageResult: PageFetchResult | null = null;
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
    const threadName = await resolveThreadName(rawUrl, pageResult);
    console.log(`[링크요약] 스레드 이름: "${threadName}"`);

    if ("threads" in message.channel) {
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
      summary = await summarizeYouTube(videoId);
    } else if (pageResult) {
      summary = await summarizeContent(pageResult.content, rawUrl);
    } else {
      throw new Error("페이지 내용을 가져올 수 없습니다.");
    }

    console.log(`[링크요약] 요약 완료 (길이: ${summary.length})`);
    const embed = buildSummaryEmbed(summary, rawUrl);
    await placeholder.edit({ content: "", embeds: [embed] });
    console.log(`[링크요약] 임베드 게시 완료: ${rawUrl}`);
  } catch (error) {
    console.error("[링크요약] 요약 실패:", error);
    await placeholder.edit("링크 내용을 읽어오는 데 실패했습니다.");
  }
}
