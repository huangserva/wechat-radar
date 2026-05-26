import { db } from './db';
import { cache } from './cache';
import { todayStr } from './range';

const MAX_ROWS = 1600;
const MAX_MUST_READ = 8;
const MAX_OPPORTUNITIES = 5;
const MAX_SIGNAL_SOURCES = 8;
const MAX_ACTION_ITEMS = 8;
const MAX_TOPIC_LIFECYCLE = 6;
const MAX_LINK_HIGHLIGHTS = 8;
const MAX_PEOPLE_RADAR = 8;
const MAX_CONTENT_IDEAS = 6;
const MAX_ANOMALIES = 6;
const CACHE_TTL_SECONDS = 90;

const URL_RE = /https?:\/\/[^\s<>"']+/i;
const URL_GLOBAL_RE = /https?:\/\/[^\s<>"']+/g;
const TOOL_RE =
  /工具|产品|项目|插件|模型|智能体|Agent|Claude|Gemini|Codex|API|CLI|MCP|开源|GitHub|Chrome|飞书|Notion|Obsidian|workflow|workspace/i;
const OPPORTUNITY_RE =
  /求推荐|求一个|谁有|谁能.*(推荐|帮|做|开发|联系)|有没有.*(工具|方案|资源|推荐)|想找|找人|招募|报名|内测|名额|一起做|采购|团购|项目合作|合作.*(项目|机会|对接|商演|商务)|需要.*(推荐|合作|对接|开发|方案)/i;
const ACTION_RE = /帮忙|看看|回复|跟进|对接|联系|报名|填写|试试|评估|整理|发我|私信/i;
const QUESTION_RE = /[?？]|怎么|如何|为啥|为什么|能不能|可不可以|有没有/i;
const NOISE_RE = /撤回了一条消息|邀请.*加入了群聊|移出了群聊|以下为新消息/i;
const DIGEST_RE = /日报|每日情报|群日报|资源分享|今日小结|知识库更新/i;

interface MessageSignalRow {
  chatroom_id: string;
  local_id: number;
  sender: string;
  content: string;
  time: string;
  timestamp: number;
}

interface TopicDefinition {
  title: string;
  keywords: string[];
  re: RegExp;
}

const TOPIC_DEFINITIONS: TopicDefinition[] = [
  { title: 'Codex / Claude Code 工作流', keywords: ['Codex', 'Claude Code', 'CLI'], re: /codex|claude code|claude.?skills|clawdbot|cli|vibe.?coding/i },
  { title: 'AI Agent 与智能体', keywords: ['Agent', '智能体', '多智能体'], re: /agent|智能体|multi.?agent|工作流|workflow/i },
  { title: 'AI 工具与产品体验', keywords: ['工具', '产品', '内测'], re: /工具|产品|插件|内测|体验|注册|api|模型/i },
  { title: 'MCP / Skills / 开源项目', keywords: ['MCP', 'Skills', 'GitHub'], re: /mcp|skills?|github|开源|repo|仓库/i },
  { title: '内容创作与 AIGC', keywords: ['AIGC', '视频', '小红书'], re: /aigc|视频|音乐|图像|小红书|公众号|内容|创作|封面/i },
  { title: 'GEO / SEO / AI 营销', keywords: ['GEO', 'SEO', '营销'], re: /geo|seo|营销|搜索|获客|品牌|公关/i },
  { title: '知识库与飞书文档', keywords: ['飞书', '知识库', '文档'], re: /飞书|知识库|文档|notion|obsidian|wiki|表格/i },
  { title: '活动 / 报名 / 社群运营', keywords: ['活动', '报名', '直播'], re: /活动|报名|直播|训练营|课程|大会|线下|分享会|名额/i },
  { title: '团购 / 采购 / 商务机会', keywords: ['团购', '采购', '合作'], re: /团购|采购|报价|预算|合作|商务|对接/i },
  { title: '投资 / 财经 / 宏观讨论', keywords: ['投资', '财经', '股票'], re: /投资|财经|股票|基金|币圈|crypto|美股|港股/i },
];

export interface DashboardSignalItem {
  chatroom_id: string;
  chat_name: string;
  local_id: number;
  sender: string;
  time: string;
  title: string;
  snippet: string;
  score: number;
  reasons: string[];
}

export interface DashboardOpportunityItem extends DashboardSignalItem {
  action: string;
}

export interface DashboardSignalSource {
  sender: string;
  signal_count: number;
  group_count: number;
  top_group: string;
  last_seen: string;
  strengths: string[];
}

export interface DashboardActionItem extends DashboardOpportunityItem {
  why: string;
  urgency: 'high' | 'medium' | 'low';
}

export interface DashboardTopicLifecycle {
  title: string;
  status: 'rising' | 'spreading' | 'hot' | 'cooling';
  today_count: number;
  previous_avg: number;
  group_count: number;
  reason: string;
  keywords: string[];
}

export interface DashboardLinkHighlight {
  kind: 'article' | 'tool';
  title: string;
  url: string;
  domain: string;
  source: string;
  score: number;
  verdict: string;
  count: number;
  group_count: number;
  last_seen: string;
}

export interface DashboardPeopleRadar {
  sender: string;
  role: '分享者' | '需求提出者' | '连接者' | '观点源';
  score: number;
  group_count: number;
  signal_count: number;
  top_group: string;
  reason: string;
}

export interface DashboardContentIdea {
  title: string;
  angle: string;
  suggested_channel: '公众号' | 'X' | '小红书' | '博客';
  evidence: string;
  source_count: number;
}

export interface DashboardAnomalySignal {
  kind: 'spike' | 'cross_group' | 'dense_links' | 'quiet_day';
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  href?: string;
}

export interface DashboardIntelligence {
  date: string;
  must_read: DashboardSignalItem[];
  opportunities: DashboardOpportunityItem[];
  signal_sources: DashboardSignalSource[];
  action_items: DashboardActionItem[];
  topic_lifecycle: DashboardTopicLifecycle[];
  link_highlights: DashboardLinkHighlight[];
  people_radar: DashboardPeopleRadar[];
  content_ideas: DashboardContentIdea[];
  anomalies: DashboardAnomalySignal[];
}

export function buildDashboardIntelligence(
  date = todayStr(),
  groupNames = new Map<string, string>(),
): DashboardIntelligence {
  date = resolveIntelligenceDate(date);
  const key = `dashboard-intelligence:${date}:v14`;
  const cached = cache.get(key) as DashboardIntelligence | undefined;
  if (cached) return cached;

  const rows = db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, content, time, timestamp
       FROM messages
       WHERE date = ?
         AND length(content) >= 8
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(date, MAX_ROWS) as MessageSignalRow[];
  const historyRows = db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, content, time, timestamp
       FROM messages
       WHERE date >= ?
         AND date <= ?
         AND length(content) >= 4
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(minusDays(date, 7), date, 9000) as MessageSignalRow[];
  const linkRows = db()
    .prepare(
      `SELECT
         ml.url,
         ml.canonical_url,
         ml.title,
         ml.domain,
         ml.source,
         ml.confidence,
         ml.time,
         ml.chatroom_id,
         m.content
       FROM message_links ml
       JOIN messages m
         ON m.chatroom_id = ml.chatroom_id
        AND m.local_id = ml.local_id
       WHERE ml.date = ?
       ORDER BY ml.timestamp DESC
       LIMIT 600`,
    )
    .all(date) as Array<{
    url: string;
    canonical_url: string;
    title: string | null;
    domain: string;
    source: string;
    confidence: number;
    time: string;
    chatroom_id: string;
    content: string;
  }>;

  const candidates: DashboardSignalItem[] = [];
  const opportunities: DashboardOpportunityItem[] = [];
  const seenOpportunities = new Set<string>();
  const sourceMap = new Map<
    string,
    {
      sender: string;
      signal_count: number;
      groups: Set<string>;
      topGroups: Map<string, number>;
      last_seen: string;
      link_count: number;
      opportunity_count: number;
      tool_count: number;
    }
  >();

  const linkBuckets = new Map<
    string,
    {
      kind: 'article' | 'tool';
      title: string;
      url: string;
      domain: string;
      count: number;
      groups: Set<string>;
      last_seen: string;
      snippets: string[];
      sources: Set<string>;
    }
  >();

  const seenSnippets = new Set<string>();
  for (const row of rows) {
    const clean = cleanContent(row.content);
    if (!clean || NOISE_RE.test(row.content)) continue;

    const score = scoreContent(clean);
    if (score < 4) continue;

    const title = titleFromContent(clean);
    const dedupeKey = normalizeDedupe(title || clean);
    if (seenSnippets.has(dedupeKey)) continue;
    seenSnippets.add(dedupeKey);

    const reasons = reasonsFor(clean);
    const item: DashboardSignalItem = {
      chatroom_id: row.chatroom_id,
      chat_name: groupNames.get(row.chatroom_id) ?? row.chatroom_id,
      local_id: row.local_id,
      sender: row.sender || '未知成员',
      time: row.time,
      title,
      snippet: clean.slice(0, 150),
      score,
      reasons,
    };
    candidates.push(item);

    if (isOpportunity(clean)) {
      const opportunityKey = opportunityDedupeKey(clean, item.title);
      if (!seenOpportunities.has(opportunityKey)) {
        seenOpportunities.add(opportunityKey);
        opportunities.push({ ...item, action: actionFor(clean) });
      }
    }

    const sourceKey = item.sender.trim() || '未知成员';
    const source = sourceMap.get(sourceKey) ?? {
      sender: sourceKey,
      signal_count: 0,
      groups: new Set<string>(),
      topGroups: new Map<string, number>(),
      last_seen: item.time,
      link_count: 0,
      opportunity_count: 0,
      tool_count: 0,
    };
    source.signal_count++;
    source.groups.add(row.chatroom_id);
    source.topGroups.set(item.chat_name, (source.topGroups.get(item.chat_name) ?? 0) + 1);
    source.last_seen = source.last_seen > item.time ? source.last_seen : item.time;
    if (URL_RE.test(clean) || clean.includes('链接')) source.link_count++;
    if (isOpportunity(clean)) source.opportunity_count++;
    if (TOOL_RE.test(clean)) source.tool_count++;
    sourceMap.set(sourceKey, source);

  }

  for (const row of linkRows) {
    const kind = isArticleUrl(row.canonical_url) ? 'article' : isToolUrl(row.canonical_url, row.content) ? 'tool' : null;
    if (!kind) continue;
    const key = normalizeUrlKey(row.canonical_url);
    const clean = cleanContent(row.content);
    const bucket = linkBuckets.get(key) ?? {
      kind,
      title: (row.title || titleFromLinkContext(row.content, row.url)).slice(0, 80),
      url: row.url,
      domain: row.domain || domainOf(row.canonical_url),
      count: 0,
      groups: new Set<string>(),
      last_seen: row.time,
      snippets: [],
      sources: new Set<string>(),
    };
    bucket.count++;
    bucket.groups.add(row.chatroom_id);
    bucket.sources.add(row.source);
    bucket.last_seen = bucket.last_seen > row.time ? bucket.last_seen : row.time;
    if (clean) bucket.snippets.push(clean.slice(0, 80));
    linkBuckets.set(key, bucket);
  }

  const mustRead = candidates
    .sort((a, b) => b.score - a.score || b.time.localeCompare(a.time))
    .slice(0, MAX_MUST_READ);
  const opportunityItems = opportunities
    .sort((a, b) => b.score - a.score || b.time.localeCompare(a.time))
    .slice(0, MAX_OPPORTUNITIES);
  const signalSources = Array.from(sourceMap.values())
    .map((s) => ({
      sender: s.sender,
      signal_count: s.signal_count,
      group_count: s.groups.size,
      top_group: topEntry(s.topGroups),
      last_seen: s.last_seen,
      strengths: strengthsFor(s),
    }))
    .filter((s) => s.signal_count >= 2)
    .sort((a, b) => b.signal_count - a.signal_count || b.group_count - a.group_count)
    .slice(0, MAX_SIGNAL_SOURCES);

  const actionItems = buildActionItems(opportunityItems, mustRead);
  const topicLifecycle = buildTopicLifecycle(date, historyRows);
  const linkHighlights = buildLinkHighlights(linkBuckets);
  const peopleRadar = buildPeopleRadar(sourceMap);
  const contentIdeas = buildContentIdeas(topicLifecycle, mustRead, linkHighlights);
  const anomalies = buildAnomalies(date, groupNames, linkBuckets, rows.length);

  const result = {
    date,
    must_read: mustRead,
    opportunities: opportunityItems,
    signal_sources: signalSources,
    action_items: actionItems,
    topic_lifecycle: topicLifecycle,
    link_highlights: linkHighlights,
    people_radar: peopleRadar,
    content_ideas: contentIdeas,
    anomalies,
  };

  cache.set(key, result, CACHE_TTL_SECONDS);
  return result;
}

function resolveIntelligenceDate(date: string): string {
  const row = db()
    .prepare('SELECT date FROM messages WHERE date <= ? GROUP BY date ORDER BY date DESC LIMIT 1')
    .get(date) as { date: string } | undefined;
  return row?.date ?? date;
}

function buildActionItems(
  opportunities: DashboardOpportunityItem[],
  mustRead: DashboardSignalItem[],
): DashboardActionItem[] {
  const fromOpportunity = opportunities.map((item) => ({
    ...item,
    why: whyForAction(item.snippet),
    urgency: urgencyFor(item.snippet, item.score),
  }));
  const fallback = mustRead
    .filter((item) => item.reasons.includes('问题') || item.reasons.includes('工具/产品'))
    .slice(0, 3)
    .map((item) => ({
      ...item,
      action: item.reasons.includes('问题') ? '可回复观点' : '可试用/收藏',
      why: item.reasons.includes('问题') ? '包含明确问题，适合补充观点或资源' : '包含工具/产品线索，适合试用或收入素材库',
      urgency: 'medium' as const,
    }));
  const seen = new Set<string>();
  return [...fromOpportunity, ...fallback]
    .filter((item) => {
      const key = normalizeDedupe(`${item.chatroom_id}:${item.title}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ACTION_ITEMS);
}

function buildTopicLifecycle(date: string, rows: MessageSignalRow[]): DashboardTopicLifecycle[] {
  const dayCounts = new Map<string, Map<string, { count: number; groups: Set<string> }>>();
  for (const row of rows) {
    const d = row.time.slice(0, 10);
    if (!d) continue;
    const clean = cleanContent(row.content);
    for (const topic of TOPIC_DEFINITIONS) {
      if (!topic.re.test(clean)) continue;
      const perDay = dayCounts.get(topic.title) ?? new Map<string, { count: number; groups: Set<string> }>();
      const bucket = perDay.get(d) ?? { count: 0, groups: new Set<string>() };
      bucket.count++;
      bucket.groups.add(row.chatroom_id);
      perDay.set(d, bucket);
      dayCounts.set(topic.title, perDay);
    }
  }

  return TOPIC_DEFINITIONS.map((topic) => {
    const perDay = dayCounts.get(topic.title) ?? new Map<string, { count: number; groups: Set<string> }>();
    const today = perDay.get(date) ?? { count: 0, groups: new Set<string>() };
    const previousValues = Array.from(perDay.entries())
      .filter(([d]) => d < date)
      .map(([, v]) => v.count);
    const previousAvg =
      previousValues.length > 0 ? previousValues.reduce((sum, n) => sum + n, 0) / previousValues.length : 0;
    const ratio = today.count / Math.max(previousAvg, 1);
    const status: DashboardTopicLifecycle['status'] =
      today.groups.size >= 5
        ? 'spreading'
        : ratio >= 1.8 && today.count >= 5
          ? 'rising'
          : today.count >= 16
            ? 'hot'
            : today.count < previousAvg * 0.45 && previousAvg >= 6
              ? 'cooling'
              : 'hot';
    return {
      title: topic.title,
      status,
      today_count: today.count,
      previous_avg: Number(previousAvg.toFixed(1)),
      group_count: today.groups.size,
      reason: topicReason(status, today.count, previousAvg, today.groups.size),
      keywords: topic.keywords,
    };
  })
    .filter((topic) => topic.today_count > 0 || topic.status === 'cooling')
    .sort((a, b) => {
      const priority = statusWeight(b.status) - statusWeight(a.status);
      return priority || b.today_count - a.today_count || b.group_count - a.group_count;
    })
    .slice(0, MAX_TOPIC_LIFECYCLE);
}

function buildLinkHighlights(
  linkBuckets: Map<
    string,
    {
      kind: 'article' | 'tool';
      title: string;
      url: string;
      domain: string;
      count: number;
      groups: Set<string>;
      last_seen: string;
      snippets: string[];
      sources: Set<string>;
    }
  >,
): DashboardLinkHighlight[] {
  return Array.from(linkBuckets.values())
    .map((item) => {
      const score = item.count * 2 + item.groups.size * 3 + (item.kind === 'tool' ? 2 : 0);
      return {
        kind: item.kind,
        title: item.title,
        url: item.url,
        domain: item.domain,
        source: preferredLinkSource(item.sources),
        score,
        verdict: verdictForLink(item.kind, item.count, item.groups.size, item.snippets.join(' ')),
        count: item.count,
        group_count: item.groups.size,
        last_seen: item.last_seen,
      };
    })
    .sort((a, b) => b.score - a.score || b.last_seen.localeCompare(a.last_seen))
    .slice(0, MAX_LINK_HIGHLIGHTS);
}

function preferredLinkSource(sources: Set<string>): string {
  if (sources.has('wechat_raw')) return 'wechat_raw';
  if (sources.has('public_search')) return 'public_search';
  if (sources.has('manual')) return 'manual';
  return Array.from(sources)[0] ?? 'plain_url';
}

function buildPeopleRadar(
  sourceMap: Map<
    string,
    {
      sender: string;
      signal_count: number;
      groups: Set<string>;
      topGroups: Map<string, number>;
      last_seen: string;
      link_count: number;
      opportunity_count: number;
      tool_count: number;
    }
  >,
): DashboardPeopleRadar[] {
  return Array.from(sourceMap.values())
    .map((s) => {
      const score = s.signal_count * 2 + s.groups.size * 3 + s.link_count + s.opportunity_count * 2 + s.tool_count;
      const role: DashboardPeopleRadar['role'] =
        s.opportunity_count >= 2 ? '需求提出者' : s.groups.size >= 3 ? '连接者' : s.link_count >= s.tool_count ? '分享者' : '观点源';
      return {
        sender: s.sender,
        role,
        score,
        group_count: s.groups.size,
        signal_count: s.signal_count,
        top_group: topEntry(s.topGroups),
        reason: personReason(role, s.signal_count, s.groups.size),
      };
    })
    .filter((p) => p.signal_count >= 2)
    .sort((a, b) => b.score - a.score || b.group_count - a.group_count)
    .slice(0, MAX_PEOPLE_RADAR);
}

function buildContentIdeas(
  topics: DashboardTopicLifecycle[],
  mustRead: DashboardSignalItem[],
  links: DashboardLinkHighlight[],
): DashboardContentIdea[] {
  const ideas: DashboardContentIdea[] = [];
  for (const topic of topics.slice(0, 4)) {
    ideas.push({
      title: `${topic.title}：今天微信群里真正升温的信号`,
      angle: topic.status === 'spreading' ? '从跨群扩散解释为什么它值得关注' : '从真实讨论里提炼一个可执行判断',
      suggested_channel: topic.title.includes('工作流') || topic.title.includes('开源') ? '博客' : '公众号',
      evidence: topic.reason,
      source_count: topic.today_count,
    });
  }
  for (const link of links.slice(0, 2)) {
    ideas.push({
      title: `${link.kind === 'tool' ? '新工具观察' : '文章拆解'}：${link.title}`,
      angle: link.verdict,
      suggested_channel: link.kind === 'tool' ? 'X' : '公众号',
      evidence: `${link.group_count} 个群提到，${link.count} 次出现`,
      source_count: link.count,
    });
  }
  if (ideas.length < MAX_CONTENT_IDEAS) {
    for (const item of mustRead.slice(0, MAX_CONTENT_IDEAS - ideas.length)) {
      ideas.push({
        title: item.title,
        angle: item.reasons.includes('问题') ? '从一个真实问题切入，给出判断和清单' : '把高信号讨论整理成一篇短观点',
        suggested_channel: item.reasons.includes('工具/产品') ? 'X' : '公众号',
        evidence: `${item.chat_name} · ${item.sender}`,
        source_count: item.score,
      });
    }
  }
  return ideas.slice(0, MAX_CONTENT_IDEAS);
}

function buildAnomalies(
  date: string,
  groupNames: Map<string, string>,
  linkBuckets: Map<string, { count: number; groups: Set<string>; title: string; kind: 'article' | 'tool'; url: string }>,
  todayRows: number,
): DashboardAnomalySignal[] {
  const anomalies: DashboardAnomalySignal[] = [];
  const rows = db()
    .prepare(
      `SELECT chatroom_id, date, total
       FROM daily_stats
       WHERE date >= ? AND date <= ? AND total > 0`,
    )
    .all(minusDays(date, 7), date) as Array<{ chatroom_id: string; date: string; total: number }>;
  const byGroup = new Map<string, Array<{ date: string; total: number }>>();
  for (const row of rows) {
    const arr = byGroup.get(row.chatroom_id) ?? [];
    arr.push({ date: row.date, total: row.total });
    byGroup.set(row.chatroom_id, arr);
  }
  for (const [chatroomId, values] of byGroup) {
    const today = values.find((v) => v.date === date)?.total ?? 0;
    const prev = values.filter((v) => v.date < date).map((v) => v.total);
    if (today < 20 || prev.length === 0) continue;
    const avg = prev.reduce((sum, n) => sum + n, 0) / prev.length;
    if (today >= Math.max(30, avg * 2.2)) {
      anomalies.push({
        kind: 'spike',
        title: `${groupNames.get(chatroomId) ?? chatroomId} 突然升温`,
        description: `今日 ${today} 条，约为近 7 日均值 ${avg.toFixed(1)} 的 ${Math.round(today / Math.max(avg, 1))} 倍`,
        severity: today >= avg * 4 ? 'high' : 'medium',
        href: `/groups/${encodeURIComponent(chatroomId)}?date=${date}`,
      });
    }
  }

  for (const link of Array.from(linkBuckets.values()).filter((l) => l.groups.size >= 3).slice(0, 3)) {
    anomalies.push({
      kind: 'cross_group',
      title: `${link.kind === 'tool' ? '工具' : '文章'}跨群扩散`,
      description: `${link.title} 被 ${link.groups.size} 个群同时提到，适合优先查看`,
      severity: link.groups.size >= 5 ? 'high' : 'medium',
      href: link.url,
    });
  }

  if (todayRows === 0) {
    anomalies.push({
      kind: 'quiet_day',
      title: '今日暂无本地消息',
      description: '可能还未同步当天消息，建议重扫或检查 wx-daemon',
      severity: 'low',
    });
  }

  return anomalies
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity))
    .slice(0, MAX_ANOMALIES);
}

function cleanContent(content: string): string {
  const xmlText = xmlSummary(content);
  return (xmlText || content)
    .replace(/https?:\/\/\S+/g, ' 链接 ')
    .replace(/\[引用\]/g, '')
    .replace(/↳/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function minusDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cleanUrl(raw: string): string {
  return raw
    .replace(/[),，。；;!?！？、\]}>]+$/g, '')
    .replace(/\.{3,}$/g, '')
    .trim();
}

function normalizeUrlKey(raw: string): string {
  try {
    const u = new URL(cleanUrl(raw));
    u.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function domainOf(raw: string): string {
  try {
    return new URL(cleanUrl(raw)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isArticleUrl(raw: string): boolean {
  try {
    const u = new URL(cleanUrl(raw));
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'mp.weixin.qq.com') return true;
    if ((host === 'x.com' || host === 'twitter.com') && /\/status\/\d{12,}/.test(u.pathname)) return true;
    if (host === 'youtube.com' || host === 'youtu.be') return true;
    return /zhihu|toutiao|sohu|163\.com|qq\.com|medium\.com|substack\.com|juejin\.cn|podcasts\.apple\.com|podscan\.fm/i.test(host);
  } catch {
    return false;
  }
}

function isToolUrl(raw: string, content: string): boolean {
  try {
    const u = new URL(cleanUrl(raw));
    const host = u.hostname.replace(/^www\./, '');
    if (/qlogo|qpic|support\.weixin|res\.wx/i.test(host)) return false;
    if (isArticleUrl(raw)) return false;
    if (/github\.com|huggingface\.co|replicate\.com|vercel\.app|netlify\.app|feishu\.cn|notion\.so|notion\.site|docs\.google\.com/i.test(host)) {
      return true;
    }
    return TOOL_RE.test(content);
  } catch {
    return false;
  }
}

function titleFromLinkContext(content: string, url: string): string {
  const xmlTitle = tagText(content, 'title');
  if (xmlTitle) return xmlTitle.slice(0, 56);
  const clean = decodeHtml(content)
    .replace(url, '')
    .replace(URL_GLOBAL_RE, '')
    .replace(/\[引用\]/g, '')
    .replace(/↳/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const first = clean.split(/[。！？!?]\s*/).find((part) => part.trim().length >= 6);
  return (first ?? domainOf(url)).slice(0, 56);
}

function whyForAction(content: string): string {
  if (/团购|采购|报价|预算/i.test(content)) return '包含采购/团购信号，可能直接转化为资源或商务机会';
  if (/报名|名额|活动|会议|直播/i.test(content)) return '包含时间敏感入口，适合尽快确认是否参与';
  if (/合作|对接|找人|招募|一起做/i.test(content)) return '包含合作或找人需求，适合主动连接';
  if (/求推荐|有没有|谁有|需要/i.test(content)) return '有人提出明确需求，适合用你的资源网络回复';
  return '具备明确上下文和行动动词，适合进入原群查看';
}

function urgencyFor(content: string, score: number): DashboardActionItem['urgency'] {
  if (/今天|今晚|明天|马上|名额|截止|限时|报名/i.test(content) || score >= 10) return 'high';
  if (/合作|采购|团购|对接|求推荐/i.test(content) || score >= 7) return 'medium';
  return 'low';
}

function topicReason(
  status: DashboardTopicLifecycle['status'],
  todayCount: number,
  previousAvg: number,
  groupCount: number,
): string {
  if (status === 'spreading') return `跨 ${groupCount} 个群出现，已经不是单群噪音`;
  if (status === 'rising') return `今日 ${todayCount} 条，高于近 7 日均值 ${previousAvg.toFixed(1)}`;
  if (status === 'cooling') return `今日热度低于近 7 日均值，可能进入退潮期`;
  return `今日 ${todayCount} 条讨论，保持高热度`;
}

function statusWeight(status: DashboardTopicLifecycle['status']): number {
  if (status === 'spreading') return 4;
  if (status === 'rising') return 3;
  if (status === 'hot') return 2;
  return 1;
}

function verdictForLink(kind: 'article' | 'tool', count: number, groupCount: number, snippets: string): string {
  if (groupCount >= 3) return '跨群重复出现，优先查看';
  if (kind === 'tool' && /实测|体验|教程|开源|github|保姆级/i.test(snippets)) return '有使用语境，值得试用';
  if (kind === 'article' && /复盘|教程|深度|报告|访谈|经验/i.test(snippets)) return '具备可整理成内容的素材';
  if (count >= 2) return '重复提到，适合收藏备查';
  return kind === 'tool' ? '新工具线索，快速扫一眼' : '文章线索，按需阅读';
}

function personReason(role: DashboardPeopleRadar['role'], signalCount: number, groupCount: number): string {
  if (role === '连接者') return `跨 ${groupCount} 个群出现，适合关注其连接的圈层`;
  if (role === '需求提出者') return `提出多条可行动需求，适合跟进`;
  if (role === '分享者') return `贡献 ${signalCount} 条链接/资料信号`;
  return `贡献 ${signalCount} 条高信号观点`;
}

function severityWeight(severity: DashboardAnomalySignal['severity']): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function xmlSummary(content: string): string {
  if (!content.includes('<msg>')) return '';
  const title = tagText(content, 'title');
  const des = tagText(content, 'des');
  const url = tagText(content, 'url') || tagText(content, 'imgsourceurl');
  return [title, des, url ? '链接' : ''].filter(Boolean).join(' ');
}

function tagText(content: string, tag: string): string {
  const text = content.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? '';
  return decodeHtml(text).replace(/\s+/g, ' ').trim();
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function scoreContent(content: string): number {
  let score = 0;
  if (URL_RE.test(content) || content.includes('链接')) score += 3;
  if (TOOL_RE.test(content)) score += 3;
  if (isOpportunity(content)) score += 4;
  if (ACTION_RE.test(content)) score += 2;
  if (QUESTION_RE.test(content)) score += 1;
  if (content.length >= 80) score += 2;
  if (content.length >= 180) score += 1;
  return score;
}

function reasonsFor(content: string): string[] {
  const reasons: string[] = [];
  if (isOpportunity(content)) reasons.push('机会/需求');
  if (TOOL_RE.test(content)) reasons.push('工具/产品');
  if (URL_RE.test(content) || content.includes('链接')) reasons.push('链接信号');
  if (ACTION_RE.test(content)) reasons.push('可跟进');
  if (content.length >= 120) reasons.push('长观点');
  if (QUESTION_RE.test(content)) reasons.push('问题');
  return reasons.slice(0, 3);
}

function actionFor(content: string): string {
  if (/团购|采购|报价|预算/i.test(content)) return '看采购/团购';
  if (/报名|名额|活动|会议|直播/i.test(content)) return '看报名/活动';
  if (/合作|对接|找人|招募|一起做/i.test(content)) return '看合作机会';
  if (/求推荐|有没有|谁有|需要/i.test(content)) return '可回复推荐';
  if (/帮忙|看看|评估|试试/i.test(content)) return '可协助跟进';
  return '查看上下文';
}

function isOpportunity(content: string): boolean {
  return OPPORTUNITY_RE.test(content.slice(0, 140)) && !DIGEST_RE.test(content);
}

function opportunityDedupeKey(content: string, title: string): string {
  if (content.includes('飞书录音豆')) return normalizeDedupe('飞书录音豆团购');
  if (content.includes('团购')) {
    const groupBuy = content.match(/([\p{L}\p{N}A-Za-z]{2,16}团购(?:表格|表)?)/u)?.[1];
    if (groupBuy) return normalizeDedupe(groupBuy);
  }
  const phrase =
    content.match(/[\p{L}\p{N}A-Za-z]{2,}.{0,18}(团购|报名|内测|合作|采购|对接|报价|预算)/u)?.[0] ??
    title;
  return normalizeDedupe(phrase);
}

function titleFromContent(content: string): string {
  const withoutPrefix = content
    .replace(/^[@#\s:：-]+/, '')
    .replace(/\[[^\]]{0,8}\]/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/链接/g, '')
    .trim();
  const first = withoutPrefix.split(/[。！？!?]\s*/).find((p) => p.trim().length >= 6);
  return (first ?? withoutPrefix).trim().slice(0, 46) || '值得查看的讨论';
}

function normalizeDedupe(content: string): string {
  return content.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 48);
}

function topEntry(values: Map<string, number>): string {
  return Array.from(values.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

function strengthsFor(source: {
  link_count: number;
  opportunity_count: number;
  tool_count: number;
}): string[] {
  const out: string[] = [];
  if (source.tool_count > 0) out.push('工具');
  if (source.link_count > 0) out.push('链接');
  if (source.opportunity_count > 0) out.push('机会');
  return out.length > 0 ? out.slice(0, 3) : ['观点'];
}
