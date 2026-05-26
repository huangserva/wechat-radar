import { NextRequest, NextResponse } from 'next/server';
import {
  assistantDbAvailable,
  assistantDbInventory,
  getDigests,
  getKnowledgeItems,
  type AssistantKnowledgeItem,
} from '@/lib/assistant-source';

export const dynamic = 'force-dynamic';

const UNCATEGORIZED = '未分类';
const MAX_ITEMS = 500;

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const since = sp.get('since')?.trim() || undefined;
  const sourceGroup = sp.get('source_group')?.trim() || undefined;

  try {
    const available = assistantDbAvailable();
    const items = getKnowledgeItems({ since, source_group: sourceGroup, limit: MAX_ITEMS });

    // category counts over the full (since/source-filtered) set
    const counts = new Map<string, number>();
    for (const it of items) {
      const key = it.category?.trim() || UNCATEGORIZED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const categories = Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => (a.key === UNCATEGORIZED ? 1 : b.key === UNCATEGORIZED ? -1 : b.count - a.count));

    // freshness: prefer inventory's latest_date for knowledge_items, fall back to data
    const inv = assistantDbInventory().find((r) => r.table === 'knowledge_items');
    const latestDate = inv?.latest_date ?? items.reduce<string | null>((max, it) => (it.date > (max ?? '') ? it.date : max), null);

    // digests as a secondary "daily summary" supplement — only non-empty ones
    const digests = getDigests({ limit: 30 })
      .filter((d) => d.text.length > 0 || d.data)
      .map((d) => ({ date: d.date, text: d.text.slice(0, 600), has_json: Boolean(d.data) }));

    return NextResponse.json({
      ok: true,
      available,
      total: items.length,
      latest_date: latestDate,
      categories,
      items: items.map(serializeItem),
      digests,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/knowledge failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function serializeItem(it: AssistantKnowledgeItem) {
  return {
    id: it.id,
    date: it.date,
    topic: it.topic,
    summary: it.summary,
    category: it.category?.trim() || UNCATEGORIZED,
    source_group: it.source_group,
    sender: it.sender,
    links: it.links,
    tags: it.tags,
  };
}
