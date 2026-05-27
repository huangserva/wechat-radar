import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const envPath = resolve(projectRoot, '.env.local');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch (e: any) {
  console.error('Failed to load .env.local:', e.message);
  process.exit(1);
}

const DATA_DIR = process.env.WECHAT_RADAR_DATA_DIR || join(homedir(), '.wechat-radar');
const DB_PATH = join(DATA_DIR, 'radar.db');

const _db = new Database(DB_PATH);
_db.pragma('journal_mode = WAL');
_db.pragma('foreign_keys = ON');
_db.pragma('busy_timeout = 30000');

const args = process.argv.slice(2);
const FROM = args[0];
const TO = args[1];
const MODE = args[2] || 'full';

if (!FROM || !TO) {
  console.error('Usage: pnpm exec tsx scripts/run-topics-links.ts <from> <to> [full|topics|links]');
  console.error('  e.g. pnpm exec tsx scripts/run-topics-links.ts 2026-02-26 2026-03-26');
  process.exit(1);
}

function pad2(n: number): string { return n.toString().padStart(2, '0'); }
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function generateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const parts = from.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const endParts = to.split('-').map(Number);
  const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);
  while (d <= end) {
    dates.push(localDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function main() {
  const { buildTopicsForDate } = await import('../lib/topics');
  const { getDailyLinkIntelligence, clearDailyLinkIntelligence } = await import('../lib/link-intelligence');
  const { extractMessageLinks } = await import('../lib/message-links');

  const dates = generateDates(FROM, TO);
  console.log(`[runner] ${MODE} mode: ${dates.length} days (${FROM} .. ${TO})`);
  console.log(`[runner] DB: ${DB_PATH}`);
  console.log(`[runner] LLM model: ${process.env.WECHAT_RADAR_TOPIC_MODEL || process.env.WECHAT_RADAR_LAB_MODEL || 'default'}`);
  console.log('');

  let totalTopics = 0, totalTopicMsgs = 0, totalLinks = 0, totalErrors = 0;
  const startTime = Date.now();

  for (const date of dates) {
    const dayStart = Date.now();
    const msgCount = (_db.prepare('SELECT COUNT(*) as n FROM messages WHERE date = ?').get(date) as any).n;

    if (msgCount === 0) {
      console.log(`[${date}] SKIP — 0 messages`);
      continue;
    }

    try {
      if (MODE === 'full' || MODE === 'links') {
        const linkRows = _db.prepare(
          `SELECT chatroom_id, local_id, sender, content, time, timestamp, type, date
           FROM messages
           WHERE date = ?
             AND (content LIKE '%http%' OR content LIKE '%<url>%' OR content LIKE '%imgsourceurl=%')`,
        ).all(date) as any[];

        if (linkRows.length > 0) {
          const upsert = _db.prepare(`
            INSERT INTO message_links (
              chatroom_id, local_id, date, sender, time, timestamp,
              url, canonical_url, title, description, domain, source, raw_kind, confidence, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(chatroom_id, local_id, canonical_url) DO UPDATE SET
              url = excluded.url,
              title = COALESCE(excluded.title, message_links.title),
              description = COALESCE(excluded.description, message_links.description),
              domain = excluded.domain,
              source = excluded.source,
              raw_kind = excluded.raw_kind,
              confidence = excluded.confidence
          `);

          let bLinks = 0;
          const tx = _db.transaction(() => {
            for (const row of linkRows) {
              const parsed = extractMessageLinks(row.content);
              for (const link of parsed) {
                try {
                  upsert.run(
                    row.chatroom_id, row.local_id, date, row.sender || '', row.time || '', row.timestamp || 0,
                    link.url, link.canonical_url, link.title, link.description, link.domain,
                    link.source, link.raw_kind, link.confidence, Date.now(),
                  );
                  bLinks++;
                } catch {}
              }
            }
          });
          tx();
          console.log(`[${date}] backfill: ${bLinks} links from ${linkRows.length} msgs`);
        }
      }

      if (MODE === 'full' || MODE === 'topics') {
        const tResult = await buildTopicsForDate(date, (p) => {
          if (p.type === 'error') console.log(`  [topics] ERROR: ${p.error}`);
          else if (p.type === 'llm') console.log(`  [topics] ${p.message}`);
        });
        totalTopics += tResult.topics;
        totalTopicMsgs += tResult.messages;
        console.log(`[${date}] topics: ${tResult.topics} topics, ${tResult.messages} msgs`);
      }

      if (MODE === 'full' || MODE === 'links') {
        clearDailyLinkIntelligence(date);
        const lResult = await getDailyLinkIntelligence(date, { refresh: true });
        const linkCount = lResult.articles.length + lResult.tools.length;
        totalLinks += linkCount;
        console.log(`[${date}] links: ${lResult.articles.length} articles, ${lResult.tools.length} tools`);
      }

      const dayMs = Date.now() - dayStart;
      console.log(`[${date}] OK (${(dayMs / 1000).toFixed(1)}s)`);
    } catch (e: any) {
      totalErrors++;
      console.error(`[${date}] FAILED: ${e.message?.slice(0, 200) || e}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`[runner] DONE: ${dates.length} days, ${totalTopics} topics, ${totalTopicMsgs} topic-msgs, ${totalLinks} links, ${totalErrors} errors in ${elapsed}s`);
}

main().catch((e) => {
  console.error('[runner] FATAL:', e);
  process.exit(1);
});
