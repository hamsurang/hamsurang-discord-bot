import { Message, TextChannel } from "discord.js";

/**
 * 채널에서 cutoffTimestamp 이후의 메시지를 페이지네이션으로 모두 가져온다.
 */
export async function fetchMessagesSince(
  channel: TextChannel,
  cutoffTimestamp: number,
): Promise<Message[]> {
  const allMessages: Message[] = [];
  let lastId: string | undefined;

  while (true) {
    const options: { limit: number; before?: string } = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    const recent = batch.filter((m) => m.createdTimestamp >= cutoffTimestamp);
    allMessages.push(...recent.values());

    const oldest = batch.last();
    if (!oldest || oldest.createdTimestamp < cutoffTimestamp) break;

    lastId = oldest.id;
  }

  return allMessages;
}
