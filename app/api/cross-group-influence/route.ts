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
      return NextResponse.json({ ok: true, available: false, top: [] });
    }
    const d = new Database(RADAR_DB, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');

    const hasTable = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cross_group_influence'").get();
    if (!hasTable) {
      d.close();
      return NextResponse.json({ ok: true, available: false, top: [] });
    }

    const rows = d
      .prepare('SELECT sender, group_breadth, link_share_count, link_referenced_count, influence_score, refreshed_at FROM cross_group_influence ORDER BY influence_score DESC LIMIT 20')
      .all() as Array<{
      sender: string;
      group_breadth: number;
      link_share_count: number;
      link_referenced_count: number;
      influence_score: number;
      refreshed_at: number;
    }>;
    d.close();

    return NextResponse.json({
      ok: true,
      available: rows.length > 0,
      top: rows,
      refreshed_at: rows[0]?.refreshed_at ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
