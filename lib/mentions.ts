import { db } from './db';
import { readConfig } from './config';
import { wxHistory } from './wx';
import type { WxMessage } from './wx-types';

export interface MentionRow {
  chatroom_id: string;
  local_id: number;
  sender: string;
  content: string;
  time: string;
  timestamp: number;
  seen: number;
}

function isMention(content: string, nicknames: string[]): boolean {
  if (!content) return false;
  return mentionNeedles(nicknames).some((n) => content.includes(n));
}

function normalizedNicknames(nicknames: string[]): string[] {
  return Array.from(
    new Set(nicknames.map((n) => n.trim()).filter((n) => n.length > 0)),
  );
}

function mentionNeedles(nicknames: string[]): string[] {
  return normalizedNicknames(nicknames).map((n) => `@${n}`);
}

function mentionPredicate(column: string, nicknames: string[]) {
  const needles = mentionNeedles(nicknames);
  return {
    sql: needles.map(() => `instr(${column}, ?) > 0`).join(' OR ') || '0',
    params: needles,
  };
}

function currentMessageState(signature: string) {
  const row = db()
    .prepare('SELECT COUNT(*) AS count, COALESCE(MAX(timestamp), 0) AS maxTimestamp FROM messages')
    .get() as { count: number; maxTimestamp: number };
  return {
    signature,
    messageCount: row.count,
    maxTimestamp: row.maxTimestamp,
  };
}

function mentionSignature(nicknames: string[]): string {
  return JSON.stringify(normalizedNicknames(nicknames));
}

function readMentionIndexState() {
  const row = db()
    .prepare("SELECT value FROM meta WHERE key = 'mention_index_state'")
    .get() as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as ReturnType<typeof currentMessageState>;
  } catch {
    return null;
  }
}

function writeMentionIndexState(state: ReturnType<typeof currentMessageState>) {
  db()
    .prepare(
      `INSERT INTO meta (key, value)
       VALUES ('mention_index_state', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(JSON.stringify(state));
}

export function rebuildMentionIndexFromMessages(): number {
  const cfg = readConfig();
  const signature = mentionSignature(cfg.myNicknames);
  const state = currentMessageState(signature);
  const predicate = mentionPredicate('content', cfg.myNicknames);

  const tx = db().transaction(() => {
    if (!predicate.params.length) {
      db().prepare('DELETE FROM mentions').run();
      writeMentionIndexState(state);
      return 0;
    }

    db()
      .prepare(`DELETE FROM mentions WHERE NOT (${predicate.sql})`)
      .run(...predicate.params);

    db()
      .prepare(
        `INSERT OR IGNORE INTO mentions
          (chatroom_id, local_id, sender, content, time, timestamp, seen)
         SELECT chatroom_id, local_id, sender, content, time, timestamp, 0
         FROM messages
         WHERE ${predicate.sql}`,
      )
      .run(...predicate.params);

    writeMentionIndexState(state);
    const row = db().prepare('SELECT COUNT(*) AS n FROM mentions').get() as { n: number };
    return row.n;
  });

  return tx();
}

function ensureMentionIndexCurrent() {
  const cfg = readConfig();
  const state = currentMessageState(mentionSignature(cfg.myNicknames));
  const indexed = readMentionIndexState();
  if (
    indexed?.signature === state.signature &&
    indexed.messageCount === state.messageCount &&
    indexed.maxTimestamp === state.maxTimestamp
  ) {
    return;
  }
  rebuildMentionIndexFromMessages();
}

export async function scanMentions(
  chatroomId: string,
  since: string,
  until: string,
): Promise<number> {
  const cfg = readConfig();
  if (!cfg.myNicknames.length) return 0;

  let messages: WxMessage[] = [];
  try {
    messages = await wxHistory(chatroomId, since, until, 5000);
  } catch {
    return 0;
  }

  const upsert = db().prepare(`
    INSERT OR REPLACE INTO mentions
      (chatroom_id, local_id, sender, content, time, timestamp, seen)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT seen FROM mentions WHERE chatroom_id = ? AND local_id = ?), 0))
  `);

  let inserted = 0;
  const insert = db().transaction((items: WxMessage[]) => {
    for (const m of items) {
      if (!isMention(m.content, cfg.myNicknames)) continue;
      upsert.run(
        chatroomId,
        m.local_id,
        m.sender,
        m.content,
        m.time,
        m.timestamp,
        chatroomId,
        m.local_id,
      );
      inserted++;
    }
  });
  insert(messages);
  return inserted;
}

export function listMentions(limit = 100): MentionRow[] {
  ensureMentionIndexCurrent();
  return db()
    .prepare(
      'SELECT chatroom_id, local_id, sender, content, time, timestamp, seen FROM mentions ORDER BY timestamp DESC LIMIT ?',
    )
    .all(limit) as MentionRow[];
}

export function countMentions(): number {
  ensureMentionIndexCurrent();
  const row = db().prepare('SELECT COUNT(*) AS n FROM mentions').get() as { n: number };
  return row.n;
}

export function countMentionsSince(unixSeconds: number): number {
  ensureMentionIndexCurrent();
  const row = db()
    .prepare('SELECT COUNT(*) AS n FROM mentions WHERE timestamp >= ?')
    .get(unixSeconds) as { n: number };
  return row.n;
}

export function countMentionsBetween(sinceUnixSeconds: number, untilUnixSeconds: number): number {
  ensureMentionIndexCurrent();
  const row = db()
    .prepare('SELECT COUNT(*) AS n FROM mentions WHERE timestamp >= ? AND timestamp <= ?')
    .get(sinceUnixSeconds, untilUnixSeconds) as { n: number };
  return row.n;
}

export function markMentionsSeen(chatroomId?: string) {
  if (chatroomId) {
    db().prepare('UPDATE mentions SET seen = 1 WHERE chatroom_id = ?').run(chatroomId);
  } else {
    db().prepare('UPDATE mentions SET seen = 1').run();
  }
}
