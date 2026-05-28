import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config';

type Sqlite = Database.Database;
export type TopicTrendLabel = '升温' | '冷却' | '稳定';

export interface TopicTrendItem {
  trend_key: string;
  title: string;
  recent_week: string;
  prev_week: string;
  recent_count: number;
  prev_count: number;
  delta_pct: number;
  trend_score: number;
  label: TopicTrendLabel;
  sparkline: number[];
  week_count: number;
  topic_count: number;
  total_messages: number;
  total_groups: number;
}

export interface TopicTrendsPayload {
  available: boolean;
  window_weeks: string[];
  summary: {
    total_trends: number;
    warming: number;
    cooling: number;
    stable: number;
  };
  items: TopicTrendItem[];
}

type TopicRow = {
  date: string;
  title: string;
  message_count: number;
  group_count: number;
};

type TrendDraft = {
  key: string;
  title: string;
  weeks: Map<string, { messages: number; groups: number }>;
  topic_count: number;
  total_messages: number;
  total_groups: number;
};

const RADAR_DB_PATH = join(DATA_DIR, 'radar.db');
const WINDOW_WEEKS = 8;

const KEYWORD_RULES: Array<{ key: string; title: string; pattern: RegExp }> = [
  { key: 'codex', title: 'Codex', pattern: /codex/i },
  { key: 'claude-code', title: 'Claude Code', pattern: /claude\s*code/i },
  { key: 'claude', title: 'Claude', pattern: /claude/i },
  { key: 'deepseek', title: 'DeepSeek', pattern: /deepseek/i },
  { key: 'cursor', title: 'Cursor', pattern: /cursor/i },
  { key: 'chatgpt-gpt', title: 'GPT / ChatGPT', pattern: /chatgpt|gpt[\s-]?\d*|gpt/i },
  { key: 'openai', title: 'OpenAI', pattern: /openai/i },
  { key: 'kimi', title: 'Kimi', pattern: /kimi|月之暗面/i },
  { key: 'gemini', title: 'Gemini', pattern: /gemini/i },
  { key: 'manus', title: 'Manus', pattern: /manus/i },
  { key: 'mcp', title: 'MCP', pattern: /\bmcp\b|模型上下文协议/i },
  { key: 'memos-memory', title: 'MemOS / 记忆系统', pattern: /memos|memory|记忆/i },
  { key: 'agent', title: 'AI Agent', pattern: /agent|智能体/i },
  { key: 'ai-coding', title: 'AI 编程', pattern: /编程|代码|开发工具|代码编辑器|codepilot|copilot/i },
  { key: 'ai-model', title: 'AI 模型', pattern: /模型|大模型|llm|推理|token/i },
  { key: 'ai-video-image', title: 'AI 视频/图像', pattern: /视频|图像|图片|aigc|midjourney|imagen|seedance/i },
  { key: 'business-campaign', title: '商单 / 推广', pattern: /商单|推广|接单|报价|合作/i },
  { key: 'x-twitter', title: 'X / Twitter', pattern: /\bx\b|twitter|推特/i },
  { key: 'wechat', title: '微信生态', pattern: /微信|公众号|群聊/i },
  { key: 'xiaomi', title: '小米', pattern: /小米|mimo/i },
  { key: 'douyin-ecommerce', title: '抖音电商', pattern: /抖音|电商/i },
];

const TOKEN_STOPWORDS = new Set([
  'ai',
  'api',
  'app',
  'pro',
  'plus',
  'vip',
  'ios',
  'mac',
  'web',
  'tool',
  'tools',
]);

