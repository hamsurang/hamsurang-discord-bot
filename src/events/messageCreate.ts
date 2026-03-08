import { EmbedBuilder, Message, ThreadAutoArchiveDuration } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import { parse } from 'node-html-parser';
import { YoutubeTranscript } from 'youtube-transcript';
import { geminiApiKey, allowedChannelIds } from '../../config.json';

const ai = new GoogleGenAI({ apiKey: geminiApiKey });

const URL_REGEX = /https?:\/\/[^\s]+/;

async function fetchAndSummarize(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });

  const html = await response.text();
  const root = parse(html);

  root.querySelectorAll('script, style, nav, footer, aside').forEach((el) => el.remove());
  const text = root.querySelector('main, article, body')?.text ?? root.text;
  const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 8000);

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `아래 웹페이지 내용을 요약해줘.

규칙:
- 마크다운 리스트(bullet point) 형식으로 작성
- 글의 핵심 내용을 소주제별로 나누어 정리 (최대 3개)
- 각 항목은 "**소주제**: 설명" 형태로, 설명은 1~2문장 이내
- 소주제는 글의 내용에 맞게 자유롭게 구성
- 마지막에 키워드 최대 3개를 쉼표로 나열

${cleaned}`,
  });

  return result.text ?? '요약을 생성할 수 없습니다.';
}

function extractYouTubeVideoId(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.hostname.includes('youtube.com')) {
    return parsed.searchParams.get('v');
  }
  if (parsed.hostname === 'youtu.be') {
    return parsed.pathname.slice(1);
  }
  return null;
}

async function fetchOgTitle(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    const html = await response.text();
    const root = parse(html);
    const ogTitle = root.querySelector('meta[property="og:title"]');
    return ogTitle?.getAttribute('content') ?? null;
  } catch {
    return null;
  }
}

async function fetchAndSummarizeYouTube(videoId: string, url: string): Promise<string> {
  let transcript: string;
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    transcript = items
      .map((item) => item.text)
      .join(' ')
      .slice(0, 8000);
  } catch {
    return '자막을 찾을 수 없습니다. 자막이 비활성화되었거나 지원되지 않는 영상입니다.';
  }

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `아래 YouTube 자막 내용을 요약해줘.

규칙:
- 마크다운 리스트(bullet point) 형식으로 작성
- 글의 핵심 내용을 소주제별로 나누어 정리 (최대 3개)
- 각 항목은 "**소주제**: 설명" 형태로, 설명은 1~2문장 이내
- 소주제는 글의 내용에 맞게 자유롭게 구성
- 마지막에 키워드 최대 3개를 쉼표로 나열

${transcript}`,
  });

  return result.text ?? '요약을 생성할 수 없습니다.';
}

export async function onMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!allowedChannelIds.includes(message.channelId)) return;
  if (!message.channel.isTextBased() || !('threads' in message.channel)) return;

  const match = message.content.match(URL_REGEX);
  if (!match) return;

  const rawUrl = match[0];
  console.log(`[링크요약] URL 감지: ${rawUrl} (유저: ${message.author.tag}, 채널: ${message.channelId})`);
  let thread;

  try {
    const url = new URL(rawUrl);
    const videoId = extractYouTubeVideoId(rawUrl);
    console.log(`[링크요약] YouTube 여부: ${videoId ? `ID=${videoId}` : '아님'}`);
    const threadName = (await fetchOgTitle(rawUrl)) ?? url.hostname.replace(/^www\./, '');
    console.log(`[링크요약] 스레드 이름: "${threadName}"`);
    const channel = message.channel;

    if ('threads' in channel) {
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      });
      console.log(`[링크요약] 스레드 생성 완료: ${thread.id}`);
    }
  } catch (err) {
    console.error('[링크요약] 스레드 생성 실패:', err);
    return;
  }

  if (!thread) return;

  const placeholder = await thread.send('요약중입니다...💭');

  try {
    const videoId = extractYouTubeVideoId(rawUrl);
    console.log(`[링크요약] 요약 시작 (${videoId ? 'YouTube' : '일반 웹페이지'})`);
    const summary = videoId
      ? await fetchAndSummarizeYouTube(videoId, rawUrl)
      : await fetchAndSummarize(rawUrl);
    console.log(`[링크요약] 요약 완료 (길이: ${summary.length})`);
    const keywordMatch = summary.match(/키워드:\s*(.+)/);
    const summaryText = summary.replace(/키워드:\s*.+/, '').trim();
    const keywords = keywordMatch?.[1]
      ?.split(',')
      .map((k) => `\`${k.trim()}\``)
      .join('  ');

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('링크 요약')
      .setURL(rawUrl)
      .setDescription(summaryText)
      .setFooter({ text: rawUrl })
      .setTimestamp();

    if (keywords) {
      embed.addFields({ name: '🏷️ 키워드', value: keywords });
    }
    await placeholder.edit({ content: '', embeds: [embed] });
    console.log(`[링크요약] 임베드 게시 완료: ${rawUrl}`);
  } catch (error) {
    console.error('[링크요약] 요약 실패:', error);
    await placeholder.edit('링크 내용을 읽어오는 데 실패했습니다.');
  }
}
