import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { setFavorite, tagGroup, untagGroup, tagsForChatroom } from '@/lib/groups';

export const dynamic = 'force-dynamic';

const TagSchema = z.object({
  chatroom_id: z.string().min(1),
  group_id: z.number().int().positive(),
  action: z.enum(['add', 'remove']),
});

const FavSchema = z.object({
  chatroom_id: z.string().min(1),
  fav: z.boolean(),
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('chatroom_id');
  if (!id) return NextResponse.json({ ok: false, error: 'chatroom_id required' }, { status: 400 });
  return NextResponse.json({ ok: true, group_ids: tagsForChatroom(id) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const tag = TagSchema.safeParse(body);
  if (tag.success) {
    if (tag.data.action === 'add') tagGroup(tag.data.chatroom_id, tag.data.group_id);
    else untagGroup(tag.data.chatroom_id, tag.data.group_id);
    return NextResponse.json({ ok: true });
  }
  const fav = FavSchema.safeParse(body);
  if (fav.success) {
    setFavorite(fav.data.chatroom_id, fav.data.fav);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 });
}
