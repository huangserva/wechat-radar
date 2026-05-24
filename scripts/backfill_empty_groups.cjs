/* eslint-disable @typescript-eslint/no-require-imports */
const { execFile } = require('node:child_process');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');

const run = promisify(execFile);
const DATA_DIR = process.env.WECHAT_RADAR_DATA_DIR || join(homedir(), '.wechat-radar');
const DB_PATH = join(DATA_DIR, 'radar.db');

const SYSTEM_TYPES = new Set(['system', '系统']);
const REVOKE_RE = /撤回了一条消息|recalled a message/i;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBefore(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

function dateOfMessage(m) {
  if (m.time && m.time.length >= 10) return m.time.slice(0, 10);
  if (m.timestamp) return ymd(new Date(m.timestamp * 1000));
  return 'unknown';
}

function dateList(since, until) {
  const out = [];
  const start = new Date(since);
  const end = new Date(until);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}

function monthChunks(since, until) {
  const chunks = [];
  const start = new Date(since);
  const end = new Date(until);
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const chunkStart = cur < start ? start : cur;
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const chunkEnd = monthEnd > end ? end : monthEnd;
    chunks.push({ since: ymd(chunkStart), until: ymd(chunkEnd) });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return chunks;
}

function ensureColumn(db, table, name, definition) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  if (rows.some((r) => r.name === name)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
}

function ensureSchema(db) {
  ensureColumn(db, 'sync_state', 'status', "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn(db, 'sync_state', 'last_error', 'TEXT');
  ensureColumn(db, 'sync_state', 'failed_chunks', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'sync_state', 'empty_chunks', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'sync_state', 'total_chunks', 'INTEGER NOT NULL DEFAULT 0');
}

async function wxJson(args, opts = {}) {
  const { stdout } = await run('wx', [...args, '--json'], {
    maxBuffer: 256 * 1024 * 1024,
    timeout: 180_000,
    ...opts,
  });
  return JSON.parse(stdout);
}

function makeInserters(db) {
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages
      (chatroom_id, local_id, sender, content, time, timestamp, type, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStats = db.prepare(`
    INSERT INTO daily_stats (chatroom_id, date, total, top_senders, by_hour, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chatroom_id, date) DO UPDATE SET
      total = excluded.total,
      top_senders = excluded.top_senders,
      by_hour = excluded.by_hour,
      refreshed_at = excluded.refreshed_at
  `);
  const upsertSync = db.prepare(`
    INSERT INTO sync_state (
      chatroom_id,
      last_synced_at,
      first_message_date,
      last_message_date,
      total_messages,
      status,
      last_error,
      failed_chunks,
      empty_chunks,
      total_chunks
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chatroom_id) DO UPDATE SET
      last_synced_at = excluded.last_synced_at,
      first_message_date = COALESCE(excluded.first_message_date, sync_state.first_message_date),
      last_message_date = COALESCE(excluded.last_message_date, sync_state.last_message_date),
      total_messages = excluded.total_messages,
      status = excluded.status,
      last_error = excluded.last_error,
      failed_chunks = excluded.failed_chunks,
      empty_chunks = excluded.empty_chunks,
      total_chunks = excluded.total_chunks
  `);
  return { insertMessage, insertStats, upsertSync };
}

function insertMessages(db, stmt, chatroomId, messages) {
  let inserted = 0;
  const tx = db.transaction((rows) => {
    for (const m of rows) {
      if (SYSTEM_TYPES.has(m.type) && REVOKE_RE.test(m.content || '')) continue;
      const r = stmt.run(
        chatroomId,
        m.local_id,
        m.sender || '',
        m.content || '',
        m.time || '',
        m.timestamp || 0,
        m.type || '',
        dateOfMessage(m),
      );
      if (r.changes > 0) inserted++;
    }
  });
  tx(messages);
  return inserted;
}

function aggregate(db, insertStats, chatroomId, dates) {
  const rows = db
    .prepare(
      `SELECT date, sender, timestamp
       FROM messages
       WHERE chatroom_id = ? AND date >= ? AND date <= ?`,
    )
    .all(chatroomId, dates[0], dates[dates.length - 1]);
  const byDate = new Map();
  for (const d of dates) byDate.set(d, { total: 0, senders: new Map(), hours: new Array(24).fill(0) });
  for (const r of rows) {
    const slot = byDate.get(r.date);
    if (!slot) continue;
    slot.total++;
    slot.senders.set(r.sender, (slot.senders.get(r.sender) || 0) + 1);
    if (r.timestamp) {
      const h = new Date(r.timestamp * 1000).getHours();
      if (h >= 0 && h < 24) slot.hours[h]++;
    }
  }
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const [date, s] of byDate.entries()) {
      const top = Array.from(s.senders.entries())
        .map(([sender, count]) => ({ sender, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      insertStats.run(
        chatroomId,
        date,
        s.total,
        JSON.stringify(top),
        JSON.stringify(s.hours.map((count, hour) => ({ hour, count }))),
        now,
      );
    }
  });
  tx();
}

async function main() {
  const since = arg('--since', daysBefore(Number(arg('--days', '30')) - 1));
  const until = arg('--until', ymd(new Date()));
  const activeDays = Number(arg('--active-days', '7'));
  const only = arg('--only', '');
  const includeExisting = hasFlag('--include-existing');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const activeSince = nowSeconds - activeDays * 86400;

  const db = new Database(DB_PATH);
  ensureSchema(db);
  const { insertMessage, insertStats, upsertSync } = makeInserters(db);
  const sessions = (await wxJson(['sessions', '-n', '500'])).filter((s) => s.is_group);

  const existing = new Map(
    db.prepare('SELECT chatroom_id, total_messages FROM sync_state').all().map((r) => [r.chatroom_id, r.total_messages]),
  );
  const candidates = sessions.filter((s) => {
    if (only && !s.chat.includes(only) && !s.username.includes(only)) return false;
    if (!includeExisting && existing.has(s.username) && existing.get(s.username) > 0) return false;
    return s.timestamp >= activeSince;
  });

  const chunks = monthChunks(since, until);
  const dates = dateList(since, until);
  console.log(`Backfilling ${candidates.length} groups from ${since} to ${until}`);

  for (const [index, group] of candidates.entries()) {
    let fetched = 0;
    let inserted = 0;
    let failedChunks = 0;
    let emptyChunks = 0;
    const errors = [];

    for (const c of chunks) {
      try {
        const messages = await wxJson([
          'history',
          group.username,
          '--since',
          c.since,
          '--until',
          c.until,
          '-n',
          '50000',
        ]);
        fetched += messages.length;
        if (messages.length === 0) emptyChunks++;
        inserted += insertMessages(db, insertMessage, group.username, messages);
      } catch (e) {
        failedChunks++;
        errors.push(`${c.since}~${c.until}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    aggregate(db, insertStats, group.username, dates);
    const row = db
      .prepare('SELECT COUNT(*) AS n, MIN(date) AS first_date, MAX(date) AS last_date FROM messages WHERE chatroom_id = ?')
      .get(group.username);
    const status =
      failedChunks === chunks.length
        ? 'failed'
        : failedChunks > 0
          ? 'partial'
          : row.n === 0 && fetched === 0
            ? 'empty'
            : 'ok';
    upsertSync.run(
      group.username,
      Date.now(),
      row.first_date,
      row.last_date,
      row.n,
      status,
      errors.slice(-3).join('\n') || null,
      failedChunks,
      emptyChunks,
      chunks.length,
    );

    console.log(
      `${index + 1}/${candidates.length} ${group.chat} fetched=${fetched} inserted=${inserted} total=${row.n} status=${status}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
