import {
  EmbedBuilder,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  TextChannel,
  User,
} from "discord.js";
import {
  allowedChannelIds,
  gaechuChannelId,
  reactionThreshold,
} from "../../config.json";
import { EMBED_COLOR } from "../constants/discord";
import { SEVEN_DAYS_MS } from "../constants/time";
import { URL_REGEX } from "../utils/url";

/**
 * 동시 리액션에 의한 중복 전송 방지.
 * 같은 메시지에 대한 두 번째 이벤트는 첫 번째 처리 완료까지 무시된다.
 * 첫 번째 이벤트 시점에 reactions.cache가 이미 최신이므로 정확한 count를 사용한다.
 */
const processing = new Set<string>();

function getMaxReactionCount(
  reaction: MessageReaction | PartialMessageReaction,
): number {
  const message = reaction.message;
  return message.reactions.cache.reduce(
    (max, r) => Math.max(max, r.count ?? 0),
    0,
  );
}

/**
 * 메시지가 속한 실제 채널 ID를 반환.
 * 스레드 내 메시지는 channelId가 스레드 ID이므로 parentId를 사용한다.
 */
function getSourceChannelId(
  message: MessageReaction["message"],
): string | null {
  const channel = message.channel;
  if (channel.isThread()) {
    return channel.parentId;
  }
  return channel.id;
}

function buildGaechuMetaEmbed(
  message: MessageReaction["message"],
  threadUrl?: string,
): EmbedBuilder {
  const author = message.author;
  const content = message.content ?? "";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("🏆 개추된 글")
    .setDescription(content || "(내용 없음)")
    .setTimestamp(message.createdAt);

  if (author) {
    embed.setAuthor({
      name: author.displayName ?? author.username,
      iconURL: author.displayAvatarURL(),
    });
  }

  if (threadUrl) {
    embed.addFields({
      name: "💬 원본 스레드",
      value: `[보러가기](${threadUrl})`,
    });
  }

  return embed;
}

/**
 * 원본 메시지의 내용, 첨부파일, 기존 임베드(링크 요약 등)를 포함한
 * 개추 메시지 전송 페이로드를 구성한다.
 */
async function buildGaechuPayload(
  message: MessageReaction["message"],
): Promise<{ embeds: EmbedBuilder[]; files: string[] }> {
  // 원본 메시지의 기존 임베드 복제 (링크 요약 등)
  const originalEmbeds = message.embeds.map((e) => EmbedBuilder.from(e));

  // 스레드 fetch — message.thread가 캐시에 없을 수 있으므로 hasThread로 확인 후 fetch
  let threadUrl: string | undefined;
  let thread = message.thread;
  if (!thread && message.hasThread) {
    try {
      const channel = message.channel;
      if ("threads" in channel && channel.threads) {
        thread = await channel.threads.fetch(message.id);
      }
    } catch {
      // 스레드 fetch 실패 시 무시
    }
  }

  if (thread) {
    threadUrl = `https://discord.com/channels/${thread.guildId}/${thread.id}`;

    // 스레드에 달린 봇의 요약 임베드 가져오기
    try {
      const threadMessages = await thread.messages.fetch({ limit: 10 });
      for (const tm of threadMessages.values()) {
        if (tm.author.id === message.client.user?.id && tm.embeds.length > 0) {
          originalEmbeds.push(...tm.embeds.map((e) => EmbedBuilder.from(e)));
        }
      }
    } catch {
      // 스레드 메시지 fetch 실패 시 무시
    }
  }

  const metaEmbed = buildGaechuMetaEmbed(message, threadUrl);

  // 첨부파일 URL 수집
  const files = message.attachments.map((a) => a.url);

  // Discord 임베드 제한: 최대 10개
  const allEmbeds = [metaEmbed, ...originalEmbeds].slice(0, 10);

  return { embeds: allEmbeds, files };
}

/**
 * 개추해 채널에서 7일 이내 봇 메시지 중 predicate에 매칭되는 것을 찾는다.
 */
