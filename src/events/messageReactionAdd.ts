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

/**
 * 동시 리액션에 의한 중복 전송 방지.
 * 같은 메시지에 대한 두 번째 이벤트는 첫 번째 처리 완료까지 무시된다.
 */
const processing = new Set<string>();

/** 이미 개추 완료된 메시지 ID 캐시. 개추해 채널 스캔 없이 즉시 중복 판별. */
const gaechuSent = new Set<string>();

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

  // 중복 체크용 원본 메시지 ID를 footer에 저장
  embed.setFooter({ text: `원본: ${message.id}` });

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
    footer: { text: string } | null;
  }) => boolean,
): Promise<{ messageId: string } | null> {
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
        return { messageId: msg.id };
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

async function isDuplicateInGaechu(
  gaechuChannel: TextChannel,
  messageId: string,
): Promise<boolean> {
  const predicate = (embed: {
    url: string | null;
    fields: { name: string; value: string }[];
    footer: { text: string } | null;
  }) => embed.footer?.text === `원본: ${messageId}`;

  const existing = await findInGaechuChannel(gaechuChannel, predicate);
  if (existing) {
    console.log(`[개추해] 이미 개추된 메시지, 스킵 (원본: ${messageId})`);
  }
  return !!existing;
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

    // 인메모리 캐시로 즉시 중복 판별
    if (gaechuSent.has(message.id)) {
      console.log(`[개추해] 이미 개추된 메시지 (캐시), 스킵: ${message.id}`);
      return;
    }

    // 캐시에 없으면 개추해 채널 스캔으로 확인 (봇 재시작 후 대응)
    if (await isDuplicateInGaechu(gaechuChannel, message.id)) {
      gaechuSent.add(message.id);
      return;
    }

    // 새 개추 메시지 전송
    const payload = await buildGaechuPayload(message);
    await gaechuChannel.send(payload);
    gaechuSent.add(message.id);
    console.log(`[개추해] 개추 완료: ${message.url}`);
  } finally {
    processing.delete(message.id);
  }
}
