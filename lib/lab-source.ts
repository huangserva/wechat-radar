import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db';
import { getSyncState } from './messages-store';
import { readConfig } from './config';
import type { LabMemberCandidate, LabMessageSource, LabSourceMessage } from './lab-types';

type Sqlite = Database.Database;

export type LabSourceCoverage = 'full' | 'partial' | 'empty';

export interface LabSourceResult {
  messages: LabSourceMessage[];
  source: LabMessageSource;
  empty_reason: string | null;
  /**
   * Whether the returned messages fully cover [since,until]. `partial` means a
   * source had rows but we could NOT confirm it covers the whole window and no
   * complete fallback was available — callers must not treat it as complete.
   */
  source_coverage: LabSourceCoverage;
}

function labDbPaths() {
  const cfg = readConfig();
  return {
    collectorDb: cfg.wechatCollectorDb,
    decryptedDir: cfg.wechatDecryptedDir,
    sessionDb: join(cfg.wechatDecryptedDir, 'session', 'session.db'),
    contactDb: join(cfg.wechatDecryptedDir, 'contact', 'contact.db'),
    messageDir: join(cfg.wechatDecryptedDir, 'message'),
  };
}

/**
 * Read raw conversation messages for the lab. Chain mirrors P0.1's adapter
 * fallback: local radar.db -> collector.db -> decrypted raw message_*.db, the
 * first source with rows wins. Role is left as 'unknown' here; identity/role
 * assignment happens in /api/lab/read. raw_sender_id / sender_wxid are only
 * populated by the decrypted_raw source (collector/local store display names).
 */
export function fetchLabSourceMessages(
  chatroomId: string,
  since: string,
  until: string,
  limit = 5000,
): LabSourceResult {
  const paths = labDbPaths();
  const start = unixStartOfDay(since);
  const end = unixEndExclusive(until);

  // 1. local radar.db — authoritative ONLY if sync_state proves it covers the
  //    whole window and is ok; an unsynced/partial local cache must not win.
  if (localSyncCoversWindow(chatroomId, since, until)) {
    const local = readLocalMessages(chatroomId, since, until, limit);
    if (local.length > 0) return result(local, 'local_messages', null, 'full');
  }

  const hasCollector = existsSync(paths.collectorDb);
  const hasRaw = existsSync(paths.messageDir);

  // 2. collector — complete for the window only if the chat has been watched
  //    since on/before `since` (else collector may miss messages before it was
  //    added). "has rows" alone does not imply completeness.
  let collectorRows: LabSourceMessage[] = [];
  if (hasCollector) {
    collectorRows = readCollectorMessages(paths.collectorDb, chatroomId, start, end, limit);
    if (collectorRows.length > 0 && collectorCoversWindow(paths.collectorDb, chatroomId, since)) {
      return result(collectorRows, 'collector', null, 'full');
    }
  }

  // 3. raw decrypted — full local history for the chat (complete fallback).
  if (hasRaw) {
    const raw = readDecryptedMessages(paths, chatroomId, start, end, limit);
    if (raw.length > 0) return result(raw, 'decrypted_raw', null, 'full');
  }

  // 4. collector had rows but coverage unconfirmed AND no raw fallback → return
  //    the rows but flag partial (don't silently present partial as complete).
  if (collectorRows.length > 0) {
    return result(collectorRows, 'collector', null, 'partial');
  }

  // 5. nothing.
  const anySource = hasCollector || hasRaw;
  return result(
    [],
    anySource ? (hasRaw ? 'decrypted_raw' : 'collector') : 'none',
    anySource ? 'no_match' : 'no_data_source',
    'empty',
  );
}

function result(
  messages: LabSourceMessage[],
  source: LabMessageSource,
  empty_reason: string | null,
  source_coverage: LabSourceCoverage,
): LabSourceResult {
  return { messages, source, empty_reason, source_coverage };
}

/** radar.db local cache is trustworthy for the window only if sync_state says so. */
function localSyncCoversWindow(chatroomId: string, since: string, until: string): boolean {
  try {
    const s = getSyncState(chatroomId);
    return Boolean(
      s &&
        s.status === 'ok' &&
        s.first_message_date &&
        s.first_message_date <= since &&
        s.last_message_date &&
        s.last_message_date >= until,
    );
  } catch {
    return false;
  }
}

