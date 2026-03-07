import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import { activeSessions, stopListening, rotateChunk, cleanup } from '../../voice/recorder';
import { transcribePcmFile } from '../../voice/transcriber';
import { summarizeTranscript } from '../../voice/summarizer';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('요약끝')
    .setDescription('음성채널 녹음을 종료하고 요약을 생성합니다.'),

  async execute(interaction: ChatInputCommandInteraction) {
    const session = activeSessions.get(interaction.guildId!);

    if (!session) {
      await interaction.reply({
        content: '진행 중인 녹음이 없습니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    try {
      stopListening(session);

      const lastChunk = rotateChunk(session);

      session.connection.destroy();

      if (lastChunk) {
        const text = await transcribePcmFile(lastChunk);
        if (text.trim()) {
          session.transcribedTexts.push(text);
        }
      }

      const summary = await summarizeTranscript(session.transcribedTexts);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎙️ 음성채널 회의 요약')
        .setDescription(summary)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('음성 요약 실패:', error);
      await interaction.editReply('음성 요약 생성에 실패했습니다.');
    } finally {
      cleanup(session);
    }
  },
};

module.exports = command;
