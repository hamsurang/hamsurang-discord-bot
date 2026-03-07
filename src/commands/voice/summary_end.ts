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
    console.log('[요약끝] execute 진입');
    const session = activeSessions.get(interaction.guildId!);

    if (!session) {
      console.log('[요약끝] 활성 세션 없음');
      await interaction.reply({
        content: '진행 중인 녹음이 없습니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    console.log('[요약끝] deferReply 완료');

    try {
      stopListening(session);
      console.log('[요약끝] stopListening 완료');

      const lastChunk = rotateChunk(session);
      console.log('[요약끝] rotateChunk 결과:', lastChunk, '청크 크기:', session.currentChunkSize);

      session.connection.destroy();
      console.log('[요약끝] connection.destroy 완료');

      if (lastChunk) {
        console.log('[요약끝] STT 시작...');
        const text = await transcribePcmFile(lastChunk);
        console.log('[요약끝] STT 결과 길이:', text.length, '내용 미리보기:', text.slice(0, 100));
        if (text.trim()) {
          session.transcribedTexts.push(text);
        }
      } else {
        console.log('[요약끝] 녹음 데이터 없음 (lastChunk가 null)');
      }

      console.log('[요약끝] 총 텍스트 수:', session.transcribedTexts.length);
      const summary = await summarizeTranscript(session.transcribedTexts);
      console.log('[요약끝] 요약 완료, 길이:', summary.length);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎙️ 음성채널 회의 요약')
        .setDescription(summary)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log('[요약끝] editReply 완료');
    } catch (error) {
      console.error('[요약끝] 음성 요약 실패:', error);
      await interaction.editReply('음성 요약 생성에 실패했습니다.');
    } finally {
      cleanup(session);
      console.log('[요약끝] cleanup 완료');
    }
  },
};

module.exports = command;
