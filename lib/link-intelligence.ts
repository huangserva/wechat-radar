import { db } from './db';
import { wxSessions } from './wx';
import { cache } from './cache';

const MAX_MESSAGES = 5000;
const MAX_ITEMS_PER_KIND = 24;
const MAX_TITLE_FETCHES = 8;
const TITLE_FETCH_TIMEOUT_MS = 1400;
const MAX_TITLE_GENERATION_ITEMS = 80;

// Title/dedupe-key generation LLM = openai-compatible (GLM). Reuses the topic/lab
// env. The previous codex CLI hung ~180s then failed locally (same gpt-5/auth
// issue as /lab + /topics) and produced no titles → garbage fallback labels.
const LINK_LLM_BASE_URL = process.env.WECHAT_RADAR_TOPIC_BASE_URL ?? process.env.WECHAT_RADAR_LAB_BASE_URL;
const LINK_LLM_API_KEY = process.env.WECHAT_RADAR_TOPIC_API_KEY ?? process.env.WECHAT_RADAR_LAB_API_KEY;
const LINK_LLM_MODEL = process.env.WECHAT_RADAR_TOPIC_MODEL ?? process.env.WECHAT_RADAR_LAB_MODEL ?? 'glm-4-flash';
const LINK_LLM_MAX_TOKENS = Number(process.env.WECHAT_RADAR_LINK_MAX_TOKENS ?? 2400);
const LINK_LLM_TIMEOUT_MS = Number(
  process.env.WECHAT_RADAR_LINK_LLM_TIMEOUT_MS ?? process.env.WECHAT_RADAR_LAB_CODEX_TIMEOUT_MS ?? 120_000,
);
const LINK_TITLE_BATCH_SIZE = Number(process.env.WECHAT_RADAR_LINK_BATCH_SIZE ?? 40);
const LINK_INTELLIGENCE_CACHE_VERSION = 'v9';
const LINK_INTELLIGENCE_CACHE_TTL_SECONDS = 60 * 60 * 24;

const TOOL_HINT_RE =
  /工具|开源|项目|产品|官网|体验|注册|插件|脚手架|模型|智能体|Agent|Claude|Gemini|Codex|API|CLI|MCP|浏览器|Demo|教程|指南|workflow|workspace/i;

const ARTICLE_HOSTS = [
  'zhuanlan.zhihu.com',
  'www.zhihu.com',
  'www.toutiao.com',
  'www.sohu.com',
  'page.om.qq.com',
  'www.163.com',
  'mparticle.uc.cn',
  'podcasts.apple.com',
  'open.spotify.com',
  'podcasters.spotify.com',
  'podscan.fm',
];

const TOOL_HOST_HINTS = [
  'github.com',
  'huggingface.co',
  'replicate.com',
  'vercel.app',
  'netlify.app',
  'feishu.cn',
  'larksuite.com',
  'notion.site',
  'notion.so',
  'docs.google.com',
  'my.feishu.cn',
];

const IGNORED_HOSTS = [
  'support.weixin.qq.com',
  'wx.qlogo.cn',
  'wxapp.tc.qq.com',
  'res.wx.qq.com',
  'mmbiz.qpic.cn',
];

type LinkKind = 'article' | 'tool';

interface MessageLinkRow {
  chatroom_id: string;
  local_id: number;
  sender: string;
  content: string;
  time: string;
  timestamp: number;
  type: string;
  url: string;
  canonical_url: string;
  link_title: string | null;
  domain: string;
  source: string;
  confidence: number;
}

export interface LinkIntelligenceItem {
  kind: LinkKind;
  url: string;
  canonical_url: string;
  title: string;
  domain: string;
  count: number;
  group_count: number;
  first_seen: string;
  last_seen: string;
  sources: Array<{
    chatroom_id: string;
    chat_name: string;
    sender: string;
    time: string;
    local_id: number;
    snippet: string;
    source: string;
  }>;
  dedupe_key?: string;
}

export interface LinkIntelligenceResult {
  date: string;
  articles: LinkIntelligenceItem[];
  tools: LinkIntelligenceItem[];
}

interface LinkIntelligenceOptions {
  refresh?: boolean;
}

interface GeneratedLinkTitle {
  canonical_url: string;
  title: string;
  group_key: string;
}

