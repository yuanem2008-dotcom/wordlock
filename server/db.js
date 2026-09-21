// 打开两个 SQLite 库：dict.db（词典，只读）和 user.db（用户数据）。

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.WORDLOCK_DATA_DIR || path.join(__dirname, '..', 'data');

export function dictDbPath() {
  return path.join(DATA_DIR, 'dict.db');
}

export function openDictDb() {
  const file = dictDbPath();
  if (!fs.existsSync(file)) return null;
  return new Database(file, { readonly: true, fileMustExist: true });
}

export function openUserDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, 'user.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      avatar        TEXT NOT NULL,
      preset        TEXT NOT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      ts         TEXT NOT NULL,
      session_id TEXT,
      mode       TEXT NOT NULL DEFAULT 'en',
      word       TEXT,
      step       TEXT,
      type       TEXT NOT NULL,
      detail     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_profile_ts ON events(profile_id, ts);
    CREATE TABLE IF NOT EXISTS learn_sessions (
      profile_id  INTEGER NOT NULL,
      session_id  TEXT NOT NULL,
      word        TEXT,
      mode        TEXT NOT NULL DEFAULT 'en',
      typing_done INTEGER NOT NULL DEFAULT 0,
      read_pass   INTEGER NOT NULL DEFAULT 0,
      read_fail   INTEGER NOT NULL DEFAULT 0,
      read_attempts INTEGER NOT NULL DEFAULT 0,
      assisted    INTEGER NOT NULL DEFAULT 0,
      quick_peek  INTEGER NOT NULL DEFAULT 0,
      meaning_shown INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (profile_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS vocab (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id      INTEGER NOT NULL,
      word            TEXT NOT NULL,
      entry_mode      TEXT NOT NULL DEFAULT 'en',
      status          TEXT NOT NULL DEFAULT 'learned',
      first_learned_at TEXT NOT NULL,
      assisted        INTEGER NOT NULL DEFAULT 0,
      typing_errors   INTEGER NOT NULL DEFAULT 0,
      read_attempts   INTEGER NOT NULL DEFAULT 0,
      best_score      INTEGER NOT NULL DEFAULT 0,
      stage           INTEGER NOT NULL DEFAULT 0,
      next_review_at  TEXT,
      review_correct  INTEGER NOT NULL DEFAULT 0,
      review_wrong    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(profile_id, word)
    );
    CREATE INDEX IF NOT EXISTS idx_vocab_review ON vocab(profile_id, status, next_review_at);
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}
