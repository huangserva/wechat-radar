import { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import { mimeFor, resolveWxImage } from '@/lib/wx-image';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const localIdStr = url.searchParams.get('local_id');
  const chatroomId = url.searchParams.get('chatroom') ?? undefined;
  const hintMonth = url.searchParams.get('month') ?? undefined;

  const localId = Number(localIdStr);
  if (!localIdStr || !Number.isInteger(localId) || localId <= 0) {
    return new Response('invalid local_id', { status: 400 });
  }

  // 自动推断 month：从本地 messages 表查这条消息的日期
  let resolvedMonth = hintMonth;
  if (!resolvedMonth && chatroomId) {
    const row = db()
      .prepare('SELECT date FROM messages WHERE chatroom_id = ? AND local_id = ?')
      .get(chatroomId, localId) as { date: string } | undefined;
    if (row?.date) resolvedMonth = row.date.slice(0, 7);
  }

  const found = await resolveWxImage(localId, resolvedMonth);
  if (!found) {
    return new Response('image not found in wx cache', { status: 404 });
  }

  const buf = await readFile(found.path);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': mimeFor(found.format),
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Image-Type': found.type,
    },
  });
}
