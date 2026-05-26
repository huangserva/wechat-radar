import { NextResponse } from 'next/server';
import { wxSessions } from '@/lib/wx';
import type { WxSession } from '@/lib/wx-types';
import { cache, CK } from '@/lib/cache';
import { listGroups, listAllTags, listFavorites } from '@/lib/groups';
import { effectiveGroupIds } from '@/lib/group-classifier';
import { db } from '@/lib/db';
import { readConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sessions = await loadSessionsSafe(500);

    const groups = listGroups();
    const tags = listAllTags();
    const favorites = new Set(listFavorites());

    const tagsByChatroom = new Map<string, number[]>();
    for (const t of tags) {
      const arr = tagsByChatroom.get(t.chatroom_id) ?? [];
      arr.push(t.group_id);
      tagsByChatroom.set(t.chatroom_id, arr);
    }

    const groupsList = sessions.filter((s) => s.is_group);

    const enriched = groupsList.map((s) => {
      const groupIds = effectiveGroupIds(
        s.chat,
        s.summary,
        tagsByChatroom.get(s.username) ?? [],
        groups,
      );
      return {
        chatroom_id: s.username,
        name: s.chat,
        last_msg_type: s.last_msg_type,
        last_sender: s.last_sender,
        summary: s.summary,
        time: s.time,
        timestamp: s.timestamp,
        unread: s.unread,
        is_favorite: favorites.has(s.username),
        group_ids: groupIds,
      };
    });

    const memberCounts = new Map<number, number>();
    for (const g of enriched) {
      for (const groupId of g.group_ids) {
        memberCounts.set(groupId, (memberCounts.get(groupId) ?? 0) + 1);
      }
    }
    const categories = groups.map((g) => ({
      ...g,
      member_count: memberCounts.get(g.id) ?? 0,
    }));

    return NextResponse.json({
      ok: true,
      total: groupsList.length,
      groups: enriched,
      categories,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function loadSessionsSafe(limit: number): Promise<WxSession[]> {
  if (readConfig().demoMode) return listLocalSessionsFallback(limit);
  const cached = cache.get(CK.sessions()) as WxSession[] | undefined;
  try {
    const sessions = await wxSessions(limit);
    cache.set(CK.sessions(), sessions, 60);
    return sessions;
  } catch (e) {
    if (cached?.length) return cached;
    console.warn('wx sessions failed, falling back to local radar.db', e);
    return listLocalSessionsFallback(limit);
  }
}

function listLocalSessionsFallback(limit: number): WxSession[] {
  const rows = db()
    .prepare(
      `
      SELECT m.chatroom_id, m.sender, m.content, m.time, m.timestamp, m.type
      FROM messages m
      JOIN (
        SELECT chatroom_id, MAX(timestamp) AS timestamp
        FROM messages
        GROUP BY chatroom_id
      ) latest
        ON latest.chatroom_id = m.chatroom_id
       AND latest.timestamp = m.timestamp
      GROUP BY m.chatroom_id
      ORDER BY m.timestamp DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{
    chatroom_id: string;
    sender: string;
    content: string;
    time: string;
    timestamp: number;
    type: string;
  }>;

  return rows.map((r) => ({
    chat: r.chatroom_id,
    chat_type: 'group',
    is_group: true,
    last_msg_type: r.type,
    last_sender: r.sender,
    summary: r.content,
    time: r.time,
    timestamp: r.timestamp,
    unread: 0,
    username: r.chatroom_id,
  }));
}
