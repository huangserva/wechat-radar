import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

loadEnvLocal();

const DATA_DIR = process.env.WECHAT_RADAR_DATA_DIR || join(homedir(), '.wechat-radar');
const DB_PATH = join(DATA_DIR, 'radar.db');

type CountRow = { n: number };
type SqlRow = { sql: string | null };

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

function loadEnvLocal() {
  try {
    const envContent = readFileSync(resolve(projectRoot, '.env.local'), 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local is optional; lib/config.ts uses the same environment fallback.
  }
}

function assertFts5Available() {
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp._fts5_probe USING fts5(x)");
    db.exec('DROP TABLE temp._fts5_probe');
  } catch (e) {
    throw new Error(`SQLite FTS5 is not available in this better-sqlite3 build: ${(e as Error).message}`);
  }
}

function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as CountRow).n;
}

function existingFtsSql(): string | null {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'")
    .get() as SqlRow | undefined;
  return row?.sql ?? null;
}

function recreateFtsIfIncompatible() {
  const sql = existingFtsSql();
  if (!sql) return;
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
  const compatible =
    normalized.includes('using fts5') &&
    normalized.includes('content') &&
    normalized.includes('sender') &&
    normalized.includes("content='messages'") &&
    normalized.includes("content_rowid='rowid'");
  if (compatible) return;
  console.warn('[fts5] Existing messages_fts is incompatible; dropping FTS index only.');
  db.exec('DROP TABLE messages_fts');
}

const startedAt = Date.now();
console.log(`[fts5] DB: ${DB_PATH}`);

assertFts5Available();
recreateFtsIfIncompatible();

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    sender,
    content='messages',
    content_rowid='rowid',
    tokenize='unicode61'
  );

  DROP TRIGGER IF EXISTS messages_fts_ai;
  DROP TRIGGER IF EXISTS messages_fts_ad;
  DROP TRIGGER IF EXISTS messages_fts_au;
`);

const messageCount = count('messages');
console.log(`[fts5] messages rows: ${messageCount}`);
console.log('[fts5] rebuilding messages_fts...');

db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");

db.exec(`
  CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, sender)
    VALUES (new.rowid, new.content, new.sender);
  END;

  CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content, sender)
    VALUES ('delete', old.rowid, old.content, old.sender);
  END;

  CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content, sender)
    VALUES ('delete', old.rowid, old.content, old.sender);
    INSERT INTO messages_fts(rowid, content, sender)
    VALUES (new.rowid, new.content, new.sender);
  END;
`);

db.pragma('optimize');

const indexedCount = count('messages_fts_docsize');
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`[fts5] indexed rows: ${indexedCount}`);
console.log(`[fts5] triggers: messages_fts_ai/messages_fts_ad/messages_fts_au`);
console.log(`[fts5] done in ${elapsed}s`);

db.close();
