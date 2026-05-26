import { db } from './db';
import type { MessageRow } from './messages-store';

export type MessageLinkSource = 'wechat_raw' | 'plain_url' | 'public_search' | 'manual';

export interface ParsedMessageLink {
  url: string;
  canonical_url: string;
  title: string | null;
  description: string | null;
  domain: string;
  source: MessageLinkSource;
  raw_kind: string;
  confidence: number;
}

type LinkInput = Pick<
  MessageRow,
  'chatroom_id' | 'local_id' | 'date' | 'sender' | 'content' | 'time' | 'timestamp'
>;

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number.parseInt(num, 10)));
}

export function cleanUrl(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/[),，。；;!?！？、\]}>]+$/g, '')
    .replace(/\.{3,}$/g, '')
    .trim();
}

// Share-attribution / tracking query params that do NOT identify the target
// resource. Stripping them lets the same article shared with different
// sharer_*/scene/clicktime/chksm tokens collapse to one canonical_url.
const TRACKING_QUERY_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'sharer_shareinfo', 'sharer_shareinfo_first', 'sharer_sharetime', 'sharer_userid', 'sharer_appid',
  'scene', 'ascene', 'subscene', 'clicktime', 'chksm', 'key', 'exportkey', 'pass_ticket',
  'isappinstalled', 'snipping_id', 'snipping_uuid', 'poc_token', 'srcid', 'mpshare',
  'wx_header', 'uin', 'sessionid', 'session_id', 'x5referer', 'fromtype',
]);

// For mp.weixin.qq.com /s? articles, only these params identify the article.
const WECHAT_ARTICLE_CORE_PARAMS = ['__biz', 'mid', 'idx', 'sn'];

function stripTrackingParams(u: URL): void {
  if (u.hostname === 'mp.weixin.qq.com') {
    // /s/<slug> — the slug fully identifies the article, drop the whole query.
    if (/^\/s\/[^/]+/.test(u.pathname)) {
      u.search = '';
      return;
    }
    // /s?__biz=..&mid=..&idx=..&sn=.. — keep only the article-identifying core
    // (drops scene/clicktime/chksm/t/sharer_* and re-orders deterministically).
    const core = new URLSearchParams();
    for (const k of WECHAT_ARTICLE_CORE_PARAMS) {
      const v = u.searchParams.get(k);
      if (v) core.set(k, v);
    }
    if ([...core.keys()].length > 0) {
      u.search = core.toString();
      return;
    }
    // no core params (unexpected) → fall through to generic stripping
  }
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.searchParams.sort();
}

