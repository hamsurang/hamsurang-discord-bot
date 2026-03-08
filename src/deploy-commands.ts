import { REST, Routes } from "discord.js";
import { clientId, guildId, token } from "../config.json";
import fs from "node:fs";
import path from "node:path";
import { Command } from "./types";

const commands: ReturnType<Command["data"]["toJSON"]>[] = [];

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
      commands.push(command.data.toJSON());
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
      );
    }
  }
}

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log(
      `Started refreshing ${commands.length} application (/) commands.`,
    );

    const data = (await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    )) as unknown[];

    console.log(
      `Successfully reloaded ${data.length} application (/) commands.`,
    );
  } catch (error) {
    console.error(error);
  }
})();
