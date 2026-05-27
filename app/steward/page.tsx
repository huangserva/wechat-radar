'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  HardDrive,
  Layers3,
  Shield,
  XCircle,
  Zap,
} from 'lucide-react';

type ScanLogEntry = {
  id: number;
  scan_ts: number | null;
  scan_date: string;
  scan_type: string;
  status: string;
  message: string;
  groups_count: number | null;
  messages_count: number | null;
  duration_ms: number | null;
};

type ScanTypeSummary = {
  scan_type: string;
  total: number;
  ok_count: number;
  error_count: number;
  latest_ok: ScanLogEntry | null;
  latest_run: ScanLogEntry | null;
};

type HealthScore = {
  score: number;
  verdict: string;
  tone: 'good' | 'warn' | 'bad';
  breakdown: {
    freshness: { score: number; max: number; detail: string };
    scan_errors: { score: number; max: number; detail: string };
    sync_errors: { score: number; max: number; detail: string };
    coverage: { score: number; max: number; detail: string };
  };
};

type StewardResp = {
  ok: boolean;
  available: boolean;
  health: HealthScore;
  assistant_db_path: string;
  radar_db_path: string;
  scan_log: {
    available: boolean;
    total: number;
    recent: ScanLogEntry[];
    by_type: ScanTypeSummary[];
    failures: ScanLogEntry[];
  };
  sync: {
    total_chatrooms: number;
    ok_count: number;
    error_count: number;
    total_messages: number;
    latest_sync_ts: number | null;
  };
  freshness: {
    latest_message_date: string | null;
    latest_topic_date: string | null;
    latest_message_age_days: number | null;
    latest_topic_age_days: number | null;
  };
  coverage: {
    stats_days: number;
    stats_chatrooms: number;
    stats_min_date: string | null;
    stats_max_date: string | null;
  };
  snapshots: {
    total_rows: number;
    latest_date: string | null;
  };
  meta: Record<string, string>;
  error?: string;
};

export default function StewardPage() {
  const [data, setData] = useState<StewardResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/steward', { cache: 'no-store' });
        const j = (await r.json()) as StewardResp;
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
            <div className="report-kicker">Steward Health</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <Shield size={17} className="text-[var(--accent)]" />
              <span>管家体检报告</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {loading ? '加载中…' : data?.health.verdict ?? '—'}
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
          ) : !data ? (
            <EmptyState title="无数据" text="无法获取管家状态" tall />
          ) : (
            <StewardContent data={data} />
          )}
        </div>
      </main>
    </div>
  );
}

function StewardContent({ data }: { data: StewardResp }) {
  return (
    <div className="space-y-5">
      <HealthCard health={data.health} />
      <TileGrid data={data} />
      <ScanTimeline scanLog={data.scan_log} />
    </div>
  );
}

// ---- Health score card ------------------------------------------------------

