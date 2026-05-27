import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, DATA_DIR } from './config';

type Sqlite = Database.Database;

export interface StewardScanLogEntry {
  id: number;
  scan_ts: number | null;
  scan_date: string;
  scan_type: string;
  status: string;
  message: string;
  groups_count: number | null;
  messages_count: number | null;
  duration_ms: number | null;
}

export interface ScanTypeSummary {
  scan_type: string;
  total: number;
  ok_count: number;
  error_count: number;
  latest_ok: StewardScanLogEntry | null;
  latest_run: StewardScanLogEntry | null;
}

export interface StewardHealthScore {
  score: number;
  verdict: string;
  tone: 'good' | 'warn' | 'bad';
  breakdown: {
    freshness: { score: number; max: number; detail: string };
    scan_errors: { score: number; max: number; detail: string };
    sync_errors: { score: number; max: number; detail: string };
    coverage: { score: number; max: number; detail: string };
  };
}

export interface StewardSyncSummary {
  total_chatrooms: number;
  ok_count: number;
  error_count: number;
  total_messages: number;
  latest_sync_ts: number | null;
}

export interface StewardDataFreshness {
  latest_message_date: string | null;
  latest_topic_date: string | null;
  latest_message_age_days: number | null;
  latest_topic_age_days: number | null;
}

export interface StewardCoverage {
  stats_days: number;
  stats_chatrooms: number;
  stats_min_date: string | null;
  stats_max_date: string | null;
}

export interface StewardSnapshotSummary {
  total_rows: number;
  latest_date: string | null;
}

export interface StewardPayload {
  available: boolean;
  health: StewardHealthScore;
  assistant_db_path: string;
  radar_db_path: string;
  scan_log: {
    available: boolean;
    total: number;
    recent: StewardScanLogEntry[];
    by_type: ScanTypeSummary[];
    failures: StewardScanLogEntry[];
  };
  sync: StewardSyncSummary;
  freshness: StewardDataFreshness;
  coverage: StewardCoverage;
  snapshots: StewardSnapshotSummary;
  meta: Record<string, string>;
}

const RADAR_DB_PATH = join(DATA_DIR, 'radar.db');

const EXPECTED_COVERAGE_DAYS = 90;

export function loadStewardStatus(): StewardPayload {
  const config = readConfig();
  const assistantDbPath = join(config.wechatAssistantDir, 'assistant.db');

  const scanLog = loadScanLog(assistantDbPath);
  const sync = loadSyncSummary();
  const freshness = loadDataFreshness();
  const coverage = loadCoverage();
  const snapshots = loadSnapshotSummary(assistantDbPath);
  const meta = loadMeta();
  const health = computeHealthScore(freshness, scanLog, sync, coverage);

  return {
    available: scanLog.available || sync.total_chatrooms > 0,
    health,
    assistant_db_path: assistantDbPath,
    radar_db_path: RADAR_DB_PATH,
    scan_log: scanLog,
    sync,
    freshness,
    coverage,
    snapshots,
    meta,
  };
}

// ---- health score -----------------------------------------------------------

/**
 * Health score 0–100. Weights:
 *   freshness  : 40 pts (data staleness is the most visible signal)
 *   scan_errors: 25 pts (broken scans = stale intelligence)
 *   sync_errors: 15 pts (sync failures = missing groups)
 *   coverage   : 20 pts (how much history is available)
 */
