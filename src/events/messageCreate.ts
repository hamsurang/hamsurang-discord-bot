import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  Message,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { summaryChannelIds } from "../config";
import { THREAD_NAME_MAX_LENGTH, EMBED_COLOR } from "../constants/discord";
import { URL_REGEX, extractYouTubeVideoId } from "../utils/url";
import {
  fetchPageContent,
  fetchPageTitle,
  PageFetchResult,
} from "../services/pageFetcher";
import { summarizeContent, summarizeYouTube } from "../services/summarizer";
import { QuotaExhaustedError } from "../lib/ai";

export const RETRY_SUMMARY_CUSTOM_ID = "retry_summary";

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
  if (!summaryChannelIds.includes(message.channelId)) return;
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

    if (message.hasThread) {
      console.log("[링크요약] 이미 스레드가 존재하는 메시지, 건너뜀");
      return;
    }

    if ("threads" in message.channel) {
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      });
      console.log(`[링크요약] 스레드 생성 완료: ${thread.id}`);
    }
  } catch (err: unknown) {
    const isAlreadyCreated =
      err instanceof Error && "code" in err && err.code === 160004;
    if (isAlreadyCreated) {
      console.log("[링크요약] 이미 스레드가 존재하는 메시지, 건너뜀");
    } else {
      console.error("[링크요약] 스레드 생성 실패:", err);
    }
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
    if (error instanceof QuotaExhaustedError) {
      await placeholder.edit(
        "API 크레딧을 전부 소진했습니다! 관리자에게 문의해주세요.",
      );
    } else {
      const retryButton = new ButtonBuilder()
        .setCustomId("retry_summary")
        .setLabel("재시도")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄");
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        retryButton,
      );
      await placeholder.edit({
        content: "링크 내용을 읽어오는 데 실패했습니다.",
        components: [row],
      });
    }
  }
}

export async function onRetrySummary(
  interaction: ButtonInteraction,
): Promise<void> {
  const thread = interaction.channel;
  if (!thread?.isThread()) return;

  const starterMessage = await thread.fetchStarterMessage();
  if (!starterMessage) {
    await interaction.reply({
      content: "원본 메시지를 찾을 수 없습니다.",
      ephemeral: true,
    });
    return;
  }

  const match = starterMessage.content.match(URL_REGEX);
  if (!match) {
    await interaction.reply({
      content: "URL을 찾을 수 없습니다.",
      ephemeral: true,
    });
    return;
  }

  const rawUrl = match[0];
  const videoId = extractYouTubeVideoId(rawUrl);

  await interaction.update({ content: "요약중입니다...💭", components: [] });

  try {
    let summary: string;
    if (videoId) {
      summary = await summarizeYouTube(videoId);
    } else {
      const pageResult = await fetchPageContent(rawUrl);
      summary = await summarizeContent(pageResult.content, rawUrl);
    }

    const embed = buildSummaryEmbed(summary, rawUrl);
    await interaction.editReply({
      content: "",
      embeds: [embed],
      components: [],
    });
  } catch (error) {
    console.error("[링크요약] 재시도 실패:", error);
    if (error instanceof QuotaExhaustedError) {
      await interaction.editReply({
        content: "API 크레딧을 전부 소진했습니다! 관리자에게 문의해주세요.",
        components: [],
      });
    } else {
      const retryButton = new ButtonBuilder()
        .setCustomId("retry_summary")
        .setLabel("재시도")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄");
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        retryButton,
      );
      await interaction.editReply({
        content: "링크 내용을 읽어오는 데 실패했습니다.",
        components: [row],
      });
    }
  }
}
