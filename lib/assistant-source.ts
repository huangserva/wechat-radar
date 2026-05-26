import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './config';

/**
 * Read-only access layer for hermes wechat-assistant's `assistant.db` analysis
 * products (todos / calendar / digests / knowledge / trending / tech). This is
 * P2 groundwork: no UI, no writes. Every getter degrades to [] (or null) when
 * the DB or a table is missing. Schemas were verified against the live DB on
 * 2026-05-26 (the bundled schema doc was stale — see .hive/research note).
 *
 * NOTE: profile_snapshots / preferences are intentionally NOT exposed here —
 * those belong to the lab profile layer (关羽), kept separate to avoid overlap.
 */

type Sqlite = Database.Database;

export interface AssistantTodo {
  id: string;
  contact: string;
  summary: string;
  status: string; // open / done / cancelled
  created_ts: number | null;
  created_date: string | null;
  resolved_ts: number | null;
  resolved_date: string | null;
  context: string;
  updated_ts: number | null;
}

export interface AssistantCalendarEvent {
  id: number;
  scan_date: string;
  event_date: string | null;
  content: string;
  contact: string;
  status: string; // pending / confirmed / done / cancelled
}

export interface AssistantDigest {
  id: number;
  date: string;
  created_ts: number | null;
  /** Parsed digest JSON when content is a JSON object, else null. */
  data: Record<string, unknown> | null;
  /** Raw content string (most rows are empty; some are plaintext, a few JSON). */
  text: string;
}

export interface AssistantKnowledgeItem {
  id: number;
  date: string;
  topic: string;
  summary: string;
  category: string;
  source_group: string;
  sender: string;
  links: string[];
  tags: string[];
  tag_count: number;
  created_ts: number;
}

export interface AssistantTrendingTopic {
  id: number;
  scan_date: string;
  keyword: string;
  groups_count: number;
  total_mentions: number;
  source_groups: string[];
  is_merged: boolean;
}

export interface AssistantTrendingUrl {
  id: number;
  scan_date: string;
  url: string;
  title: string;
  share_count: number;
  first_group: string;
  first_time: string;
}

export interface AssistantTechHighlight {
  id: number;
  scan_date: string;
  category: string;
  keyword: string;
  count: number;
  groups: number;
  highlights: string[];
}

export interface AssistantInventoryRow {
  table: string;
  product: string;
  panel: string;
  rows: number;
  latest_date: string | null;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function assistantDbPath(): string {
  return join(readConfig().wechatAssistantDir, 'assistant.db');
}

/**
 * True only if the DB file exists AND can be opened read-only and queried — so a
 * status light reflects actual readability, not just a file on disk.
 */
export function assistantDbAvailable(): boolean {
  return withDb((d) => {
    d.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
    return true;
  }, false);
}

// ---- 承诺追踪 ← todos ------------------------------------------------------

export function getTodos(filter: { status?: string; contact?: string; limit?: number } = {}): AssistantTodo[] {
  return query<AssistantTodo>('todos', (d) => {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.contact) {
      where.push('contact = ?');
      params.push(filter.contact);
    }
    const rows = d
      .prepare(
        `SELECT id, contact, summary, status, created_ts, created_date, resolved_ts, resolved_date, context, updated_ts
         FROM todos ${whereSql(where)}
         ORDER BY (status = 'open') DESC, COALESCE(created_ts, 0) DESC
         LIMIT ?`,
      )
      .all(...params, clampLimit(filter.limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id ?? ''),
      contact: str(r.contact),
      summary: str(r.summary),
      status: str(r.status) || 'open',
      created_ts: num(r.created_ts),
      created_date: r.created_date == null ? null : str(r.created_date),
      resolved_ts: num(r.resolved_ts),
      resolved_date: r.resolved_date == null ? null : str(r.resolved_date),
      context: str(r.context),
      updated_ts: num(r.updated_ts),
    }));
  });
}

// ---- 承诺追踪 / 日程 ← calendar_events -------------------------------------

export function getCalendarEvents(
  filter: { since?: string; status?: string; limit?: number } = {},
): AssistantCalendarEvent[] {
  return query<AssistantCalendarEvent>('calendar_events', (d) => {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.since) {
      where.push('event_date >= ?');
      params.push(filter.since);
    }
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    const rows = d
      .prepare(
        `SELECT id, scan_date, event_date, content, contact, status
         FROM calendar_events ${whereSql(where)}
         ORDER BY COALESCE(event_date, scan_date) DESC, id DESC
         LIMIT ?`,
      )
      .all(...params, clampLimit(filter.limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      scan_date: str(r.scan_date),
      event_date: r.event_date == null ? null : str(r.event_date),
      content: str(r.content),
      contact: str(r.contact),
      status: str(r.status) || 'pending',
    }));
  });
}

