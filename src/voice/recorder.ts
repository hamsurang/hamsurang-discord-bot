import { VoiceConnection, EndBehaviorType } from "@discordjs/voice";
import { OpusEncoder } from "@discordjs/opus";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const CHUNK_SIZE_LIMIT = 20 * 1024 * 1024; // ~20MB

export interface RecordingSession {
  guildId: string;
  channelId: string;
  connection: VoiceConnection;
  tmpDir: string;
  chunkIndex: number;
  currentChunkSize: number;
  currentWriteStream: fs.WriteStream | null;
  transcribedTexts: string[];
  userStreams: Map<string, NodeJS.Timeout>;
  mixBuffer: Map<string, Buffer>;
  mixInterval: NodeJS.Timeout | null;
  sttInterval: NodeJS.Timeout | null;
}

export const activeSessions = new Map<string, RecordingSession>();

export function createSession(
  guildId: string,
  channelId: string,
  connection: VoiceConnection,
): RecordingSession {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discord-voice-"));

  const session: RecordingSession = {
    guildId,
    channelId,
    connection,
    tmpDir,
    chunkIndex: 0,
    currentChunkSize: 0,
    currentWriteStream: null,
    transcribedTexts: [],
    userStreams: new Map(),
    mixBuffer: new Map(),
    mixInterval: null,
    sttInterval: null,
  };

  activeSessions.set(guildId, session);
  return session;
}

function getOrCreateChunkStream(session: RecordingSession): fs.WriteStream {
  if (!session.currentWriteStream) {
    const filePath = path.join(
      session.tmpDir,
      `chunk_${session.chunkIndex}.pcm`,
    );
    session.currentWriteStream = fs.createWriteStream(filePath);
    session.currentChunkSize = 0;
  }
  return session.currentWriteStream;
}

export function rotateChunk(session: RecordingSession): string | null {
  if (!session.currentWriteStream) return null;

  const filePath = path.join(session.tmpDir, `chunk_${session.chunkIndex}.pcm`);
  session.currentWriteStream.end();
  session.currentWriteStream = null;

  if (session.currentChunkSize === 0) return null;

  session.chunkIndex++;
  return filePath;
}

function shouldRotate(session: RecordingSession): boolean {
  return session.currentChunkSize >= CHUNK_SIZE_LIMIT;
}

export function startListening(session: RecordingSession): void {
  const receiver = session.connection.receiver;
  const encoder = new OpusEncoder(SAMPLE_RATE, CHANNELS);

  console.log("[녹음] speaking 이벤트 리스너 등록");

  receiver.speaking.on("start", (userId: string) => {
    if (session.userStreams.has(userId)) return;
    session.userStreams.set(userId, null as unknown as NodeJS.Timeout);

    console.log(`[녹음] 유저 ${userId} speaking 감지, 오디오 구독 시작`);

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.Manual },
    });

    audioStream.on("error", (err) => {
      console.error(`[녹음] audioStream 에러 (유저: ${userId}):`, err.message);
    });

    let packetCount = 0;
    audioStream.on("data", (chunk: Buffer) => {
      try {
        const pcm = encoder.decode(chunk);
        packetCount++;
        if (packetCount <= 3) {
          console.log(
            `[녹음] 유저 ${userId} 패킷 #${packetCount} 수신 (Opus: ${chunk.length}B -> PCM: ${pcm.length}B)`,
          );
        }
        const existing = session.mixBuffer.get(userId);
        if (existing) {
          session.mixBuffer.set(userId, Buffer.concat([existing, pcm]));
        } else {
          session.mixBuffer.set(userId, pcm);
        }
      } catch (err) {
        console.error(`[녹음] Opus 디코딩 실패 (유저: ${userId}):`, err);
      }
    });
  });

  // 60ms마다 믹스 버퍼를 합쳐서 파일에 쓰기
  let mixCount = 0;
  session.mixInterval = setInterval(() => {
    if (session.mixBuffer.size === 0) return;

    let maxLen = 0;
    for (const buf of session.mixBuffer.values()) {
      if (buf.length > maxLen) maxLen = buf.length;
    }

    if (maxLen === 0) return;

    const mixed = Buffer.alloc(maxLen, 0);
    for (const buf of session.mixBuffer.values()) {
      for (let i = 0; i < buf.length - 1; i += 2) {
        const sample = buf.readInt16LE(i);
        const existing = mixed.readInt16LE(i);
        const sum = existing + sample;
        mixed.writeInt16LE(Math.max(-32768, Math.min(32767, sum)), i);
      }
    }

    session.mixBuffer.clear();

    const stream = getOrCreateChunkStream(session);
    stream.write(mixed);
    session.currentChunkSize += mixed.length;

    mixCount++;
    if (mixCount <= 5 || mixCount % 500 === 0) {
      console.log(
        `[녹음] 믹스 #${mixCount} — 청크 크기: ${(session.currentChunkSize / 1024).toFixed(1)}KB`,
      );
    }
  }, 60);

  // 10초마다 청크 크기 체크 → 20MB 초과 시 STT 처리
  session.sttInterval = setInterval(async () => {
    if (shouldRotate(session)) {
      const chunkPath = rotateChunk(session);
      if (chunkPath) {
        try {
          const { transcribePcmFile } = await import("./transcriber");
          const text = await transcribePcmFile(chunkPath);
          if (text.trim()) {
            session.transcribedTexts.push(text);
          }
        } catch (err) {
          console.error("주기적 STT 실패:", err);
        }
      }
    }
  }, 10_000);
}

export function stopListening(session: RecordingSession): void {
  if (session.mixInterval) {
    clearInterval(session.mixInterval);
    session.mixInterval = null;
  }

  if (session.sttInterval) {
    clearInterval(session.sttInterval);
    session.sttInterval = null;
  }

  for (const timeout of session.userStreams.values()) {
    clearTimeout(timeout);
  }
  session.userStreams.clear();
  session.mixBuffer.clear();
}

export function cleanup(session: RecordingSession): void {
  try {
    fs.rmSync(session.tmpDir, { recursive: true, force: true });
  } catch {
    // 정리 실패 무시
  }
  activeSessions.delete(session.guildId);
}
