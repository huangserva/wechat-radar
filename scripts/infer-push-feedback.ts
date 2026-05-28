import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const DATA_DIR = process.env.WECHAT_RADAR_DATA_DIR || join(homedir(), '.wechat-radar');
const ASSISTANT_DB = join(homedir(), 'wechat-assistant', 'assistant.db');
const RADAR_DB = join(DATA_DIR, 'radar.db');

type InferredAction = 'acted' | 'ignored' | 'snoozed';

interface PushRow {
  id: number;
  push_time: string;
  push_type: string;
  content_summary: string;
  priority: string | null;
}

interface TodoRow {
  id: string;
  contact: string;
  summary: string;
  status: string;
  resolved_ts: number | null;
  updated_ts: number | null;
  created_ts: number | null;
}

async function main() {
  if (!existsSync(ASSISTANT_DB)) {
    console.error('assistant.db not found:', ASSISTANT_DB);
    process.exit(1);
  }
  if (!existsSync(RADAR_DB)) {
    console.error('radar.db not found:', RADAR_DB);
    process.exit(1);
  }

  // Read push_feedback from assistant.db
  const adb = new Database(ASSISTANT_DB, { readonly: true, fileMustExist: true });
  adb.pragma('query_only = ON');
  const pushes = adb
    .prepare('SELECT id, push_time, push_type, content_summary, priority FROM push_feedback ORDER BY id')
    .all() as PushRow[];
  const todos = adb
    .prepare('SELECT id, contact, summary, status, resolved_ts, updated_ts, created_ts FROM todos')
    .all() as TodoRow[];
  adb.close();

  console.log(`Read ${pushes.length} push_feedback rows, ${todos.length} todos`);

  // Create table in radar.db
  const rdb = new Database(RADAR_DB);
  rdb.pragma('journal_mode = WAL');
  rdb.exec(`
    CREATE TABLE IF NOT EXISTS push_feedback_inferred (
      feedback_id INTEGER PRIMARY KEY,
      push_type TEXT NOT NULL,
      content_summary TEXT NOT NULL,
      push_time TEXT NOT NULL,
      priority TEXT,
      inferred_action TEXT,
      basis TEXT,
      matched_todo_id TEXT,
      computed_at INTEGER NOT NULL
    )
  `);

  // Build todo index by contact for fast matching
  const todosByContact = new Map<string, TodoRow[]>();
  for (const t of todos) {
    const key = normalizeContact(t.contact);
    const list = todosByContact.get(key) ?? [];
    list.push(t);
    todosByContact.set(key, list);
  }

  // Process each push
  const upsert = rdb.prepare(`
    INSERT INTO push_feedback_inferred (feedback_id, push_type, content_summary, push_time, priority, inferred_action, basis, matched_todo_id, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(feedback_id) DO UPDATE SET
      inferred_action = excluded.inferred_action,
      basis = excluded.basis,
      matched_todo_id = excluded.matched_todo_id,
      computed_at = excluded.computed_at
  `);

  let acted = 0, ignored = 0, snoozed = 0, skipped = 0;
  const now = Date.now();

  const tx = rdb.transaction(() => {
    for (const p of pushes) {
      if (p.push_type !== 'todo') {
        upsert.run(p.id, p.push_type, p.content_summary, p.push_time, p.priority, null, 'non-todo type', null, now);
        skipped++;
        continue;
      }

      // Parse contact and summary from content_summary
      const parsed = parseContentSummary(p.content_summary);
      if (!parsed) {
        upsert.run(p.id, p.push_type, p.content_summary, p.push_time, p.priority, null, 'unparseable', null, now);
        skipped++;
        continue;
      }

      // Find matching todo
      const matched = findMatchingTodo(parsed.contact, parsed.summary, todosByContact, p.push_time);
      if (!matched) {
        upsert.run(p.id, p.push_type, p.content_summary, p.push_time, p.priority, 'ignored', 'no matching todo found', null, now);
        ignored++;
        continue;
      }

      // Determine action based on resolution timing
      const pushTs = new Date(p.push_time).getTime() / 1000;
      const { action, basis } = inferAction(pushTs, matched);

      upsert.run(p.id, p.push_type, p.content_summary, p.push_time, p.priority, action, basis, matched.id, now);
      if (action === 'acted') acted++;
      else if (action === 'snoozed') snoozed++;
      else ignored++;
    }
  });
  tx();
  rdb.close();

  console.log(`\nDone: acted=${acted} ignored=${ignored} snoozed=${snoozed} skipped=${skipped}`);
  console.log(`Total: ${acted + ignored + snoozed + skipped} rows written to push_feedback_inferred`);
}

function parseContentSummary(s: string): { contact: string; summary: string } | null {
  // Patterns: "contact - summary" or "contact-summary" or "contact -summary"
  const sep = s.indexOf(' - ');
  if (sep > 0) {
    return { contact: s.slice(0, sep).trim(), summary: s.slice(sep + 3).trim() };
  }
  // Try "-" separator (but not at start)
  const dash = s.indexOf('-');
  if (dash > 0) {
    const contact = s.slice(0, dash).trim();
    const summary = s.slice(dash + 1).trim();
    if (contact && summary) return { contact, summary };
  }
  return null;
}

function normalizeContact(s: string): string {
  return s.trim().toLowerCase().replace(/[\s\-_@.]/g, '');
}

function findMatchingTodo(
  contact: string,
  summary: string,
  todosByContact: Map<string, TodoRow[]>,
  pushTime: string,
): TodoRow | null {
  const key = normalizeContact(contact);
  const candidates = todosByContact.get(key);
  if (!candidates || candidates.length === 0) return null;

  // Try exact summary match first
  const summaryLower = summary.toLowerCase();
  for (const t of candidates) {
    if (t.summary.toLowerCase().includes(summaryLower) || summaryLower.includes(t.summary.toLowerCase())) {
      return t;
    }
  }

  // Fallback: if only one todo for this contact, use it
  if (candidates.length === 1) return candidates[0];

  // Try partial match
  for (const t of candidates) {
    const tLower = t.summary.toLowerCase();
    // Check if any 4+ char substring matches
    const words = summaryLower.split(/[\s,，。、]+/).filter((w) => w.length >= 3);
    const matchCount = words.filter((w) => tLower.includes(w)).length;
    if (matchCount >= 2 || (words.length > 0 && matchCount / words.length > 0.5)) {
      return t;
    }
  }

  return null;
}

function inferAction(pushTs: number, todo: TodoRow): { action: InferredAction; basis: string } {
  // pushTs is in seconds
  if (!todo.resolved_ts) {
    // Not resolved yet
    const hoursSince = (Date.now() / 1000 - pushTs) / 3600;
    if (hoursSince > 24) {
      return { action: 'ignored', basis: `unresolved after ${Math.round(hoursSince)}h` };
    }
    return { action: 'ignored', basis: 'unresolved' };
  }

  const diffHours = (todo.resolved_ts - pushTs) / 3600;

  if (diffHours <= 0) {
    // Resolved before push (already done)
    return { action: 'acted', basis: `resolved ${Math.round(diffHours * 60)}min before push` };
  }
  if (diffHours <= 2) {
    return { action: 'acted', basis: `resolved ${Math.round(diffHours * 60)}min after push` };
  }
  if (diffHours <= 24) {
    return { action: 'snoozed', basis: `resolved ${Math.round(diffHours)}h after push` };
  }
  return { action: 'ignored', basis: `resolved ${Math.round(diffHours)}h after push (>24h)` };
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
