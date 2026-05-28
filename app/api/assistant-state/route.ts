import { NextResponse } from 'next/server';
import { loadAssistantState } from '@/lib/assistant-state-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, state: loadAssistantState() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
