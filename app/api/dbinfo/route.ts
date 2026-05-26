import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DATA_DIR } from '@/lib/config';
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const dataDir = DATA_DIR;
  const dbPath = join(dataDir, 'radar.db');
  const dbSize = existsSync(dbPath) ? statSync(dbPath).size : 0;
  const counts = {
    groups: (db().prepare('SELECT COUNT(*) AS n FROM groups').get() as { n: number }).n,
    messages: (db().prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n,
    daily_stats: (db().prepare('SELECT COUNT(*) AS n FROM daily_stats').get() as { n: number }).n,
    sync_state: (db().prepare('SELECT COUNT(*) AS n FROM sync_state').get() as { n: number }).n,
  };
  const topGroups = db().prepare(`
    SELECT chatroom_id, COUNT(*) AS n FROM messages GROUP BY chatroom_id ORDER BY n DESC LIMIT 5
  `).all();
  return NextResponse.json({ dataDir, dbPath, dbSize, counts, topGroups });
}
