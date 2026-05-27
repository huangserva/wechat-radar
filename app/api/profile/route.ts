import { NextResponse } from 'next/server';
import { loadOwnerProfile } from '@/lib/profile-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      ...loadOwnerProfile(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/profile failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
