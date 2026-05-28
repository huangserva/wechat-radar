'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import TopBar, { type RangeKey } from '@/components/TopBar';
import StatGrid, { type CardsData } from '@/components/StatGrid';
import TrendChart, { type TrendPoint } from '@/components/TrendChart';
import ActiveGroupsList, { type ActiveGroup } from '@/components/ActiveGroupsList';
import CategoryChart, { type CategoryStat } from '@/components/CategoryChart';
import IntelligenceBrief, { type DashboardIntelligence } from '@/components/IntelligenceBrief';
import { AlertTriangle, BellDot } from 'lucide-react';

type StatsResponse = {
  ok: boolean;
  error?: string;
  range: RangeKey;
  window: { since: string; until: string; days: number };
  cards: CardsData;
  trend: { data: TrendPoint[]; peak: TrendPoint; avg: number; total: number };
  active_groups: ActiveGroup[];
  categories: CategoryStat[];
  intelligence: DashboardIntelligence;
};

type StewardTodoState = {
  available: boolean;
  updated_at: string | null;
  active_todos: number;
  urgent_unresolved: number;
  unacked_todos: number;
  urgent_items: Array<{
    id: string;
    contact: string;
    title: string;
    created_date: string | null;
  }>;
};

export default function Page() {
  const [range, setRange] = useState<RangeKey>('month');
  const [date, setDate] = useState(() => localToday());
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanInfo, setRescanInfo] = useState<string | undefined>(undefined);
  const [setupChecked, setSetupChecked] = useState(false);
  const [stewardState, setStewardState] = useState<StewardTodoState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/setup', { cache: 'no-store' });
        const j = await r.json();
        if (!cancelled && j.ok && !j.configured) {
          window.location.href = '/setup';
          return;
        }
      } catch {}
      if (!cancelled) setSetupChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      setStats(await fetchStats(range, date));
    } catch (e) {
      console.error(e);
    }
  }, [range, date]);

  useEffect(() => {
    if (!setupChecked) return;
    let cancelled = false;
    (async () => {
      try {
        const j = await fetchStats(range, date);
        if (!cancelled) setStats(j);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, date, setupChecked]);

  useEffect(() => {
    if (!setupChecked) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/assistant-state', { cache: 'no-store' });
        const j = await r.json();
        if (!cancelled && r.ok && j.ok) {
          setStewardState(j.state);
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setupChecked]);

  const runRescan = useCallback(
    async (full: boolean) => {
      setRescanning(true);
      setRescanInfo(full ? '全量同步启动…（365 天，预计 8-15 分钟）' : '启动重扫…');
      try {
        const r = await fetch('/api/rescan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(full ? { full: true } : { range, anchorDate: date }),
        });
        if (!r.ok || !r.body) {
          setRescanInfo('重扫失败');
          setRescanning(false);
          return;
        }
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
              const evt = JSON.parse(chunk.slice(5).trim());
              if (evt.type === 'start') {
                setRescanInfo(`同步 ${evt.groups} 群 · ${evt.since} ~ ${evt.until}`);
              } else if (evt.type === 'progress') {
                const pct = Math.floor((evt.done / evt.total) * 100);
                setRescanInfo(
                  `同步中 ${evt.done}/${evt.total} (${pct}%) · 已存 ${evt.inserted_messages ?? 0} 条 · ${evt.current ?? ''}`,
                );
              } else if (evt.type === 'done' || evt.type === 'finished') {
                setRescanInfo(
                  `完成 · ${evt.messages ?? evt.inserted_messages ?? 0} 条消息已入库`,
                );
              } else if (evt.type === 'topics_start') {
                setRescanInfo(`消息已入库 · 开始构建 ${evt.dates} 天话题`);
              } else if (evt.type === 'topics_date') {
                setRescanInfo(`构建话题 · ${evt.date}`);
              } else if (typeof evt.type === 'string' && evt.type.startsWith('topics_')) {
                setRescanInfo(`构建话题 · ${evt.date}${evt.message ? ` · ${evt.message}` : ''}`);
              }
            } catch {}
          }
        }
      } catch (e) {
        setRescanInfo('重扫失败：' + (e instanceof Error ? e.message : 'unknown'));
      } finally {
        setRescanning(false);
        reload();
      }
    },
    [range, date, reload],
  );

  if (!setupChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)] text-[12px] text-[var(--text-3)]">
        加载配置…
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />

      <main className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          range={range}
          date={date}
          onRangeChange={setRange}
          onDateChange={setDate}
          rescanning={rescanning}
          onRescan={() => runRescan(false)}
          onFullSync={() => runRescan(true)}
          rescanInfo={rescanInfo ?? infoLine(stats)}
        />

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <StewardTodoCard state={stewardState} />

          <StatGrid cards={stats?.cards} days={stats?.window.days ?? 7} />

          <div className="mt-4">
            <IntelligenceBrief intelligence={stats?.intelligence} />
          </div>

          <div className="mt-4">
            <TrendChart
              data={stats?.trend.data ?? []}
              peak={stats?.trend.peak ?? { date: '', count: 0 }}
              avg={stats?.trend.avg ?? 0}
              total={stats?.trend.total ?? 0}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[1.4fr_1fr]">
            <ActiveGroupsList groups={stats?.active_groups ?? []} date={stats?.window.until ?? date} />
            <CategoryChart categories={stats?.categories ?? []} />
          </div>
        </div>
      </main>
    </div>
  );
}

