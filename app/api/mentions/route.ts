import { NextRequest, NextResponse } from 'next/server';
import { countMentions, listMentions, markMentionsSeen } from '@/lib/mentions';
import { wxSessions } from '@/lib/wx';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 1000), 1), 5000);

  const sessions = await wxSessions(500);
  const nameByChatroom = new Map<string, string>();
  for (const s of sessions) nameByChatroom.set(s.username, s.chat);

  const items = listMentions(limit).map((m) => ({
    ...m,
    chat_name: nameByChatroom.get(m.chatroom_id) ?? m.chatroom_id,
  }));

  return NextResponse.json({ ok: true, total: countMentions(), items });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { chatroom_id?: string };
  markMentionsSeen(body.chatroom_id);
  return NextResponse.json({ ok: true });
}
