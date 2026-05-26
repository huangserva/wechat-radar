import { NextRequest, NextResponse } from 'next/server';
import { listLabTrendTargets } from '@/lib/lab-trends';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const q = sp.get('q')?.trim() || undefined;
  const verifiedOnly = sp.get('verified_only') === '1' || sp.get('verified_only') === 'true';
  const limitRaw = sp.get('limit');
  const limit = limitRaw && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined;

  try {
    const targets = listLabTrendTargets({ q, limit, verified_only: verifiedOnly });
    const allCreated = targets.flatMap((t) => [t.first_created_at, t.last_created_at]);
    return NextResponse.json({
      ok: true,
      targets,
      total: targets.length,
      freshness: {
        run_count: targets.reduce((s, t) => s + t.run_count, 0),
        first_created_at: allCreated.length ? Math.min(...allCreated) : null,
        last_created_at: allCreated.length ? Math.max(...allCreated) : null,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unknown error' }, { status: 500 });
  }
}
