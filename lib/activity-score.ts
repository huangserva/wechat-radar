import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config';

type Sqlite = Database.Database;

export interface ActivityScore {
  chatroom_id: string;
  score: number;
  breakdown: {
    frequency: number;
    speakers: number;
    topics: number;
    links: number;
  };
}

const RADAR_DB_PATH = join(DATA_DIR, 'radar.db');

/**
 * Compute activity scores for all synced groups (last 7 days).
 * Weights: frequency 35%, speakers 25%, topics 20%, links 20%.
 */
export function computeActivityScores(): Map<string, ActivityScore> {
  return withRadarDb(new Map(), (d) => {
    const since = daysAgoStr(7);

    // 1. Message frequency: total messages per group in last 7 days
    const freqRows = d
      .prepare('SELECT chatroom_id, SUM(total) as total FROM daily_stats WHERE date >= ? GROUP BY chatroom_id')
      .all(since) as Array<{ chatroom_id: string; total: number }>;
    const freqMap = new Map<string, number>();
    for (const r of freqRows) freqMap.set(r.chatroom_id, r.total);

    // 2. Speaker diversity: distinct senders per group in last 7 days
    const speakerRows = d
      .prepare('SELECT chatroom_id, COUNT(DISTINCT sender) as speakers FROM messages WHERE date >= ? AND sender != ? GROUP BY chatroom_id')
      .all(since, '__self__') as Array<{ chatroom_id: string; speakers: number }>;
    const speakerMap = new Map<string, number>();
    for (const r of speakerRows) speakerMap.set(r.chatroom_id, r.speakers);

    // 3. Topic diversity: distinct topics per group in last 7 days
    let topicMap = new Map<string, number>();
    if (tableExists(d, 'topic_messages') && tableExists(d, 'topics')) {
      const topicRows = d
        .prepare(
          `SELECT tm.chatroom_id, COUNT(DISTINCT t.id) as topics
           FROM topic_messages tm
           JOIN topics t ON t.id = tm.topic_id
           WHERE t.date >= ?
           GROUP BY tm.chatroom_id`,
        )
        .all(since) as Array<{ chatroom_id: string; topics: number }>;
      for (const r of topicRows) topicMap.set(r.chatroom_id, r.topics);
    }

    // 4. Link density: links per group in last 7 days
    let linkMap = new Map<string, number>();
    if (tableExists(d, 'message_links')) {
      const linkRows = d
        .prepare('SELECT chatroom_id, COUNT(*) as links FROM message_links WHERE date >= ? GROUP BY chatroom_id')
        .all(since) as Array<{ chatroom_id: string; links: number }>;
      for (const r of linkRows) linkMap.set(r.chatroom_id, r.links);
    }

    // Get all synced groups
    const synced = tableExists(d, 'sync_state')
      ? (d.prepare('SELECT chatroom_id FROM sync_state').all() as Array<{ chatroom_id: string }>).map((r) => r.chatroom_id)
      : Array.from(freqMap.keys());

    // Normalize and score
    const maxFreq = Math.max(1, ...freqMap.values());
    const maxSpeakers = Math.max(1, ...speakerMap.values());
    const maxTopics = Math.max(1, ...topicMap.values());
    const maxLinks = Math.max(1, ...linkMap.values());

    const result = new Map<string, ActivityScore>();
    for (const cid of synced) {
      const freq = freqMap.get(cid) ?? 0;
      const speakers = speakerMap.get(cid) ?? 0;
      const topics = topicMap.get(cid) ?? 0;
      const links = linkMap.get(cid) ?? 0;

      const breakdown = {
        frequency: Math.round((freq / maxFreq) * 100),
        speakers: Math.round((speakers / maxSpeakers) * 100),
        topics: Math.round((topics / maxTopics) * 100),
        links: Math.round((links / maxLinks) * 100),
      };

      const score = Math.round(
        breakdown.frequency * 0.35 +
        breakdown.speakers * 0.25 +
        breakdown.topics * 0.20 +
        breakdown.links * 0.20,
      );

      result.set(cid, { chatroom_id: cid, score, breakdown });
    }

    return result;
  });
}

// ---- helpers ----------------------------------------------------------------

function withRadarDb<T>(fallback: T, fn: (d: Sqlite) => T): T {
  if (!existsSync(RADAR_DB_PATH)) return fallback;
  let d: Sqlite | null = null;
  try {
    d = new Database(RADAR_DB_PATH, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');
    return fn(d);
  } catch {
    return fallback;
  } finally {
    d?.close();
  }
}

function tableExists(d: Sqlite, table: string): boolean {
  return Boolean(d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
