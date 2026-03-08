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
    .setDescription('지난 7일간 이 채널의 메시지·멤버 주간 랭킹을 보여줍니다.'),

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

    const REACTION_NAME = '가장 좋아요👍가 많았던 메시지 TOP 3'
    // 리액션 섹션
    if (reactionTop3.length === 0) {
      embed.addFields({ name: REACTION_NAME, value: '해당 메시지가 없습니다.' });
    } else {
      const lines = reactionTop3.map((item, i) => {
        const url = item.message.content.match(URL_REGEX)?.[0] ?? '';
        const preview = url.length > 60 ? url.slice(0, 60) + '...' : url;
        const author = item.message.author.displayName ?? item.message.author.username;
        const threadName = item.message.thread?.name ?? '';
        const threadInfo = threadName ? ` | 스레드: ${threadName}` : '';
        return `${medals[i]} **${item.totalReactions}개 반응** | [메시지 바로가기](${item.message.url})\n> ${preview}\n> 작성자: ${author}${threadInfo}`;
      });
      embed.addFields({ name: REACTION_NAME, value: lines.join('\n\n') });
    }

    const COMMENT_NAME = '가장 활발히 대화🗣️했던 메시지 TOP 3'
    // 댓글 섹션
    if (threadTop3.length === 0) {
      embed.addFields({ name: COMMENT_NAME, value: '해당 메시지가 없습니다.' });
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
      embed.addFields({ name: COMMENT_NAME, value: lines.join('\n\n') });
    }

    // ── 멤버 기준 랭킹 ──

    type CountEntry = { count: number; displayName: string };

    const addCount = (map: Map<string, CountEntry>, id: string, displayName: string, amount = 1) => {
      const existing = map.get(id);
      if (existing) existing.count += amount;
      else map.set(id, { count: amount, displayName });
    };

    const formatTop3 = (map: Map<string, CountEntry>) =>
      [...map.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 3)
        .map(([, { count, displayName }], i) => `${i + 1}. ${displayName} (${count}개)`)
        .join(' | ');

    const addRankingField = (name: string, map: Map<string, CountEntry>) => {
      embed.addFields({ name, value: map.size === 0 ? '해당 멤버가 없습니다.' : formatTop3(map) });
    };

    // Single pass for message counts, URL counts, reaction received counts
    const messageCounts = new Map<string, CountEntry>();
    const urlCounts = new Map<string, CountEntry>();
    const reactionReceivedCounts = new Map<string, CountEntry>();

    for (const m of messages) {
      if (m.author.bot) continue;
      const displayName = m.author.displayName ?? m.author.username;
      addCount(messageCounts, m.author.id, displayName);
      if (URL_REGEX.test(m.content)) addCount(urlCounts, m.author.id, displayName);
      const totalReactions = m.reactions.cache.reduce((sum, r) => sum + (r.count ?? 0), 0);
      if (totalReactions > 0) addCount(reactionReceivedCounts, m.author.id, displayName, totalReactions);
    }

    // Reaction givers: fetch reaction users in parallel per message to reduce N+1
    const reactionGivenCounts = new Map<string, CountEntry>();
    const messagesWithReactions = messages.filter((m) => m.reactions.cache.size > 0);
    await Promise.all(
      messagesWithReactions.map(async (m) => {
        const fetches = m.reactions.cache.map((reaction) => reaction.users.fetch());
        const userCollections = await Promise.all(fetches);
        for (const users of userCollections) {
          for (const user of users.values()) {
            if (user.bot) continue;
            addCount(reactionGivenCounts, user.id, user.displayName ?? user.username);
          }
        }
      }),
    );

    addRankingField('💬 가장 많이 대화한 사람 TOP 3', messageCounts);
    addRankingField('🔗 가장 많이 아티클을 공유한 사람 TOP 3', urlCounts);
    addRankingField('🎶 리액션이 가장 많았던 사람 TOP 3', reactionGivenCounts);
    addRankingField('😎 리액션을 가장 많이 받은 사람 TOP 3', reactionReceivedCounts);

    await interaction.editReply({ embeds: [embed] });
  },
};

module.exports = command;
