import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "../../types";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong!"),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply("Pong! newnewnews");
  },
};

module.exports = command;
