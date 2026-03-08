import fs from "node:fs";
import path from "node:path";
import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import { token } from "../config.json";
import { Command } from "./types";
import { onMessageCreate } from "./events/messageCreate";

declare module "discord.js" {
  interface Client {
    commands: Collection<string, Command>;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, "commands");
// NOTE: voice 폴더는 Lightsail 배포 시 음성 관련 의존성 미지원으로 제외
const EXCLUDED_COMMAND_FOLDERS = ["voice"];
const commandFolders = fs
  .readdirSync(foldersPath)
  .filter((folder) => !EXCLUDED_COMMAND_FOLDERS.includes(folder));

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js") || file.endsWith(".ts"));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const command: Command = require(filePath);
    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
      );
    }
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[봇] Ready! Logged in as ${readyClient.user.tag}`);
  console.log(`[봇] 등록된 커맨드: ${[...client.commands.keys()].join(", ")}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  console.log(
    `[커맨드] "${interaction.commandName}" 수신 (유저: ${interaction.user.tag}, 길드: ${interaction.guildId})`,
  );

  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.error(
      `[커맨드] "${interaction.commandName}" 매칭 실패 — 등록된 커맨드에 없음`,
    );
    return;
  }

  try {
    console.log(`[커맨드] "${interaction.commandName}" 실행 시작`);
    await command.execute(interaction);
    console.log(`[커맨드] "${interaction.commandName}" 실행 완료`);
  } catch (error) {
    console.error(`[커맨드] "${interaction.commandName}" 실행 중 에러:`, error);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "There was an error while executing this command!",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: "There was an error while executing this command!",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      console.error("[커맨드] 에러 응답도 실패:", replyError);
    }
  }
});

client.on(Events.MessageCreate, onMessageCreate);

client.login(token);
