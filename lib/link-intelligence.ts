import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from './db';
import { wxSessions } from './wx';
import { cache } from './cache';

const MAX_MESSAGES = 5000;
const MAX_ITEMS_PER_KIND = 24;
const MAX_TITLE_FETCHES = 8;
const TITLE_FETCH_TIMEOUT_MS = 1400;
const MAX_TITLE_GENERATION_ITEMS = 80;
const CODEX_TIMEOUT_MS = Number(process.env.WECHAT_RADAR_LINK_CODEX_TIMEOUT_MS ?? 180_000);
const CODEX_MODEL = process.env.WECHAT_RADAR_CODEX_MODEL;
const LINK_INTELLIGENCE_CACHE_VERSION = 'v6';
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

const LINK_TITLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          canonical_url: { type: 'string' },
          title: { type: 'string' },
          group_key: { type: 'string' },
        },
        required: ['canonical_url', 'title', 'group_key'],
      },
    },
  },
  required: ['items'],
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanUrl(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/[),，。；;!?！？、\]}>]+$/g, '')
    .replace(/\.{3,}$/g, '')
    .trim();
}

function normalizeUrl(raw: string): string | null {
  if (raw.includes('...') || raw.includes('…')) return null;
  try {
    const u = new URL(cleanUrl(raw));
    u.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

function extractUrls(content: string): string[] {
  const decoded = decodeHtmlEntities(content);
  const urls = new Set<string>();

  for (const m of decoded.matchAll(/imgsourceurl="([^"]+)"/g)) {
    try {
      urls.add(decodeURIComponent(m[1]));
    } catch {
      urls.add(m[1]);
    }
  }

  for (const m of decoded.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    urls.add(cleanUrl(m[0]));
  }

  return Array.from(urls).filter(Boolean);
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
    throw new Error('codex returned non-JSON');
  }
}

function runCodexJson<T>(prompt: string, schema: unknown, timeoutMs = CODEX_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'wechat-links-'));
    const schemaPath = join(dir, 'schema.json');
    const outPath = join(dir, 'response.json');
    writeFileSync(schemaPath, JSON.stringify(schema), 'utf8');

    const args = [
      '-a',
      'never',
      'exec',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-rules',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outPath,
    ];
    if (CODEX_MODEL) args.push('--model', CODEX_MODEL);
    args.push('-');

    const proc = spawn('codex', args, {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    const t = setTimeout(() => {
      proc.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
      reject(new Error('codex CLI timeout'));
    }, timeoutMs);
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (e) => {
      clearTimeout(t);
      rmSync(dir, { recursive: true, force: true });
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(t);
      try {
        if (code !== 0) {
          reject(new Error(`codex exit ${code}: ${stderr.slice(0, 800)}`));
          return;
        }
        resolve(parseJsonOutput<T>(readFileSync(outPath, 'utf8')));
      } catch (e) {
        reject(e);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
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
  try {
    const response = await runCodexJson<GeneratedLinkTitleResponse>(
      buildTitleGenerationPrompt(items),
      LINK_TITLE_SCHEMA,
    );
    const byUrl = new Map(response.items.map((item) => [item.canonical_url, item]));
    for (const item of items) {
      const generated = byUrl.get(item.canonical_url);
      if (!generated) {
        item.dedupe_key = fallbackDedupeKey(item);
        continue;
      }
      item.title = generated.title.trim().slice(0, 80) || item.title;
      item.dedupe_key = generated.group_key.trim().toLowerCase() || fallbackDedupeKey(item);
    }
  } catch {
    for (const item of items) item.dedupe_key = fallbackDedupeKey(item);
  }
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
      `SELECT chatroom_id, local_id, sender, content, time, timestamp, type
       FROM messages
       WHERE date = ?
         AND content LIKE '%http%'
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(date, MAX_MESSAGES) as MessageLinkRow[];

  const sessions = await wxSessions(500).catch(() => []);
  const names = new Map<string, string>();
  for (const s of sessions) names.set(s.username, s.chat);

  const buckets = new Map<string, LinkIntelligenceItem>();

  for (const row of rows) {
    for (const raw of extractUrls(row.content)) {
      const canonical = normalizeUrl(raw);
      if (!canonical) continue;

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
          url: raw,
          canonical_url: canonical,
          title: titleFromContext(row.content, raw),
          domain: domainOf(canonical),
          count: 1,
          group_count: 1,
          first_seen: row.time,
          last_seen: row.time,
          sources: [source],
        });
      }
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
