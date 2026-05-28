import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DATA_DIR } from './config';

type Sqlite = Database.Database;

const ASSISTANT_DB = join(homedir(), 'wechat-assistant', 'assistant.db');
const RADAR_DB = join(DATA_DIR, 'radar.db');

export interface FeedbackPayload {
  available: boolean;
  total: number;
  by_action: { acted: number; ignored: number; snoozed: number; unknown: number };
  by_type: Array<{ push_type: string; total: number; acted: number; ignored: number; snoozed: number }>;
  by_hour: Array<{ hour: number; total: number; acted: number; ignored: number }>;
  by_priority: Array<{ priority: string; total: number; acted: number; ignored: number }>;
  recent: Array<{ id: number; push_time: string; push_type: string; content_summary: string; inferred_action: string | null; priority: string | null }>;
}

export function loadFeedbackData(): FeedbackPayload {
  if (!existsSync(ASSISTANT_DB) || !existsSync(RADAR_DB)) {
    return emptyPayload();
  }

  // Read push_feedback from assistant.db
  const adb = new Database(ASSISTANT_DB, { readonly: true, fileMustExist: true });
  adb.pragma('query_only = ON');
  const pushes = adb
    .prepare('SELECT id, push_time, push_type, content_summary, priority FROM push_feedback ORDER BY id DESC')
    .all() as Array<{ id: number; push_time: string; push_type: string; content_summary: string; priority: string | null }>;
  adb.close();

  // Read inferred actions from radar.db
  const rdb = new Database(RADAR_DB, { readonly: true, fileMustExist: true });
  rdb.pragma('query_only = ON');

  let inferredMap = new Map<number, string>();
  if (tableExists(rdb, 'push_feedback_inferred')) {
    const rows = rdb
      .prepare('SELECT feedback_id, inferred_action FROM push_feedback_inferred WHERE inferred_action IS NOT NULL')
      .all() as Array<{ feedback_id: number; inferred_action: string }>;
    for (const r of rows) inferredMap.set(r.feedback_id, r.inferred_action);
  }
  rdb.close();

  // Merge and compute stats
  const by_action = { acted: 0, ignored: 0, snoozed: 0, unknown: 0 };
  const by_type = new Map<string, { total: number; acted: number; ignored: number; snoozed: number }>();
  const by_hour = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, acted: 0, ignored: 0 }));
  const by_priority = new Map<string, { total: number; acted: number; ignored: number }>();

  for (const p of pushes) {
    const action = inferredMap.get(p.id) ?? null;

    // by_action
    if (action === 'acted') by_action.acted++;
    else if (action === 'ignored') by_action.ignored++;
    else if (action === 'snoozed') by_action.snoozed++;
    else by_action.unknown++;

    // by_type
    const t = by_type.get(p.push_type) ?? { total: 0, acted: 0, ignored: 0, snoozed: 0 };
    t.total++;
    if (action === 'acted') t.acted++;
    else if (action === 'ignored') t.ignored++;
    else if (action === 'snoozed') t.snoozed++;
    by_type.set(p.push_type, t);

    // by_hour
    try {
      const hour = new Date(p.push_time).getHours();
      by_hour[hour].total++;
      if (action === 'acted') by_hour[hour].acted++;
      else if (action === 'ignored') by_hour[hour].ignored++;
    } catch {}

    // by_priority
    const pri = p.priority ?? 'none';
    const pr = by_priority.get(pri) ?? { total: 0, acted: 0, ignored: 0 };
    pr.total++;
    if (action === 'acted') pr.acted++;
    else if (action === 'ignored') pr.ignored++;
    by_priority.set(pri, pr);
  }

  // Recent 20 with actions
  const recent = pushes.slice(0, 20).map((p) => ({
    id: p.id,
    push_time: p.push_time,
    push_type: p.push_type,
    content_summary: p.content_summary,
    inferred_action: inferredMap.get(p.id) ?? null,
    priority: p.priority,
  }));

  return {
    available: true,
    total: pushes.length,
    by_action,
    by_type: Array.from(by_type.entries()).map(([push_type, d]) => ({ push_type, ...d })).sort((a, b) => b.total - a.total),
    by_hour,
    by_priority: Array.from(by_priority.entries()).map(([priority, d]) => ({ priority, ...d })).sort((a, b) => b.total - a.total),
    recent,
  };
}

function tableExists(d: Sqlite, table: string): boolean {
  return Boolean(d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function emptyPayload(): FeedbackPayload {
  return {
    available: false,
    total: 0,
    by_action: { acted: 0, ignored: 0, snoozed: 0, unknown: 0 },
    by_type: [],
    by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, acted: 0, ignored: 0 })),
    by_priority: [],
    recent: [],
  };
}
