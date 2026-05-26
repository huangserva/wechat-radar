'use client';

import { useEffect, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { Activity, Pause, Play } from 'lucide-react';

type StreamMessage = {
  local_id: number;
  username: string;
  chat_name: string;
  sender: string;
  content: string;
  time: string;
  timestamp: number;
  type: string;
};

type StreamEvent =
  | { type: 'open'; interval: number }
  | { type: 'tick'; count: number; items: StreamMessage[]; ts: number }
  | { type: 'error'; error: string };

export default function SignalsPage() {
  const [items, setItems] = useState<StreamMessage[]>([]);
  const [running, setRunning] = useState(true);
  const [lastTick, setLastTick] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ctlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!running) {
      ctlRef.current?.abort();
      ctlRef.current = null;
      return;
    }
    const ctl = new AbortController();
    ctlRef.current = ctl;
    (async () => {
      try {
        const r = await fetch('/api/new-messages', { signal: ctl.signal });
        if (!r.body) return;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 2);
            if (!chunk.startsWith('data:')) continue;
            try {
              const evt = JSON.parse(chunk.slice(5).trim()) as StreamEvent;
              if (evt.type === 'tick') {
                setLastTick(evt.ts);
                setErr(null);
                if (evt.items.length) {
                  setItems((prev) => [...evt.items, ...prev].slice(0, 200));
                }
              } else if (evt.type === 'error') {
                setErr(evt.error);
              }
            } catch {}
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
      }
    })();
    return () => ctl.abort();
  }, [running]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div>
            <div className="report-kicker">Live Signals</div>
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <Activity size={16} className="text-[var(--accent)]" />
              信号流 · 实时
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
              {err
                ? `错误：${err}`
                : lastTick
                ? `上次刷新：${new Date(lastTick).toLocaleTimeString()} · ${items.length} 条已收`
                : '等待第一条消息…'}
            </div>
          </div>
          <button
            className={`btn ${running ? 'btn-warn' : 'btn-primary'}`}
            onClick={() => setRunning((v) => !v)}
          >
            {running ? <Pause size={13} /> : <Play size={13} />}
            <span>{running ? '暂停' : '继续'}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="py-20 text-center text-[12px] text-[var(--text-3)]">
              等待新消息（每 5 秒拉取一次）…
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((m, i) => (
                <Row key={`${m.username}-${m.local_id}-${i}`} m={m} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Row({ m }: { m: StreamMessage }) {
  return (
    <div className="card grid grid-cols-[140px_1fr_120px] gap-3 px-4 py-3 text-[13px]">
      <div className="truncate text-[var(--text-2)]">
        <div className="truncate font-medium text-[var(--text)]">{m.chat_name}</div>
        <div className="truncate text-[11px] text-[var(--text-3)]">{m.sender}</div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[var(--text)]">{m.content}</div>
        <div className="mt-0.5 text-[11px] text-[var(--text-3)]">类型：{m.type}</div>
      </div>
      <div className="text-right text-[11px] text-[var(--text-3)] tabular-nums">{m.time}</div>
    </div>
  );
}
