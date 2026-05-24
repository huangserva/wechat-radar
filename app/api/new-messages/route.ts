import { NextRequest } from 'next/server';
import { wxNewMessages, wxSessions } from '@/lib/wx';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const interval = Math.max(Number(url.searchParams.get('interval') ?? 5000), 2000);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let timer: NodeJS.Timeout | null = null;
      let stopped = false;

      const tick = async () => {
        if (stopped) return;
        try {
          const [msgs, sessions] = await Promise.all([
            wxNewMessages(50).catch(() => []),
            wxSessions(500).catch(() => []),
          ]);
          const names = new Map<string, string>();
          for (const s of sessions) names.set(s.username, s.chat);
          const enriched = msgs.map((m) => ({
            ...m,
            chat_name: names.get(m.username) ?? m.username,
          }));
          send({ type: 'tick', count: msgs.length, items: enriched, ts: Date.now() });
        } catch (e) {
          send({ type: 'error', error: e instanceof Error ? e.message : 'unknown' });
        }
      };

      // Send initial heartbeat so the client knows the stream is open
      send({ type: 'open', interval });
      await tick();
      timer = setInterval(tick, interval);

      req.signal.addEventListener('abort', () => {
        stopped = true;
        if (timer) clearInterval(timer);
        controller.close();
      });
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
