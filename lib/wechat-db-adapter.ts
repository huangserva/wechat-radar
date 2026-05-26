import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './config';
import type {
  WxDaemonStatus,
  WxEmptyReason,
  WxMember,
  WxMessage,
  WxNewMessage,
  WxResult,
  WxSession,
  WxSource,
  WxStats,
} from './wx-types';

type Sqlite = Database.Database;

function found<T>(data: T, source: WxSource): WxResult<T> {
  return { data, source, empty_reason: null };
}

/** Build the empty result, labelling which source(s) were actually consulted. */
function emptyResult<T>(data: T, hasCollector: boolean, hasRaw: boolean): WxResult<T> {
  const source: WxSource = hasRaw ? 'raw' : hasCollector ? 'collector' : 'none';
  const empty_reason: WxEmptyReason = source === 'none' ? 'no_data_source' : 'no_match';
  return { data, source, empty_reason };
}

type CollectorMessageRow = {
  chatroom_id: string;
  sender: string | null;
  content: string | null;
  msg_time: number | null;
  local_id: string | number | null;
  msg_type: number | string | null;
  chatroom_name?: string | null;
};

type SessionRow = {
  username: string;
  unread_count?: number | null;
  summary?: string | null;
  last_timestamp?: number | null;
  last_msg_type?: number | string | null;
  last_msg_sender?: string | null;
  last_sender_display_name?: string | null;
};

type ContactRow = {
  username: string;
  nick_name?: string | null;
  remark?: string | null;
  alias?: string | null;
};

export type WxStatsRangeRow = {
  chatroom_id: string;
  date: string;
  total: number;
  top_senders: Array<{ sender: string; count: number }>;
  by_hour: Array<{ hour: number; count: number }>;
};

export function wxDbPaths() {
  const cfg = readConfig();
  return {
    collectorDb: cfg.wechatCollectorDb,
    decryptedDir: cfg.wechatDecryptedDir,
    sessionDb: join(cfg.wechatDecryptedDir, 'session', 'session.db'),
    contactDb: join(cfg.wechatDecryptedDir, 'contact', 'contact.db'),
    messageDir: join(cfg.wechatDecryptedDir, 'message'),
  };
}

export function wxDbAvailable(): boolean {
  const paths = wxDbPaths();
  return existsSync(paths.collectorDb) || existsSync(paths.sessionDb) || existsSync(paths.contactDb);
}

export async function wxSessions(limit = 500): Promise<WxSession[]> {
  const paths = wxDbPaths();
  const contactNames = readContactNames(paths.contactDb);
  const watchedNames = readWatchedChatNames(paths.collectorDb);
  for (const [id, name] of watchedNames) {
    if (name && !contactNames.has(id)) contactNames.set(id, name);
  }
  const sessionRows = readSessionRows(paths.sessionDb);
  const sessionsById = new Map<string, WxSession>();

  for (const row of sessionRows) {
    sessionsById.set(row.username, sessionRowToSession(row, contactNames));
  }

  if (sessionsById.size === 0) {
    const latestRows = readCollectorLatestRows(paths.collectorDb, Math.max(limit * 3, limit));
    for (const row of latestRows) {
      sessionsById.set(row.chatroom_id, collectorRowToSession(row, contactNames, sessionsById.get(row.chatroom_id)));
    }
  }

  return Array.from(sessionsById.values())
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, limit);
}

export async function wxHistory(
  chat: string,
  since: string,
  until: string,
  limit = 1000,
): Promise<WxResult<WxMessage[]>> {
  const paths = wxDbPaths();
  const start = unixStartOfDay(since);
  const end = unixEndExclusive(until);
  const hasCollector = existsSync(paths.collectorDb);
  const hasRaw = existsSync(paths.messageDir);

  if (hasCollector) {
    const fromCollector = readCollectorHistory(paths.collectorDb, chat, start, end, limit);
    if (fromCollector.length > 0) return found(fromCollector, 'collector');
  }
  // Collector missed (or is absent) for this target → fall back to raw decrypted
  // message_*.db instead of trusting "collector exists" to mean "chat is empty".
  if (hasRaw) {
    const fromRaw = readDecryptedMessageHistory(paths.messageDir, paths.contactDb, chat, start, end, limit);
    if (fromRaw.length > 0) return found(fromRaw, 'raw');
  }
  return emptyResult<WxMessage[]>([], hasCollector, hasRaw);
}

