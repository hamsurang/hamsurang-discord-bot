import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import { Command } from "../../types";
import {
  activeSessions,
  createSession,
  startListening,
} from "../../voice/recorder";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("요약시작")
    .setDescription("음성채널 녹음을 시작하고, 나중에 요약을 생성합니다."),

  async execute(interaction: ChatInputCommandInteraction) {
    console.log("[요약시작] execute 진입");
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      console.log("[요약시작] 유저가 음성채널에 없음");
      await interaction.reply({
        content: "음성채널에 먼저 접속해주세요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (activeSessions.has(interaction.guildId!)) {
      console.log("[요약시작] 이미 세션 존재:", interaction.guildId);
      await interaction.reply({
        content: "이미 녹음이 진행 중입니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    console.log(
      `[요약시작] deferReply 완료, 채널: ${voiceChannel.name} (${voiceChannel.id})`,
    );

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId!,
      adapterCreator: interaction.guild!.voiceAdapterCreator,
      selfDeaf: false,
    });
    console.log("[요약시작] joinVoiceChannel 호출 완료");

    connection.on("stateChange", (oldState, newState) => {
      console.log(
        `[요약시작] 연결 상태: ${oldState.status} → ${newState.status}`,
      );
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      console.log("[요약시작] 연결 Ready 도달");
    } catch (err) {
      console.error(
        "[요약시작] 연결 실패, 현재 상태:",
        connection.state.status,
        err,
      );
      connection.destroy();
      await interaction.editReply("음성채널 연결에 실패했습니다.");
      return;
    }

    const session = createSession(
      interaction.guildId!,
      voiceChannel.id,
      connection,
    );
    startListening(session);
    console.log("[요약시작] 녹음 시작 완료");

    await interaction.editReply(
      `녹음을 시작합니다 🎙️ (채널: ${voiceChannel.name})`,
    );
  },
};

module.exports = command;
