import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { Command } from "../../types";
import { buildWeeklyRankingEmbed } from "../../services/weeklyRankingBuilder";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("ranking_weekly")
    .setDescription("지난 7일간 이 채널의 메시지·멤버 주간 랭킹을 보여줍니다."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const channel = interaction.channel;
    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.editReply("이 채널에서는 사용할 수 없습니다.");
      return;
    }

    const embed = await buildWeeklyRankingEmbed([channel]);

    if (!embed) {
      await interaction.editReply("지난 7일간 메시지가 없습니다.");
      return;
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

module.exports = command;
