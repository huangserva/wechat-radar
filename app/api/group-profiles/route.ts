import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const path = join(homedir(), 'wechat-assistant', 'group_profiles.json');
    if (!existsSync(path)) {
      return NextResponse.json({ ok: true, available: false, profiles: {} });
    }
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    return NextResponse.json({ ok: true, available: true, profiles: raw });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
