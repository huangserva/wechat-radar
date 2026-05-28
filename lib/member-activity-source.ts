import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, readConfig } from './config';

type Sqlite = Database.Database;
export type ActivityDeltaLabel = '突然活跃' | '突然沉默' | '稳定';

export interface MemberActivityDelta {
  wxid: string;
  nick_name: string;
  recent_count: number;
  prev_count: number;
  delta_pct: number;
  label: ActivityDeltaLabel;
}

export interface MemberActivityPayload {
  available: boolean;
  window: {
    recent_since: string | null;
    recent_until: string | null;
    prev_since: string | null;
    prev_until: string | null;
  };
  summary: {
    total_members: number;
    sudden_active: number;
    sudden_silent: number;
    stable: number;
  };
  items: MemberActivityDelta[];
}

const RADAR_DB_PATH = join(DATA_DIR, 'radar.db');

export function loadMemberActivityDelta(limit = 24): MemberActivityPayload {
  if (!existsSync(RADAR_DB_PATH)) return emptyPayload();
  let d: Sqlite | null = null;
  try {
    d = new Database(RADAR_DB_PATH);
    migrate(d);
    const window = computeWindow(d);
    if (!window.recent_until) return emptyPayload();
    const rows = computeRows(d, window);
    writeRows(d, rows);
    const items = readRows(d, limit);
    return {
      available: true,
      window,
      summary: {
        total_members: rows.length,
        sudden_active: rows.filter((row) => row.label === '突然活跃').length,
        sudden_silent: rows.filter((row) => row.label === '突然沉默').length,
        stable: rows.filter((row) => row.label === '稳定').length,
      },
      items,
    };
  } catch {
    return emptyPayload();
  } finally {
    d?.close();
  }
}

function migrate(d: Sqlite) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS member_activity_delta (
      wxid TEXT PRIMARY KEY,
      nick_name TEXT NOT NULL,
      recent_count INTEGER NOT NULL,
      prev_count INTEGER NOT NULL,
      delta_pct REAL NOT NULL,
      label TEXT NOT NULL,
      refreshed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_member_activity_delta_label ON member_activity_delta(label);
  `);
}

function computeWindow(d: Sqlite): MemberActivityPayload['window'] {
  const latest = (d.prepare('SELECT MAX(date) AS latest FROM messages').get() as { latest: string | null }).latest;
  if (!latest) {
    return { recent_since: null, recent_until: null, prev_since: null, prev_until: null };
  }
  const recentUntil = latest;
  const recentSince = shiftDate(latest, -6);
  const prevUntil = shiftDate(latest, -7);
  const prevSince = shiftDate(latest, -13);
  return { recent_since: recentSince, recent_until: recentUntil, prev_since: prevSince, prev_until: prevUntil };
}

function computeRows(d: Sqlite, window: MemberActivityPayload['window']): MemberActivityDelta[] {
  if (!window.recent_since || !window.recent_until || !window.prev_since || !window.prev_until) return [];
  const self = selfSenders();
  const rows = d
    .prepare(
      `SELECT sender,
              SUM(CASE WHEN date >= @recent_since AND date <= @recent_until THEN 1 ELSE 0 END) AS recent_count,
              SUM(CASE WHEN date >= @prev_since AND date <= @prev_until THEN 1 ELSE 0 END) AS prev_count
       FROM messages
       WHERE date >= @prev_since
         AND date <= @recent_until
         AND TRIM(sender) <> ''
       GROUP BY sender`,
    )
    .all(window) as Array<{ sender: string; recent_count: number; prev_count: number }>;

  return rows
    .filter((row) => !self.has(row.sender))
    .map((row) => toDelta(row.sender, Number(row.recent_count ?? 0), Number(row.prev_count ?? 0)))
    .filter((row) => row.recent_count >= 3 || row.prev_count >= 3)
    .sort(compareDeltaRows);
}

function toDelta(sender: string, recent: number, prev: number): MemberActivityDelta {
  const deltaPct = prev <= 0 ? (recent > 0 ? 100 : 0) : Math.round(((recent - prev) / prev) * 100);
  const absDelta = Math.abs(recent - prev);
  let label: ActivityDeltaLabel = '稳定';
  if (recent >= 3 && recent >= prev * 1.8 && absDelta >= 3) {
    label = '突然活跃';
  } else if (prev >= 3 && prev >= recent * 1.8 && absDelta >= 3) {
    label = '突然沉默';
  }
  return {
    wxid: sender,
    nick_name: sender,
    recent_count: recent,
    prev_count: prev,
    delta_pct: deltaPct,
    label,
  };
}

function writeRows(d: Sqlite, rows: MemberActivityDelta[]) {
  const now = Math.floor(Date.now() / 1000);
  const tx = d.transaction((items: MemberActivityDelta[]) => {
    d.prepare('DELETE FROM member_activity_delta').run();
    const stmt = d.prepare(
      `INSERT INTO member_activity_delta (wxid, nick_name, recent_count, prev_count, delta_pct, label, refreshed_at)
       VALUES (@wxid, @nick_name, @recent_count, @prev_count, @delta_pct, @label, @refreshed_at)`,
    );
    for (const row of items) stmt.run({ ...row, refreshed_at: now });
  });
  tx(rows);
}

function readRows(d: Sqlite, limit: number): MemberActivityDelta[] {
  return (d
    .prepare(
      `SELECT wxid, nick_name, recent_count, prev_count, delta_pct, label
       FROM member_activity_delta
       ORDER BY (label = '稳定') ASC,
                ABS(recent_count - prev_count) DESC,
                ABS(delta_pct) DESC,
                recent_count DESC
       LIMIT ?`,
    )
    .all(limit) as MemberActivityDelta[]);
}

function compareDeltaRows(a: MemberActivityDelta, b: MemberActivityDelta): number {
  return (
    Number(a.label === '稳定') - Number(b.label === '稳定') ||
    Math.abs(b.recent_count - b.prev_count) - Math.abs(a.recent_count - a.prev_count) ||
    Math.abs(b.delta_pct) - Math.abs(a.delta_pct) ||
    b.recent_count - a.recent_count ||
    a.nick_name.localeCompare(b.nick_name, 'zh-Hans-CN')
  );
}

function selfSenders(): Set<string> {
  const config = readConfig();
  return new Set(['__self__', 'servasyy', config.wechatSelfWxid].filter(Boolean));
}

function shiftDate(date: string, offsetDays: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyPayload(): MemberActivityPayload {
  return {
    available: false,
    window: { recent_since: null, recent_until: null, prev_since: null, prev_until: null },
    summary: { total_members: 0, sudden_active: 0, sudden_silent: 0, stable: 0 },
    items: [],
  };
}