function HealthCard({ health }: { health: HealthScore }) {
  const ringColor = health.tone === 'good' ? 'var(--accent)' : health.tone === 'warn' ? 'var(--warn)' : 'var(--danger)';
  const textColor = health.tone === 'good' ? 'text-[var(--accent)]' : health.tone === 'warn' ? 'text-[var(--warn)]' : 'text-[var(--danger)]';
  const bgColor = health.tone === 'good' ? 'bg-[var(--accent-soft)]' : health.tone === 'warn' ? 'bg-[var(--warn-soft)]' : 'bg-red-500/10';

  return (
    <section className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="relative flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(${ringColor} ${health.score * 3.6}deg, var(--surface-2) 0deg)` }}>
          <div className="flex h-[96px] w-[96px] flex-col items-center justify-center rounded-full bg-[var(--surface)]">
            <span className={`text-[36px] font-bold leading-none tabular-nums ${textColor}`}>{health.score}</span>
            <span className="mt-0.5 text-[10px] text-[var(--text-3)]">/100</span>
          </div>
        </div>

        <div className="flex-1 text-center sm:text-left">
          <div className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[14px] font-semibold ${bgColor} ${textColor}`}>
            {health.tone === 'good' ? <CheckCircle2 size={15} /> : health.tone === 'warn' ? <Clock size={15} /> : <XCircle size={15} />}
            {health.verdict}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
            <BreakdownRow label="数据新鲜度" b={health.breakdown.freshness} />
            <BreakdownRow label="扫描状态" b={health.breakdown.scan_errors} />
            <BreakdownRow label="同步健康" b={health.breakdown.sync_errors} />
            <BreakdownRow label="覆盖完整度" b={health.breakdown.coverage} />
          </div>
        </div>
      </div>
    </section>
  );
}

function BreakdownRow({ label, b }: { label: string; b: { score: number; max: number; detail: string } }) {
  const pct = b.max > 0 ? b.score / b.max : 1;
  const barColor = pct >= 0.8 ? 'bg-[var(--accent)]' : pct >= 0.5 ? 'bg-[var(--warn)]' : 'bg-[var(--danger)]';
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[var(--text-2)]">{label}</span>
        <span className="tabular-nums text-[var(--text-3)]">{b.score}/{b.max}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--text-3)]">{b.detail}</div>
    </div>
  );
}

// ---- 4 metric tiles ---------------------------------------------------------

function TileGrid({ data }: { data: StewardResp }) {
  const latestScan = data.scan_log.recent[0] ?? null;
  const scanOk = latestScan?.status === 'ok';
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Tile
        icon={<Layers3 size={15} />}
        label="同步群数"
        value={String(data.sync.total_chatrooms)}
        sub={`${data.sync.ok_count} 正常 · ${data.sync.error_count} 异常`}
        accent={data.sync.error_count > 0 ? 'bad' : 'good'}
      />
      <Tile
        icon={<Zap size={15} />}
        label="数据新鲜度"
        value={data.freshness.latest_message_age_days != null ? `${data.freshness.latest_message_age_days} 天` : '—'}
        sub={`消息 ${data.freshness.latest_message_date ?? '—'} · 话题 ${data.freshness.latest_topic_age_days ?? '—'} 天前`}
        accent={data.freshness.latest_message_age_days != null && data.freshness.latest_message_age_days <= 1 ? 'good' : data.freshness.latest_message_age_days != null && data.freshness.latest_message_age_days > 3 ? 'bad' : 'neutral'}
      />
      <Tile
        icon={<HardDrive size={15} />}
        label="覆盖天数"
        value={String(data.coverage.stats_days)}
        sub={`${data.coverage.stats_chatrooms} 群 · ${data.coverage.stats_min_date ?? '—'} → ${data.coverage.stats_max_date ?? '—'}`}
      />
      <Tile
        icon={scanOk ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
        label="最近扫描"
        value={latestScan ? latestScan.status.toUpperCase() : '—'}
        sub={latestScan ? `${latestScan.scan_date} · ${latestScan.scan_type} · ${formatDuration(latestScan.duration_ms)}` : '暂无记录'}
        accent={scanOk ? 'good' : latestScan ? 'bad' : 'neutral'}
      />
    </div>
  );
}

function Tile({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent?: 'good' | 'bad' | 'neutral' }) {
  const valClass = accent === 'good' ? 'text-[var(--accent)]' : accent === 'bad' ? 'text-[var(--danger)]' : '';
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-2)]">{icon}{label}</div>
      <div className={`mt-2 text-[28px] font-semibold leading-none tabular-nums ${valClass}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-[var(--text-3)]">{sub}</div>
    </div>
  );
}

// ---- Scan timeline ----------------------------------------------------------

