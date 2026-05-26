import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wxSessions } from '@/lib/wx';
import { todayStr } from '@/lib/range';

export const dynamic = 'force-dynamic';

type RawLinkRow = {
  chatroom_id: string;
  local_id: number;
  sender: string;
  time: string;
  url: string;
  canonical_url: string;
  title: string | null;
  domain: string;
  source: string;
  raw_kind: string;
};

export async function GET(req: NextRequest) {
  const date = new URL(req.url).searchParams.get('date') ?? todayStr();
  const names = await groupNames();
  const rows = db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, time, url, canonical_url, title, domain, source, raw_kind
       FROM message_links
       WHERE date = ?
         AND canonical_url LIKE '%://mp.weixin.qq.com/%'
       ORDER BY timestamp DESC
       LIMIT 200`,
    )
    .all(date) as RawLinkRow[];

  return NextResponse.json({
    ok: true,
    date,
    links: rows.map((row) => ({
      ...row,
      chat_name: names.get(row.chatroom_id) ?? row.chatroom_id,
    })),
  });
}

async function groupNames() {
  const names = new Map<string, string>();
  try {
    const sessions = await wxSessions(500);
    for (const s of sessions) names.set(s.username, s.chat);
  } catch {}
  return names;
}
