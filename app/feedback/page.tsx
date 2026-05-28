'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  XCircle,
  Zap,
} from 'lucide-react';

type FeedbackResp = {
  ok: boolean;
  available: boolean;
  total: number;
  by_action: { acted: number; ignored: number; snoozed: number; unknown: number };
  by_type: Array<{ push_type: string; total: number; acted: number; ignored: number; snoozed: number }>;
  by_hour: Array<{ hour: number; total: number; acted: number; ignored: number }>;
  by_priority: Array<{ priority: string; total: number; acted: number; ignored: number }>;
  recent: Array<{ id: number; push_time: string; push_type: string; content_summary: string; inferred_action: string | null; priority: string | null }>;
  error?: string;
};

export default function FeedbackPage() {
  const [data, setData] = useState<FeedbackResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/feedback', { cache: 'no-store' });
        const j = (await r.json()) as FeedbackResp;
        if (cancelled) return;
        if (!j.ok) throw new Error(j.error ?? '加载失败');
        setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="report-kicker">Push Feedback</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <BarChart3 size={17} className="text-[var(--accent)]" />
              <span>推送效果</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {loading ? '加载中…' : data?.available ? `${data.total} 条推送记录` : '数据不可用'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-2)] xl:flex">
              <Database size={13} className="text-[var(--accent)]" />
              <span>assistant.db + radar.db</span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <EmptyState title="加载失败" text={error} tall />
          ) : loading ? (
            <LoadingState />
          ) : !data?.available ? (
            <EmptyState title="无数据" text="需要 assistant.db push_feedback 数据和 radar.db 推断结果。" tall />
          ) : (
            <FeedbackContent data={data} />
          )}
        </div>
      </main>
    </div>
  );
}

