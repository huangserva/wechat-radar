import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const envPath = resolve(projectRoot, '.env.local');
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

const FROM = process.argv[2] || '2025-11-28';
const TO = process.argv[3] || '2026-02-25';

function unixStart(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}

function unixEnd(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d + 1).getTime() / 1000);
}

function msgTypeName(value: number | string | null): string {
  const n = Number(value);
  if (!Number.isNaN(n)) {
    if (n === 1) return '文本';
    if (n === 3) return '图片';
    if (n === 34) return '语音';
    if (n === 43) return '视频';
    if (n === 47) return '表情';
    if (n === 49) return '链接/文件';
    if (n === 10000 || n === 10002) return '系统';
    return String(n);
  }
  return String(value ?? '');
}

function numericLocalId(value: number | string | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function dateOfTs(ts: number): string {
  return formatTime(ts).slice(0, 10);
}

async function main() {
  const { bulkInsertMessages } = await import('../lib/messages-store');
  const { rebuildMentionIndexFromMessages } = await import('../lib/mentions');
  const { aggregateDailyStats, upsertSyncState } = await import('../lib/messages-store');
  const { db } = await import('../lib/db');
  const { readConfig } = await import('../lib/config');

  const cfg = readConfig();
  const collectorPath = cfg.wechatCollectorDb;
  const start = unixStart(FROM);
  const end = unixEnd(TO);

  console.log(`[sync] Range: ${FROM} .. ${TO}`);
  console.log(`[sync] Collector: ${collectorPath}`);
  console.log(`[sync] Unix: ${start} .. ${end}`);

  const collector = new Database(collectorPath, { readonly: true });
  collector.pragma('query_only = ON');

  const totalCount = (collector.prepare(
    'SELECT COUNT(*) as n FROM messages WHERE COALESCE(msg_time,0) >= ? AND COALESCE(msg_time,0) < ?'
  ).get(start, end) as any).n;
  console.log(`[sync] Total messages in range: ${totalCount}`);

  if (totalCount === 0) {
    collector.close();
    console.log('[sync] No messages to sync.');
    return;
  }

  const chatrooms = collector.prepare(
    `SELECT chatroom_id, COUNT(*) as n FROM messages
     WHERE COALESCE(msg_time,0) >= ? AND COALESCE(msg_time,0) < ?
     GROUP BY chatroom_id ORDER BY n DESC`
  ).all(start, end) as Array<{ chatroom_id: string; n: number }>;
  console.log(`[sync] ${chatrooms.length} chatrooms`);
  console.log('');

  let totalInserted = 0;
  let totalLinks = 0;
  const allDates = new Set<string>();
  const syncStart = Date.now();

  for (let ci = 0; ci < chatrooms.length; ci++) {
    const { chatroom_id, n: expected } = chatrooms[ci];
    const rows = collector.prepare(
      `SELECT chatroom_id, sender, content, msg_time, local_id, msg_type
       FROM messages
       WHERE chatroom_id = ?
         AND COALESCE(msg_time,0) >= ?
         AND COALESCE(msg_time,0) < ?
       ORDER BY COALESCE(msg_time,0) ASC, CAST(COALESCE(local_id,'0') AS INTEGER) ASC`
    ).all(chatroom_id, start, end) as Array<{
      chatroom_id: string; sender: string | null; content: unknown;
      msg_time: number | null; local_id: number | string | null; msg_type: number | string | null;
    }>;

    const messages = rows.map(r => {
      const timestamp = Number(r.msg_time ?? 0);
      const type = msgTypeName(r.msg_type);
      const content = (r.content === null || r.content === undefined || Buffer.isBuffer(r.content))
        ? '' : String(r.content).replace(/\u0000/g, '');
      if (timestamp > 0) allDates.add(dateOfTs(timestamp));
      return {
        local_id: numericLocalId(r.local_id),
        sender: r.sender || '',
        content,
        time: formatTime(timestamp),
        timestamp,
        type,
      };
    });

    const before = totalInserted;
    const inserted = bulkInsertMessages(chatroom_id, messages);
    totalInserted += inserted;
    const pct = ((ci + 1) / chatrooms.length * 100).toFixed(0);
    console.log(`[sync] ${ci+1}/${chatrooms.length} ${chatroom_id}: ${inserted}/${expected} inserted (${pct}%)`);
  }

  const elapsed = ((Date.now() - syncStart) / 1000).toFixed(1);
  console.log('');
  console.log(`[sync] Messages: ${totalInserted} inserted in ${elapsed}s`);

  const datesArr = Array.from(allDates).sort();
  console.log(`[sync] Dates: ${datesArr.length} days (${datesArr[0]} .. ${datesArr[datesArr.length-1]})`);

  console.log('[sync] Rebuilding mentions...');
  const mentionCount = rebuildMentionIndexFromMessages();
  console.log(`[sync] Mentions: ${mentionCount}`);

  collector.close();

  const byDate: Record<string, number> = {};
  for (const d of datesArr) {
    const r = (db().prepare('SELECT COUNT(*) as n FROM messages WHERE date = ?').get(d) as any).n;
    byDate[d] = r;
  }
  console.log('');
  console.log('[sync] Per-day message counts in radar.db:');
  for (const [d, n] of Object.entries(byDate)) {
    console.log(`  ${d}: ${n}`);
  }

  console.log('');
  console.log('[sync] SYNC_DONE');
}

main().catch((e) => {
  console.error('[sync] FATAL:', e);
  process.exit(1);
});
