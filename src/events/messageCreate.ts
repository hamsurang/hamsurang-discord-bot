import { EmbedBuilder, Message, ThreadAutoArchiveDuration } from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import { parse } from 'node-html-parser';
import { YoutubeTranscript } from 'youtube-transcript';
import { anthropicApiKey, allowedChannelIds } from '../../config.json';

const anthropic = new Anthropic({ apiKey: anthropicApiKey });

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

  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `아래 웹페이지를 한국어 2~3문장으로 요약하고, 대표 키워드 최대 3개를 쉼표로 나열해줘.\n형식:\n요약: ...\n키워드: ...\n\n${cleaned}`,
      },
    ],
  });

  const block = result.content[0];
  return block.type === 'text' ? block.text : '요약을 생성할 수 없습니다.';
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

  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `아래 YouTube 자막을 한국어 2~3문장으로 요약하고, 대표 키워드 최대 3개를 쉼표로 나열해줘.\n형식:\n요약: ...\n키워드: ...\n\n${transcript}`,
      },
    ],
  });

  const block = result.content[0];
  return block.type === 'text' ? block.text : '요약을 생성할 수 없습니다.';
}

export async function onMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!allowedChannelIds.includes(message.channelId)) return;
  if (!message.channel.isTextBased() || !('threads' in message.channel)) return;

  const match = message.content.match(URL_REGEX);
  if (!match) return;

  const rawUrl = match[0];
  let thread;

  try {
    const url = new URL(rawUrl);
    const videoId = extractYouTubeVideoId(rawUrl);
    const threadName = (await fetchOgTitle(rawUrl)) ?? url.hostname.replace(/^www\./, '');
    const channel = message.channel;

    if ('threads' in channel) {
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      });
    }
  } catch {
    return;
  }

  if (!thread) return;

  const placeholder = await thread.send('요약중입니다...💭');

  try {
    const videoId = extractYouTubeVideoId(rawUrl);
    const summary = videoId
      ? await fetchAndSummarizeYouTube(videoId, rawUrl)
      : await fetchAndSummarize(rawUrl);
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
  } catch (error) {
    console.error('요약 실패:', error);
    await placeholder.edit('링크 내용을 읽어오는 데 실패했습니다.');
  }
}
