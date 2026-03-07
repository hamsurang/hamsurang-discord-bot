import { ChatInputCommandInteraction, GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { Command } from '../../types';
import { activeSessions, createSession, startListening } from '../../voice/recorder';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('요약시작')
    .setDescription('음성채널 녹음을 시작하고, 나중에 요약을 생성합니다.'),

  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: '음성채널에 먼저 접속해주세요.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (activeSessions.has(interaction.guildId!)) {
      await interaction.reply({
        content: '이미 녹음이 진행 중입니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId!,
      adapterCreator: interaction.guild!.voiceAdapterCreator,
      selfDeaf: false,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      connection.destroy();
      await interaction.editReply('음성채널 연결에 실패했습니다.');
      return;
    }

    const session = createSession(interaction.guildId!, voiceChannel.id, connection);
    startListening(session);

    await interaction.editReply(`녹음을 시작합니다 🎙️ (채널: ${voiceChannel.name})`);
  },
};

module.exports = command;
