import { NextRequest, NextResponse } from 'next/server';
import { backfillMessageLinks } from '@/lib/message-links';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    since?: string;
    until?: string;
  };

  if (body.since && !DATE_RE.test(body.since)) {
    return NextResponse.json({ ok: false, error: 'invalid since' }, { status: 400 });
  }
  if (body.until && !DATE_RE.test(body.until)) {
    return NextResponse.json({ ok: false, error: 'invalid until' }, { status: 400 });
  }

  const result = backfillMessageLinks(body.since, body.until);
  return NextResponse.json({ ok: true, ...result });
}