/** Collector covers [since,..] only if the chat was being watched on/before `since`. */
function collectorCoversWindow(collectorDb: string, chatroomId: string, since: string): boolean {
  return withReadonlyDb(collectorDb, (d) => {
    if (!tableExists(d, 'watched_chats')) return false;
    const row = d
      .prepare("SELECT date(added_at, 'unixepoch', 'localtime') AS added_date FROM watched_chats WHERE chatroom_id = ?")
      .get(chatroomId) as { added_date: string | null } | undefined;
    return Boolean(row && row.added_date && row.added_date <= since);
  }, false);
}

/** Members of a group (or the single peer of a private chat) for role-B picking. */
export function listLabMembers(chatroomId: string): LabMemberCandidate[] {
  const paths = labDbPaths();
  if (!isGroup(chatroomId)) {
    const peer = lookupContact(paths.contactDb, chatroomId);
    return peer ? [peer] : [{ username: chatroomId, display_name: chatroomId }];
  }
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
      .all(chatroomId) as ContactRow[];
    return rows.map(contactRowToCandidate);
  }, []);
}

/** Display/identity lookup for a single wxid; used to enrich self/target matching. */
export function lookupContact(contactDb: string, wxid: string): LabMemberCandidate | null {
  return withReadonlyDb(contactDb, (d) => {
    if (!tableExists(d, 'contact')) return null;
    const row = d
      .prepare('SELECT username, nick_name, remark, alias FROM contact WHERE username = ?')
      .get(wxid) as ContactRow | undefined;
    return row ? contactRowToCandidate(row) : null;
  }, null);
}

export function contactDbPath(): string {
  return labDbPaths().contactDb;
}

// ---- source readers -------------------------------------------------------

