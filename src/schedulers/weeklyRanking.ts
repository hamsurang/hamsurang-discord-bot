import cron from "node-cron";
import { Client, TextChannel } from "discord.js";
import { allowedChannelIds, gaechuChannelId } from "../../config.json";
import { buildWeeklyRankingEmbed } from "../services/weeklyRankingBuilder";

export function startWeeklyRankingScheduler(client: Client): void {
  if (!gaechuChannelId) {
    console.log("[스케줄러] gaechuChannelId 미설정, 주간 랭킹 스케줄러 비활성");
    return;
  }

  // 매주 월요일 09:00 한국시간 (Asia/Seoul)
  cron.schedule(
    "0 9 * * 1",
    async () => {
      console.log("[스케줄러] 주간 랭킹 자동 게시 시작");

      try {
        // 소스 채널들에서 메시지 수집 (개별 채널 실패 시 나머지 계속 진행)
        const sourceChannels: TextChannel[] = [];
        for (const channelId of allowedChannelIds) {
          try {
            const ch = await client.channels.fetch(channelId);
            if (ch instanceof TextChannel) {
              sourceChannels.push(ch);
            }
          } catch (err) {
            console.error(
              `[스케줄러] 채널 ${channelId} fetch 실패, 스킵:`,
              err,
            );
          }
        }

        if (sourceChannels.length === 0) {
          console.error("[스케줄러] 소스 채널을 찾을 수 없습니다.");
          return;
        }

        const embed = await buildWeeklyRankingEmbed(sourceChannels);
        if (!embed) {
          console.log("[스케줄러] 지난 7일간 메시지가 없어 랭킹 미게시");
          return;
        }

        // 개추해 채널에 게시
        const gaechuChannel = await client.channels.fetch(gaechuChannelId);
        if (!gaechuChannel || !(gaechuChannel instanceof TextChannel)) {
          console.error("[스케줄러] 개추해 채널을 찾을 수 없습니다.");
          return;
        }

        await gaechuChannel.send({ embeds: [embed] });
        console.log("[스케줄러] 주간 랭킹 게시 완료");
      } catch (error) {
        console.error("[스케줄러] 주간 랭킹 게시 실패:", error);
      }
    },
    { timezone: "Asia/Seoul" },
  );

  console.log("[스케줄러] 주간 랭킹 스케줄러 등록 (매주 월요일 09:00 KST)");
}
