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

    CREATE TABLE IF NOT EXISTS message_links (
      chatroom_id TEXT NOT NULL,
      local_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      sender TEXT NOT NULL,
      time TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      title TEXT,
      description TEXT,
      domain TEXT NOT NULL,
      source TEXT NOT NULL,
      raw_kind TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (chatroom_id, local_id, canonical_url)
    );

    CREATE INDEX IF NOT EXISTS idx_message_links_date
      ON message_links(date, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_message_links_canonical
      ON message_links(canonical_url);
    CREATE INDEX IF NOT EXISTS idx_message_links_domain
      ON message_links(domain);
    CREATE INDEX IF NOT EXISTS idx_message_links_source
      ON message_links(source);

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

    CREATE INDEX IF NOT EXISTS idx_link_intelligence_cache_generated
      ON link_intelligence_cache(generated_at DESC);

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

  migrateLabTables(d);

  ensureColumn(d, 'sync_state', 'status', "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn(d, 'sync_state', 'last_error', 'TEXT');
  ensureColumn(d, 'sync_state', 'failed_chunks', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'sync_state', 'empty_chunks', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'sync_state', 'total_chunks', 'INTEGER NOT NULL DEFAULT 0');
}

function ensureColumn(
  d: Database.Database,
  table: string,
  name: string,
  definition: string,
) {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((r) => r.name === name)) return;
  d.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
}

function tableExists(d: Database.Database, table: string): boolean {
  return Boolean(
    d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
  );
}

