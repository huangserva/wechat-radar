import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DATA_DIR } from '@/lib/config';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

export async function POST() {
  const dataDir = DATA_DIR;
  const dest = join(dataDir, 'radar-recovered.db');
  try {
    db().pragma('wal_checkpoint(TRUNCATE)');
    db().exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    const size = existsSync(dest) ? statSync(dest).size : 0;
    return NextResponse.json({ ok: true, dest, size });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