function readLocalMessages(chatroomId: string, since: string, until: string, limit: number): LabSourceMessage[] {
  const rows = db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, content, time, timestamp, type
       FROM messages
       WHERE chatroom_id = ? AND date >= ? AND date <= ?
       ORDER BY timestamp ASC, local_id ASC
       LIMIT ?`,
    )
    .all(chatroomId, since, until, limit) as Array<{
    chatroom_id: string;
    local_id: number;
    sender: string;
    content: string;
    time: string;
    timestamp: number;
    type: string;
  }>;
  return rows.map((r) => ({
    chatroom_id: r.chatroom_id,
    local_id: numericLocalId(r.local_id),
    raw_sender_id: null,
    sender_wxid: null,
    display_name: r.sender || '',
    sender: r.sender || '',
    role: 'unknown',
    content: (r.content || '').replace(/\u0000/g, '').trim(),
    type: r.type || '文本',
    time: r.time || formatTime(r.timestamp),
    timestamp: Number(r.timestamp ?? 0),
    source: 'local_messages',
  }));
}

function readCollectorMessages(
  path: string,
  chatroomId: string,
  start: number,
  end: number,
  limit: number,
): LabSourceMessage[] {
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
      .all(chatroomId, start, end, limit) as Array<{
      chatroom_id: string;
      sender: string | null;
      content: string | null;
      msg_time: number | null;
      local_id: string | number | null;
      msg_type: number | string | null;
    }>;
    return rows.map((r) => {
      const type = msgTypeName(r.msg_type);
      const timestamp = Number(r.msg_time ?? 0);
      return {
        chatroom_id: r.chatroom_id,
        local_id: numericLocalId(r.local_id),
        raw_sender_id: null,
        sender_wxid: null,
        display_name: r.sender || '',
        sender: r.sender || '',
        role: 'unknown' as const,
        content: normalizeContent(r.content, type),
        type,
        time: timestamp ? formatTime(timestamp) : '',
        timestamp,
        source: 'collector' as const,
      };
    });
  }, []);
}

function readDecryptedMessages(
  paths: ReturnType<typeof labDbPaths>,
  chatroomId: string,
  start: number,
  end: number,
  limit: number,
): LabSourceMessage[] {
  if (!existsSync(paths.messageDir)) return [];
  const table = `Msg_${createHash('md5').update(chatroomId).digest('hex')}`;
  const contactNames = readContactNames(paths.contactDb);
  const out: LabSourceMessage[] = [];

  for (const file of messageDbFiles(paths.messageDir)) {
    if (out.length >= limit) break;
    const part = withReadonlyDb(file, (d) => {
      if (!tableExists(d, table)) return [];
      const cols = tableColumns(d, table);
      const idCol = chooseColumn(cols, ['local_id', 'MsgLocalID', 'rowid']);
      const timeCol = chooseColumn(cols, ['create_time', 'msg_time', 'CreateTime']);
      const senderCol = chooseColumn(cols, ['real_sender_id', 'sender', 'StrTalker']);
      const contentCol = chooseColumn(cols, ['message_content', 'compress_content', 'content', 'Content']);
      const typeCol = chooseColumn(cols, ['local_type', 'MsgType', 'Type']);
      if (!timeCol || !contentCol) return [];
      const nameByRowid = readName2Id(d);
      const rows = d
        .prepare(
          `
          SELECT ${idCol ? sqlIdent(idCol) : 'rowid'} AS local_id,
                 ${sqlIdent(timeCol)} AS msg_time,
                 ${senderCol ? sqlIdent(senderCol) : "''"} AS sender,
                 ${sqlIdent(contentCol)} AS content,
                 ${typeCol ? sqlIdent(typeCol) : '1'} AS msg_type
          FROM ${sqlIdent(table)}
          WHERE ${sqlIdent(timeCol)} >= ? AND ${sqlIdent(timeCol)} < ?
          ORDER BY ${sqlIdent(timeCol)} ASC, local_id ASC
          LIMIT ?
        `,
        )
        .all(start, end, Math.max(limit - out.length, 0)) as Array<{
        local_id: number | string | null;
        msg_time: number | null;
        sender: number | string | null;
        content: unknown;
        msg_type: number | string | null;
      }>;
      return rows.map((row) => {
        const wxid =
          typeof row.sender === 'number'
            ? nameByRowid.get(row.sender) ?? null
            : row.sender != null && String(row.sender).length > 0
              ? String(row.sender)
              : null;
        const display = wxid ? contactNames.get(wxid) || wxid : '';
        const type = msgTypeName(row.msg_type);
        const timestamp = Number(row.msg_time ?? 0);
        return {
          chatroom_id: chatroomId,
          local_id: numericLocalId(row.local_id),
          raw_sender_id: typeof row.sender === 'number' ? row.sender : (row.sender ?? null),
          sender_wxid: wxid,
          display_name: display,
          sender: display,
          role: 'unknown' as const,
          content: stripSenderPrefix(normalizeContent(row.content, type), wxid),
          type,
          time: timestamp ? formatTime(timestamp) : '',
          timestamp,
          source: 'decrypted_raw' as const,
        };
      });
    }, []);
    out.push(...part);
  }

  return out
    .sort((a, b) => a.timestamp - b.timestamp || a.local_id - b.local_id)
    .slice(0, limit);
}

// ---- helpers --------------------------------------------------------------

type ContactRow = {
  username: string;
  nick_name?: string | null;
  remark?: string | null;
  alias?: string | null;
};

function contactRowToCandidate(r: ContactRow): LabMemberCandidate {
  return {
    username: r.username,
    nickname: r.nick_name || undefined,
    remark: r.remark || undefined,
    alias: r.alias || undefined,
    display_name: r.remark || r.nick_name || r.alias || r.username,
  };
}

function readContactNames(path: string): Map<string, string> {
  const names = new Map<string, string>();
  withReadonlyDb(path, (d) => {
    if (!tableExists(d, 'contact')) return null;
    const rows = d.prepare('SELECT username, nick_name, remark, alias FROM contact').all() as ContactRow[];
    for (const row of rows) {
      names.set(row.username, row.remark || row.nick_name || row.alias || row.username);
    }
    return null;
  }, null);
  return names;
}

function readName2Id(d: Sqlite): Map<number, string> {
  const names = new Map<number, string>();
  if (!tableExists(d, 'Name2Id')) return names;
  const rows = d.prepare('SELECT rowid, user_name FROM Name2Id').all() as Array<{ rowid: number; user_name: string }>;
  for (const row of rows) names.set(row.rowid, row.user_name);
  return names;
}

/** Group raw text content is prefixed with "<sender_wxid>:\n"; strip it. */
function stripSenderPrefix(content: string, wxid: string | null): string {
  if (!wxid) return content;
  const prefix = `${wxid}:`;
  if (content.startsWith(prefix)) {
    return content.slice(prefix.length).replace(/^\s+/, '');
  }
  return content;
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
  if (Number.isSafeInteger(n)) return n;
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
  if (!timestamp) return '';
  const d = new Date(timestamp * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
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
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[lab-source] readonly query failed on ${path}:`, e instanceof Error ? e.message : e);
    }
    return fallback;
  } finally {
    d?.close();
  }
}

function sqlIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