function hasColumn(d: Database.Database, table: string, column: string): boolean {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

// Single source of truth for the lab schema — used both for fresh creation and
// for the rebuild path below.
const LAB_TABLES_DDL = `
  CREATE TABLE IF NOT EXISTS conversation_lab_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL,
    chatroom_id TEXT NOT NULL,
    chat_name TEXT,
    target_wxid TEXT,
    target_display_name TEXT NOT NULL,
    target_resolution_json TEXT NOT NULL,
    since TEXT NOT NULL,
    until TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    source TEXT NOT NULL,
    source_message_hash TEXT NOT NULL,
    dimensions_hash TEXT NOT NULL,
    compression_version TEXT NOT NULL,
    compression_json TEXT NOT NULL,
    profile_context_used INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL,
    model_reading TEXT NOT NULL,
    avg_score INTEGER NOT NULL DEFAULT 0,
    detail_count INTEGER NOT NULL DEFAULT 0,
    risk_count INTEGER NOT NULL DEFAULT 0,
    confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
    highlights_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lab_runs_chatroom ON conversation_lab_runs(chatroom_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS conversation_lab_dimensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    level TEXT NOT NULL CHECK (level IN ('低', '中', '高')),
    basis TEXT NOT NULL,
    icon TEXT,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (run_id) REFERENCES conversation_lab_runs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_lab_dimensions_run_id ON conversation_lab_dimensions(run_id);

  CREATE TABLE IF NOT EXISTS conversation_lab_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('信息', '提醒', '风险')),
    evidence_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (run_id) REFERENCES conversation_lab_runs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_lab_details_run_id ON conversation_lab_details(run_id);
`;

// Required columns for conversation_lab_runs, used to evolve older tables in place.
const LAB_RUNS_COLUMNS: Array<[string, string]> = [
  ['target_resolution_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['source', "TEXT NOT NULL DEFAULT ''"],
  ['source_message_hash', "TEXT NOT NULL DEFAULT ''"],
  ['dimensions_hash', "TEXT NOT NULL DEFAULT ''"],
  ['compression_version', "TEXT NOT NULL DEFAULT ''"],
  ['compression_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['profile_context_used', 'INTEGER NOT NULL DEFAULT 0'],
  ['model_reading', "TEXT NOT NULL DEFAULT ''"],
  ['avg_score', 'INTEGER NOT NULL DEFAULT 0'],
  ['detail_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['risk_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['highlights_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['prompt_version', "TEXT NOT NULL DEFAULT ''"],
];

/**
 * Explicit, evolvable migration for the conversation_lab_* tables. Fresh installs
 * get the full schema; older tables are evolved in place via ensureColumn (and
 * re-assert indexes). A structurally-incompatible legacy table (pre-UNIQUE, no
 * cache_key) is rebuilt only when empty; if it holds data we keep it and warn
 * rather than risk losing rows.
 */
function migrateLabTables(d: Database.Database) {
  // Structural incompatibility check BEFORE create (so an empty legacy table is
  // dropped and then recreated fresh by the DDL below).
  if (tableExists(d, 'conversation_lab_runs') && !hasColumn(d, 'conversation_lab_runs', 'cache_key')) {
    const count = (d.prepare('SELECT COUNT(*) AS n FROM conversation_lab_runs').get() as { n: number }).n;
    if (count === 0) {
      d.exec(
        `DROP TABLE IF EXISTS conversation_lab_details;
         DROP TABLE IF EXISTS conversation_lab_dimensions;
         DROP TABLE IF EXISTS conversation_lab_runs;`,
      );
    } else if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[db] conversation_lab_runs is on an incompatible legacy schema and is non-empty; manual migration required.',
      );
    }
  }

  d.exec(LAB_TABLES_DDL);

  // Evolve older runs tables that predate columns added later (additive, safe).
  if (tableExists(d, 'conversation_lab_runs') && hasColumn(d, 'conversation_lab_runs', 'cache_key')) {
    for (const [name, def] of LAB_RUNS_COLUMNS) ensureColumn(d, 'conversation_lab_runs', name, def);
  }

  // P3 trend query indexes — only on a column-compatible table (see fn).
  createLabTrendIndexes(d);
}

/**
 * P3 trend query indexes (idempotent). Guarded: an incompatible legacy
 * conversation_lab_runs (e.g. kept non-empty without the trend columns) would
 * make `CREATE INDEX ... ON (target_wxid, …)` fail with "no such column" and
 * throw at startup — breaking the "keep legacy, only warn" promise. So we only
 * build the indexes when all referenced columns exist; otherwise warn + skip,
 * and never throw.
 */
export function createLabTrendIndexes(d: Database.Database) {
  if (!tableExists(d, 'conversation_lab_runs')) return;
  const needed = ['target_wxid', 'chatroom_id', 'target_display_name', 'mode', 'created_at'];
  const missing = needed.filter((c) => !hasColumn(d, 'conversation_lab_runs', c));
  if (missing.length > 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[db] skip P3 trend indexes — conversation_lab_runs missing columns: ${missing.join(', ')}`);
    }
    return;
  }
  try {
    d.exec(`
      CREATE INDEX IF NOT EXISTS idx_lab_runs_target_wxid_created
        ON conversation_lab_runs(target_wxid, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lab_runs_target_display_chat_created
        ON conversation_lab_runs(chatroom_id, target_display_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lab_runs_target_mode_created
        ON conversation_lab_runs(target_wxid, mode, created_at DESC);
    `);
  } catch (e) {
    // Belt-and-suspenders: never let index creation crash startup.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[db] P3 trend index creation failed (skipped): ${e instanceof Error ? e.message : e}`);
    }
  }
}

const SEED_VERSION = 'qiaomu_v2_2026_05_23';

const DEFAULT_GROUPS: Array<{ name: string; color: string; emoji: string }> = [
  { name: 'AI产品蝗虫团', color: '#ef4444', emoji: '🐝' },
  { name: '自营/读者群', color: '#22c55e', emoji: '🌟' },
  { name: 'WaytoAGI', color: '#06b6d4', emoji: '🛸' },
  { name: 'HowOneAI', color: '#0ea5e9', emoji: '🚀' },
  { name: 'Vibe Coding · 编程', color: '#6366f1', emoji: '💻' },
  { name: 'AIGC · 内容创作', color: '#ec4899', emoji: '🎨' },
  { name: 'AI 学术', color: '#a855f7', emoji: '🎓' },
  { name: 'AI 商业 · 营销', color: '#10b981', emoji: '💰' },
  { name: 'AI 工具用户群', color: '#f59e0b', emoji: '🛠️' },
  { name: '付费社区', color: '#eab308', emoji: '💎' },
  { name: 'AI 圈社交', color: '#8b5cf6', emoji: '🤖' },
  { name: '大佬 · 媒体圈', color: '#f97316', emoji: '📰' },
  { name: '行业活动', color: '#22d3ee', emoji: '🎯' },
  { name: '生活 · 兴趣', color: '#fb7185', emoji: '🏘️' },
];

function seed(d: Database.Database) {
  const meta = d
    .prepare("SELECT value FROM meta WHERE key = 'seed_version'")
    .get() as { value: string } | undefined;

  if (meta?.value === SEED_VERSION) return;

  // Check if any groups have user tags — if so, leave them alone (additive seed).
  const tagged = d.prepare('SELECT COUNT(*) AS n FROM group_tags').get() as { n: number };

  if (tagged.n === 0) {
    // Safe to wipe and re-seed.
    d.prepare('DELETE FROM groups').run();
  }

  const now = Date.now();
  const insertOrIgnore = d.prepare(
    'INSERT OR IGNORE INTO groups (name, color, emoji, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  d.transaction(() => {
    DEFAULT_GROUPS.forEach((g, i) => insertOrIgnore.run(g.name, g.color, g.emoji, i, now));
  })();

  d.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_version', ?)",
  ).run(SEED_VERSION);
}
