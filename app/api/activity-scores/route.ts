import { NextResponse } from 'next/server';
import { computeActivityScores } from '@/lib/activity-score';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const scores = computeActivityScores();
    const result: Record<string, { score: number; breakdown: { frequency: number; speakers: number; topics: number; links: number } }> = {};
    for (const [cid, data] of scores) {
      result[cid] = { score: data.score, breakdown: data.breakdown };
    }
    return NextResponse.json({ ok: true, scores: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/activity-scores failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
