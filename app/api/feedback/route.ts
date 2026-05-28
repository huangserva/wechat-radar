import { NextResponse } from 'next/server';
import { loadFeedbackData } from '@/lib/feedback-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...loadFeedbackData() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/feedback failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
