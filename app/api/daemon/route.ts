import { NextResponse } from 'next/server';
import { wxDaemonStatus } from '@/lib/wx';
import { cache, CK } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  let s = cache.get(CK.daemon()) as Awaited<ReturnType<typeof wxDaemonStatus>> | undefined;
  if (!s) {
    s = await wxDaemonStatus();
    cache.set(CK.daemon(), s, 30);
  }
  return NextResponse.json({ ok: true, ...s });
}
