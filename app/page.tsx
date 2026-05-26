'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import TopBar, { type RangeKey } from '@/components/TopBar';
import StatGrid, { type CardsData } from '@/components/StatGrid';
import TrendChart, { type TrendPoint } from '@/components/TrendChart';
import ActiveGroupsList, { type ActiveGroup } from '@/components/ActiveGroupsList';
import CategoryChart, { type CategoryStat } from '@/components/CategoryChart';
import IntelligenceBrief, { type DashboardIntelligence } from '@/components/IntelligenceBrief';

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

export default function Page() {
  const [range, setRange] = useState<RangeKey>('month');
  const [date, setDate] = useState(() => localToday());
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanInfo, setRescanInfo] = useState<string | undefined>(undefined);
  const [setupChecked, setSetupChecked] = useState(false);

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
