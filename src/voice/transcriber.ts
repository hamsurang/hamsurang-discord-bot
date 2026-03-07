import fs from 'node:fs';
import OpenAI from 'openai';
import { openaiApiKey } from '../../config.json';

const openai = new OpenAI({ apiKey: openaiApiKey });

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;

function pcmToWav(pcmPath: string): string {
  const pcmData = fs.readFileSync(pcmPath);
  const wavPath = pcmPath.replace('.pcm', '.wav');

  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8, 28);
  header.writeUInt16LE(CHANNELS * BITS_PER_SAMPLE / 8, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);

  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  fs.writeFileSync(wavPath, Buffer.concat([header, pcmData]));
  return wavPath;
}

export async function transcribePcmFile(pcmPath: string): Promise<string> {
  console.log(`[STT] PCM 파일: ${pcmPath}`);
  const pcmSize = fs.statSync(pcmPath).size;
  console.log(`[STT] PCM 크기: ${(pcmSize / 1024 / 1024).toFixed(2)}MB`);

  const wavPath = pcmToWav(pcmPath);
  const wavSize = fs.statSync(wavPath).size;
  console.log(`[STT] WAV 변환 완료: ${wavPath} (${(wavSize / 1024 / 1024).toFixed(2)}MB)`);

  try {
    console.log('[STT] Whisper API 호출 시작...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(wavPath),
      model: 'whisper-1',
      language: 'ko',
    });
    console.log(`[STT] Whisper 결과: "${transcription.text.slice(0, 100)}..." (길이: ${transcription.text.length})`);
    return transcription.text;
  } finally {
    try { fs.unlinkSync(wavPath); } catch {}
  }
}
