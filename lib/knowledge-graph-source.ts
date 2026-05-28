import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { assistantDbPath } from './assistant-source';

type Sqlite = Database.Database;

export interface KnowledgeTagNode {
  tag: string;
  count: number;
  weight: number;
  size: number;
}

export interface KnowledgeTagPair {
  tag_a: string;
  tag_b: string;
  count: number;
  score: number;
  sample_topics: string[];
}

export interface KnowledgeTagGraph {
  available: boolean;
  total_tags: number;
  total_pairs: number;
  top_tags: KnowledgeTagNode[];
  top_pairs: KnowledgeTagPair[];
}

type TagRow = {
  item_id: number;
  tag: string;
  weight: number;
  topic: string;
};

const MAX_TAGS_PER_ITEM = 12;
const TOP_TAG_LIMIT = 36;
const TOP_PAIR_LIMIT = 24;

const TAG_STOPWORDS = new Set([
  'ai',
  'gpt',
  'app',
  'pro',
  'plus',
  'use',
  'dex',
  '群友',
  '多个',
  '提示',
  '推文',
  '链接',
  '工具',
  '讨论',
]);

export function loadKnowledgeTagGraph(): KnowledgeTagGraph {
  const dbPath = assistantDbPath();
  if (!existsSync(dbPath)) return emptyGraph();
  let d: Sqlite | null = null;
  try {
    d = new Database(dbPath, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');
    if (!tableExists(d, 'tag_index') || !tableExists(d, 'knowledge_items')) return emptyGraph();
    return buildGraph(readTagRows(d));
  } catch {
    return emptyGraph();
  } finally {
    d?.close();
  }
}

function readTagRows(d: Sqlite): TagRow[] {
  return d
    .prepare(
      `SELECT ti.item_id, ti.tag, COALESCE(ti.weight, 1.0) AS weight, ki.topic
       FROM tag_index ti
       JOIN knowledge_items ki ON ki.id = ti.item_id
       WHERE TRIM(ti.tag) <> ''
       ORDER BY ti.item_id ASC, COALESCE(ti.weight, 1.0) DESC, ti.tag ASC`,
    )
    .all() as TagRow[];
}

function buildGraph(rows: TagRow[]): KnowledgeTagGraph {
  const items = new Map<number, Array<{ tag: string; weight: number; topic: string }>>();
  const displayByKey = new Map<string, string>();
  for (const row of rows) {
    const tag = normalizeDisplayTag(row.tag);
    const key = normalizeKey(tag);
    if (!key || isNoiseTag(tag, key)) continue;
    displayByKey.set(key, displayByKey.get(key) ?? tag);
    const list = items.get(row.item_id) ?? [];
    if (!list.some((item) => normalizeKey(item.tag) === key)) {
      list.push({ tag, weight: Number(row.weight ?? 1), topic: row.topic });
    }
    items.set(row.item_id, list);
  }

  const tagStats = new Map<string, { count: number; weight: number }>();
  const pairStats = new Map<string, { a: string; b: string; count: number; score: number; sample_topics: Set<string> }>();

  for (const tags of items.values()) {
    const selected = tags
      .sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
      .slice(0, MAX_TAGS_PER_ITEM);

    for (const tag of selected) {
      const key = normalizeKey(tag.tag);
      const stat = tagStats.get(key) ?? { count: 0, weight: 0 };
      stat.count += 1;
      stat.weight += Math.max(1, tag.weight);
      tagStats.set(key, stat);
    }

    for (let i = 0; i < selected.length; i += 1) {
      for (let j = i + 1; j < selected.length; j += 1) {
        const aKey = normalizeKey(selected[i].tag);
        const bKey = normalizeKey(selected[j].tag);
        if (!aKey || !bKey || aKey === bKey) continue;
        const [a, b] = [aKey, bKey].sort();
        const key = `${a}::${b}`;
        const existing = pairStats.get(key) ?? {
          a,
          b,
          count: 0,
          score: 0,
          sample_topics: new Set<string>(),
        };
        existing.count += 1;
        existing.score += Math.max(1, selected[i].weight) + Math.max(1, selected[j].weight);
        if (selected[i].topic && existing.sample_topics.size < 3) existing.sample_topics.add(selected[i].topic);
        pairStats.set(key, existing);
      }
    }
  }

  const maxCount = Math.max(1, ...Array.from(tagStats.values()).map((stat) => stat.count));
  const topTags = Array.from(tagStats.entries())
    .map(([key, stat]) => ({
      tag: displayByKey.get(key) ?? key,
      count: stat.count,
      weight: Math.round(stat.weight * 10) / 10,
      size: Math.max(12, Math.min(28, Math.round(12 + (stat.count / maxCount) * 16))),
    }))
    .filter((tag) => tag.count >= 2)
    .sort((a, b) => b.count - a.count || b.weight - a.weight || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
    .slice(0, TOP_TAG_LIMIT);

  const topPairs = Array.from(pairStats.values())
    .filter((pair) => pair.count >= 2)
    .map((pair) => ({
      tag_a: displayByKey.get(pair.a) ?? pair.a,
      tag_b: displayByKey.get(pair.b) ?? pair.b,
      count: pair.count,
      score: Math.round(pair.score * 10) / 10,
      sample_topics: Array.from(pair.sample_topics),
    }))
    .sort((a, b) => b.count - a.count || b.score - a.score || a.tag_a.localeCompare(b.tag_a, 'zh-Hans-CN'))
    .slice(0, TOP_PAIR_LIMIT);

  return {
    available: true,
    total_tags: tagStats.size,
    total_pairs: pairStats.size,
    top_tags: topTags,
    top_pairs: topPairs,
  };
}

function normalizeDisplayTag(tag: string): string {
  return tag.normalize('NFKC').trim();
}

function normalizeKey(tag: string): string {
  return tag.normalize('NFKC').trim().toLowerCase();
}

function isNoiseTag(tag: string, key: string): boolean {
  if (TAG_STOPWORDS.has(tag) || TAG_STOPWORDS.has(key)) return true;
  if (/^\d+(?:\.\d+)?$/.test(key)) return true;
  if (tag.length <= 1) return true;
  return false;
}

function tableExists(d: Sqlite, table: string): boolean {
  return Boolean(d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function emptyGraph(): KnowledgeTagGraph {
  return {
    available: false,
    total_tags: 0,
    total_pairs: 0,
    top_tags: [],
    top_pairs: [],
  };
}
