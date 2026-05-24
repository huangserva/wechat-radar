import { db } from './db';

export interface GroupRow {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
  sort_order: number;
  created_at: number;
  member_count?: number;
  message_count?: number;
}

export function listGroups(): GroupRow[] {
  return db()
    .prepare(
      `SELECT g.*,
              (SELECT COUNT(*) FROM group_tags t WHERE t.group_id = g.id) AS member_count
       FROM groups g
       ORDER BY g.sort_order ASC, g.id ASC`,
    )
    .all() as GroupRow[];
}

export function createGroup(input: { name: string; color: string; emoji?: string }) {
  const max = db().prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM groups').get() as {
    m: number;
  };
  const stmt = db().prepare(
    'INSERT INTO groups (name, color, emoji, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const info = stmt.run(input.name, input.color, input.emoji ?? null, max.m + 1, Date.now());
  return Number(info.lastInsertRowid);
}

export function deleteGroup(id: number) {
  db().prepare('DELETE FROM groups WHERE id = ?').run(id);
}

export function tagGroup(chatroomId: string, groupId: number) {
  db()
    .prepare('INSERT OR IGNORE INTO group_tags (chatroom_id, group_id) VALUES (?, ?)')
    .run(chatroomId, groupId);
}

export function untagGroup(chatroomId: string, groupId: number) {
  db()
    .prepare('DELETE FROM group_tags WHERE chatroom_id = ? AND group_id = ?')
    .run(chatroomId, groupId);
}

export function tagsForChatroom(chatroomId: string): number[] {
  const rows = db()
    .prepare('SELECT group_id FROM group_tags WHERE chatroom_id = ?')
    .all(chatroomId) as Array<{ group_id: number }>;
  return rows.map((r) => r.group_id);
}

export function chatroomsForGroup(groupId: number): string[] {
  const rows = db()
    .prepare('SELECT chatroom_id FROM group_tags WHERE group_id = ?')
    .all(groupId) as Array<{ chatroom_id: string }>;
  return rows.map((r) => r.chatroom_id);
}

export function listAllTags(): Array<{ chatroom_id: string; group_id: number }> {
  return db()
    .prepare('SELECT chatroom_id, group_id FROM group_tags')
    .all() as Array<{ chatroom_id: string; group_id: number }>;
}

export function isFavorite(chatroomId: string): boolean {
  const r = db()
    .prepare('SELECT 1 AS x FROM favorites WHERE chatroom_id = ?')
    .get(chatroomId) as { x: number } | undefined;
  return !!r;
}

export function listFavorites(): string[] {
  return (
    db().prepare('SELECT chatroom_id FROM favorites ORDER BY starred_at DESC').all() as Array<{
      chatroom_id: string;
    }>
  ).map((r) => r.chatroom_id);
}

export function setFavorite(chatroomId: string, fav: boolean) {
  if (fav) {
    db()
      .prepare('INSERT OR IGNORE INTO favorites (chatroom_id, starred_at) VALUES (?, ?)')
      .run(chatroomId, Date.now());
  } else {
    db().prepare('DELETE FROM favorites WHERE chatroom_id = ?').run(chatroomId);
  }
}
