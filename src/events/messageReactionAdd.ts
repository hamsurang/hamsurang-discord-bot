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

function buildGaechuEmbed(
  message: MessageReaction["message"],
  maxCount: number,
): EmbedBuilder {
  const author = message.author;
  const content = message.content ?? "";
  const urlMatch = content.match(URL_REGEX);
  const url = urlMatch?.[0];

  // 스레드 이름: 스레드 안의 메시지이면 channel.name, 스레드를 시작한 메시지이면 thread.name
  const channel = message.channel;
  const threadName = channel.isThread() ? channel.name : message.thread?.name;

  // 미리보기에서 URL 제거하여 중복 방지
  const contentWithoutUrl = url ? content.replace(url, "").trim() : content;
  const preview =
    contentWithoutUrl.length > 200
      ? contentWithoutUrl.slice(0, 200) + "..."
      : contentWithoutUrl;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("🏆 개추된 글")
    .setDescription(preview || url || "(내용 없음)")
    .addFields(
      {
        name: "원본 메시지",
        value: `[바로가기](${message.url})`,
        inline: true,
      },
      {
        name: "리액션",
        value: `${maxCount}`,
        inline: true,
      },
    )
    .setTimestamp(message.createdAt);

  if (author) {
    embed.setAuthor({
      name: author.displayName ?? author.username,
      iconURL: author.displayAvatarURL(),
    });
  }

  if (url) {
    embed.setURL(url);
  }

  if (threadName) {
    embed.addFields({ name: "스레드", value: threadName, inline: true });
  }

  return embed;
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
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
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

export async function onMessageReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _user: User | PartialUser,
): Promise<void> {
  // partial인 경우 fetch
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (err) {
      console.error("[개추해] 리액션 fetch 실패:", err);
      return;
    }
  }
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (err) {
      console.error("[개추해] 메시지 fetch 실패:", err);
      return;
    }
  }

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

    // URL 기반 중복 체크
    const content = message.content ?? "";
    const urlMatch = content.match(URL_REGEX);
    const url = urlMatch?.[0];

    if (url) {
      const existing = await findInGaechuChannel(
        gaechuChannel,
        (embed) => embed.url === url,
      );
      if (existing) {
        if (maxCount > existing.currentMax) {
          console.log(
            `[개추해] 중복 URL 발견, 리액션 업데이트: ${existing.currentMax} → ${maxCount}`,
          );
          const existingMsg = await gaechuChannel.messages.fetch(
            existing.messageId,
          );
          const embed = buildGaechuEmbed(message, maxCount);
          await existingMsg.edit({ embeds: [embed] });
        } else {
          console.log("[개추해] 중복 URL이며 기존 리액션이 더 높음, 스킵");
        }
        return;
      }
    } else {
      // URL이 없는 메시지: 원본 메시지 URL로 중복 체크
      const existing = await findInGaechuChannel(gaechuChannel, (embed) => {
        const linkField = embed.fields.find((f) => f.name === "원본 메시지");
        return linkField ? linkField.value.includes(message.url) : false;
      });
      if (existing) {
        if (maxCount > existing.currentMax) {
          console.log(
            `[개추해] 중복 메시지 발견, 리액션 업데이트: ${existing.currentMax} → ${maxCount}`,
          );
          const existingMsg = await gaechuChannel.messages.fetch(
            existing.messageId,
          );
          const embed = buildGaechuEmbed(message, maxCount);
          await existingMsg.edit({ embeds: [embed] });
        } else {
          console.log("[개추해] 중복 메시지이며 기존 리액션이 더 높음, 스킵");
        }
        return;
      }
    }

    // 새 개추 메시지 전송
    const embed = buildGaechuEmbed(message, maxCount);
    await gaechuChannel.send({ embeds: [embed] });
    console.log(`[개추해] 개추 완료: ${message.url}`);
  } finally {
    processing.delete(message.id);
  }
}
