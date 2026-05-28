import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './config';

type Sqlite = Database.Database;

export interface HeatRankItem {
  id: number;
  rank: number;
  title: string;
  subtitle: string;
  value: number;
  value_label: string;
  heat_percent: number;
  date: string;
}

export interface TopicRankItem extends HeatRankItem {
  groups_count: number;
  source_groups: string[];
  is_merged: boolean;
}

export interface LinkRankItem extends HeatRankItem {
  url: string;
  first_group: string;
  first_time: string;
}

export interface DigestEventItem extends HeatRankItem {
  summary: string;
  source_group: string;
  category: string;
  links: string[];
}

export interface TopicThreadItem {
  id: number;
  title: string;
  description: string;
  days: number;
  groups: string[];
  keywords: string[];
  timeline: string[];
}

export interface InsightsPayload {
  available: boolean;
  assistant_db_path: string;
  generated_at: string;
  latest_date: string | null;
  totals: {
    hot_topics: number;
    hot_links: number;
    digest_rows: number;
    nonempty_digest_rows: number;
    parsed_digest_rows: number;
    digest_events: number;
    knowledge_items: number;
    tech_highlights: number;
  };
  rankings: {
    topics: {
      max_value: number;
      total_count: number;
      visible_count: number;
      items: TopicRankItem[];
    };
    links: {
      max_value: number;
      total_count: number;
      visible_count: number;
      items: LinkRankItem[];
    };
    events: {
      max_value: number;
      visible_count: number;
      items: DigestEventItem[];
    };
  };
  topic_threads: {
    available: boolean;
    source_path: string;
    total: number;
    items: TopicThreadItem[];
  };
}

type DigestEventDraft = {
  id: number;
  date: string;
  title: string;
  summary: string;
  source_group: string;
  category: string;
  links: string[];
  value: number;
};

const EVENT_LIMIT = 18;

// Only strip explicit time-window suffixes; do not do fuzzy semantic merges.
const TOPIC_TIME_SUFFIX_RE = /(?:[（(]\s*(?:本周|今日|今天|昨日|昨天|本日|近期|最近|本月|本季度)\s*[)）]|[\s·:：\-—_]*(?:本周|今日|今天|昨日|昨天|本日|近期|最近|本月|本季度))$/u;

// Keep this list conservative: these are WeChat system/payment/media placeholders,
// not human-shared articles or tools.
const SYSTEM_LINK_TITLE_DENYLIST = [
  '微信转账',
  '转账',
  '收款付款',
  '收款',
  '付款',
  '红包',
  '微信红包',
  '微信支付',
  '位置共享',
  '系统消息',
  '聊天记录',
  '群聊邀请',
  '名片',
  '语音通话',
  '视频通话',
  '文件传输',
];

const SYSTEM_LINK_URL_DENYLIST = [
  'support.weixin.qq.com/cgi-bin/mmsupport-bin/readtemplate',
  'support.weixin.qq.com/',
  'wxapp.tenpay.com/mmpayhb',
  'wx.gtimg.com/hongbao',
  'wx.qlogo.cn/mmhead',
  'wwfile.work.weixin.qq.com/cgi-bin/download',
  'mp.weixin.qq.com/mp/waerrpage',
];

