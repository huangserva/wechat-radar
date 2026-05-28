import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DATA_DIR } from './config';

const RADAR_DB = join(DATA_DIR, 'radar.db');
const SELF_NAMES = new Set(['__self__', 'servasyy', '']);

interface ReplyPair {
  from_sender: string;
  to_sender: string;
  count: number;
}

export function computeReplyPairs(): ReplyPair[] {
  if (!existsSync(RADAR_DB)) return [];
  const d = new Database(RADAR_DB, { readonly: true, fileMustExist: true });
  d.pragma('query_only = ON');

  try {
    // Use window function to find consecutive messages within 5 min in same chatroom
    // LAG gets the previous message's sender and timestamp
    const rows = d.prepare(`
      WITH ordered AS (
        SELECT
          chatroom_id,
          sender,
          timestamp,
          LAG(sender) OVER (PARTITION BY chatroom_id ORDER BY timestamp) AS prev_sender,
          LAG(timestamp) OVER (PARTITION BY chatroom_id ORDER BY timestamp) AS prev_ts
        FROM messages
        WHERE sender IS NOT NULL AND sender != ''
      )
      SELECT
        prev_sender AS from_sender,
        sender AS to_sender,
        COUNT(*) AS pair_count
      FROM ordered
      WHERE prev_sender IS NOT NULL
        AND prev_sender != sender
        AND (timestamp - prev_ts) <= 300
        AND (timestamp - prev_ts) > 0
        AND prev_sender NOT IN ('__self__', 'servasyy')
        AND sender NOT IN ('__self__', 'servasyy')
      GROUP BY prev_sender, sender
      HAVING pair_count >= 5
      ORDER BY pair_count DESC
      LIMIT 100
    `).all() as Array<{ from_sender: string; to_sender: string; pair_count: number }>;

    d.close();

    // Normalize: treat A→B and B→A as the same pair (bidirectional)
    const pairMap = new Map<string, { a: string; b: string; count: number }>();
    for (const r of rows) {
      const a = r.from_sender < r.to_sender ? r.from_sender : r.to_sender;
      const b = r.from_sender < r.to_sender ? r.to_sender : r.from_sender;
      const key = `${a}|||${b}`;
      const existing = pairMap.get(key);
      if (existing) {
        existing.count += r.pair_count;
      } else {
        pairMap.set(key, { a, b, count: r.pair_count });
      }
    }

    return Array.from(pairMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 30)
      .map((p) => ({ from_sender: p.a, to_sender: p.b, count: p.count }));
  } catch (e) {
    d.close();
    console.error('computeReplyPairs error:', e);
    return [];
  }
}

export function writeReplyPairs(rows: ReplyPair[]): void {
  if (!existsSync(RADAR_DB)) return;
  const d = new Database(RADAR_DB);
  d.pragma('journal_mode = WAL');
  d.exec(`
    CREATE TABLE IF NOT EXISTS reply_pairs (
      from_sender TEXT NOT NULL,
      to_sender TEXT NOT NULL,
      count INTEGER NOT NULL,
      refreshed_at INTEGER NOT NULL,
      PRIMARY KEY (from_sender, to_sender)
    )
  `);

  const upsert = d.prepare(`
    INSERT INTO reply_pairs (from_sender, to_sender, count, refreshed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(from_sender, to_sender) DO UPDATE SET
      count = excluded.count,
      refreshed_at = excluded.refreshed_at
  `);

  const now = Date.now();
  const tx = d.transaction(() => {
    for (const r of rows) {
      upsert.run(r.from_sender, r.to_sender, r.count, now);
    }
  });
  tx();
  d.close();
}

// CLI mode
if (process.argv[1]?.includes('reply-network')) {
  console.log('Computing reply pairs (5-min window, count >= 5)...');
  const rows = computeReplyPairs();
  console.log(`Found ${rows.length} reply pairs`);
  writeReplyPairs(rows);
  console.log('Written to reply_pairs table');
  for (const r of rows.slice(0, 15)) {
    console.log(`  ${r.from_sender} ↔ ${r.to_sender}: ${r.count}`);
  }
}
