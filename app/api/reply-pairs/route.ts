import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '@/lib/config';

export const dynamic = 'force-dynamic';

const RADAR_DB = join(DATA_DIR, 'radar.db');

export async function GET() {
  try {
    if (!existsSync(RADAR_DB)) {
      return NextResponse.json({ ok: true, available: false, pairs: [] });
    }
    const d = new Database(RADAR_DB, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');

    const hasTable = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reply_pairs'").get();
    if (!hasTable) {
      d.close();
      return NextResponse.json({ ok: true, available: false, pairs: [] });
    }

    const rows = d
      .prepare('SELECT from_sender, to_sender, count, refreshed_at FROM reply_pairs ORDER BY count DESC LIMIT 20')
      .all() as Array<{ from_sender: string; to_sender: string; count: number; refreshed_at: number }>;
    d.close();

    return NextResponse.json({
      ok: true,
      available: rows.length > 0,
      pairs: rows,
      refreshed_at: rows[0]?.refreshed_at ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
