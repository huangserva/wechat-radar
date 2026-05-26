import { NextRequest, NextResponse } from 'next/server';
import {
  assistantDbAvailable,
  assistantDbInventory,
  getDigests,
  getTechHighlights,
  getTrendingTopics,
  getTrendingUrls,
} from '@/lib/assistant-source';

export const dynamic = 'force-dynamic';

type DigestKind = 'json' | 'text' | 'empty';

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const today = todayStr();
  let since = sp.get('since')?.trim() || '';
  let until = sp.get('until')?.trim() || '';
  if (!isDate(since) || !isDate(until) || since > until) {
    // default: 本周（近 7 天，含今天）
    since = addDays(today, -6);
    until = today;
  }

  try {
    const available = assistantDbAvailable();
    const inv = assistantDbInventory();
    const invOf = (t: string) => inv.find((r) => r.table === t)?.latest_date ?? null;

    const inWindow = (d: string) => d >= since && d <= until;

    // ---- 周期主题：trending_topics 按 keyword 聚合 ----
    const allTopics = getTrendingTopics({ limit: 1000 }).filter((t) => inWindow(t.scan_date));
    const topicMap = new Map<
      string,
      { keyword: string; mentions: number; days: Set<string>; groups: Set<string>; maxGroups: number }
    >();
    for (const t of allTopics) {
      let agg = topicMap.get(t.keyword);
      if (!agg) {
        agg = { keyword: t.keyword, mentions: 0, days: new Set(), groups: new Set(), maxGroups: 0 };
        topicMap.set(t.keyword, agg);
      }
      agg.mentions += t.total_mentions;
      agg.days.add(t.scan_date);
      for (const g of t.source_groups) agg.groups.add(g);
      agg.maxGroups = Math.max(agg.maxGroups, t.groups_count);
    }
    const topics = Array.from(topicMap.values())
      .map((a) => ({
        keyword: a.keyword,
        total_mentions: a.mentions,
        active_days: a.days.size,
        // Cross-day distinct source groups; fall back to single-day max when the
        // text-form source_groups was empty so the union understates coverage.
        groups_count: Math.max(a.groups.size, a.maxGroups),
        source_groups: Array.from(a.groups).slice(0, 8),
      }))
      .sort((a, b) => b.total_mentions - a.total_mentions);

    // ---- 链接回看：trending_urls 按 url 聚合 ----
    const allUrls = getTrendingUrls({ limit: 1000 }).filter((u) => inWindow(u.scan_date));
    const urlMap = new Map<
      string,
      { url: string; title: string; shares: number; first_seen: string; first_time: string; first_group: string }
    >();
    for (const u of allUrls) {
      let agg = urlMap.get(u.url);
      if (!agg) {
        agg = { url: u.url, title: u.title, shares: 0, first_seen: u.scan_date, first_time: u.first_time, first_group: u.first_group };
        urlMap.set(u.url, agg);
      }
      agg.shares += u.share_count;
      if (!agg.title && u.title) agg.title = u.title;
      // Earliest occurrence by (scan_date, first_time); keep first_group in sync so
      // "首现群" matches "首现日"（trending_urls is scan_date DESC, so the seed row
      // is the newest day — never overwriting first_group desynced them before).
      const earlier =
        u.scan_date < agg.first_seen || (u.scan_date === agg.first_seen && (u.first_time || '') < (agg.first_time || ''));
      if (earlier) {
        agg.first_seen = u.scan_date;
        agg.first_time = u.first_time;
        agg.first_group = u.first_group;
      }
    }
    const links = Array.from(urlMap.values()).sort((a, b) => b.shares - a.shares);

    // ---- 摘要：digests 分 json / text / empty ----
    const windowDigests = getDigests({ limit: 200 }).filter((d) => inWindow(d.date));
    let emptyDays = 0;
    const digests = [] as Array<{ date: string; kind: DigestKind; text: string; top3: string[]; groups_count: number }>;
    for (const d of windowDigests) {
      const kind: DigestKind = d.data ? 'json' : d.text.length > 0 ? 'text' : 'empty';
      if (kind === 'empty') {
        emptyDays += 1;
        continue;
      }
      digests.push({
        date: d.date,
        kind,
        text: d.text.slice(0, 400),
        top3: extractTop3(d.data),
        groups_count: countGroups(d.data),
      });
    }
    digests.sort((a, b) => (a.date < b.date ? 1 : -1));

    // ---- 技术讨论：tech_highlights（多半 stale，窗口内常为空）----
    const techItems = getTechHighlights({ limit: 200 }).filter((t) => inWindow(t.scan_date));
    const techLatest = invOf('tech_highlights');
    const techStatus: 'present' | 'stale' | 'missing' = techItems.length > 0 ? 'present' : techLatest ? 'stale' : 'missing';

    return NextResponse.json({
      ok: true,
      available,
      since,
      until,
      freshness: {
        trending: invOf('trending_topics'),
        digests: invOf('digests'),
        tech: techLatest,
      },
      stats: {
        topic_count: topics.length,
        link_count: links.length,
        digest_days: digests.length,
        empty_digest_days: emptyDays,
        tech_status: techStatus,
      },
      topics,
      links,
      digests,
      tech: {
        status: techStatus,
        latest_date: techLatest,
        items: techItems
          .map((t) => ({ scan_date: t.scan_date, category: t.category, keyword: t.keyword, count: t.count, groups: t.groups }))
          .slice(0, 50),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/reviews failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function extractTop3(data: Record<string, unknown> | null): string[] {
  if (!data) return [];
  const t = data.top3 ?? data.top ?? data.topics;
  if (!Array.isArray(t)) return [];
  return t
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Record<string, unknown>).title ?? (x as Record<string, unknown>).keyword ?? '') : ''))
    .filter(Boolean)
    .slice(0, 3);
}

function countGroups(data: Record<string, unknown> | null): number {
  if (!data) return 0;
  const g = data.groups;
  return Array.isArray(g) ? g.length : 0;
}

function isDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
