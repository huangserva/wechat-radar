import { NextResponse } from 'next/server';
import { loadInsights } from '@/lib/insights-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      ...loadInsights(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/insights failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
