import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wxSearchMessagesWithMeta, wxSessions } from '@/lib/wx';
import type { WxSource, WxEmptyReason } from '@/lib/wx-types';

export const dynamic = 'force-dynamic';

type SearchResult = {
  id: string;
  type: 'group' | 'topic' | 'person' | 'message' | 'link';
  title: string;
  subtitle: string;
  href: string;
  external?: boolean;
};

type MessageRow = {
  chatroom_id: string;
  sender: string;
  content: string;
  date: string;
  time: string;
};

type TopicRow = {
  id: number;
  date: string;
  title: string;
  summary: string | null;
  message_count: number;
  group_count: number;
};

type LinkRow = {
  canonical_url: string;
  title: string | null;
  domain: string;
  date: string;
};

type PersonRow = {
  sender: string;
  hits: number;
  groups: number;
  latest: string;
};

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });

  const like = `%${q}%`;
  const nameMap = await loadGroupNames();
  const results: SearchResult[] = [];

  for (const [chatroomId, name] of nameMap) {
    if (!name.toLowerCase().includes(q.toLowerCase())) continue;
    results.push({
      id: `group:${chatroomId}`,
      type: 'group',
      title: name,
      subtitle: chatroomId,
      href: `/groups/${encodeURIComponent(chatroomId)}`,
    });
    if (results.length >= 8) break;
  }

  const topics = db()
    .prepare(
      `SELECT id, date, title, summary, message_count, group_count
       FROM topics
       WHERE title LIKE ? OR COALESCE(summary, '') LIKE ?
       ORDER BY date DESC, message_count DESC
       LIMIT 8`,
    )
    .all(like, like) as TopicRow[];
  for (const t of topics) {
    results.push({
      id: `topic:${t.id}`,
      type: 'topic',
      title: t.title,
      subtitle: `${t.date} · ${t.message_count} 条 · ${t.group_count} 群${t.summary ? ` · ${t.summary}` : ''}`,
      href: `/topics?date=${t.date}`,
    });
  }

  const people = db()
    .prepare(
      `SELECT sender, COUNT(*) AS hits, COUNT(DISTINCT chatroom_id) AS groups, MAX(date) AS latest
       FROM messages
       WHERE sender LIKE ?
       GROUP BY sender
       ORDER BY hits DESC
       LIMIT 8`,
    )
    .all(like) as PersonRow[];
  for (const p of people) {
    results.push({
      id: `person:${p.sender}`,
      type: 'person',
      title: p.sender,
      subtitle: `${p.hits} 条消息 · ${p.groups} 个群 · 最近 ${p.latest}`,
      href: `/signals?q=${encodeURIComponent(p.sender)}`,
    });
  }

  const messages = db()
    .prepare(
      `SELECT chatroom_id, sender, content, date, time
       FROM messages
       WHERE content LIKE ? OR sender LIKE ?
       ORDER BY timestamp DESC
       LIMIT 10`,
    )
    .all(like, like) as MessageRow[];
  for (const m of messages) {
    results.push({
      id: `message:${m.chatroom_id}:${m.time}:${m.sender}`,
      type: 'message',
      title: compact(m.content || m.sender, 80),
      subtitle: `${nameMap.get(m.chatroom_id) ?? m.chatroom_id} · ${m.sender} · ${m.time}`,
      href: `/groups/${encodeURIComponent(m.chatroom_id)}?date=${m.date}`,
    });
  }

  let messageSource: WxSource = messages.length > 0 ? 'local' : 'none';
  let messageEmptyReason: WxEmptyReason = messages.length > 0 ? null : 'no_match';
  if (messages.length < 10) {
    const seen = new Set(results.map((r) => r.id));
    const live = await wxSearchMessagesWithMeta(q, 10 - messages.length).catch(
      () => ({ data: [], source: 'none' as WxSource, empty_reason: 'no_match' as WxEmptyReason }),
    );
    const liveMessages = live.data;
    // Only override source when the local radar.db produced nothing itself.
    if (messages.length === 0) {
      messageSource = live.source;
      messageEmptyReason = live.empty_reason;
    }
    for (const m of liveMessages) {
      const id = `message:${m.username}:${m.time}:${m.sender}`;
      if (seen.has(id)) continue;
      results.push({
        id,
        type: 'message',
        title: compact(m.content || m.sender, 80),
        subtitle: `${m.chat ?? nameMap.get(m.username) ?? m.username} · ${m.sender} · ${m.time}`,
        href: `/groups/${encodeURIComponent(m.username)}?date=${m.date}`,
      });
      seen.add(id);
    }
  }

  const links = db()
    .prepare(
      `SELECT canonical_url, title, domain, MAX(date) AS date
       FROM message_links
       WHERE canonical_url LIKE ? OR COALESCE(title, '') LIKE ? OR domain LIKE ?
       GROUP BY canonical_url
       ORDER BY MAX(timestamp) DESC
       LIMIT 8`,
    )
    .all(like, like, like) as LinkRow[];
  for (const l of links) {
    results.push({
      id: `link:${l.canonical_url}`,
      type: 'link',
      title: l.title || l.canonical_url,
      subtitle: `${l.domain} · ${l.date}`,
      href: l.canonical_url,
      external: true,
    });
  }

  return NextResponse.json({
    ok: true,
    results: results.slice(0, 32),
    message_source: messageSource,
    message_empty_reason: messageEmptyReason,
  });
}

async function loadGroupNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const sessions = await wxSessions(500);
    for (const s of sessions) {
      if (s.is_group) names.set(s.username, s.chat);
    }
  } catch {}

  const local = db()
    .prepare(
      `SELECT chatroom_id, COUNT(*) AS n
       FROM messages
       GROUP BY chatroom_id
       ORDER BY n DESC
       LIMIT 500`,
    )
    .all() as Array<{ chatroom_id: string }>;
  for (const row of local) {
    if (!names.has(row.chatroom_id)) names.set(row.chatroom_id, row.chatroom_id);
  }
  return names;
}

function compact(s: string, max: number): string {
  const text = s.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
