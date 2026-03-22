import { EmbedBuilder, Message, TextChannel } from "discord.js";
import { EMBED_COLOR } from "../constants/discord";
import { SEVEN_DAYS_MS } from "../constants/time";
import { URL_REGEX } from "../utils/url";

const TOP_N = 3;
const PREVIEW_MAX_LENGTH = 60;

async function fetchMessagesForLastWeek(
  channel: TextChannel,
): Promise<Message[]> {
  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
  const allMessages: Message[] = [];
  let lastId: string | undefined;

  while (true) {
    const options: { limit: number; before?: string } = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    const recent = batch.filter((m) => m.createdTimestamp >= sevenDaysAgo);
    allMessages.push(...recent.values());

    const oldest = batch.last();
    if (!oldest || oldest.createdTimestamp < sevenDaysAgo) break;

    lastId = oldest.id;
  }

  return allMessages;
}

/**
 * 여러 채널의 7일간 메시지를 합산하여 주간 랭킹 임베드를 생성한다.
 * 단일 채널도 배열로 감싸서 전달 가능.
 */
export async function buildWeeklyRankingEmbed(
  channels: TextChannel[],
): Promise<EmbedBuilder | null> {
  const allMessages: Message[] = [];
  for (const channel of channels) {
    const msgs = await fetchMessagesForLastWeek(channel);
    allMessages.push(...msgs);
  }

  if (allMessages.length === 0) return null;

  const reactionTop3 = allMessages
    .filter((m) => URL_REGEX.test(m.content))
    .map((m) => ({
      message: m,
      totalReactions: m.reactions.cache.reduce(
        (sum, r) => sum + (r.count ?? 0),
        0,
      ),
    }))
    .filter((item) => item.totalReactions > 0)
    .sort((a, b) => b.totalReactions - a.totalReactions)
    .slice(0, TOP_N);

  const threadTop3 = allMessages
    .filter((m) => m.thread && (m.thread.messageCount ?? 0) > 0)
    .map((m) => ({
      message: m,
      commentCount: m.thread?.messageCount ?? 0,
    }))
    .sort((a, b) => b.commentCount - a.commentCount)
    .slice(0, TOP_N);

  const medals = ["🥇", "🥈", "🥉"];

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("주간 랭킹 (지난 7일)")
    .setTimestamp();

  const REACTION_NAME = "가장 좋아요👍가 많았던 메시지 TOP 3";
  if (reactionTop3.length === 0) {
    embed.addFields({
      name: REACTION_NAME,
      value: "해당 메시지가 없습니다.",
    });
  } else {
    const lines = reactionTop3.map((item, i) => {
      const url = item.message.content.match(URL_REGEX)?.[0] ?? "";
      const preview =
        url.length > PREVIEW_MAX_LENGTH
          ? url.slice(0, PREVIEW_MAX_LENGTH) + "..."
          : url;
      const author =
        item.message.author.displayName ?? item.message.author.username;
      const threadName = item.message.thread?.name ?? "";
      const threadInfo = threadName ? ` | 스레드: ${threadName}` : "";
      return `${medals[i]} **${item.totalReactions}개 반응** | [메시지 바로가기](${item.message.url})\n> ${preview}\n> 작성자: ${author}${threadInfo}`;
    });
    embed.addFields({ name: REACTION_NAME, value: lines.join("\n\n") });
  }

  const COMMENT_NAME = "가장 활발히 대화🗣️했던 메시지 TOP 3";
  if (threadTop3.length === 0) {
    embed.addFields({
      name: COMMENT_NAME,
      value: "해당 메시지가 없습니다.",
    });
  } else {
    const lines = threadTop3.map((item, i) => {
      const preview =
        item.message.content.length > PREVIEW_MAX_LENGTH
          ? item.message.content.slice(0, PREVIEW_MAX_LENGTH) + "..."
          : item.message.content || "(내용 없음)";
      const author =
        item.message.author.displayName ?? item.message.author.username;
      const threadName = item.message.thread?.name ?? "";
      const threadInfo = threadName ? ` | 스레드: ${threadName}` : "";
      return `${medals[i]} **${item.commentCount}개 댓글** | [메시지 바로가기](${item.message.url})\n> ${preview}\n> 작성자: ${author}${threadInfo}`;
    });
    embed.addFields({ name: COMMENT_NAME, value: lines.join("\n\n") });
  }

  type CountEntry = { count: number; displayName: string };

  const addCount = (
    map: Map<string, CountEntry>,
    author: { id: string; displayName: string },
    amount = 1,
  ) => {
    const existing = map.get(author.id);
    if (existing) existing.count += amount;
    else map.set(author.id, { count: amount, displayName: author.displayName });
  };

  const formatTop3 = (map: Map<string, CountEntry>) =>
    [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, TOP_N)
      .map(
        ([, { count, displayName }], i) =>
          `${i + 1}. ${displayName} (${count}개)`,
      )
      .join(" | ");

  const addRankingField = (name: string, map: Map<string, CountEntry>) => {
    embed.addFields({
      name,
      value: map.size === 0 ? "해당 멤버가 없습니다." : formatTop3(map),
    });
  };

  const messageCounts = new Map<string, CountEntry>();
  const urlCounts = new Map<string, CountEntry>();
  const reactionReceivedCounts = new Map<string, CountEntry>();

  for (const m of allMessages) {
    if (m.author.bot) continue;
    const author = {
      id: m.author.id,
      displayName: m.author.displayName ?? m.author.username,
    };
    addCount(messageCounts, author);
    if (URL_REGEX.test(m.content)) addCount(urlCounts, author);
    const totalReactions = m.reactions.cache.reduce(
      (sum, r) => sum + (r.count ?? 0),
      0,
    );
    if (totalReactions > 0)
      addCount(reactionReceivedCounts, author, totalReactions);
  }

  const reactionGivenCounts = new Map<string, CountEntry>();
  const messagesWithReactions = allMessages.filter(
    (m) => m.reactions.cache.size > 0,
  );
  await Promise.all(
    messagesWithReactions.map(async (m) => {
      const fetches = m.reactions.cache.map((reaction) =>
        reaction.users.fetch(),
      );
      const userCollections = await Promise.all(fetches);
      for (const users of userCollections) {
        for (const user of users.values()) {
          if (user.bot) continue;
          addCount(reactionGivenCounts, {
            id: user.id,
            displayName: user.displayName ?? user.username,
          });
        }
      }
    }),
  );

  addRankingField("💬 가장 많이 대화한 사람 TOP 3", messageCounts);
  addRankingField("🔗 가장 많이 아티클을 공유한 사람 TOP 3", urlCounts);
  addRankingField("🎶 리액션이 가장 많았던 사람 TOP 3", reactionGivenCounts);
  addRankingField(
    "😎 리액션을 가장 많이 받은 사람 TOP 3",
    reactionReceivedCounts,
  );

  return embed;
}