function FeedbackContent({ data }: { data: FeedbackResp }) {
  const actionTotal = data.by_action.acted + data.by_action.ignored + data.by_action.snoozed + data.by_action.unknown;
  return (
    <div className="space-y-5">
      {/* Big numbers */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <BigNum icon={<Zap size={15} />} label="推送总数" value={String(data.total)} sub={`${data.by_type.length} 种类型`} />
        <BigNum
          icon={<CheckCircle2 size={15} />}
          label="已处理 (acted)"
          value={String(data.by_action.acted)}
          sub={pct(data.by_action.acted, actionTotal)}
          accent="good"
        />
        <BigNum
          icon={<Eye size={15} />}
          label="延迟处理 (snoozed)"
          value={String(data.by_action.snoozed)}
          sub={pct(data.by_action.snoozed, actionTotal)}
          accent="warn"
        />
        <BigNum
          icon={<XCircle size={15} />}
          label="未处理 (ignored)"
          value={String(data.by_action.ignored)}
          sub={pct(data.by_action.ignored, actionTotal)}
          accent="bad"
        />
      </div>

      {/* Action distribution bar */}
      <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-4">
        <div className="mb-2 text-[12px] font-semibold text-[var(--text-2)]">推送效果分布</div>
        <div className="flex h-6 overflow-hidden rounded-full bg-[var(--surface-2)]">
          {data.by_action.acted > 0 && (
            <div className="flex items-center justify-center bg-[var(--accent)] text-[10px] font-semibold text-white" style={{ width: pct(data.by_action.acted, actionTotal) }} title={`acted: ${data.by_action.acted}`}>
              {data.by_action.acted}
            </div>
          )}
          {data.by_action.snoozed > 0 && (
            <div className="flex items-center justify-center bg-[var(--warn)] text-[10px] font-semibold text-white" style={{ width: pct(data.by_action.snoozed, actionTotal) }} title={`snoozed: ${data.by_action.snoozed}`}>
              {data.by_action.snoozed}
            </div>
          )}
          {data.by_action.ignored > 0 && (
            <div className="flex items-center justify-center bg-[var(--danger)] text-[10px] font-semibold text-white" style={{ width: pct(data.by_action.ignored, actionTotal) }} title={`ignored: ${data.by_action.ignored}`}>
              {data.by_action.ignored}
            </div>
          )}
          {data.by_action.unknown > 0 && (
            <div className="flex items-center justify-center bg-[var(--text-3)] text-[10px] font-semibold text-white" style={{ width: pct(data.by_action.unknown, actionTotal) }} title={`unknown: ${data.by_action.unknown}`}>
              {data.by_action.unknown}
            </div>
          )}
        </div>
        <div className="mt-2 flex gap-4 text-[10px] text-[var(--text-3)]">
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-[var(--accent)]" />已处理 {pct(data.by_action.acted, actionTotal)}</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-[var(--warn)]" />延迟 {pct(data.by_action.snoozed, actionTotal)}</span>
          <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-[var(--danger)]" />未处理 {pct(data.by_action.ignored, actionTotal)}</span>
          {data.by_action.unknown > 0 && <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-[var(--text-3)]" />未知 {pct(data.by_action.unknown, actionTotal)}</span>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Time heatmap */}
        <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-4">
          <div className="mb-3 text-[12px] font-semibold text-[var(--text-2)]">推送时段分布</div>
          <HourHeatmap hours={data.by_hour} />
        </section>

        {/* Type breakdown */}
        <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-4">
          <div className="mb-3 text-[12px] font-semibold text-[var(--text-2)]">按类型</div>
          <div className="space-y-2">
            {data.by_type.map((t) => (
              <TypeRow key={t.push_type} data={t} />
            ))}
          </div>
        </section>
      </div>

      {/* Priority breakdown */}
      <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-4">
        <div className="mb-3 text-[12px] font-semibold text-[var(--text-2)]">按优先级</div>
        <div className="flex flex-wrap gap-3">
          {data.by_priority.map((p) => (
            <div key={p.priority} className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 text-[11px]">
              <div className="font-medium text-[var(--text)]">{priorityLabel(p.priority)}</div>
              <div className="mt-1 text-[var(--text-3)]">{p.total} 条 · acted {p.acted} · ignored {p.ignored}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent list */}
      <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border-soft)] px-4 py-3 text-[12px] font-semibold text-[var(--text-2)]">最近 20 条推送</div>
        <div className="space-y-1 p-3">
          {data.recent.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded px-2 py-1.5 text-[11px]">
              {r.inferred_action === 'acted' ? (
                <CheckCircle2 size={12} className="shrink-0 text-[var(--accent)]" />
              ) : r.inferred_action === 'snoozed' ? (
                <Clock size={12} className="shrink-0 text-[var(--warn)]" />
              ) : r.inferred_action === 'ignored' ? (
                <XCircle size={12} className="shrink-0 text-[var(--danger)]" />
              ) : (
                <span className="size-2 shrink-0 rounded-full bg-[var(--text-3)]" />
              )}
              <span className="w-[60px] shrink-0 text-[var(--text-3)]">{r.push_type}</span>
              <span className="flex-1 truncate text-[var(--text-2)]">{r.content_summary}</span>
              <span className="shrink-0 text-[var(--text-3)]">{formatTime(r.push_time)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function HourHeatmap({ hours }: { hours: FeedbackResp['by_hour'] }) {
  const maxTotal = Math.max(1, ...hours.map((h) => h.total));
  return (
    <div className="grid grid-cols-12 gap-1">
      {hours.map((h) => {
        const intensity = h.total / maxTotal;
        const actedRate = h.total > 0 ? h.acted / h.total : 0;
        const bg = h.total === 0
          ? 'bg-[var(--surface-2)]'
          : actedRate > 0.5
            ? 'bg-[var(--accent)]'
            : actedRate > 0.2
              ? 'bg-[var(--warn)]'
              : 'bg-[var(--danger)]';
        return (
          <div
            key={h.hour}
            className={`flex h-10 flex-col items-center justify-center rounded text-[9px] ${bg}`}
            style={{ opacity: h.total === 0 ? 0.3 : 0.3 + intensity * 0.7 }}
            title={`${h.hour}:00 — ${h.total} 条, acted ${h.acted}, ignored ${h.ignored}`}
          >
            <span className="font-semibold text-white">{h.hour}</span>
            {h.total > 0 && <span className="text-white/70">{h.total}</span>}
          </div>
        );
      })}
    </div>
  );
}

function TypeRow({ data }: { data: { push_type: string; total: number; acted: number; ignored: number; snoozed: number } }) {
  return (
    <div className="flex items-center gap-3 rounded border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2">
      <span className="w-[80px] shrink-0 text-[12px] font-medium text-[var(--text)]">{data.push_type}</span>
      <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-[var(--surface)]">
        {data.acted > 0 && <div className="bg-[var(--accent)]" style={{ width: pct(data.acted, data.total) }} />}
        {data.snoozed > 0 && <div className="bg-[var(--warn)]" style={{ width: pct(data.snoozed, data.total) }} />}
        {data.ignored > 0 && <div className="bg-[var(--danger)]" style={{ width: pct(data.ignored, data.total) }} />}
      </div>
      <span className="w-8 text-right text-[11px] tabular-nums text-[var(--text-2)]">{data.total}</span>
    </div>
  );
}

function BigNum({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent?: 'good' | 'bad' | 'warn' }) {
  const cls = accent === 'good' ? 'text-[var(--accent)]' : accent === 'bad' ? 'text-[var(--danger)]' : accent === 'warn' ? 'text-[var(--warn)]' : '';
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-2)]">{icon}{label}</div>
      <div className={`mt-2 text-[28px] font-semibold leading-none tabular-nums ${cls}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-[var(--text-3)]">{sub}</div>
    </div>
  );
}

function EmptyState({ title, text, tall }: { title: string; text: string; tall?: boolean }) {
  return (
    <div className={`flex items-center justify-center rounded-md border border-dashed border-[var(--border-soft)] px-4 py-8 text-center ${tall ? 'min-h-[420px]' : ''}`}>
      <div>
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="mt-1 text-[11px] leading-5 text-[var(--text-3)]">{text}</div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[96px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface)]" />
        ))}
      </div>
      <div className="h-[120px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface)]" />
    </div>
  );
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

function priorityLabel(p: string): string {
  const map: Record<string, string> = { urgent: '紧急', normal: '普通', medium: '中等', none: '无', low: '低' };
  return map[p] ?? p;
}

function formatTime(t: string): string {
  try {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return t.slice(0, 16);
  }
}