async function findInGaechuChannel(
  gaechuChannel: TextChannel,
  predicate: (embed: {
    url: string | null;
    fields: { name: string; value: string }[];
  }) => boolean,
): Promise<{ messageId: string; currentMax: number } | null> {
  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
  let lastId: string | undefined;

  while (true) {
    const options: { limit: number; before?: string } = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await gaechuChannel.messages.fetch(options);
    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      if (msg.createdTimestamp < sevenDaysAgo) return null;
      if (msg.author.id !== msg.client.user?.id) continue;

      const embed = msg.embeds[0];
      if (!embed) continue;

      if (predicate(embed)) {
        const reactionField = embed.fields.find((f) => f.name === "리액션");
        const currentMax = reactionField
          ? parseInt(reactionField.value, 10)
          : 0;
        return { messageId: msg.id, currentMax };
      }
    }

    const oldest = batch.last();
    if (!oldest || oldest.createdTimestamp < sevenDaysAgo) break;
    lastId = oldest.id;
  }

  return null;
}

async function ensureFullReaction(
  reaction: MessageReaction | PartialMessageReaction,
): Promise<boolean> {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (err) {
      console.error("[개추해] 리액션 fetch 실패:", err);
      return false;
    }
  }
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (err) {
      console.error("[개추해] 메시지 fetch 실패:", err);
      return false;
    }
  }
  return true;
}

async function handleDuplicateCheck(
  gaechuChannel: TextChannel,
  predicate: (embed: {
    url: string | null;
    fields: { name: string; value: string }[];
  }) => boolean,
  message: MessageReaction["message"],
  maxCount: number,
): Promise<boolean> {
  const existing = await findInGaechuChannel(gaechuChannel, predicate);
  if (!existing) return false;

  if (maxCount > existing.currentMax) {
    console.log(
      `[개추해] 중복 발견, 리액션 업데이트: ${existing.currentMax} → ${maxCount}`,
    );
    const existingMsg = await gaechuChannel.messages.fetch(existing.messageId);
    const payload = await buildGaechuPayload(message);
    await existingMsg.edit(payload);
  } else {
    console.log("[개추해] 중복이며 기존 리액션이 더 높음, 스킵");
  }
  return true;
}

export async function onMessageReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _user: User | PartialUser,
): Promise<void> {
  if (!(await ensureFullReaction(reaction))) return;

  const message = reaction.message;

  // 설정 검증
  if (!gaechuChannelId) return;

  // 스레드 내 메시지는 parentId로 채널 확인
  const sourceChannelId = getSourceChannelId(message);
  if (!sourceChannelId || !allowedChannelIds.includes(sourceChannelId)) return;

  // 최대 리액션 수 확인 (단일 이모지 중 최대값)
  const maxCount = getMaxReactionCount(reaction);
  if (maxCount < reactionThreshold) return;

  // 동시 리액션 중복 방지
  if (processing.has(message.id)) return;
  processing.add(message.id);

  try {
    console.log(
      `[개추해] 임계값 도달: ${maxCount}개 (메시지: ${message.id}, 채널: ${sourceChannelId})`,
    );

    // 개추해 채널 가져오기
    const gaechuChannel = await message.client.channels.fetch(gaechuChannelId);
    if (!gaechuChannel || !(gaechuChannel instanceof TextChannel)) {
      console.error(
        "[개추해] 개추해 채널을 찾을 수 없거나 텍스트 채널이 아닙니다.",
      );
      return;
    }

    const content = message.content ?? "";
    const urlMatch = content.match(URL_REGEX);
    const url = urlMatch?.[0];

    const predicate = url
      ? (embed: { url: string | null }) => embed.url === url
      : (embed: { fields: { name: string; value: string }[] }) => {
          const linkField = embed.fields.find((f) => f.name === "원본 메시지");
          return linkField ? linkField.value.includes(message.url) : false;
        };

    const isDuplicate = await handleDuplicateCheck(
      gaechuChannel,
      predicate,
      message,
      maxCount,
    );
    if (isDuplicate) return;

    // 새 개추 메시지 전송
    const payload = await buildGaechuPayload(message);
    await gaechuChannel.send(payload);
    console.log(`[개추해] 개추 완료: ${message.url}`);
  } finally {
    processing.delete(message.id);
  }
}