function ScanTimeline({ scanLog }: { scanLog: StewardResp['scan_log'] }) {
  const [expanded, setExpanded] = useState(false);
  const hasFailures = scanLog.failures.length > 0;

  return (
    <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Activity size={14} className="text-[var(--accent)]" />
          扫描时间线
        </div>
        <div className="text-[10px] text-[var(--text-3)]">scan_log · {scanLog.total} 条</div>
      </div>

      <div className="p-4 space-y-3">
        {/* Failures pinned at top */}
        {hasFailures && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-[var(--danger)]">异常记录</div>
            {scanLog.failures.map((entry) => (
              <FailureRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        {/* Aggregated by type */}
        {scanLog.by_type.length === 0 ? (
          <SmallEmpty text="scan_log 表暂无数据。" />
        ) : (
          <div className="space-y-2">
            {!hasFailures && (
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--accent)]">
                <CheckCircle2 size={13} />
                近 {Math.min(scanLog.total, scanLog.recent.length)} 次扫描全部正常
              </div>
            )}
            {scanLog.by_type.map((ts) => (
              <TypeRow key={ts.scan_type} ts={ts} />
            ))}
          </div>
        )}

        {/* Expandable raw list */}
        {scanLog.total > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex w-full items-center justify-between rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 text-[11px] text-[var(--text-2)] hover:bg-[var(--surface)]"
            >
              <span>展开查看全部 {scanLog.total} 条原始记录</span>
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {expanded && <ExpandedLog recent={scanLog.recent} />}
          </div>
        )}
      </div>
    </section>
  );
}

function FailureRow({ entry }: { entry: ScanLogEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--danger)]/30 bg-red-500/5 px-3 py-2">
      <XCircle size={14} className="shrink-0 text-[var(--danger)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-medium">{entry.scan_date}</span>
          <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">{entry.scan_type}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-[var(--danger)]">{entry.message || '无错误信息'}</div>
      </div>
    </div>
  );
}

function TypeRow({ ts }: { ts: ScanTypeSummary }) {
  const hasErrors = ts.error_count > 0;
  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2.5">
      <div className="shrink-0">
        {hasErrors ? (
          <XCircle size={14} className="text-[var(--warn)]" />
        ) : (
          <CheckCircle2 size={14} className="text-[var(--accent)]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span>{ts.scan_type}</span>
          <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">{ts.total} 次</span>
          {hasErrors && (
            <span className="rounded bg-[var(--warn-soft)] px-1.5 py-0.5 text-[10px] text-[var(--warn)]">{ts.error_count} 次失败</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-[var(--text-3)]">
          {ts.latest_ok && (
            <span>最近成功：{ts.latest_ok.scan_date} · {ts.latest_ok.message || '—'}</span>
          )}
          {ts.latest_run && ts.latest_run !== ts.latest_ok && (
            <span>最近运行：{ts.latest_run.scan_date} · {ts.latest_run.status}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ExpandedLog({ recent }: { recent: ScanLogEntry[] }) {
  return (
    <div className="mt-2 max-h-[400px] space-y-1 overflow-y-auto rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] p-2">
      {recent.map((entry) => (
        <div key={entry.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px]">
          {entry.status === 'ok' ? (
            <CheckCircle2 size={12} className="shrink-0 text-[var(--accent)]" />
          ) : (
            <XCircle size={12} className="shrink-0 text-[var(--danger)]" />
          )}
          <span className="w-[80px] shrink-0 text-[var(--text-3)]">{entry.scan_date}</span>
          <span className="w-[90px] shrink-0 rounded bg-[var(--surface)] px-1 py-0.5 text-[10px] text-[var(--text-3)]">{entry.scan_type}</span>
          <span className="flex-1 truncate text-[var(--text-2)]">{entry.message || '—'}</span>
          <span className="shrink-0 text-[var(--text-3)]">{formatDuration(entry.duration_ms)}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Shared components ------------------------------------------------------

function SmallEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--border-soft)] px-3 py-8 text-center text-[12px] text-[var(--text-3)]">
      {text}
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
    <div className="space-y-5">
      <div className="h-[160px] animate-pulse rounded-lg border border-[var(--border-soft)] bg-[var(--surface)]" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[96px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface)]" />
        ))}
      </div>
      <div className="h-[240px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface)]" />
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}