function computeHealthScore(
  freshness: StewardDataFreshness,
  scanLog: StewardPayload['scan_log'],
  sync: StewardSyncSummary,
  coverage: StewardCoverage,
): StewardHealthScore {
  // --- freshness (40 pts) ---
  const freshMax = 40;
  const msgAge = freshness.latest_message_age_days ?? 999;
  let freshScore: number;
  if (msgAge <= 0) freshScore = freshMax;
  else if (msgAge <= 1) freshScore = 35;
  else if (msgAge <= 2) freshScore = 28;
  else if (msgAge <= 3) freshScore = 20;
  else if (msgAge <= 7) freshScore = 10;
  else freshScore = 0;
  const freshDetail = freshness.latest_message_date
    ? `最新消息 ${freshness.latest_message_date}（${msgAge} 天前）`
    : '无消息数据';

  // --- scan errors (25 pts) ---
  const scanMax = 25;
  let scanScore: number;
  let scanDetail: string;
  if (!scanLog.available || scanLog.total === 0) {
    scanScore = scanMax; // no data = assume ok (don't punish missing assistant.db)
    scanDetail = '无扫描记录';
  } else {
    const recentN = Math.min(scanLog.total, 20);
    const recentRows = scanLog.recent.length > 0 ? scanLog.recent : [];
    const errorCount = recentRows.filter((r) => r.status !== 'ok').length;
    const errorRate = recentRows.length > 0 ? errorCount / recentRows.length : 0;
    scanScore = Math.round(scanMax * (1 - errorRate));
    scanDetail = errorCount > 0
      ? `近 ${recentRows.length} 次扫描 ${errorCount} 次失败（${Math.round(errorRate * 100)}%）`
      : `近 ${recentRows.length} 次扫描全部正常`;
  }

  // --- sync errors (15 pts) ---
  const syncMax = 15;
  let syncScore: number;
  let syncDetail: string;
  if (sync.total_chatrooms === 0) {
    syncScore = syncMax; // no sync data = don't punish
    syncDetail = '无同步数据';
  } else if (sync.error_count === 0) {
    syncScore = syncMax;
    syncDetail = `${sync.total_chatrooms} 群全部正常`;
  } else {
    const errorRatio = sync.error_count / sync.total_chatrooms;
    syncScore = Math.max(0, Math.round(syncMax * (1 - errorRatio * 2)));
    syncDetail = `${sync.error_count}/${sync.total_chatrooms} 群同步异常`;
  }

  // --- coverage (20 pts) ---
  const covMax = 20;
  let covScore: number;
  const covRatio = Math.min(1, coverage.stats_days / EXPECTED_COVERAGE_DAYS);
  covScore = Math.round(covMax * covRatio);
  const covDetail = coverage.stats_days > 0
    ? `${coverage.stats_days} 天覆盖（期望 ${EXPECTED_COVERAGE_DAYS} 天）`
    : '无覆盖数据';

  const total = freshScore + scanScore + syncScore + covScore;
  const clamped = Math.max(0, Math.min(100, total));

  let verdict: string;
  let tone: 'good' | 'warn' | 'bad';
  if (clamped >= 85) {
    tone = 'good';
    verdict = msgAge <= 1 ? '管家健康，数据实时' : `管家健康，数据 ${msgAge} 天前更新`;
  } else if (clamped >= 60) {
    tone = 'warn';
    const issues: string[] = [];
    if (msgAge > 2) issues.push(`数据 ${msgAge} 天未更新`);
    if (sync.error_count > 0) issues.push(`${sync.error_count} 群同步异常`);
    verdict = issues.length > 0 ? `⚠️ ${issues.join('；')}` : '管家状态一般';
  } else {
    tone = 'bad';
    const issues: string[] = [];
    if (msgAge > 7) issues.push(`数据 ${msgAge} 天未更新`);
    if (sync.error_count > 0) issues.push(`${sync.error_count} 群同步异常`);
    if (scanLog.failures.length > 0) issues.push('扫描频繁失败');
    verdict = issues.length > 0 ? `❌ ${issues.join('；')}` : '管家状态异常';
  }

  return {
    score: clamped,
    verdict,
    tone,
    breakdown: {
      freshness: { score: freshScore, max: freshMax, detail: freshDetail },
      scan_errors: { score: scanScore, max: scanMax, detail: scanDetail },
      sync_errors: { score: syncScore, max: syncMax, detail: syncDetail },
      coverage: { score: covScore, max: covMax, detail: covDetail },
    },
  };
}

// ---- scan log ---------------------------------------------------------------

function loadScanLog(dbPath: string): StewardPayload['scan_log'] {
  const fallback: StewardPayload['scan_log'] = { available: false, total: 0, recent: [], by_type: [], failures: [] };
  return withAssistantDb(dbPath, fallback, (d) => {
    if (!tableExists(d, 'scan_log')) return fallback;
    const total = (d.prepare('SELECT COUNT(*) AS n FROM scan_log').get() as { n: number }).n;
    const rows = d
      .prepare(
        `SELECT id, scan_ts, scan_date, scan_type, status, message, groups_count, messages_count, duration_ms
         FROM scan_log ORDER BY scan_ts DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    const all = rows.map(parseScanLogRow);

    // failures: any non-ok, most recent first
    const failures = all.filter((r) => r.status !== 'ok').slice(0, 10);

    // aggregation by scan_type
    const typeMap = new Map<string, StewardScanLogEntry[]>();
    for (const entry of all) {
      const list = typeMap.get(entry.scan_type) ?? [];
      list.push(entry);
      typeMap.set(entry.scan_type, list);
    }
    const by_type: ScanTypeSummary[] = [];
    for (const [scan_type, entries] of typeMap) {
      const okEntries = entries.filter((e) => e.status === 'ok');
      by_type.push({
        scan_type,
        total: entries.length,
        ok_count: okEntries.length,
        error_count: entries.length - okEntries.length,
        latest_ok: okEntries[0] ?? null,
        latest_run: entries[0] ?? null,
      });
    }
    // sort: errors first, then by total desc
    by_type.sort((a, b) => {
      if (a.error_count > 0 && b.error_count === 0) return -1;
      if (a.error_count === 0 && b.error_count > 0) return 1;
      return b.total - a.total;
    });

    return { available: true, total, recent: all.slice(0, 10), by_type, failures };
  });
}

// ---- other data loaders -----------------------------------------------------

function loadSyncSummary(): StewardSyncSummary {
  const fallback: StewardSyncSummary = { total_chatrooms: 0, ok_count: 0, error_count: 0, total_messages: 0, latest_sync_ts: null };
  return withRadarDb(fallback, (d) => {
    if (!tableExists(d, 'sync_state')) return fallback;
    const row = d
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
           SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS error_count,
           SUM(total_messages) AS total_messages,
           MAX(last_synced_at) AS latest_ts
         FROM sync_state`,
      )
      .get() as Record<string, unknown>;
    return {
      total_chatrooms: Number(row.total ?? 0),
      ok_count: Number(row.ok_count ?? 0),
      error_count: Number(row.error_count ?? 0),
      total_messages: Number(row.total_messages ?? 0),
      latest_sync_ts: numOrNull(row.latest_ts),
    };
  });
}

