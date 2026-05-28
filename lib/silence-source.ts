import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readConfig, DATA_DIR } from './config';

type Sqlite = Database.Database;

export type SilenceStatus = 'never' | 'silent_30d' | 'occasional' | 'active';

export interface SilenceMember {
  wxid: string;
  nick_name: string;
  remark: string;
  display_name: string;
  last_spoken_ts: number | null;
  days_since: number | null;
  status: SilenceStatus;
}

export interface GroupSilence {
  chatroom_id: string;
  group_name: string;
  total_members: number;
  active_count: number;
  occasional_count: number;
  silent_30d_count: number;
  never_count: number;
  top_silent: SilenceMember[];
}

export interface SilencePayload {
  available: boolean;
  groups: GroupSilence[];
  summary: {
    total_groups: number;
    total_members: number;
    total_silent: number;
    total_never: number;
  };
}

const RADAR_DB_PATH = join(DATA_DIR, 'radar.db');

export function loadSilenceAnalysis(): SilencePayload {
  const config = readConfig();
  const contactDbPath = join(config.wechatDecryptedDir, 'contact', 'contact.db');

  if (!existsSync(contactDbPath) || !existsSync(RADAR_DB_PATH)) {
    return emptyPayload();
  }

  // Step 1: Get all synced groups from radar.db
  const syncedGroups = getSyncedGroups();
  if (syncedGroups.length === 0) return emptyPayload();

  // Step 2: Get group names from radar.db groups table
  const groupNames = getGroupNames();

  // Step 3: For each synced group, compute silence data
  const groups: GroupSilence[] = [];
  const now = Date.now() / 1000;

  for (const chatroom_id of syncedGroups) {
    const members = getContactMembers(contactDbPath, chatroom_id);
    if (members.length === 0) continue;

    const senderLastSeen = getSenderLastSeen(chatroom_id);

    // Match members to senders by nick_name or remark
    const analyzed: SilenceMember[] = members.map((m) => {
      const displayName = m.remark || m.nick_name || m.wxid;
      // Try matching: remark first, then nick_name
      const matched = senderLastSeen.get(m.remark) ?? senderLastSeen.get(m.nick_name);
      const lastTs = matched ?? null;
      const daysSince = lastTs ? Math.floor((now - lastTs) / 86400) : null;
      const status = classifyStatus(lastTs, daysSince);
      return {
        wxid: m.wxid,
        nick_name: m.nick_name,
        remark: m.remark,
        display_name: displayName,
        last_spoken_ts: lastTs,
        days_since: daysSince,
        status,
      };
    });

    // Sort: never first, then by days_since desc
    analyzed.sort((a, b) => {
      const order: Record<SilenceStatus, number> = { never: 0, silent_30d: 1, occasional: 2, active: 3 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return (b.days_since ?? 9999) - (a.days_since ?? 9999);
    });

    // Top 20 silent (never + silent_30d)
    const top_silent = analyzed.filter((m) => m.status === 'never' || m.status === 'silent_30d').slice(0, 20);

    const active_count = analyzed.filter((m) => m.status === 'active').length;
    const occasional_count = analyzed.filter((m) => m.status === 'occasional').length;
    const silent_30d_count = analyzed.filter((m) => m.status === 'silent_30d').length;
    const never_count = analyzed.filter((m) => m.status === 'never').length;

    groups.push({
      chatroom_id,
      group_name: groupNames.get(chatroom_id) ?? chatroom_id,
      total_members: analyzed.length,
      active_count,
      occasional_count,
      silent_30d_count,
      never_count,
      top_silent,
    });
  }

  // Sort groups: most silent members first
  groups.sort((a, b) => (b.silent_30d_count + b.never_count) - (a.silent_30d_count + a.never_count));

  const summary = {
    total_groups: groups.length,
    total_members: groups.reduce((s, g) => s + g.total_members, 0),
    total_silent: groups.reduce((s, g) => s + g.silent_30d_count, 0),
    total_never: groups.reduce((s, g) => s + g.never_count, 0),
  };

  return { available: true, groups, summary };
}

// ---- DB queries -------------------------------------------------------------

function getSyncedGroups(): string[] {
  return withRadarDb([], (d) => {
    if (!tableExists(d, 'sync_state')) return [];
    const rows = d.prepare('SELECT chatroom_id FROM sync_state').all() as Array<{ chatroom_id: string }>;
    return rows.map((r) => r.chatroom_id);
  });
}

function getGroupNames(): Map<string, string> {
  // Read from collector.db watched_chats (has chatroom_id → chatroom_name mapping)
  const collectorPath = join(homedir(), 'wechat-assistant', 'collector.db');
  if (!existsSync(collectorPath)) return new Map();
  let d: Sqlite | null = null;
  try {
    d = new Database(collectorPath, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');
    if (!tableExists(d, 'watched_chats')) return new Map();
    const rows = d.prepare('SELECT chatroom_id, chatroom_name FROM watched_chats').all() as Array<{ chatroom_id: string; chatroom_name: string }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      // Only use names that aren't just the chatroom_id itself
      if (r.chatroom_name && r.chatroom_name !== r.chatroom_id) {
        map.set(r.chatroom_id, r.chatroom_name);
      }
    }
    return map;
  } catch {
    return new Map();
  } finally {
    d?.close();
  }
}

function getSenderLastSeen(chatroom_id: string): Map<string, number> {
  return withRadarDb(new Map(), (d) => {
    if (!tableExists(d, 'messages')) return new Map();
    const rows = d
      .prepare('SELECT sender, MAX(timestamp) as last_ts FROM messages WHERE chatroom_id = ? AND sender != ? GROUP BY sender')
      .all(chatroom_id, '__self__') as Array<{ sender: string; last_ts: number }>;
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.sender) map.set(r.sender, r.last_ts);
    }
    return map;
  });
}

function getContactMembers(contactDbPath: string, chatroom_id: string): Array<{ wxid: string; nick_name: string; remark: string }> {
  let d: Sqlite | null = null;
  try {
    d = new Database(contactDbPath, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');

    // Find chat_room.id by username
    const room = d.prepare('SELECT id FROM chat_room WHERE username = ?').get(chatroom_id) as { id: number } | undefined;
    if (!room) return [];

    const rows = d
      .prepare(
        `SELECT c.username as wxid, c.nick_name, c.remark
         FROM chatroom_member cm
         JOIN contact c ON c.id = cm.member_id
         WHERE cm.room_id = ?`,
      )
      .all(room.id) as Array<{ wxid: string; nick_name: string; remark: string }>;

    // Filter out self and system accounts
    const config = readConfig();
    const selfWxid = config.wechatSelfWxid;
    return rows.filter((r) => r.wxid !== selfWxid && r.wxid !== 'notifymessage' && r.wxid !== 'fmessage');
  } catch {
    return [];
  } finally {
    d?.close();
  }
}

function classifyStatus(lastTs: number | null, daysSince: number | null): SilenceStatus {
  if (lastTs === null) return 'never';
  if (daysSince === null) return 'never';
  if (daysSince > 30) return 'silent_30d';
  if (daysSince > 7) return 'occasional';
  return 'active';
}

// ---- helpers ----------------------------------------------------------------

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
  return Boolean(d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function emptyPayload(): SilencePayload {
  return { available: false, groups: [], summary: { total_groups: 0, total_members: 0, total_silent: 0, total_never: 0 } };
}
