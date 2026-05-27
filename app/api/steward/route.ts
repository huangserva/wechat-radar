import { NextResponse } from 'next/server';
import { loadStewardStatus } from '@/lib/steward-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...loadStewardStatus() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/steward failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
