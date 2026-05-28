import { NextRequest, NextResponse } from 'next/server';
import { listTopics } from '@/lib/topics';
import { todayStr } from '@/lib/range';
import { loadTopicTrends } from '@/lib/topic-trends-source';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? todayStr();
  const topics = listTopics(date);
  const trends = loadTopicTrends();
  return NextResponse.json({ ok: true, date, topics, trends });
}
