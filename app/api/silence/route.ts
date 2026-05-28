import { NextResponse } from 'next/server';
import { loadSilenceAnalysis } from '@/lib/silence-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...loadSilenceAnalysis() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/silence failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
