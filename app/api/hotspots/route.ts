import { NextRequest, NextResponse } from 'next/server';
import {
  assistantDbAvailable,
  assistantDbInventory,
  getTrendingTopics,
  getTrendingUrls,
} from '@/lib/assistant-source';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const dateParam = new URL(req.url).searchParams.get('date')?.trim() || '';

  try {
    const available = assistantDbAvailable();
    // trending_topics ~295 / trending_urls ~191 total — cheap to pull all, then
    // derive the date list and filter in-process (avoids a dates-list getter).
    const allTopics = getTrendingTopics({ limit: 500 });
    const allUrls = getTrendingUrls({ limit: 300 });

    const dates = Array.from(
      new Set([...allTopics.map((t) => t.scan_date), ...allUrls.map((u) => u.scan_date)].filter(Boolean)),
    ).sort((a, b) => (a < b ? 1 : -1));

    const inv = assistantDbInventory().find((r) => r.table === 'trending_topics');
    const latestDate = inv?.latest_date ?? dates[0] ?? null;
    const date = dateParam || latestDate || '';

    const topics = allTopics.filter((t) => t.scan_date === date);
    const urls = allUrls.filter((u) => u.scan_date === date).sort((a, b) => b.share_count - a.share_count);

    const groupSet = new Set<string>();
    for (const t of topics) for (const g of t.source_groups) groupSet.add(g);
    const maxMentions = topics.reduce((m, t) => Math.max(m, t.total_mentions), 0);

    return NextResponse.json({
      ok: true,
      available,
      date,
      latest_date: latestDate,
      available_dates: dates.slice(0, 60),
      stats: {
        topic_count: topics.length,
        url_count: urls.length,
        group_estimate: groupSet.size,
        max_mentions: maxMentions,
      },
      topics: topics.map((t) => ({
        keyword: t.keyword,
        total_mentions: t.total_mentions,
        groups_count: t.groups_count,
        source_groups: t.source_groups,
        is_merged: t.is_merged,
      })),
      urls: urls.map((u) => ({
        url: u.url,
        title: u.title,
        share_count: u.share_count,
        first_group: u.first_group,
        first_time: u.first_time,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/hotspots failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
