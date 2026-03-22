import path from "node:path";
import Database from "better-sqlite3";

const DB_PATH = path.join(__dirname, "../../data/gaechu.db");

const db = new Database(DB_PATH);

// WAL 모드: 읽기/쓰기 동시 성능 향상
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS gaechu_sent (
    message_id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (unixepoch())
  )
`);

/** 이미 개추된 메시지인지 확인 */
export function isGaechuSent(messageId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM gaechu_sent WHERE message_id = ?")
    .get(messageId);
  return !!row;
}

/** 개추 완료된 메시지 ID 기록 */
export function markGaechuSent(messageId: string): void {
  db.prepare("INSERT OR IGNORE INTO gaechu_sent (message_id) VALUES (?)").run(
    messageId,
  );
}
