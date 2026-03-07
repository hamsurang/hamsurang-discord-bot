import { ChatInputCommandInteraction, EmbedBuilder, Message, SlashCommandBuilder, TextChannel } from 'discord.js';
import { Command } from '../../types';

const URL_REGEX = /https?:\/\/[^\s]+/;

async function fetchMessagesForLastWeek(channel: TextChannel): Promise<Message[]> {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
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

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ranking_weekly')
    .setDescription('지난 7일간 이 채널의 리액션 TOP 3 & 댓글 TOP 3를 보여줍니다.'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const channel = interaction.channel;
    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.editReply('이 채널에서는 사용할 수 없습니다.');
      return;
    }

    const messages = await fetchMessagesForLastWeek(channel);

    if (messages.length === 0) {
      await interaction.editReply('지난 7일간 메시지가 없습니다.');
      return;
    }

    // 리액션 TOP 3: URL이 포함된 메시지 중 총 리액션 수 기준
    const reactionTop3 = messages
      .filter((m) => URL_REGEX.test(m.content))
      .map((m) => ({
        message: m,
        totalReactions: m.reactions.cache.reduce((sum, r) => sum + (r.count ?? 0), 0),
      }))
      .filter((item) => item.totalReactions > 0)
      .sort((a, b) => b.totalReactions - a.totalReactions)
      .slice(0, 3);

    // 댓글 TOP 3: 스레드가 있는 메시지 중 스레드 메시지 수 기준
    const threadTop3 = messages
      .filter((m) => m.thread && (m.thread.messageCount ?? 0) > 0)
      .map((m) => ({
        message: m,
        commentCount: m.thread!.messageCount ?? 0,
      }))
      .sort((a, b) => b.commentCount - a.commentCount)
      .slice(0, 3);

    const medals = ['🥇', '🥈', '🥉'];

    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('주간 랭킹 (지난 7일)').setTimestamp();

    // 리액션 섹션
    if (reactionTop3.length === 0) {
      embed.addFields({ name: '리액션 TOP 3 (URL 포함 메시지)', value: '해당 메시지가 없습니다.' });
    } else {
      const lines = reactionTop3.map((item, i) => {
        const url = item.message.content.match(URL_REGEX)?.[0] ?? '';
        const preview = url.length > 60 ? url.slice(0, 60) + '...' : url;
        const author = item.message.author.displayName ?? item.message.author.username;
        const threadName = item.message.thread?.name ?? '';
        const threadInfo = threadName ? ` | 스레드: ${threadName}` : '';
        return `${medals[i]} **${item.totalReactions}개 반응** | [메시지 바로가기](${item.message.url})\n> ${preview}\n> 작성자: ${author}${threadInfo}`;
      });
      embed.addFields({ name: '리액션 TOP 3 (URL 포함 메시지)', value: lines.join('\n\n') });
    }

    // 댓글 섹션
    if (threadTop3.length === 0) {
      embed.addFields({ name: '댓글 TOP 3', value: '해당 메시지가 없습니다.' });
    } else {
      const lines = threadTop3.map((item, i) => {
        const preview =
          item.message.content.length > 60
            ? item.message.content.slice(0, 60) + '...'
            : item.message.content || '(내용 없음)';
        const author = item.message.author.displayName ?? item.message.author.username;
        const threadName = item.message.thread?.name ?? '';
        const threadInfo = threadName ? ` | 스레드: ${threadName}` : '';
        return `${medals[i]} **${item.commentCount}개 댓글** | [메시지 바로가기](${item.message.url})\n> ${preview}\n> 작성자: ${author}${threadInfo}`;
      });
      embed.addFields({ name: '댓글 TOP 3', value: lines.join('\n\n') });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

module.exports = command;