export function normalizeUrl(raw: string): string | null {
  if (!raw || raw.includes('...') || raw.includes('…')) return null;
  try {
    const u = new URL(cleanUrl(raw));
    u.hash = '';
    stripTrackingParams(u);
    return u.toString();
  } catch {
    return null;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isWechatArticleUrl(url: string): boolean {
  try {
    const u = new URL(cleanUrl(url));
    return u.hostname === 'mp.weixin.qq.com' && (/^\/s\/?/.test(u.pathname) || u.searchParams.has('__biz'));
  } catch {
    return false;
  }
}

function tagText(content: string, tag: string): string {
  const text = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? '';
  return decodeHtmlEntities(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function attrValues(content: string, attr: string): string[] {
  return Array.from(content.matchAll(new RegExp(`${attr}=["']([^"']+)["']`, 'gi')))
    .map((m) => decodeHtmlEntities(m[1]).trim())
    .filter(Boolean);
}

function titleFromContext(content: string, url: string): string | null {
  const xmlTitle = tagText(content, 'title');
  if (xmlTitle) return xmlTitle.slice(0, 160);

  const decoded = decodeHtmlEntities(content).replace(/<\?xml[\s\S]+?<\/msg>/g, ' ');
  const lines = decoded
    .split(/\n+/)
    .map((line) =>
      line
        .replace(url, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\[引用\]/g, '')
        .replace(/^\s*↳\s*/, '')
        .replace(/^\s*\[链接\]\s*/, '')
        .trim(),
    )
    .filter((line) => line.length >= 4 && line.length <= 120);

  return lines.find((line) => !/^[@#\d\s:：-]+$/.test(line))?.slice(0, 160) ?? null;
}

export function extractMessageLinks(content: string): ParsedMessageLink[] {
  const decoded = decodeHtmlEntities(content);
  const hasXml = /<msg[\s>]|<appmsg[\s>]/i.test(decoded);
  const xmlTitle = tagText(decoded, 'title') || null;
  const xmlDescription = tagText(decoded, 'des') || tagText(decoded, 'digest') || null;
  const candidates: Array<{ url: string; source: MessageLinkSource; raw_kind: string; confidence: number }> = [];

  for (const tag of ['url', 'lowurl']) {
    const url = tagText(decoded, tag);
    if (url && isWechatArticleUrl(url)) {
      candidates.push({ url, source: 'wechat_raw', raw_kind: `appmsg_${tag}`, confidence: 1 });
    }
  }

  for (const value of attrValues(decoded, 'url')) {
    if (!isWechatArticleUrl(value)) continue;
      candidates.push({
        url: value,
        source: hasXml ? 'wechat_raw' : 'plain_url',
        raw_kind: hasXml ? 'appmsg_attr_url' : 'plain_attr_url',
        confidence: hasXml ? 0.98 : 0.9,
      });
  }

  for (const m of decoded.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const rawUrl = cleanUrl(m[0]);
    const article = isWechatArticleUrl(rawUrl);
    const source: MessageLinkSource = hasXml && article ? 'wechat_raw' : 'plain_url';
    candidates.push({
      url: rawUrl,
      source,
      raw_kind: hasXml && article ? 'appmsg_url_text' : 'plain_url',
      confidence: article ? 0.96 : 0.9,
    });
  }

  const out = new Map<string, ParsedMessageLink>();
  for (const c of candidates) {
    const canonical = normalizeUrl(c.url);
    if (!canonical) continue;
    const domain = domainOf(canonical);
    if (!domain) continue;
    const existing = out.get(canonical);
    if (existing && existing.confidence >= c.confidence) continue;
    out.set(canonical, {
      url: cleanUrl(c.url),
      canonical_url: canonical,
      title: xmlTitle ?? titleFromContext(decoded, c.url),
      description: xmlDescription,
      domain,
      source: c.source,
      raw_kind: c.raw_kind,
      confidence: c.confidence,
    });
  }

  return Array.from(out.values());
}

const upsertMessageLink = () =>
  db().prepare(`
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

export function upsertLinksForMessage(message: LinkInput): number {
  const links = extractMessageLinks(message.content);
  if (links.length === 0) return 0;
  const stmt = upsertMessageLink();
  let changed = 0;
  for (const link of links) {
    const r = stmt.run(
      message.chatroom_id,
      message.local_id,
      message.date,
      message.sender ?? '',
      message.time ?? '',
      message.timestamp ?? 0,
      link.url,
      link.canonical_url,
      link.title,
      link.description,
      link.domain,
      link.source,
      link.raw_kind,
      link.confidence,
      Date.now(),
    );
    changed += r.changes;
  }
  return changed;
}

export function upsertResolvedLinkForMessage(input: {
  chatroom_id: string;
  local_id: number;
  url: string;
  title?: string | null;
  description?: string | null;
  source: Extract<MessageLinkSource, 'public_search' | 'manual'>;
  confidence?: number;
}): { ok: boolean; error?: string } {
  const message = db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, content, time, timestamp, type, date
       FROM messages
       WHERE chatroom_id = ? AND local_id = ?`,
    )
    .get(input.chatroom_id, input.local_id) as MessageRow | undefined;

  if (!message) return { ok: false, error: 'message not found' };

  const canonical = normalizeUrl(input.url);
  if (!canonical) return { ok: false, error: 'invalid url' };

  const domain = domainOf(canonical);
  if (!domain) return { ok: false, error: 'invalid domain' };

  upsertMessageLink().run(
    message.chatroom_id,
    message.local_id,
    message.date,
    message.sender ?? '',
    message.time ?? '',
    message.timestamp ?? 0,
    cleanUrl(input.url),
    canonical,
    input.title?.trim() || titleFromContext(message.content, input.url),
    input.description?.trim() || null,
    domain,
    input.source,
    input.source,
    input.confidence ?? (input.source === 'manual' ? 0.95 : 0.72),
    Date.now(),
  );

  return { ok: true };
}

export function backfillMessageLinks(since?: string, until?: string): { scanned: number; links: number } {
  const clauses = ["(content LIKE '%http%' OR content LIKE '%<url>%' OR content LIKE '%imgsourceurl=%')"];
  const params: string[] = [];
  if (since) {
    clauses.push('date >= ?');
    params.push(since);
  }
  if (until) {
    clauses.push('date <= ?');
    params.push(until);
  }

  const rows = db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, content, time, timestamp, type, date
       FROM messages
       WHERE ${clauses.join(' AND ')}
       ORDER BY timestamp DESC`,
    )
    .all(...params) as MessageRow[];

  let links = 0;
  const tx = db().transaction(() => {
    db()
      .prepare(
        `DELETE FROM message_links
         WHERE source = 'wechat_raw'
           AND canonical_url NOT LIKE '%://mp.weixin.qq.com/%'`,
      )
      .run();
    for (const row of rows) links += upsertLinksForMessage(row);
  });
  tx();
  return { scanned: rows.length, links };
}
