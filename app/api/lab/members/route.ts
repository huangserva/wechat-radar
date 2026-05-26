import { NextRequest, NextResponse } from 'next/server';
import { listLabMembers } from '@/lib/lab-source';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const chatroomId = (new URL(req.url).searchParams.get('chatroom_id') ?? '').trim();
  if (!chatroomId) {
    return NextResponse.json({ ok: false, error: 'chatroom_id is required' }, { status: 400 });
  }
  try {
    const members = listLabMembers(chatroomId);
    return NextResponse.json({ ok: true, members });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