export function loadTopicTrends(limit = 12): TopicTrendsPayload {
  if (!existsSync(RADAR_DB_PATH)) return emptyPayload();
  let d: Sqlite | null = null;
  try {
    d = new Database(RADAR_DB_PATH);
    migrate(d);
    const rows = readTopicRows(d);
    const latestWeek = latestTopicWeek(rows);
    if (!latestWeek) return emptyPayload();
    const weeks = recentWeeks(latestWeek, WINDOW_WEEKS);
    const trendItems = computeTrendItems(rows, weeks);
    writeTrendRows(d, trendItems);
    const items = readTrendRows(d, limit);
    return {
      available: true,
      window_weeks: weeks,
      summary: {
        total_trends: trendItems.length,
        warming: trendItems.filter((item) => item.label === '升温').length,
        cooling: trendItems.filter((item) => item.label === '冷却').length,
        stable: trendItems.filter((item) => item.label === '稳定').length,
      },
      items,
    };
  } catch {
    return emptyPayload();
  } finally {
    d?.close();
  }
}

function migrate(d: Sqlite) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS topic_trends (
      trend_key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      recent_week TEXT NOT NULL,
      prev_week TEXT NOT NULL,
      recent_count INTEGER NOT NULL,
      prev_count INTEGER NOT NULL,
      delta_pct REAL NOT NULL,
      trend_score REAL NOT NULL,
      label TEXT NOT NULL,
      sparkline TEXT NOT NULL,
      week_count INTEGER NOT NULL,
      topic_count INTEGER NOT NULL,
      total_messages INTEGER NOT NULL,
      total_groups INTEGER NOT NULL,
      refreshed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_topic_trends_label_score ON topic_trends(label, trend_score DESC);
  `);
}

function readTopicRows(d: Sqlite): TopicRow[] {
  const rows = d
    .prepare(
      `SELECT date, title, message_count, group_count
       FROM topics
       WHERE TRIM(title) <> '' AND message_count > 0
       ORDER BY date ASC, message_count DESC`,
    )
    .all() as TopicRow[];
  return rows;
}

function computeTrendItems(rows: TopicRow[], weeks: string[]): TopicTrendItem[] {
  const groups = new Map<string, TrendDraft>();
  for (const row of rows) {
    const inferred = inferTrendKey(row.title);
    if (!inferred) continue;
    const week = weekStart(row.date);
    let draft = groups.get(inferred.key);
    if (!draft) {
      draft = {
        key: inferred.key,
        title: inferred.title,
        weeks: new Map(),
        topic_count: 0,
        total_messages: 0,
        total_groups: 0,
      };
      groups.set(inferred.key, draft);
    }
    const point = draft.weeks.get(week) ?? { messages: 0, groups: 0 };
    point.messages += Number(row.message_count ?? 0);
    point.groups = Math.max(point.groups, Number(row.group_count ?? 0));
    draft.weeks.set(week, point);
    draft.topic_count += 1;
    draft.total_messages += Number(row.message_count ?? 0);
    draft.total_groups = Math.max(draft.total_groups, Number(row.group_count ?? 0));
  }

  const prevWeek = weeks.at(-2) ?? weeks[0] ?? '';
  const recentWeek = weeks.at(-1) ?? prevWeek;
  return Array.from(groups.values())
    .map((draft) => {
      const sparkline = weeks.map((week) => draft.weeks.get(week)?.messages ?? 0);
      const recent = sparkline.at(-1) ?? 0;
      const prev = sparkline.at(-2) ?? 0;
      const deltaPct = prev <= 0 ? (recent > 0 ? 100 : 0) : Math.round(((recent - prev) / prev) * 100);
      const deltaAbs = Math.abs(recent - prev);
      const label = classifyTrend(recent, prev);
      return {
        trend_key: draft.key,
        title: draft.title,
        recent_week: recentWeek,
        prev_week: prevWeek,
        recent_count: recent,
        prev_count: prev,
        delta_pct: deltaPct,
        trend_score: Math.round(deltaAbs * Math.log10(Math.max(10, draft.total_messages)) * 10) / 10,
        label,
        sparkline,
        week_count: Array.from(draft.weeks.values()).filter((point) => point.messages > 0).length,
        topic_count: draft.topic_count,
        total_messages: draft.total_messages,
        total_groups: draft.total_groups,
      };
    })
    .filter((item) => item.topic_count >= 2 && item.total_messages >= 8 && (item.recent_count >= 3 || item.prev_count >= 3))
    .sort(compareTrendItems);
}

function classifyTrend(recent: number, prev: number): TopicTrendLabel {
  const delta = Math.abs(recent - prev);
  if (recent >= 3 && recent >= prev * 1.35 && delta >= 3) return '升温';
  if (prev >= 3 && prev >= recent * 1.35 && delta >= 3) return '冷却';
  return '稳定';
}

function writeTrendRows(d: Sqlite, items: TopicTrendItem[]) {
  const now = Math.floor(Date.now() / 1000);
  const tx = d.transaction((rows: TopicTrendItem[]) => {
    d.prepare('DELETE FROM topic_trends').run();
    const stmt = d.prepare(
      `INSERT INTO topic_trends (
        trend_key, title, recent_week, prev_week, recent_count, prev_count,
        delta_pct, trend_score, label, sparkline, week_count, topic_count,
        total_messages, total_groups, refreshed_at
      ) VALUES (
        @trend_key, @title, @recent_week, @prev_week, @recent_count, @prev_count,
        @delta_pct, @trend_score, @label, @sparkline, @week_count, @topic_count,
        @total_messages, @total_groups, @refreshed_at
      )`,
    );
    for (const item of rows) stmt.run({ ...item, sparkline: JSON.stringify(item.sparkline), refreshed_at: now });
  });
  tx(items);
}

function readTrendRows(d: Sqlite, limit: number): TopicTrendItem[] {
  const rows = d
    .prepare(
      `SELECT trend_key, title, recent_week, prev_week, recent_count, prev_count,
              delta_pct, trend_score, label, sparkline, week_count, topic_count,
              total_messages, total_groups
       FROM topic_trends
       ORDER BY (label = '稳定') ASC,
                trend_score DESC,
                ABS(delta_pct) DESC,
                total_messages DESC
       LIMIT ?`,
    )
    .all(limit) as Array<Omit<TopicTrendItem, 'sparkline'> & { sparkline: string }>;
  return rows.map((row) => ({
    ...row,
    sparkline: parseSparkline(row.sparkline),
  }));
}

function inferTrendKey(title: string): { key: string; title: string } | null {
  const normalized = title.normalize('NFKC').trim();
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(normalized)) return { key: rule.key, title: rule.title };
  }
  const token = normalized.match(/[A-Za-z][A-Za-z0-9.+-]{2,}/)?.[0];
  if (token && !TOKEN_STOPWORDS.has(token.toLowerCase())) {
    return { key: `token:${token.toLowerCase()}`, title: token };
  }
  return null;
}

function latestTopicWeek(rows: TopicRow[]): string | null {
  const latest = rows.reduce((max, row) => (row.date > max ? row.date : max), '');
  return latest ? weekStart(latest) : null;
}

function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return formatDate(d);
}

function recentWeeks(latestWeek: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftDate(latestWeek, (index - count + 1) * 7));
}

function shiftDate(date: string, offsetDays: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  return formatDate(d);
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function compareTrendItems(a: TopicTrendItem, b: TopicTrendItem): number {
  return (
    Number(a.label === '稳定') - Number(b.label === '稳定') ||
    b.trend_score - a.trend_score ||
    Math.abs(b.delta_pct) - Math.abs(a.delta_pct) ||
    b.total_messages - a.total_messages ||
    a.title.localeCompare(b.title, 'zh-Hans-CN')
  );
}

function parseSparkline(value: string): number[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => Number(item) || 0) : [];
  } catch {
    return [];
  }
}

function emptyPayload(): TopicTrendsPayload {
  return {
    available: false,
    window_weeks: [],
    summary: { total_trends: 0, warming: 0, cooling: 0, stable: 0 },
    items: [],
  };
}