interface GeneratedLinkTitleResponse {
  items: GeneratedLinkTitle[];
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isWeChatArticle(url: URL): boolean {
  return url.hostname === 'mp.weixin.qq.com' && (
    (url.pathname.startsWith('/s/') && url.pathname.length > 3) ||
    url.searchParams.has('__biz') ||
    url.searchParams.has('mid') ||
    url.searchParams.has('sn')
  );
}

function isArticleLink(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (isWeChatArticle(u)) return true;
    if ((host === 'x.com' || host === 'twitter.com') && /\/status\/\d{12,}/.test(u.pathname)) return true;
    if ((host === 'youtube.com' || host === 'youtu.be') && (u.pathname === '/watch' || host === 'youtu.be')) {
      return true;
    }
    return ARTICLE_HOSTS.includes(host);
  } catch {
    return false;
  }
}

function isToolLink(url: string, content: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (
      host === 'x.com' ||
      host === 'twitter.com' ||
      (host === 'mp.weixin.qq.com' && !isWeChatArticle(u)) ||
      /meeting\.tencent\.com$/.test(host) ||
      IGNORED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    ) {
      return false;
    }
    if (isArticleLink(url)) return false;
    if (TOOL_HOST_HINTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
    return TOOL_HINT_RE.test(content);
  } catch {
    return false;
  }
}

function cleanSnippet(content: string): string {
  return decodeHtmlEntities(content)
    .replace(/<\?xml[\s\S]+?<\/msg>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[引用\]/g, '')
    .replace(/↳/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function titleFromContext(content: string, url: string): string {
  const decoded = decodeHtmlEntities(content);
  const withoutXml = decoded.replace(/<\?xml[\s\S]+?<\/msg>/g, ' ');
  const lines = withoutXml
    .split(/\n+/)
    .map((line) =>
      line
        .replace(url, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\[引用\]/g, '')
        .replace(/↳/g, '')
        .trim(),
    )
    .filter((line) => line.length >= 4 && line.length <= 90);

  const preferred = lines.find((line) => !/^[@#\d\s:：-]+$/.test(line));
  return preferred ?? domainOf(url);
}

function decodeTitle(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/\s+/g, ' ')
    .replace(/ - 微信公众平台$/, '')
    .replace(/_哔哩哔哩_bilibili$/, '')
    .trim()
    .slice(0, 120);
}

async function fetchTitle(url: string): Promise<string | null> {
  const cacheKey = `link-title:${url}`;
  const cached = cache.get(cacheKey) as string | undefined;
  if (cached) return cached;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TITLE_FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    const html = await r.text();
    const title =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
      null;
    if (!title) return null;
    const decoded = decodeTitle(title);
    if (decoded) cache.set(cacheKey, decoded, 60 * 60 * 24);
    return decoded || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function hydrateTitles(items: LinkIntelligenceItem[]) {
  const needsTitle = items
    .filter((item) => item.title === item.domain || item.title.length < 8)
    .slice(0, MAX_TITLE_FETCHES);
  await Promise.all(
    needsTitle.map(async (item) => {
      const title = await fetchTitle(item.url);
      if (title) item.title = title;
    }),
  );
}

function parseJsonOutput<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]) as T;
    const obj = trimmed.match(/\{[\s\S]*\}/);
    if (obj) return JSON.parse(obj[0]) as T;
    throw new Error('link LLM returned non-JSON');
  }
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * Link title/dedupe generation via openai-compatible (GLM) /chat/completions.
 * Replaces the codex CLI (hung ~180s then failed locally). Uses
 * response_format=json_object and unwraps a GLM `{answer:...}` wrapper if present.
 */
async function runLinkLlm<T>(prompt: string, timeoutMs = LINK_LLM_TIMEOUT_MS): Promise<T> {
  if (!LINK_LLM_BASE_URL) {
    throw new Error('WECHAT_RADAR_TOPIC_BASE_URL / WECHAT_RADAR_LAB_BASE_URL required for link LLM');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const response = await fetch(`${LINK_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        ...(LINK_LLM_API_KEY ? { authorization: `Bearer ${LINK_LLM_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: LINK_LLM_MODEL,
        messages: [
          { role: 'system', content: '你是微信群链接情报的标题整理器。只输出严格 JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: LINK_LLM_MAX_TOKENS,
        response_format: { type: 'json_object' },
      }),
    });
    const text = await response.text();
    let payload: OpenAIChatResponse | null = null;
    try {
      payload = JSON.parse(text) as OpenAIChatResponse;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(`link LLM request failed (${response.status}): ${payload?.error?.message || text.slice(0, 400)}`);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error('link LLM response missing choices[0].message.content');
    const parsed = parseJsonOutput<unknown>(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'answer' in parsed) {
      const answer = (parsed as { answer: unknown }).answer;
      if (typeof answer === 'string') return parseJsonOutput<T>(answer);
      return answer as T;
    }
    return parsed as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('link LLM timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function fallbackDedupeKey(item: LinkIntelligenceItem): string {
  const title = item.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 40);
  return title || item.canonical_url;
}

function buildTitleGenerationPrompt(items: LinkIntelligenceItem[]): string {
  const rows = items
    .map((item) =>
      JSON.stringify({
        canonical_url: item.canonical_url,
        kind: item.kind,
        domain: item.domain,
        current_title: item.title,
        snippets: item.sources.slice(0, 3).map((s) => s.snippet).filter(Boolean),
      }),
    )
    .join('\n');

  return `你是微信群链接情报的标题整理器。请为每个链接生成适合列表展示的中文标题，并给出语义去重 key。

要求：
- title 要短、具体、可点击，优先保留产品名、文章主题、工具名或资料名。
- 不要直接复制整段聊天长句；去掉寒暄、@人名、表情和“老师”等噪声。
- 文章链接 title 像文章标题；工具/资源 title 像工具名、项目名、资料库名或活动名。
- group_key 用于去重：同一个工具、同一篇文章、同一组资料更新、同一活动报名，即便 URL 不同，也给相同 group_key。
- group_key 使用小写英文/数字/短横线；无法判断时用域名加核心标题。
- canonical_url 必须原样来自输入；不要新增、删除或编造 URL。

只输出严格 JSON：
{"items":[{"canonical_url":"...","title":"...","group_key":"..."}]}

输入 JSONL：
${rows}`;
}

async function generateTitlesAndKeys(items: LinkIntelligenceItem[]) {
  if (items.length === 0) return;
  // Seed every item with a deterministic fallback key; the LLM overrides
  // title/group_key per successfully-returned batch. A failed batch (timeout /
  // content filter) keeps its fallback and never blocks the rest.
  for (const item of items) item.dedupe_key = fallbackDedupeKey(item);
  if (!LINK_LLM_BASE_URL) return;

  const batches: LinkIntelligenceItem[][] = [];
  for (let i = 0; i < items.length; i += LINK_TITLE_BATCH_SIZE) {
    batches.push(items.slice(i, i + LINK_TITLE_BATCH_SIZE));
  }
  // Batches are independent — run them concurrently. A failed batch (timeout /
  // content filter) keeps its fallback keys and never blocks the others.
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const response = await runLinkLlm<GeneratedLinkTitleResponse>(buildTitleGenerationPrompt(batch));
        const byUrl = new Map((response.items ?? []).map((item) => [item.canonical_url, item]));
        for (const item of batch) {
          const generated = byUrl.get(item.canonical_url);
          if (!generated) continue;
          if (generated.title?.trim()) item.title = generated.title.trim().slice(0, 80);
          if (generated.group_key?.trim()) item.dedupe_key = generated.group_key.trim().toLowerCase();
        }
      } catch {
        // keep fallback keys for this batch
      }
    }),
  );
}

