import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DATA_DIR } from './config';

const RADAR_DB = join(DATA_DIR, 'radar.db');

// Spam filtering constants
const AUSPICIOUS_WORDS = ['财富', '心想', '万事', '安康', '家人', '事事', '平安', '吉祥', '如意', '幸福', '发财', '兴旺', '顺利', '好运'];
const AUSPICIOUS_THRESHOLD = 3; // nicknames with ≥ 3 auspicious words are spam
const LINK_MESSAGE_RATIO_THRESHOLD = 5; // links / messages > 5 → bot-like

interface InfluenceRow {
  sender: string;
  group_breadth: number;
  link_share_count: number;
  link_referenced_count: number;
  influence_score: number;
}

function isSpamByNickname(name: string): boolean {
  const count = AUSPICIOUS_WORDS.filter((w) => name.includes(w)).length;
  return count >= AUSPICIOUS_THRESHOLD;
}

function isSpamByRatio(linkCount: number, messageCount: number): boolean {
  if (messageCount === 0) return linkCount > 0; // only links, no messages → spam
  return linkCount / messageCount > LINK_MESSAGE_RATIO_THRESHOLD;
}

export function computeCrossGroupInfluence(): InfluenceRow[] {
  if (!existsSync(RADAR_DB)) return [];
  const d = new Database(RADAR_DB, { readonly: true, fileMustExist: true });
  d.pragma('query_only = ON');

  try {
    // Group breadth: distinct chatrooms per sender (exclude self)
    const breadthRows = d
      .prepare(
        `SELECT sender, COUNT(DISTINCT chatroom_id) as breadth
         FROM messages
         WHERE sender != '__self__' AND sender != '' AND sender != 'servasyy'
         GROUP BY sender
         HAVING breadth >= 2`
      )
      .all() as Array<{ sender: string; breadth: number }>;

    // Link share count: how many links this person shared
    let linkShareMap = new Map<string, number>();
    if (tableExists(d, 'message_links')) {
      const linkRows = d
        .prepare(
          `SELECT sender, COUNT(*) as cnt
           FROM message_links
           WHERE sender != '' AND sender != '__self__'
           GROUP BY sender`
        )
        .all() as Array<{ sender: string; cnt: number }>;
      for (const r of linkRows) linkShareMap.set(r.sender, r.cnt);
    }

    // Link referenced count: skip (too expensive with self-join on 197k rows)
    // Instead, use a simpler heuristic: count distinct domains shared
    let linkRefMap = new Map<string, number>();
    if (tableExists(d, 'message_links')) {
      const refRows = d
        .prepare(
          `SELECT sender, COUNT(DISTINCT domain) as domain_count
           FROM message_links
           WHERE sender != '' AND sender != '__self__'
           GROUP BY sender`
        )
        .all() as Array<{ sender: string; domain_count: number }>;
      for (const r of refRows) linkRefMap.set(r.sender, r.domain_count);
    }

    // Message count per sender (for spam ratio filter)
    const msgCountRows = d
      .prepare(
        `SELECT sender, COUNT(*) as cnt
         FROM messages
         WHERE sender != '__self__' AND sender != '' AND sender != 'servasyy'
         GROUP BY sender`
      )
      .all() as Array<{ sender: string; cnt: number }>;
    const msgCountMap = new Map<string, number>();
    for (const r of msgCountRows) msgCountMap.set(r.sender, r.cnt);

    d.close();

    // Spam filtering: denylist (auspicious words) + ratio (link-heavy bots)
    const filtered = breadthRows.filter((r) => {
      if (isSpamByNickname(r.sender)) return false;
      const linkCount = linkShareMap.get(r.sender) ?? 0;
      const msgCount = msgCountMap.get(r.sender) ?? 0;
      if (isSpamByRatio(linkCount, msgCount)) return false;
      return true;
    });

    // Compute influence score: breadth * 2 + link_share * 1.5 + domain_diversity * 2
    const results: InfluenceRow[] = filtered.map((r) => {
      const linkShare = linkShareMap.get(r.sender) ?? 0;
      const domainDiversity = linkRefMap.get(r.sender) ?? 0;
      const score = Math.round(r.breadth * 2 + linkShare * 1.5 + domainDiversity * 2);
      return {
        sender: r.sender,
        group_breadth: r.breadth,
        link_share_count: linkShare,
        link_referenced_count: domainDiversity,
        influence_score: score,
      };
    });

    return results.sort((a, b) => b.influence_score - a.influence_score).slice(0, 50);
  } catch {
    d.close();
    return [];
  }
}

export function writeCrossGroupInfluence(rows: InfluenceRow[]): void {
  if (!existsSync(RADAR_DB)) return;
  const d = new Database(RADAR_DB);
  d.pragma('journal_mode = WAL');
  d.exec(`
    CREATE TABLE IF NOT EXISTS cross_group_influence (
      sender TEXT PRIMARY KEY,
      group_breadth INTEGER NOT NULL,
      link_share_count INTEGER NOT NULL,
      link_referenced_count INTEGER NOT NULL,
      influence_score INTEGER NOT NULL,
      refreshed_at INTEGER NOT NULL
    )
  `);

  const upsert = d.prepare(`
    INSERT INTO cross_group_influence (sender, group_breadth, link_share_count, link_referenced_count, influence_score, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(sender) DO UPDATE SET
      group_breadth = excluded.group_breadth,
      link_share_count = excluded.link_share_count,
      link_referenced_count = excluded.link_referenced_count,
      influence_score = excluded.influence_score,
      refreshed_at = excluded.refreshed_at
  `);

  const now = Date.now();
  const tx = d.transaction(() => {
    d.exec('DELETE FROM cross_group_influence');
    for (const r of rows) {
      upsert.run(r.sender, r.group_breadth, r.link_share_count, r.link_referenced_count, r.influence_score, now);
    }
  });
  tx();
  d.close();
}

function tableExists(d: Database.Database, table: string): boolean {
  return Boolean(d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

// CLI mode
if (process.argv[1]?.includes('cross-group-influence')) {
  console.log('Computing cross-group influence...');
  const rows = computeCrossGroupInfluence();
  console.log(`Found ${rows.length} influential senders`);
  writeCrossGroupInfluence(rows);
  console.log('Written to cross_group_influence table');
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.sender}: score=${r.influence_score} breadth=${r.group_breadth} links=${r.link_share_count} refs=${r.link_referenced_count}`);
  }
}