// ---- 知识库 ← digests (daily summary JSON) ---------------------------------

export function getDigests(filter: { date?: string; limit?: number } = {}): AssistantDigest[] {
  return query<AssistantDigest>('digests', (d) => {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.date) {
      where.push('date = ?');
      params.push(filter.date);
    }
    const rows = d
      .prepare(
        `SELECT id, date, content, created_ts FROM digests ${whereSql(where)}
         ORDER BY date DESC, id DESC LIMIT ?`,
      )
      .all(...params, clampLimit(filter.limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      date: str(r.date),
      created_ts: num(r.created_ts),
      data: parseJsonObject(r.content),
      text: str(r.content).trim(),
    }));
  });
}

// ---- 知识库 ← knowledge_items ----------------------------------------------

export function getKnowledgeItems(
  filter: { since?: string; category?: string; source_group?: string; limit?: number } = {},
): AssistantKnowledgeItem[] {
  return query<AssistantKnowledgeItem>('knowledge_items', (d) => {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.since) {
      where.push('date >= ?');
      params.push(filter.since);
    }
    if (filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }
    if (filter.source_group) {
      where.push('source_group = ?');
      params.push(filter.source_group);
    }
    const rows = d
      .prepare(
        `SELECT id, date, topic, summary, category, source_group, sender, links, tags, tag_count, created_ts
         FROM knowledge_items ${whereSql(where)}
         ORDER BY COALESCE(created_ts, 0) DESC, id DESC LIMIT ?`,
      )
      .all(...params, clampLimit(filter.limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      date: str(r.date),
      topic: str(r.topic),
      summary: str(r.summary),
      category: str(r.category),
      source_group: str(r.source_group),
      sender: str(r.sender),
      links: parseJsonArray(r.links),
      tags: parseJsonArray(r.tags),
      tag_count: Number(r.tag_count ?? 0),
      created_ts: Number(r.created_ts ?? 0),
    }));
  });
}

// ---- 信号流 / 热点 ← trending_topics ---------------------------------------

export function getTrendingTopics(filter: { scan_date?: string; limit?: number } = {}): AssistantTrendingTopic[] {
  return query<AssistantTrendingTopic>('trending_topics', (d) => {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.scan_date) {
      where.push('scan_date = ?');
      params.push(filter.scan_date);
    }
    const rows = d
      .prepare(
        `SELECT id, scan_date, keyword, groups_count, total_mentions, source_groups, is_merged
         FROM trending_topics ${whereSql(where)}
         ORDER BY scan_date DESC, total_mentions DESC, id DESC LIMIT ?`,
      )
      .all(...params, clampLimit(filter.limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      scan_date: str(r.scan_date),
      keyword: str(r.keyword),
      groups_count: Number(r.groups_count ?? 0),
      total_mentions: Number(r.total_mentions ?? 0),
      source_groups: parseGroupList(r.source_groups),
      is_merged: Number(r.is_merged ?? 0) === 1,
    }));
  });
}

// ---- 信号流 / 热点 ← trending_urls -----------------------------------------

export function getTrendingUrls(filter: { scan_date?: string; limit?: number } = {}): AssistantTrendingUrl[] {
  return query<AssistantTrendingUrl>('trending_urls', (d) => {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.scan_date) {
      where.push('scan_date = ?');
      params.push(filter.scan_date);
    }
    const rows = d
      .prepare(
        `SELECT id, scan_date, url, title, share_count, first_group, first_time
         FROM trending_urls ${whereSql(where)}
         ORDER BY scan_date DESC, share_count DESC, id DESC LIMIT ?`,
      )
      .all(...params, clampLimit(filter.limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      scan_date: str(r.scan_date),
      url: str(r.url),
      title: str(r.title),
      share_count: Number(r.share_count ?? 0),
      first_group: str(r.first_group),
      first_time: str(r.first_time),
    }));
  });
}

// ---- 复盘 / 技术讨论 ← tech_highlights -------------------------------------