export async function wxStats(
  chat: string,
  since: string,
  until: string,
): Promise<WxStats> {
  const { data: messages } = await wxHistory(chat, since, until, 50_000);
  const sessions = await wxSessions(1000);
  const found = sessions.find((s) => s.username === chat);
  const hours = new Array(24).fill(0) as number[];
  const byType = new Map<string, number>();
  const bySender = new Map<string, number>();

  for (const m of messages) {
    const h = new Date(m.timestamp * 1000).getHours();
    if (h >= 0 && h < 24) hours[h]++;
    byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
    bySender.set(m.sender, (bySender.get(m.sender) ?? 0) + 1);
  }

  return {
    chat: found?.chat ?? chat,
    chat_type: isGroup(chat) ? 'group' : 'private',
    is_group: isGroup(chat),
    username: chat,
    total: messages.length,
    by_hour: hours.map((count, hour) => ({ hour, count })),
    by_type: Array.from(byType.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    top_senders: Array.from(bySender.entries())
      .map(([sender, count]) => ({ sender, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
  };
}

export async function wxStatsRange(
  since: string,
  until: string,
  opts: { collectorOnly?: boolean } = {},
): Promise<WxResult<WxStatsRangeRow[]>> {
  const paths = wxDbPaths();
  const start = unixStartOfDay(since);
  const end = unixEndExclusive(until);
  const hasCollector = existsSync(paths.collectorDb);
  const hasRaw = existsSync(paths.messageDir);

  // Collector is the cleanest source; raw then SUPPLEMENTS (chat,date) buckets
  // collector never captured (raw-only / unwatched groups) — without it a global
  // dashboard query silently drops those groups. Buckets present in collector are
  // NOT overwritten (avoids double-counting the same chat across both sources).
  // The raw scan is the known ~15s degraded cost, so the home dashboard passes
  // collectorOnly=true (collector alone already dwarfs the sparse radar.db cache).
  const fromCollector = hasCollector ? readCollectorStatsRange(paths.collectorDb, start, end) : [];
  const collectorKeys = new Set(fromCollector.map((r) => statsRowKey(r)));
  const merged = [...fromCollector];
  let usedRaw = false;
  if (hasRaw && !opts.collectorOnly) {
    for (const r of readDecryptedStatsRange(paths, start, end)) {
      if (collectorKeys.has(statsRowKey(r))) continue; // collector already covers it
      merged.push(r);
      usedRaw = true;
    }
  }
  if (merged.length === 0) return emptyResult<WxStatsRangeRow[]>([], hasCollector, hasRaw);
  const source: WxSource = fromCollector.length > 0 && usedRaw ? 'mixed' : usedRaw ? 'raw' : 'collector';
  return { data: merged, source, empty_reason: null };
}

function statsRowKey(r: WxStatsRangeRow): string {
  return JSON.stringify([r.chatroom_id, r.date]);
}

function readCollectorStatsRange(path: string, start: number, end: number): WxStatsRangeRow[] {
  return withReadonlyDb(path, (d) => {
    if (!tableExists(d, 'messages')) return [];
    const rows = d
      .prepare(
        `
        SELECT chatroom_id,
               date(msg_time, 'unixepoch', 'localtime') AS date,
               COALESCE(NULLIF(sender, ''), '(unknown)') AS sender,
               CAST(strftime('%H', msg_time, 'unixepoch', 'localtime') AS INTEGER) AS hour,
               COUNT(*) AS count
        FROM messages
        WHERE COALESCE(msg_time, 0) >= ?
          AND COALESCE(msg_time, 0) < ?
        GROUP BY chatroom_id, date, sender, hour
      `,
      )
      .all(start, end) as Array<{
      chatroom_id: string;
      date: string;
      sender: string;
      hour: number;
      count: number;
    }>;

    const buckets = new Map<
      string,
      {
        chatroom_id: string;
        date: string;
        total: number;
        senders: Map<string, number>;
        hours: number[];
      }
    >();
    for (const row of rows) {
      if (!row.chatroom_id || !row.date) continue;
      const key = `${row.chatroom_id}\u0000${row.date}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          chatroom_id: row.chatroom_id,
          date: row.date,
          total: 0,
          senders: new Map(),
          hours: new Array(24).fill(0),
        };
        buckets.set(key, bucket);
      }
      bucket.total += row.count;
      bucket.senders.set(row.sender, (bucket.senders.get(row.sender) ?? 0) + row.count);
      if (row.hour >= 0 && row.hour < 24) bucket.hours[row.hour] += row.count;
    }

    return Array.from(buckets.values()).map((b) => ({
      chatroom_id: b.chatroom_id,
      date: b.date,
      total: b.total,
      top_senders: Array.from(b.senders.entries())
        .map(([sender, count]) => ({ sender, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      by_hour: b.hours.map((count, hour) => ({ hour, count })),
    }));
  }, []);
}

type StatsBucket = {
  chatroom_id: string;
  date: string;
  total: number;
  senders: Map<string, number>;
  hours: number[];
};

function statsBucketsToRows(buckets: Map<string, StatsBucket>): WxStatsRangeRow[] {
  return Array.from(buckets.values()).map((b) => ({
    chatroom_id: b.chatroom_id,
    date: b.date,
    total: b.total,
    top_senders: Array.from(b.senders.entries())
      .map(([sender, count]) => ({ sender, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    by_hour: b.hours.map((count, hour) => ({ hour, count })),
  }));
}

/**
 * Reconstruct per-(chat, date) stats from raw decrypted message_*.db. Reached
 * only when collector.db is empty/absent. Walks every `Msg_<md5(username)>`
 * table whose hash maps back to a known chat (session/contact/watched). Counts
 * are reliable even when message_content is a compressed BLOB; sender labels
 * resolve via Name2Id + contacts where possible. This path full-scans raw
 * tables and is intentionally a degraded fallback, not the hot path.
 */
function readDecryptedStatsRange(
  paths: ReturnType<typeof wxDbPaths>,
  start: number,
  end: number,
): WxStatsRangeRow[] {
  if (!existsSync(paths.messageDir)) return [];
  const hashToChat = buildChatHashMap(paths);
  if (hashToChat.size === 0) return [];
  const contactNames = readContactNames(paths.contactDb);
  const selfWxid = readConfig().wechatSelfWxid;
  const buckets = new Map<string, StatsBucket>();

  for (const file of messageDbFiles(paths.messageDir)) {
    withReadonlyDb(file, (d) => {
      const nameByRowid = readName2Id(d);
      for (const table of msgTablesFor(d, hashToChat)) {
        const cols = tableColumns(d, table.name);
        const timeCol = chooseColumn(cols, ['create_time', 'msg_time', 'CreateTime']);
        const senderCol = chooseColumn(cols, ['real_sender_id', 'sender', 'StrTalker']);
        if (!timeCol) continue;
        const rows = d
          .prepare(
            `
            SELECT date(${sqlIdent(timeCol)}, 'unixepoch', 'localtime') AS date,
                   CAST(strftime('%H', ${sqlIdent(timeCol)}, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                   ${senderCol ? sqlIdent(senderCol) : "''"} AS sender,
                   COUNT(*) AS count
            FROM ${sqlIdent(table.name)}
            WHERE ${sqlIdent(timeCol)} >= ? AND ${sqlIdent(timeCol)} < ?
            GROUP BY date, hour, sender
          `,
          )
          .all(start, end) as Array<{ date: string; hour: number; sender: number | string | null; count: number }>;
        for (const row of rows) {
          if (!row.date) continue;
          const key = `${table.chatroomId}|${row.date}`;
          let bucket = buckets.get(key);
          if (!bucket) {
            bucket = { chatroom_id: table.chatroomId, date: row.date, total: 0, senders: new Map(), hours: new Array(24).fill(0) };
            buckets.set(key, bucket);
          }
          const sender = resolveRawSender(row.sender, nameByRowid, contactNames, selfWxid);
          bucket.total += row.count;
          bucket.senders.set(sender, (bucket.senders.get(sender) ?? 0) + row.count);
          if (row.hour >= 0 && row.hour < 24) bucket.hours[row.hour] += row.count;
        }
      }
      return null;
    }, null);
  }
  return statsBucketsToRows(buckets);
}

/**
 * md5(username) → username, for reverse-mapping raw `Msg_<hash>` tables back to
 * a chatroom_id. Universe = watched_chats ∪ session usernames ∪ contacts.
 */
function buildChatHashMap(paths: ReturnType<typeof wxDbPaths>): Map<string, string> {
  const ids = new Set<string>();
  for (const id of readWatchedChatNames(paths.collectorDb).keys()) ids.add(id);
  for (const row of readSessionRows(paths.sessionDb)) {
    if (row.username) ids.add(row.username);
  }
  for (const id of readContactNames(paths.contactDb).keys()) ids.add(id);

  const map = new Map<string, string>();
  for (const id of ids) {
    map.set(createHash('md5').update(id).digest('hex'), id);
  }
  return map;
}

/** Raw `Msg_<hash>` tables present in `d` whose hash maps back to a known chat. */
function msgTablesFor(d: Sqlite, hashToChat: Map<string, string>): Array<{ name: string; chatroomId: string }> {
  const rows = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'Msg\\_%' ESCAPE '\\'")
    .all() as Array<{ name: string }>;
  const out: Array<{ name: string; chatroomId: string }> = [];
  for (const row of rows) {
    const hash = row.name.slice(4); // strip "Msg_"
    const chatroomId = hashToChat.get(hash);
    if (chatroomId) out.push({ name: row.name, chatroomId });
  }
  return out;
}

function resolveRawSender(
  raw: number | string | null,
  nameByRowid: Map<number, string>,
  contactNames: Map<string, string>,
  selfWxid: string,
): string {
  if (raw === null || raw === undefined || raw === '') return '(unknown)';
  const senderId = typeof raw === 'number' ? nameByRowid.get(raw) || String(raw) : String(raw);
  if (senderId === selfWxid) return '__self__';
  return contactNames.get(senderId) || senderId;
}

export async function wxNewMessages(limit = 50): Promise<WxNewMessage[]> {
  const paths = wxDbPaths();
  const contactNames = readContactNames(paths.contactDb);
  return readCollectorNewest(paths.collectorDb, limit).map((row) => {
    const message = collectorRowToMessage(row);
    return {
      ...message,
      username: row.chatroom_id,
      chat: row.chatroom_name || contactNames.get(row.chatroom_id) || row.chatroom_id,
    };
  });
}

export async function wxMembers(chat: string): Promise<WxMember[]> {
  const paths = wxDbPaths();
  return withReadonlyDb(paths.contactDb, (d) => {
    if (!tableExists(d, 'chat_room') || !tableExists(d, 'chatroom_member') || !tableExists(d, 'contact')) {
      return [];
    }
    const rows = d
      .prepare(
        `
        SELECT c.username, c.nick_name, c.remark, c.alias
        FROM chat_room cr
        JOIN chatroom_member cm ON cm.room_id = cr.id
        JOIN contact c ON c.id = cm.member_id
        WHERE cr.username = ?
        ORDER BY COALESCE(NULLIF(c.remark, ''), NULLIF(c.nick_name, ''), c.username) ASC
      `,
      )
      .all(chat) as ContactRow[];
    return rows.map((r) => ({
      username: r.username,
      nickname: r.nick_name || undefined,
      display_name: displayContactName(r),
    }));
  }, []);
}

export async function wxDaemonStatus(): Promise<WxDaemonStatus> {
  // DB source mode: there is no resident daemon. Report data-source readability.
  const readable = wxDbAvailable();
  return { running: readable, source: 'db', db_readable: readable };
}

export async function wxAvailable(): Promise<boolean> {
  return wxDbAvailable();
}

type SearchHit = WxNewMessage & { date: string };

export async function wxSearchMessages(
  q: string,
  limit = 10,
): Promise<WxResult<SearchHit[]>> {
  const query = q.trim();
  if (query.length < 2) return found<SearchHit[]>([], 'collector');
  const paths = wxDbPaths();
  const contactNames = readContactNames(paths.contactDb);
  const like = `%${escapeLike(query)}%`;
  const hasCollector = existsSync(paths.collectorDb);
  const hasRaw = existsSync(paths.messageDir);

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  let usedCollector = false;
  let usedRaw = false;

  // 1. collector (cleanest content) — ESCAPE so % _ \ in the query are literal.
  if (hasCollector) {
    const rows = withReadonlyDb(paths.collectorDb, (d) => {
      if (!tableExists(d, 'messages')) return [];
      return d
        .prepare(
          `
        SELECT m.chatroom_id, m.sender, m.content, m.msg_time, m.local_id, m.msg_type, wc.chatroom_name
        FROM messages m
        LEFT JOIN watched_chats wc ON wc.chatroom_id = m.chatroom_id
        WHERE m.content LIKE ? ESCAPE '\\' OR m.sender LIKE ? ESCAPE '\\'
        ORDER BY m.msg_time DESC, CAST(m.local_id AS INTEGER) DESC
        LIMIT ?
      `,
        )
        .all(like, like, limit) as CollectorMessageRow[];
    }, []);
    for (const row of rows) {
      const message = collectorRowToMessage(row);
      const hit: SearchHit = {
        ...message,
        username: row.chatroom_id,
        chat: row.chatroom_name || contactNames.get(row.chatroom_id) || row.chatroom_id,
        date: dateOfTimestamp(message.timestamp),
      };
      if (pushHit(hits, seen, hit, limit)) usedCollector = true;
      if (hits.length >= limit) break;
    }
  }

  // 2. raw decrypted — supplement up to `limit` (catches raw-only chats/matches
  // collector never captured). Skipped once collector already filled `limit`.
  if (hits.length < limit && hasRaw) {
    const before = hits.length;
    readDecryptedSearch(paths, query, limit, contactNames, hits, seen);
    if (hits.length > before) usedRaw = true;
  }

  if (hits.length === 0) return emptyResult<SearchHit[]>([], hasCollector, hasRaw);
  const source: WxSource = usedCollector && usedRaw ? 'mixed' : usedRaw ? 'raw' : 'collector';
  return { data: hits.slice(0, limit), source, empty_reason: null };
}

/** Stable dedup key across collector/raw (their local_id spaces differ). */
function searchHitKey(h: SearchHit): string {
  return JSON.stringify([h.username, h.timestamp, h.sender, h.content.slice(0, 40)]);
}

function pushHit(hits: SearchHit[], seen: Set<string>, hit: SearchHit, limit: number): boolean {
  if (hits.length >= limit) return false;
  const k = searchHitKey(hit);
  if (seen.has(k)) return false;
  seen.add(k);
  hits.push(hit);
  return true;
}

function readDecryptedSearch(
  paths: ReturnType<typeof wxDbPaths>,
  query: string,
  limit: number,
  contactNames: Map<string, string>,
  hits: SearchHit[],
  seen: Set<string>,
): void {
  if (!existsSync(paths.messageDir)) return;
  const hashToChat = buildChatHashMap(paths);
  if (hashToChat.size === 0) return;
  const like = `%${escapeLike(query)}%`;

  for (const file of messageDbFiles(paths.messageDir)) {
    if (hits.length >= limit) break;
    withReadonlyDb(file, (d) => {
      const nameByRowid = readName2Id(d);
      for (const table of msgTablesFor(d, hashToChat)) {
        if (hits.length >= limit) break;
        const cols = tableColumns(d, table.name);
        const idCol = chooseColumn(cols, ['local_id', 'MsgLocalID', 'rowid']);
        const timeCol = chooseColumn(cols, ['create_time', 'msg_time', 'CreateTime']);
        const senderCol = chooseColumn(cols, ['real_sender_id', 'sender', 'StrTalker']);
        const contentCol = chooseColumn(cols, ['message_content', 'compress_content', 'content', 'Content']);
        const typeCol = chooseColumn(cols, ['local_type', 'MsgType', 'Type']);
        if (!timeCol || !contentCol) continue;
        const rows = d
          .prepare(
            `
            SELECT ${idCol ? sqlIdent(idCol) : 'rowid'} AS local_id,
                   ${sqlIdent(timeCol)} AS msg_time,
                   ${senderCol ? sqlIdent(senderCol) : "''"} AS sender,
                   ${sqlIdent(contentCol)} AS content,
                   ${typeCol ? sqlIdent(typeCol) : '1'} AS msg_type
            FROM ${sqlIdent(table.name)}
            WHERE ${sqlIdent(contentCol)} LIKE ? ESCAPE '\\'
            ORDER BY ${sqlIdent(timeCol)} DESC
            LIMIT ?
          `,
          )
          .all(like, Math.max(limit - hits.length, 0)) as Array<{
          local_id: number | string | null;
          msg_time: number | null;
          sender: number | string | null;
          content: unknown;
          msg_type: number | string | null;
        }>;
        for (const row of rows) {
          const message = rawMessageRowToMessage(row, nameByRowid, contactNames);
          pushHit(
            hits,
            seen,
            {
              ...message,
              username: table.chatroomId,
              chat: contactNames.get(table.chatroomId) || table.chatroomId,
              date: dateOfTimestamp(message.timestamp),
            },
            limit,
          );
          if (hits.length >= limit) break;
        }
      }
      return null;
    }, null);
  }
}

function readCollectorLatestRows(path: string, limit: number): CollectorMessageRow[] {
  return withReadonlyDb(path, (d) => {
    if (!tableExists(d, 'messages')) return [];
    return d
      .prepare(
        `
        WITH ranked AS (
          SELECT m.chatroom_id, m.sender, m.content, m.msg_time, m.local_id, m.msg_type,
                 wc.chatroom_name,
                 ROW_NUMBER() OVER (
                   PARTITION BY m.chatroom_id
                   ORDER BY COALESCE(m.msg_time, 0) DESC, CAST(COALESCE(m.local_id, '0') AS INTEGER) DESC, m.id DESC
                 ) AS rn
          FROM messages m
          LEFT JOIN watched_chats wc ON wc.chatroom_id = m.chatroom_id
        )
        SELECT chatroom_id, sender, content, msg_time, local_id, msg_type, chatroom_name
        FROM ranked
        WHERE rn = 1
        ORDER BY COALESCE(msg_time, 0) DESC
        LIMIT ?
      `,
      )
      .all(limit) as CollectorMessageRow[];
  }, []);
}

function readCollectorNewest(path: string, limit: number): CollectorMessageRow[] {
  return withReadonlyDb(path, (d) => {
    if (!tableExists(d, 'messages')) return [];
    return d
      .prepare(
        `
        SELECT m.chatroom_id, m.sender, m.content, m.msg_time, m.local_id, m.msg_type, wc.chatroom_name
        FROM messages m
        LEFT JOIN watched_chats wc ON wc.chatroom_id = m.chatroom_id
        ORDER BY COALESCE(m.msg_time, 0) DESC, CAST(COALESCE(m.local_id, '0') AS INTEGER) DESC, m.id DESC
        LIMIT ?
      `,
      )
      .all(limit) as CollectorMessageRow[];
  }, []);
}

function readCollectorHistory(
  path: string,
  chat: string,
  start: number,
  end: number,
  limit: number,
): WxMessage[] {
  return withReadonlyDb(path, (d) => {
    if (!tableExists(d, 'messages')) return [];
    const rows = d
      .prepare(
        `
        SELECT chatroom_id, sender, content, msg_time, local_id, msg_type
        FROM messages
        WHERE chatroom_id = ?
          AND COALESCE(msg_time, 0) >= ?
          AND COALESCE(msg_time, 0) < ?
        ORDER BY msg_time ASC, CAST(COALESCE(local_id, '0') AS INTEGER) ASC, id ASC
        LIMIT ?
      `,
      )
      .all(chat, start, end, limit) as CollectorMessageRow[];
    return rows.map(collectorRowToMessage);
  }, []);
}

function readSessionRows(path: string): SessionRow[] {
  return withReadonlyDb(path, (d) => {
    if (!tableExists(d, 'SessionTable')) return [];
    return d
      .prepare(
        `
        SELECT username, unread_count, summary, last_timestamp, last_msg_type,
               last_msg_sender, last_sender_display_name
        FROM SessionTable
        WHERE username IS NOT NULL AND username != ''
      `,
      )
      .all() as SessionRow[];
  }, []);
}

function readContactNames(path: string): Map<string, string> {
  const names = new Map<string, string>();
  withReadonlyDb(path, (d) => {
    if (!tableExists(d, 'contact')) return null;
    const rows = d
      .prepare('SELECT username, nick_name, remark, alias FROM contact')
      .all() as ContactRow[];
    for (const row of rows) {
      names.set(row.username, displayContactName(row));
    }
    return null;
  }, null);
  return names;
}

function readWatchedChatNames(path: string): Map<string, string> {
  const names = new Map<string, string>();
  withReadonlyDb(path, (d) => {
    if (!tableExists(d, 'watched_chats')) return null;
    const rows = d
      .prepare('SELECT chatroom_id, chatroom_name FROM watched_chats')
      .all() as Array<{ chatroom_id: string; chatroom_name: string | null }>;
    for (const row of rows) {
      if (row.chatroom_name) names.set(row.chatroom_id, row.chatroom_name);
    }
    return null;
  }, null);
  return names;
}

function readDecryptedMessageHistory(
  messageDir: string,
  contactDb: string,
  chat: string,
  start: number,
  end: number,
  limit: number,
): WxMessage[] {
  if (!existsSync(messageDir)) return [];
  const table = `Msg_${createHash('md5').update(chat).digest('hex')}`;
  const contactNames = readContactNames(contactDb);
  const messages: WxMessage[] = [];

  for (const file of messageDbFiles(messageDir)) {
    const part = withReadonlyDb(file, (d) => {
      if (!tableExists(d, table)) return [];
      const cols = tableColumns(d, table);
      const idCol = chooseColumn(cols, ['local_id', 'MsgLocalID', 'rowid']);
      const timeCol = chooseColumn(cols, ['create_time', 'msg_time', 'CreateTime']);
      const senderCol = chooseColumn(cols, ['real_sender_id', 'sender', 'StrTalker']);
      const contentCol = chooseColumn(cols, ['message_content', 'compress_content', 'content', 'Content']);
      const typeCol = chooseColumn(cols, ['local_type', 'MsgType', 'Type']);
      if (!timeCol || !contentCol) return [];

      const selectCols = [
        idCol ? sqlIdent(idCol) : 'rowid',
        timeCol ? sqlIdent(timeCol) : '0',
        senderCol ? sqlIdent(senderCol) : "''",
        contentCol ? sqlIdent(contentCol) : "''",
        typeCol ? sqlIdent(typeCol) : '1',
      ];
      const rows = d
        .prepare(
          `
          SELECT ${selectCols[0]} AS local_id,
                 ${selectCols[1]} AS msg_time,
                 ${selectCols[2]} AS sender,
                 ${selectCols[3]} AS content,
                 ${selectCols[4]} AS msg_type
          FROM ${sqlIdent(table)}
          WHERE ${sqlIdent(timeCol)} >= ? AND ${sqlIdent(timeCol)} < ?
          ORDER BY ${sqlIdent(timeCol)} ASC, local_id ASC
          LIMIT ?
        `,
        )
        .all(start, end, Math.max(limit - messages.length, 0)) as Array<{
        local_id: number | string | null;
        msg_time: number | null;
        sender: number | string | null;
        content: unknown;
        msg_type: number | string | null;
      }>;
      const nameByRowid = readName2Id(d);
      return rows.map((row) => rawMessageRowToMessage(row, nameByRowid, contactNames));
    }, []);
    messages.push(...part);
    if (messages.length >= limit) break;
  }

  return messages
    .sort((a, b) => a.timestamp - b.timestamp || a.local_id - b.local_id)
    .slice(0, limit);
}

function readName2Id(d: Sqlite): Map<number, string> {
  const names = new Map<number, string>();
  if (!tableExists(d, 'Name2Id')) return names;
  const rows = d.prepare('SELECT rowid, user_name FROM Name2Id').all() as Array<{ rowid: number; user_name: string }>;
  for (const row of rows) names.set(row.rowid, row.user_name);
  return names;
}

function rawMessageRowToMessage(
  row: {
    local_id: number | string | null;
    msg_time: number | null;
    sender: number | string | null;
    content: unknown;
    msg_type: number | string | null;
  },
  nameByRowid: Map<number, string>,
  contactNames: Map<string, string>,
): WxMessage {
  const cfg = readConfig();
  const senderId =
    typeof row.sender === 'number'
      ? nameByRowid.get(row.sender) || String(row.sender)
      : String(row.sender ?? '');
  const sender = senderId === cfg.wechatSelfWxid ? '__self__' : contactNames.get(senderId) || senderId;
  const type = msgTypeName(row.msg_type);
  // Group raw content is prefixed with "<sender_wxid>:\n"; strip it so group
  // detail / rescan don't persist wxid noise into content.
  const content = stripSenderPrefix(normalizeContent(row.content, type), senderId);
  const timestamp = Number(row.msg_time ?? 0);
  return {
    local_id: numericLocalId(row.local_id),
    sender,
    content,
    time: formatTime(timestamp),
    timestamp,
    type,
  };
}

function collectorRowToSession(
  row: CollectorMessageRow,
  contactNames: Map<string, string>,
  fallback?: WxSession,
): WxSession {
  const timestamp = Number(row.msg_time ?? fallback?.timestamp ?? 0);
  const type = msgTypeName(row.msg_type ?? fallback?.last_msg_type);
  return {
    chat: row.chatroom_name || contactNames.get(row.chatroom_id) || fallback?.chat || row.chatroom_id,
    chat_type: isGroup(row.chatroom_id) ? 'group' : 'private',
    is_group: isGroup(row.chatroom_id),
    last_msg_type: type,
    last_sender: row.sender || fallback?.last_sender || '',
    summary: compact(normalizeContent(row.content, type) || fallback?.summary || '', 160),
    time: timestamp ? formatTime(timestamp) : fallback?.time || '',
    timestamp,
    unread: fallback?.unread ?? 0,
    username: row.chatroom_id,
  };
}

function sessionRowToSession(row: SessionRow, contactNames: Map<string, string>): WxSession {
  const timestamp = Number(row.last_timestamp ?? 0);
  const type = msgTypeName(row.last_msg_type);
  const chat = contactNames.get(row.username) || row.username;
  return {
    chat,
    chat_type: isGroup(row.username) ? 'group' : 'private',
    is_group: isGroup(row.username),
    last_msg_type: type,
    last_sender: row.last_sender_display_name || row.last_msg_sender || '',
    summary: compact(normalizeContent(row.summary, type), 160),
    time: timestamp ? formatTime(timestamp) : '',
    timestamp,
    unread: Number(row.unread_count ?? 0),
    username: row.username,
  };
}

function collectorRowToMessage(row: CollectorMessageRow): WxMessage {
  const timestamp = Number(row.msg_time ?? 0);
  const type = msgTypeName(row.msg_type);
  return {
    local_id: numericLocalId(row.local_id),
    sender: row.sender || '',
    content: normalizeContent(row.content, type),
    time: timestamp ? formatTime(timestamp) : '',
    timestamp,
    type,
  };
}

function displayContactName(row: ContactRow): string {
  return row.remark || row.nick_name || row.alias || row.username;
}

function normalizeContent(value: unknown, type: string): string {
  if (value === null || value === undefined) return placeholderForType(type);
  if (Buffer.isBuffer(value)) return placeholderForType(type);
  const text = String(value).replace(/\u0000/g, '').trim();
  return text || placeholderForType(type);
}

function placeholderForType(type: string): string {
  if (type === '图片') return '[图片]';
  if (type === '语音') return '[语音]';
  if (type === '视频') return '[视频]';
  if (type === '表情') return '[表情]';
  if (type === '链接/文件') return '[链接/文件]';
  if (type === '系统') return '[系统消息]';
  return '';
}

function msgTypeName(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isNaN(n)) {
    if (n === 1) return '文本';
    if (n === 3) return '图片';
    if (n === 34) return '语音';
    if (n === 43) return '视频';
    if (n === 47) return '表情';
    if (n === 49) return '链接/文件';
    if (n === 10000 || n === 10002) return '系统';
    return String(n);
  }
  return String(value ?? '');
}

function isGroup(username: string): boolean {
  return username.endsWith('@chatroom');
}

function numericLocalId(value: number | string | null | undefined): number {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const hash = createHash('md5').update(String(value ?? '')).digest('hex').slice(0, 12);
  return Number.parseInt(hash, 16);
}

function unixStartOfDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000);
}

function unixEndExclusive(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime() / 1000);
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

function dateOfTimestamp(timestamp: number): string {
  return formatTime(timestamp).slice(0, 10);
}

function compact(s: string, max: number): string {
  const text = s.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function messageDbFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /^message_\d+\.db$/.test(name))
    .map((name) => join(dir, name))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

function chooseColumn(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (c === 'rowid' || cols.has(c)) return c;
  }
  return null;
}

function tableColumns(d: Sqlite, table: string): Set<string> {
  const rows = d.prepare(`PRAGMA table_info(${sqlIdent(table)})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function tableExists(d: Sqlite, table: string): boolean {
  const row = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function withReadonlyDb<T>(path: string, fn: (d: Sqlite) => T, fallback: T): T {
  if (!existsSync(path)) return fallback;
  let d: Sqlite | null = null;
  try {
    d = new Database(path, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');
    return fn(d);
  } catch (e) {
    // Degrade to fallback in prod, but never silently swallow schema/SQL errors:
    // surface them in dev so a query bug isn't mistaken for "no data".
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[wechat-db-adapter] readonly query failed on ${path}:`, e instanceof Error ? e.message : e);
    }
    return fallback;
  } finally {
    d?.close();
  }
}

function stripSenderPrefix(content: string, wxid: string): string {
  if (!wxid) return content;
  const prefix = `${wxid}:`;
  return content.startsWith(prefix) ? content.slice(prefix.length).replace(/^\s+/, '') : content;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function sqlIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
