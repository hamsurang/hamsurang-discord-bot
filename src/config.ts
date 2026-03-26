function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const token = required("DISCORD_TOKEN");
export const clientId = required("DISCORD_CLIENT_ID");
export const guildId = required("DISCORD_GUILD_ID");
export const geminiApiKey = required("GEMINI_API_KEY");
export const openaiApiKey = required("OPENAI_API_KEY");
export const gaechuChannelId = required("GAECHU_CHANNEL_ID");
export const trackingChannelIds = required("TRACKING_CHANNEL_IDS").split(",");
export const summaryChannelIds = required("SUMMARY_CHANNEL_IDS").split(",");
export const reactionThreshold = Number(process.env.REACTION_THRESHOLD ?? "5");
