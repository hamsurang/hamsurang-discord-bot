import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DB_DIR = path.join(__dirname, "../../data");
const DB_PATH = path.join(DB_DIR, "gaechu.db");

// data/ 디렉토리가 없으면 자동 생성 (fresh deploy 대응)
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL 모드: 읽기/쓰기 동시 성능 향상
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS gaechu_sent (
    message_id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (unixepoch())
  )
`);

// prepared statement 캐싱
const selectStmt = db.prepare("SELECT 1 FROM gaechu_sent WHERE message_id = ?");
const insertStmt = db.prepare(
  "INSERT OR IGNORE INTO gaechu_sent (message_id) VALUES (?)",
);

/** 이미 개추된 메시지인지 확인 */
export function isGaechuSent(messageId: string): boolean {
  return !!selectStmt.get(messageId);
}

/** 개추 완료된 메시지 ID 기록 */
export function markGaechuSent(messageId: string): void {
  insertStmt.run(messageId);
}
