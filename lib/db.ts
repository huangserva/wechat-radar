import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './config';

const DB_PATH = join(DATA_DIR, 'radar.db');

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  seed(_db);
  return _db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      emoji TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_tags (
      chatroom_id TEXT NOT NULL,
      group_id INTEGER NOT NULL,
      PRIMARY KEY (chatroom_id, group_id),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      chatroom_id TEXT PRIMARY KEY,
      starred_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      chatroom_id TEXT NOT NULL,
      date TEXT NOT NULL,
      total INTEGER NOT NULL,
      top_senders TEXT NOT NULL,
      by_hour TEXT NOT NULL,
      refreshed_at INTEGER NOT NULL,
      PRIMARY KEY (chatroom_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);

    CREATE TABLE IF NOT EXISTS mentions (
      chatroom_id TEXT NOT NULL,
      local_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      time TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chatroom_id, local_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mentions_time ON mentions(timestamp DESC);

    CREATE TABLE IF NOT EXISTS messages (
      chatroom_id TEXT NOT NULL,
      local_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      time TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (chatroom_id, local_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chatroom_date ON messages(chatroom_id, date);
    CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);

    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      message_count INTEGER NOT NULL,
      group_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_topics_date ON topics(date DESC, message_count DESC);

    CREATE TABLE IF NOT EXISTS topic_messages (
      topic_id INTEGER NOT NULL,
      chatroom_id TEXT NOT NULL,
      local_id INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (topic_id, chatroom_id, local_id),
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_topic_messages_topic ON topic_messages(topic_id);

    CREATE TABLE IF NOT EXISTS link_intelligence_cache (
      date TEXT NOT NULL,
      version TEXT NOT NULL,
      payload TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      PRIMARY KEY (date, version)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      chatroom_id TEXT PRIMARY KEY,
      last_synced_at INTEGER NOT NULL,
      first_message_date TEXT,
      last_message_date TEXT,
      total_messages INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  ensureColumn(d, 'sync_state', 'status', "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn(d, 'sync_state', 'last_error', 'TEXT');
  ensureColumn(d, 'sync_state', 'failed_chunks', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'sync_state', 'empty_chunks', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'sync_state', 'total_chunks', 'INTEGER NOT NULL DEFAULT 0');
}

function ensureColumn(d: Database.Database, table: string, name: string, definition: string) {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((r) => r.name === name)) return;
  d.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
}

const SEED_VERSION = 'wechat_radar_v1_2026_05_24';

const DEFAULT_GROUPS: Array<{ name: string; color: string; emoji: string }> = [
  { name: 'AI / Coding', color: '#7dd3a8', emoji: '💻' },
  { name: 'Tools', color: '#f59e0b', emoji: '🛠️' },
  { name: 'Articles', color: '#06b6d4', emoji: '📚' },
  { name: 'Business', color: '#10b981', emoji: '💼' },
  { name: 'Events', color: '#f97316', emoji: '📅' },
  { name: 'Research', color: '#a855f7', emoji: '🔬' },
  { name: 'Lifestyle', color: '#fb7185', emoji: '🏠' },
];

function seed(d: Database.Database) {
  const meta = d.prepare("SELECT value FROM meta WHERE key = 'seed_version'").get() as { value: string } | undefined;
  if (meta?.value === SEED_VERSION) return;

  const tagged = d.prepare('SELECT COUNT(*) AS n FROM group_tags').get() as { n: number };
  if (tagged.n === 0) d.prepare('DELETE FROM groups').run();

  const now = Date.now();
  const insertOrIgnore = d.prepare(
    'INSERT OR IGNORE INTO groups (name, color, emoji, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  d.transaction(() => {
    DEFAULT_GROUPS.forEach((g, i) => insertOrIgnore.run(g.name, g.color, g.emoji, i, now));
  })();

  d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)").run(SEED_VERSION);
}
