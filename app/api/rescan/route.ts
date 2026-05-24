import { NextRequest } from 'next/server';
import { wxSessions } from '@/lib/wx';
import { syncFullHistory } from '@/lib/stats-aggregator';
import { normalizeDate, normalizeRangeKey, rangeToWindow, type RangeKey } from '@/lib/range';
import { readConfig } from '@/lib/config';
import { cache, CK } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 1800; // 30 min

interface RescanBody {
  range?: RangeKey;
  anchorDate?: string;
  since?: string;
  until?: string;
  full?: boolean; // 一键全量：1 年
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as RescanBody;

  let since: string;
  let until: string;
  let scope: string;

  if (body.full) {
    const w = rangeToWindow('year');
    since = w.since;
    until = w.until;
    scope = 'full(365d)';
  } else if (body.since && body.until) {
    since = body.since;
    until = body.until;
    scope = `custom(${since}~${until})`;
  } else {
    const range = normalizeRangeKey(body.range, 'month');
    const w = rangeToWindow(range, normalizeDate(body.anchorDate));
    since = w.since;
    until = w.until;
    scope = range;
  }

  const sessions = await wxSessions(500);
  const targets = sessions
    .filter((s) => s.is_group)
    .map((s) => ({ chatroomId: s.username, display: s.chat }));

  const cfg = readConfig();
  const concurrency = cfg.rescanConcurrency ?? 6;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      send({ type: 'start', scope, since, until, groups: targets.length });

      try {
        const result = await syncFullHistory({
          targets,
          since,
          until,
          concurrency,
          onProgress: (p) => send(p),
        });
        cache.del(CK.sessions());
        send({
          type: 'finished',
          ok: result.ok,
          failed: result.failed,
          messages: result.messages,
        });
      } catch (e) {
        send({ type: 'error', error: e instanceof Error ? e.message : 'unknown' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