function loadDataFreshness(): StewardDataFreshness {
  const fallback: StewardDataFreshness = { latest_message_date: null, latest_topic_date: null, latest_message_age_days: null, latest_topic_age_days: null };
  return withRadarDb(fallback, (d) => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    let latestMessageDate: string | null = null;
    if (tableExists(d, 'messages')) {
      const r = d.prepare('SELECT MAX(date) AS d FROM messages').get() as { d: string | null };
      latestMessageDate = r.d ?? null;
    }

    let latestTopicDate: string | null = null;
    if (tableExists(d, 'topics')) {
      const r = d.prepare('SELECT MAX(date) AS d FROM topics').get() as { d: string | null };
      latestTopicDate = r.d ?? null;
    }

    return {
      latest_message_date: latestMessageDate,
      latest_topic_date: latestTopicDate,
      latest_message_age_days: latestMessageDate ? daysBetween(latestMessageDate, todayStr) : null,
      latest_topic_age_days: latestTopicDate ? daysBetween(latestTopicDate, todayStr) : null,
    };
  });
}

function loadCoverage(): StewardCoverage {
  const fallback: StewardCoverage = { stats_days: 0, stats_chatrooms: 0, stats_min_date: null, stats_max_date: null };
  return withRadarDb(fallback, (d) => {
    if (!tableExists(d, 'daily_stats')) return fallback;
    const r = d
      .prepare(
        'SELECT COUNT(DISTINCT date) AS days, COUNT(DISTINCT chatroom_id) AS chatrooms, MIN(date) AS min_d, MAX(date) AS max_d FROM daily_stats',
      )
      .get() as Record<string, unknown>;
    return {
      stats_days: Number(r.days ?? 0),
      stats_chatrooms: Number(r.chatrooms ?? 0),
      stats_min_date: strOrNull(r.min_d),
      stats_max_date: strOrNull(r.max_d),
    };
  });
}

function loadSnapshotSummary(dbPath: string): StewardSnapshotSummary {
  const fallback: StewardSnapshotSummary = { total_rows: 0, latest_date: null };
  return withAssistantDb(dbPath, fallback, (d) => {
    if (!tableExists(d, 'profile_snapshots')) return fallback;
    const r = d
      .prepare('SELECT COUNT(*) AS n, MAX(date) AS latest FROM profile_snapshots')
      .get() as { n: number; latest: string | null };
    return { total_rows: r.n, latest_date: r.latest ?? null };
  });
}

function loadMeta(): Record<string, string> {
  return withRadarDb({}, (d) => {
    if (!tableExists(d, 'meta')) return {};
    const rows = d.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });
}

// ---- helpers ----------------------------------------------------------------

function withAssistantDb<T>(dbPath: string, fallback: T, fn: (d: Sqlite) => T): T {
  if (!existsSync(dbPath)) return fallback;
  let d: Sqlite | null = null;
  try {
    d = new Database(dbPath, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');
    return fn(d);
  } catch {
    return fallback;
  } finally {
    d?.close();
  }
}

function withRadarDb<T>(fallback: T, fn: (d: Sqlite) => T): T {
  if (!existsSync(RADAR_DB_PATH)) return fallback;
  let d: Sqlite | null = null;
  try {
    d = new Database(RADAR_DB_PATH, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');
    return fn(d);
  } catch {
    return fallback;
  } finally {
    d?.close();
  }
}

function tableExists(d: Sqlite, table: string): boolean {
  return Boolean(
    d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
  );
}

function parseScanLogRow(r: Record<string, unknown>): StewardScanLogEntry {
  return {
    id: Number(r.id),
    scan_ts: numOrNull(r.scan_ts),
    scan_date: str(r.scan_date),
    scan_type: str(r.scan_type),
    status: str(r.status),
    message: str(r.message),
    groups_count: numOrNull(r.groups_count),
    messages_count: numOrNull(r.messages_count),
    duration_ms: numOrNull(r.duration_ms),
  };
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function strOrNull(v: unknown): string | null {
  const s = str(v).trim();
  return s || null;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