function StewardTodoCard({ state }: { state: StewardTodoState | null }) {
  if (!state?.available) return null;
  if (state.active_todos <= 0 && state.urgent_unresolved <= 0 && state.unacked_todos <= 0) return null;

  return (
    <section className="mb-4 overflow-hidden rounded-md border border-[rgba(223,107,107,0.36)] bg-[linear-gradient(135deg,rgba(223,107,107,0.16),rgba(213,162,83,0.08),rgba(255,255,255,0.02))]">
      <div className="grid gap-4 px-5 py-4 lg:grid-cols-[260px_1fr]">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--danger)]">
            <AlertTriangle size={15} />
            管家待办
          </div>
          <div className="mt-2 text-[34px] font-semibold leading-none tracking-normal text-[var(--danger)]">
            {state.urgent_unresolved}
            <span className="ml-2 align-middle text-[15px] font-medium text-[var(--text)]">件紧急未处理</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded bg-[var(--surface)] px-2 py-1 text-[var(--text-2)]">Active {state.active_todos}</span>
            <span className="rounded bg-[var(--warn-soft)] px-2 py-1 text-[var(--warn)]">未确认 {state.unacked_todos}</span>
            {state.updated_at ? (
              <span className="rounded bg-[var(--surface)] px-2 py-1 text-[var(--text-3)]">
                {formatStateTime(state.updated_at)}
              </span>
            ) : null}
          </div>
        </div>

        {state.urgent_items.length > 0 ? (
          <div className="grid gap-2">
            {state.urgent_items.slice(0, 5).map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-md border border-[rgba(223,107,107,0.22)] bg-[rgba(0,0,0,0.08)] px-3 py-2 text-[12px]">
                <BellDot size={13} className="shrink-0 text-[var(--danger)]" />
                <div className="min-w-0 flex-1 truncate font-medium">{item.title}</div>
                {item.contact ? <div className="shrink-0 text-[10px] text-[var(--text-3)]">{item.contact}</div> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatStateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${m}-${d} ${hh}:${mm}`;
}

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function infoLine(stats: StatsResponse | null) {
  if (!stats) return undefined;
  return `${stats.window.since} ~ ${stats.window.until} · 共 ${stats.cards.total_groups} 个群`;
}

async function fetchStats(range: RangeKey, date: string): Promise<StatsResponse> {
  const r = await fetch(`/api/stats?range=${range}&date=${date}`, { cache: 'no-store' });
  const text = await r.text();
  if (!text.trim()) {
    throw new Error(`/api/stats returned an empty response (${r.status})`);
  }
  const j = JSON.parse(text) as StatsResponse;
  if (!r.ok || !j.ok) {
    throw new Error(j.error ?? `/api/stats failed (${r.status})`);
  }
  return j;
}
