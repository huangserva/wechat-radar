import { NextRequest } from 'next/server';
import { wxSessions } from '@/lib/wx';
import { syncFullHistory } from '@/lib/stats-aggregator';
import { normalizeDate, normalizeRangeKey, rangeToWindow, type RangeKey } from '@/lib/range';
import { readConfig } from '@/lib/config';
import { cache, CK } from '@/lib/cache';
import { buildTopicsForDate } from '@/lib/topics';

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

        const topicDates = datesBetween(since, until).slice(-autoTopicDays(body.full));
        send({ type: 'topics_start', dates: topicDates.length });
        for (const date of topicDates) {
          send({ type: 'topics_date', date, message: '开始构建话题…' });
          await buildTopicsForDate(date, (p) => send({ ...p, type: `topics_${p.type}`, date }));
        }

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

function datesBetween(since: string, until: string): string[] {
  const out: string[] = [];
  const start = parseLocalDate(since);
  const end = parseLocalDate(until);
  for (const d = start; d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    out.push(formatLocalDate(d));
  }
  return out;
}

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function autoTopicDays(full?: boolean): number {
  const configured = Number(process.env.WECHAT_RADAR_AUTO_TOPIC_DAYS ?? (full ? 14 : 31));
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 31;
}