export function getTechHighlights(
  filter: { scan_date?: string; category?: string; limit?: number } = {},
): AssistantTechHighlight[] {
  return query<AssistantTechHighlight>('tech_highlights', (d) => {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.scan_date) {
      where.push('scan_date = ?');
      params.push(filter.scan_date);
    }
    if (filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }
    const rows = d
      .prepare(
        `SELECT id, scan_date, category, keyword, count, groups, highlights
         FROM tech_highlights ${whereSql(where)}
         ORDER BY scan_date DESC, count DESC, id DESC LIMIT ?`,
      )
      .all(...params, clampLimit(filter.limit)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      scan_date: str(r.scan_date),
      category: str(r.category),
      keyword: str(r.keyword),
      count: Number(r.count ?? 0),
      groups: Number(r.groups ?? 0),
      highlights: parseJsonArray(r.highlights),
    }));
  });
}

// ---- inventory (row counts + latest date + panel mapping) ------------------

const INVENTORY_SPEC: Array<{ table: string; product: string; panel: string; dateCol: string }> = [
  { table: 'todos', product: '待办/承诺', panel: '承诺追踪', dateCol: 'created_date' },
  { table: 'calendar_events', product: '日程', panel: '承诺追踪/日程', dateCol: 'event_date' },
  { table: 'digests', product: '每日干货摘要', panel: '知识库/复盘', dateCol: 'date' },
  { table: 'knowledge_items', product: '知识条目', panel: '知识库', dateCol: 'date' },
  { table: 'trending_topics', product: '热点话题', panel: '信号流/热点', dateCol: 'scan_date' },
  { table: 'trending_urls', product: '热点链接', panel: '信号流/热点', dateCol: 'scan_date' },
  { table: 'tech_highlights', product: '技术讨论', panel: '复盘/技术', dateCol: 'scan_date' },
];

export function assistantDbInventory(): AssistantInventoryRow[] {
  return withDb((d) => {
    return INVENTORY_SPEC.map((spec) => {
      const base = { table: spec.table, product: spec.product, panel: spec.panel, rows: 0, latest_date: null as string | null };
      // Per-table guard: one bad table (missing/locked/missing dateCol) must not
      // null out the whole inventory.
      try {
        if (!tableExists(d, spec.table)) return base;
        base.rows = (d.prepare(`SELECT COUNT(*) AS n FROM ${ident(spec.table)}`).get() as { n: number }).n;
        if (hasColumn(d, spec.table, spec.dateCol)) {
          const latest = d
            .prepare(`SELECT MAX(${ident(spec.dateCol)}) AS latest FROM ${ident(spec.table)}`)
            .get() as { latest: string | null };
          base.latest_date = latest.latest ?? null;
        }
        return base;
      } catch {
        return base;
      }
    });
  }, [] as AssistantInventoryRow[]);
}

// ---- helpers ---------------------------------------------------------------

function query<T>(table: string, fn: (d: Sqlite) => T[]): T[] {
  return withDb((d) => (tableExists(d, table) ? fn(d) : []), [] as T[]);
}

function withDb<T>(fn: (d: Sqlite) => T, fallback: T): T {
  const path = assistantDbPath();
  if (!existsSync(path)) return fallback;
  let d: Sqlite | null = null;
  try {
    d = new Database(path, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');
    return fn(d);
  } catch (e) {
    // Prod: degrade silently. Dev/test: surface so a missing table/column, lock,
    // or open failure isn't mistaken for "no data".
    if (process.env.NODE_ENV !== 'production') {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = /unable to open|no such file/i.test(msg)
        ? 'open-failed'
        : /no such table/i.test(msg)
          ? 'missing-table'
          : /no such column/i.test(msg)
            ? 'missing-column'
            : /locked|busy/i.test(msg)
              ? 'locked'
              : 'sql-error';
      console.warn(`[assistant-source] ${kind} on ${path}: ${msg}`);
    }
    return fallback;
  } finally {
    d?.close();
  }
}

function tableExists(d: Sqlite, table: string): boolean {
  const row = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function hasColumn(d: Sqlite, table: string, column: string): boolean {
  const rows = d.prepare(`PRAGMA table_info(${ident(table)})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function whereSql(clauses: string[]): string {
  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * trending_topics.source_groups appears in two real shapes: a JSON array
 * (`["群A","群B"]`, often `[]`) and a JSON-encoded comma-separated string
 * (`"群A,群B,…"`). The plain parseJsonArray silently dropped the string form
 * (135/295 rows) — treat both, splitting strings on CN/EN commas; only truly
 * invalid JSON returns [].
 */
function parseGroupList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const raw = value.trim();
  if (raw === '') return [];
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // not JSON — fall through and treat `raw` as bare comma-separated text
  }
  if (Array.isArray(parsed)) {
    return parsed.map((v) => String(v).trim()).filter(Boolean);
  }
  const text = typeof parsed === 'string' ? parsed : raw;
  return text
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