const NON_ARTICLE_LINK_URL_DENYLIST_RE = [
  /(?:^|\/\/)(?:x|twitter)\.com\/i\/status(?:$|[/?#])/i,
  /(?:^|\/\/)(?:x|twitter)\.com\/[^/]+\/status(?:$|[/?#])/i,
];

export function loadInsights(): InsightsPayload {
  const assistantDir = readConfig().wechatAssistantDir;
  const assistantDbPath = join(assistantDir, 'assistant.db');
  const topicThreads = loadTopicThreads(join(assistantDir, 'topic_threads.json'));
  return withDb(
    assistantDbPath,
    (d) => {
      const topics = getTopicRankings(d);
      const links = getLinkRankings(d);
      const digestData = getDigestEvents(d);

      return {
        available: true,
        assistant_db_path: assistantDbPath,
        generated_at: new Date().toISOString(),
        latest_date: [latestDate(d, 'trending_topics', 'scan_date'), latestDate(d, 'trending_urls', 'scan_date'), latestDate(d, 'digests', 'date')]
          .filter((date): date is string => Boolean(date))
          .sort()
          .at(-1) ?? null,
        totals: {
          hot_topics: topics.total_count,
          hot_links: links.total_count,
          digest_rows: tableCount(d, 'digests'),
          nonempty_digest_rows: digestData.nonempty_rows,
          parsed_digest_rows: digestData.parsed_rows,
          digest_events: digestData.total_events,
          knowledge_items: tableCount(d, 'knowledge_items'),
          tech_highlights: tableCount(d, 'tech_highlights'),
        },
        rankings: {
          topics,
          links,
          events: digestData.ranking,
        },
        topic_threads: topicThreads,
      };
    },
    { ...emptyPayload(assistantDbPath), topic_threads: topicThreads },
  );
}

function emptyPayload(assistantDbPath: string): InsightsPayload {
  return {
    available: false,
    assistant_db_path: assistantDbPath,
    generated_at: new Date().toISOString(),
    latest_date: null,
    totals: {
      hot_topics: 0,
      hot_links: 0,
      digest_rows: 0,
      nonempty_digest_rows: 0,
      parsed_digest_rows: 0,
      digest_events: 0,
      knowledge_items: 0,
      tech_highlights: 0,
    },
    rankings: {
      topics: { max_value: 0, total_count: 0, visible_count: 10, items: [] },
      links: { max_value: 0, total_count: 0, visible_count: 8, items: [] },
      events: { max_value: 0, visible_count: 10, items: [] },
    },
    topic_threads: {
      available: false,
      source_path: '',
      total: 0,
      items: [],
    },
  };
}

function loadTopicThreads(sourcePath: string): InsightsPayload['topic_threads'] {
  if (!existsSync(sourcePath)) {
    return { available: false, source_path: sourcePath, total: 0, items: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, 'utf-8'));
    const rows = Array.isArray(parsed) ? parsed : [];
    const items = rows
      .map((row, index) => normalizeTopicThread(row, index))
      .filter((item): item is TopicThreadItem => Boolean(item));
    return {
      available: true,
      source_path: sourcePath,
      total: items.length,
      items,
    };
  } catch {
    return { available: false, source_path: sourcePath, total: 0, items: [] };
  }
}

function normalizeTopicThread(value: unknown, index: number): TopicThreadItem | null {
  const row = objectOf(value);
  if (!row) return null;
  const title = oneLine(str(row.title), 64);
  const timeline = parseJsonArray(row.timeline).map((item) => oneLine(item, 120)).filter(Boolean);
  if (!title || timeline.length === 0) return null;
  return {
    id: index + 1,
    title,
    description: oneLine(str(row.description), 120),
    days: Math.max(1, Number(row.days ?? 1) || timeline.length),
    groups: parseJsonArray(row.groups).slice(0, 8),
    keywords: parseJsonArray(row.keywords).slice(0, 8),
    timeline,
  };
}

function getTopicRankings(d: Sqlite): InsightsPayload['rankings']['topics'] {
  if (!tableExists(d, 'trending_topics')) return { max_value: 0, total_count: 0, visible_count: 10, items: [] };
  const rows = d
    .prepare(
      `SELECT id, scan_date, keyword, groups_count, total_mentions, source_groups, is_merged
       FROM trending_topics
       WHERE TRIM(keyword) <> '' AND total_mentions > 0
       ORDER BY total_mentions DESC, groups_count DESC, scan_date DESC, id DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  const aggregates = new Map<string, {
    id: number;
    title: string;
    value: number;
    latest_date: string;
    representative_value: number;
    source_groups: Set<string>;
    groups_count_fallback: number;
    is_merged: boolean;
    occurrence_count: number;
  }>();

  for (const row of rows) {
    const rawTitle = str(row.keyword);
    const key = normalizeTopicTitle(rawTitle);
    if (!key) continue;
    const value = Number(row.total_mentions ?? 0);
    const date = str(row.scan_date);
    const groups = parseGroupList(row.source_groups);
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, {
        id: Number(row.id),
        title: stripTopicTimeSuffix(rawTitle) || rawTitle.trim(),
        value,
        latest_date: date,
        representative_value: value,
        source_groups: new Set(groups),
        groups_count_fallback: Number(row.groups_count ?? 0),
        is_merged: Number(row.is_merged ?? 0) === 1,
        occurrence_count: 1,
      });
      continue;
    }

    // Same normalized title across scan dates is treated as one topic; mentions are summed.
    existing.value += value;
    existing.latest_date = date > existing.latest_date ? date : existing.latest_date;
    existing.groups_count_fallback = Math.max(existing.groups_count_fallback, Number(row.groups_count ?? 0));
    existing.is_merged = existing.is_merged || Number(row.is_merged ?? 0) === 1;
    existing.occurrence_count += 1;
    for (const group of groups) existing.source_groups.add(group);
    if (value > existing.representative_value || (value === existing.representative_value && date >= existing.latest_date)) {
      existing.id = Number(row.id);
      existing.title = stripTopicTimeSuffix(rawTitle) || rawTitle.trim();
      existing.representative_value = value;
    }
  }

  const ranked = Array.from(aggregates.values())
    .sort((a, b) => b.value - a.value || groupCount(b) - groupCount(a) || b.latest_date.localeCompare(a.latest_date) || b.id - a.id);
  const maxValue = ranked.reduce((max, item) => Math.max(max, item.value), 0);
  return {
    max_value: maxValue,
    total_count: aggregates.size,
    visible_count: 10,
    items: ranked.map((item, index) => {
      const groupsCount = groupCount(item);
      return {
        id: item.id,
        rank: index + 1,
        title: item.title,
        subtitle: `${item.latest_date} · ${groupsCount} 个群在聊${item.occurrence_count > 1 ? ` · ${item.occurrence_count} 次上榜` : ''}`,
        value: item.value,
        value_label: `${item.value} 次提及`,
        heat_percent: heatPercent(item.value, maxValue),
        date: item.latest_date,
        groups_count: groupsCount,
        source_groups: Array.from(item.source_groups).slice(0, 8),
        is_merged: item.is_merged || item.occurrence_count > 1,
      };
    }),
  };
}

function getLinkRankings(d: Sqlite): InsightsPayload['rankings']['links'] {
  if (!tableExists(d, 'trending_urls')) return { max_value: 0, total_count: 0, visible_count: 8, items: [] };
  const rows = d
    .prepare(
      `SELECT id, scan_date, url, title, share_count, first_group, first_time
       FROM trending_urls
       WHERE share_count > 0 AND (TRIM(title) <> '' OR TRIM(url) <> '')
       ORDER BY share_count DESC, scan_date DESC, id DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  const allowedRows = rows.filter((row) => !isDeniedSystemLink(row));
  const filteredRows = allowedRows;
  const totalCount = allowedRows.length;
  const maxValue = filteredRows.reduce((max, row) => Math.max(max, Number(row.share_count ?? 0)), 0);
  return {
    max_value: maxValue,
    total_count: totalCount,
    visible_count: 8,
    items: filteredRows.map((row, index) => {
      const value = Number(row.share_count ?? 0);
      const date = str(row.scan_date);
      const firstGroup = str(row.first_group);
      return {
        id: Number(row.id),
        rank: index + 1,
        title: str(row.title).trim() || str(row.url),
        subtitle: `${date}${firstGroup ? ` · 首见 ${firstGroup}` : ''}`,
        value,
        value_label: `${value} 次转发`,
        heat_percent: heatPercent(value, maxValue),
        date,
        url: str(row.url),
        first_group: firstGroup,
        first_time: str(row.first_time),
      };
    }),
  };
}

function normalizeTopicTitle(title: string): string {
  return stripTopicTimeSuffix(title)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function stripTopicTimeSuffix(title: string): string {
  let text = title.normalize('NFKC').trim();
  let previous = '';
  while (text && text !== previous) {
    previous = text;
    text = text.replace(TOPIC_TIME_SUFFIX_RE, '').trim();
  }
  return text;
}

function groupCount(item: { source_groups: Set<string>; groups_count_fallback: number }): number {
  return item.source_groups.size || item.groups_count_fallback;
}

function isDeniedSystemLink(row: Record<string, unknown>): boolean {
  const title = str(row.title).trim().toLowerCase();
  const url = str(row.url).trim().toLowerCase();
  return SYSTEM_LINK_TITLE_DENYLIST.some((keyword) => title.includes(keyword.toLowerCase()))
    || SYSTEM_LINK_URL_DENYLIST.some((keyword) => url.includes(keyword.toLowerCase()))
    || NON_ARTICLE_LINK_URL_DENYLIST_RE.some((pattern) => pattern.test(url));
}

function getDigestEvents(d: Sqlite): {
  nonempty_rows: number;
  parsed_rows: number;
  total_events: number;
  ranking: InsightsPayload['rankings']['events'];
} {
  if (!tableExists(d, 'digests')) {
    return { nonempty_rows: 0, parsed_rows: 0, total_events: 0, ranking: { max_value: 0, visible_count: 10, items: [] } };
  }
  const nonemptyRows = (d.prepare("SELECT COUNT(*) AS n FROM digests WHERE TRIM(content) <> ''").get() as { n: number }).n;
  const rows = d
    .prepare(
      `SELECT id, date, content
       FROM digests
       WHERE TRIM(content) <> ''
       ORDER BY date DESC, id DESC
       LIMIT 80`,
    )
    .all() as Array<{ id: number; date: string; content: string }>;

  let parsedRows = 0;
  const events: DigestEventDraft[] = [];
  for (const row of rows) {
    const parsed = parseDigestJson(row.content);
    const rowEvents = parsed ? extractDigestEvents(row.id, row.date, parsed) : extractTextDigestEvents(row.id, row.date, row.content);
    if (rowEvents.length === 0) continue;
    parsedRows += 1;
    events.push(...rowEvents);
  }

  const latestEvents = events
    .filter((item) => item.title && item.summary)
    .sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value)
    .slice(0, EVENT_LIMIT);
  const maxValue = latestEvents.reduce((max, item) => Math.max(max, item.value), 0);

  return {
    nonempty_rows: nonemptyRows,
    parsed_rows: parsedRows,
    total_events: events.length,
    ranking: {
      max_value: maxValue,
      visible_count: 10,
      items: latestEvents.map((item, index) => ({
        id: item.id,
        rank: index + 1,
        title: item.title,
        subtitle: `${item.date}${item.source_group ? ` · ${item.source_group}` : ''}`,
        summary: item.summary,
        source_group: item.source_group,
        category: item.category,
        links: item.links,
        value: item.value,
        value_label: item.value > 1 ? `${item.value} 条有效消息` : '摘要收录',
        heat_percent: heatPercent(item.value, maxValue),
        date: item.date,
      })),
    },
  };
}

function parseDigestJson(content: string): unknown | null {
  const text = content.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractDigestEvents(id: number, date: string, parsed: unknown): DigestEventDraft[] {
  const root = objectOf(parsed);
  if (!root) return [];
  const groups = Array.isArray(root.groups) ? root.groups : [];
  const events: DigestEventDraft[] = [];
  for (const groupValue of groups) {
    const group = objectOf(groupValue);
    if (!group) continue;
    const groupName = str(group.name);
    const usefulMessages = numberOf(group.useful_messages) ?? 1;
    const items = Array.isArray(group.items) ? group.items : [];
    for (const itemValue of items) {
      const item = objectOf(itemValue);
      if (!item) continue;
      const title = str(item.topic).trim();
      const summary = oneLine(str(item.summary), 120);
      if (!title || !summary) continue;
      events.push({
        id: id * 1000 + events.length + 1,
        date,
        title: oneLine(title, 48),
        summary,
        source_group: str(item.source_group).trim() || groupName,
        category: str(item.category).trim(),
        links: parseJsonArray(item.links).slice(0, 3),
        value: Math.max(1, usefulMessages),
      });
    }
  }
  return events;
}

function extractTextDigestEvents(id: number, date: string, content: string): DigestEventDraft[] {
  const events: DigestEventDraft[] = [];
  const lines = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const numbered = line.match(/^\d+\.\s+\*\*(.+?)\*\*\s*[—-]\s*(.+)$/);
    const bullet = line.match(/^[-•🔹\s]*\*\*(.+?)\*\*\s*[—-]\s*(.+)$/);
    const match = numbered ?? bullet;
    if (!match) continue;
    events.push(textEvent(id, date, events.length, match[1], match[2]));
  }

  if (events.length > 0) return events;

  const sentences = content
    .split(/(?<=。)/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    const match = sentence.match(/^(.{2,42}?)\s*[—-]\s*(.{8,})$/);
    if (!match) continue;
    events.push(textEvent(id, date, events.length, match[1], match[2]));
    if (events.length >= 12) break;
  }

  return events;
}

function textEvent(id: number, date: string, index: number, title: string, summary: string): DigestEventDraft {
  return {
    id: id * 1000 + index + 1,
    date,
    title: oneLine(stripMarkdown(title), 48),
    summary: oneLine(stripMarkdown(summary), 120),
    source_group: '',
    category: '',
    links: parseJsonArray(extractLinks(summary)),
    value: 1,
  };
}

function withDb<T>(path: string, fn: (d: Sqlite) => T, fallback: T): T {
  if (!existsSync(path)) return fallback;
  let d: Sqlite | null = null;
  try {
    d = new Database(path, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');
    return fn(d);
  } catch {
    return fallback;
  } finally {
    d?.close();
  }
}

function tableCount(d: Sqlite, table: string): number {
  if (!tableExists(d, table)) return 0;
  return (d.prepare(`SELECT COUNT(*) AS n FROM ${ident(table)}`).get() as { n: number }).n;
}

function latestDate(d: Sqlite, table: string, column: string): string | null {
  if (!tableExists(d, table)) return null;
  const row = d.prepare(`SELECT MAX(${ident(column)}) AS latest FROM ${ident(table)}`).get() as { latest: string | null };
  return row.latest ?? null;
}

function tableExists(d: Sqlite, table: string): boolean {
  const row = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(str).map((item) => item.trim()).filter(Boolean);
  const text = str(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(str).map((item) => item.trim()).filter(Boolean);
    if (typeof parsed === 'string') return splitList(parsed);
  } catch {}
  return splitList(text);
}

function parseGroupList(value: unknown): string[] {
  return parseJsonArray(value);
}

function splitList(text: string): string[] {
  return text
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function heatPercent(value: number, maxValue: number): number {
  if (maxValue <= 0 || value <= 0) return 0;
  return Math.max(6, Math.round((value / maxValue) * 100));
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOf(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function oneLine(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`>#]+/g, '')
    .replace(/[📌🔗🔥📰📂🔹]/g, '')
    .trim();
}

function extractLinks(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s)\]）】>]+/g)).map((match) => match[0]);
}

function ident(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}
