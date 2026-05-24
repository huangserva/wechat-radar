import { NextRequest, NextResponse } from 'next/server';
import { getDailyLinkIntelligence } from '@/lib/link-intelligence';
import { todayStr } from '@/lib/range';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? todayStr();
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ ok: false, error: 'invalid date' }, { status: 400 });
  }
  const refresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';

  try {
    const result = await getDailyLinkIntelligence(date, { refresh });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