function mergeDuplicateItems(items: LinkIntelligenceItem[]): LinkIntelligenceItem[] {
  const merged = new Map<string, LinkIntelligenceItem>();
  for (const item of items) {
    const key = `${item.kind}:${item.dedupe_key ?? fallbackDedupeKey(item)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item, sources: [...item.sources] });
      continue;
    }
    existing.count += item.count;
    existing.last_seen = existing.last_seen > item.last_seen ? existing.last_seen : item.last_seen;
    existing.first_seen = existing.first_seen < item.first_seen ? existing.first_seen : item.first_seen;
    for (const source of item.sources) {
      if (!existing.sources.some((s) => s.chatroom_id === source.chatroom_id && s.local_id === source.local_id)) {
        existing.sources.push(source);
      }
    }
    existing.group_count = new Set(existing.sources.map((s) => s.chatroom_id)).size;
    if (item.count > existing.count) {
      existing.url = item.url;
      existing.canonical_url = item.canonical_url;
    }
  }
  return Array.from(merged.values());
}

function resultCacheKey(date: string) {
  return `link-intelligence:${date}:${LINK_INTELLIGENCE_CACHE_VERSION}`;
}

function readPersistedLinkIntelligence(date: string): LinkIntelligenceResult | null {
  const row = db()
    .prepare('SELECT payload FROM link_intelligence_cache WHERE date = ? AND version = ?')
    .get(date, LINK_INTELLIGENCE_CACHE_VERSION) as { payload: string } | undefined;
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.payload) as LinkIntelligenceResult;
    if (parsed.date !== date || !Array.isArray(parsed.articles) || !Array.isArray(parsed.tools)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedLinkIntelligence(result: LinkIntelligenceResult) {
  db()
    .prepare(
      `INSERT INTO link_intelligence_cache (date, version, payload, generated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date, version) DO UPDATE SET
         payload = excluded.payload,
         generated_at = excluded.generated_at`,
    )
    .run(
      result.date,
      LINK_INTELLIGENCE_CACHE_VERSION,
      JSON.stringify(result),
      Date.now(),
    );
}

export function clearDailyLinkIntelligence(date: string) {
  cache.del(resultCacheKey(date));
  db()
    .prepare('DELETE FROM link_intelligence_cache WHERE date = ? AND version = ?')
    .run(date, LINK_INTELLIGENCE_CACHE_VERSION);
}

export async function getDailyLinkIntelligence(
  date: string,
  options: LinkIntelligenceOptions = {},
): Promise<LinkIntelligenceResult> {
  const refresh = options.refresh ?? false;
  const key = resultCacheKey(date);
  const cached = cache.get(key) as LinkIntelligenceResult | undefined;
  if (cached && !refresh) return cached;

  if (!refresh) {
    const persisted = readPersistedLinkIntelligence(date);
    if (persisted) {
      cache.set(key, persisted, LINK_INTELLIGENCE_CACHE_TTL_SECONDS);
      return persisted;
    }
  }

  const rows = db()
    .prepare(
      `SELECT
         m.chatroom_id,
         m.local_id,
         m.sender,
         m.content,
         m.time,
         m.timestamp,
         m.type,
         ml.url,
         ml.canonical_url,
         ml.title AS link_title,
         ml.domain,
         ml.source,
         ml.confidence
       FROM message_links ml
       JOIN messages m
         ON m.chatroom_id = ml.chatroom_id
        AND m.local_id = ml.local_id
       WHERE ml.date = ?
       ORDER BY ml.timestamp DESC
       LIMIT ?`,
    )
    .all(date, MAX_MESSAGES) as MessageLinkRow[];

  const sessions = await wxSessions(500).catch(() => []);
  const names = new Map<string, string>();
  for (const s of sessions) names.set(s.username, s.chat);

  const buckets = new Map<string, LinkIntelligenceItem>();

  for (const row of rows) {
      const canonical = row.canonical_url;
      const kind: LinkKind | null = isArticleLink(canonical)
        ? 'article'
        : isToolLink(canonical, row.content)
          ? 'tool'
          : null;
      if (!kind) continue;

      const key = `${kind}:${canonical}`;
      const existing = buckets.get(key);
      const source = {
        chatroom_id: row.chatroom_id,
        chat_name: names.get(row.chatroom_id) ?? row.chatroom_id,
        sender: row.sender,
        time: row.time,
        local_id: row.local_id,
        snippet: cleanSnippet(row.content),
        source: row.source,
      };

      if (existing) {
        existing.count++;
        existing.last_seen = existing.last_seen > row.time ? existing.last_seen : row.time;
        existing.first_seen = existing.first_seen < row.time ? existing.first_seen : row.time;
        if (!existing.sources.some((s) => s.chatroom_id === row.chatroom_id && s.local_id === row.local_id)) {
          existing.sources.push(source);
        }
        existing.group_count = new Set(existing.sources.map((s) => s.chatroom_id)).size;
      } else {
        buckets.set(key, {
          kind,
          url: row.url,
          canonical_url: canonical,
          title: row.link_title || titleFromContext(row.content, row.url),
          domain: row.domain || domainOf(canonical),
          count: 1,
          group_count: 1,
          first_seen: row.time,
          last_seen: row.time,
          sources: [source],
        });
      }
  }

  const sortItems = (kind: LinkKind, limit = MAX_ITEMS_PER_KIND) =>
    Array.from(buckets.values())
      .filter((item) => item.kind === kind)
      .sort((a, b) => b.count - a.count || b.group_count - a.group_count || b.last_seen.localeCompare(a.last_seen))
      .slice(0, limit);

  const articleCandidates = sortItems('article', MAX_TITLE_GENERATION_ITEMS);
  const toolCandidates = sortItems('tool', MAX_TITLE_GENERATION_ITEMS);
  await Promise.all([hydrateTitles(articleCandidates), hydrateTitles(toolCandidates)]);
  await generateTitlesAndKeys([...articleCandidates, ...toolCandidates]);

  const articles = mergeDuplicateItems(articleCandidates)
    .sort((a, b) => b.count - a.count || b.group_count - a.group_count || b.last_seen.localeCompare(a.last_seen))
    .slice(0, MAX_ITEMS_PER_KIND);
  const tools = mergeDuplicateItems(toolCandidates)
    .sort((a, b) => b.count - a.count || b.group_count - a.group_count || b.last_seen.localeCompare(a.last_seen))
    .slice(0, MAX_ITEMS_PER_KIND);

  const result = { date, articles, tools };
  writePersistedLinkIntelligence(result);
  cache.set(key, result, LINK_INTELLIGENCE_CACHE_TTL_SECONDS);
  return result;
}
