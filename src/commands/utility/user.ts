import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';

const command: Command = {
  data: new SlashCommandBuilder().setName('user').setDescription('Provides information about the user.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember | null;
    await interaction.reply(
      `This command was run by ${interaction.user.username}, who joined on ${member?.joinedAt}.`,
    );
  },
};

module.exports = command;
