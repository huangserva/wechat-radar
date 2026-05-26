import { db } from './db';
import { upsertLinksForMessage } from './message-links';
import { normalizeMessageContent } from './normalize-message';
import type { WxMessage } from './wx-types';

export interface MessageRow extends WxMessage {
  chatroom_id: string;
  date: string;
}

const SYSTEM_TYPES = new Set(['系统', 'system']);
const REVOKE_RE = /撤回了一条消息|recalled a message/i;

export function dateOfMessage(m: WxMessage): string {
  if (m.time && m.time.length >= 10) return m.time.slice(0, 10);
  if (m.timestamp) {
    const d = new Date(m.timestamp * 1000);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return 'unknown';
}

export function bulkInsertMessages(chatroomId: string, messages: WxMessage[]): number {
  if (messages.length === 0) return 0;
  const stmt = db().prepare(`
    INSERT OR IGNORE INTO messages
      (chatroom_id, local_id, sender, content, time, timestamp, type, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  const tx = db().transaction((msgs: WxMessage[]) => {
    for (const m of msgs) {
      if (SYSTEM_TYPES.has(m.type) && REVOKE_RE.test(m.content)) continue;
      const raw = m.content ?? '';
      // Extract links from the RAW XML (URLs live in <appmsg><url>) BEFORE
      // normalizing — normalization collapses appmsg XML to "[链接] 标题".
      upsertLinksForMessage({
        chatroom_id: chatroomId,
        local_id: m.local_id,
        sender: m.sender ?? '',
        content: raw,
        time: m.time ?? '',
        timestamp: m.timestamp ?? 0,
        date: dateOfMessage(m),
      });
      // Store a display-normalized form so group detail / topics / lab never see
      // raw media/appmsg XML or the "<wxid>:\n" sender prefix.
      const r = stmt.run(
        chatroomId,
        m.local_id,
        m.sender ?? '',
        normalizeMessageContent(raw, m.type ?? ''),
        m.time ?? '',
        m.timestamp ?? 0,
        m.type ?? '',
        dateOfMessage(m),
      );
      if (r.changes > 0) inserted++;
    }
  });
  tx(messages);
  return inserted;
}

export function listMessagesForDate(chatroomId: string, date: string, limit = 1000): MessageRow[] {
  return db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, content, time, timestamp, type, date
       FROM messages
       WHERE chatroom_id = ? AND date = ?
       ORDER BY timestamp ASC, local_id ASC
       LIMIT ?`,
    )
    .all(chatroomId, date, limit) as MessageRow[];
}

export interface DailyStatsAggregate {
  date: string;
  total: number;
  by_hour: Array<{ hour: number; count: number }>;
  top_senders: Array<{ sender: string; count: number }>;
}

export function aggregateDailyStats(chatroomId: string, dates: string[]): DailyStatsAggregate[] {
  if (dates.length === 0) return [];
  const placeholders = dates.map(() => '?').join(',');
  const rows = db()
    .prepare(
      `SELECT date, sender, timestamp, type
       FROM messages
       WHERE chatroom_id = ? AND date IN (${placeholders})`,
    )
    .all(chatroomId, ...dates) as Array<{
    date: string;
    sender: string;
    timestamp: number;
    type: string;
  }>;

  const byDate = new Map<string, { total: number; senders: Map<string, number>; hours: number[] }>();
  for (const d of dates) byDate.set(d, { total: 0, senders: new Map(), hours: new Array(24).fill(0) });

  for (const r of rows) {
    const slot = byDate.get(r.date);
    if (!slot) continue;
    slot.total++;
    slot.senders.set(r.sender, (slot.senders.get(r.sender) ?? 0) + 1);
    if (r.timestamp) {
      const h = new Date(r.timestamp * 1000).getHours();
      if (h >= 0 && h < 24) slot.hours[h]++;
    }
  }

  return dates.map((date) => {
    const s = byDate.get(date)!;
    const top = Array.from(s.senders.entries())
      .map(([sender, count]) => ({ sender, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const by_hour = s.hours.map((count, hour) => ({ hour, count }));
    return { date, total: s.total, by_hour, top_senders: top };
  });
}

export function getSyncState(chatroomId: string) {
  return db()
    .prepare('SELECT * FROM sync_state WHERE chatroom_id = ?')
    .get(chatroomId) as
    | {
        chatroom_id: string;
        last_synced_at: number;
        first_message_date: string | null;
        last_message_date: string | null;
        total_messages: number;
        status: string;
        last_error: string | null;
        failed_chunks: number;
        empty_chunks: number;
        total_chunks: number;
      }
    | undefined;
}

export type SyncStatus = 'ok' | 'partial' | 'failed' | 'empty' | 'unknown';

export function upsertSyncState(
  chatroomId: string,
  total: number,
  firstDate: string | null,
  lastDate: string | null,
  meta: {
    status?: SyncStatus;
    lastError?: string | null;
    failedChunks?: number;
    emptyChunks?: number;
    totalChunks?: number;
  } = {},
) {
  db()
    .prepare(
      `INSERT INTO sync_state (
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
         total_chunks = excluded.total_chunks`,
    )
    .run(
      chatroomId,
      Date.now(),
      firstDate,
      lastDate,
      total,
      meta.status ?? 'unknown',
      meta.lastError ?? null,
      meta.failedChunks ?? 0,
      meta.emptyChunks ?? 0,
      meta.totalChunks ?? 0,
    );
}

export function countMessagesInRange(chatroomId: string, since: string, until: string): number {
  const r = db()
    .prepare(
      'SELECT COUNT(*) AS n FROM messages WHERE chatroom_id = ? AND date >= ? AND date <= ?',
    )
    .get(chatroomId, since, until) as { n: number };
  return r.n;
}

export function listAllSyncedDates(chatroomId: string): string[] {
  const rows = db()
    .prepare(
      'SELECT DISTINCT date FROM messages WHERE chatroom_id = ? ORDER BY date ASC',
    )
    .all(chatroomId) as Array<{ date: string }>;
  return rows.map((r) => r.date);
}
