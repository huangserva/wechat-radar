'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import {
  ChevronDown,
  ChevronUp,
  Database,
  Ghost,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';

type SilenceStatus = 'never' | 'silent_30d' | 'occasional' | 'active';

type SilenceMember = {
  wxid: string;
  nick_name: string;
  remark: string;
  display_name: string;
  last_spoken_ts: number | null;
  days_since: number | null;
  status: SilenceStatus;
};

type GroupSilence = {
  chatroom_id: string;
  group_name: string;
  total_members: number;
  active_count: number;
  occasional_count: number;
  silent_30d_count: number;
  never_count: number;
  top_silent: SilenceMember[];
};

type SilenceResp = {
  ok: boolean;
  available: boolean;
  groups: GroupSilence[];
  summary: {
    total_groups: number;
    total_members: number;
    total_silent: number;
    total_never: number;
  };
  error?: string;
};

const STATUS_LABEL: Record<SilenceStatus, string> = {
  never: '从未发言',
  silent_30d: '沉默 >30天',
  occasional: '偶尔 7-30天',
  active: '活跃 <7天',
};

const STATUS_COLOR: Record<SilenceStatus, string> = {
  never: 'bg-[var(--danger)]',
  silent_30d: 'bg-[var(--warn)]',
  occasional: 'bg-[var(--text-3)]',
  active: 'bg-[var(--accent)]',
};

export default function SilencePage() {
  const [data, setData] = useState<SilenceResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/silence', { cache: 'no-store' });
        const j = (await r.json()) as SilenceResp;
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
            <div className="report-kicker">Silence Analysis</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <Ghost size={17} className="text-[var(--warn)]" />
              <span>沉默成员分析</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {loading ? '加载中…' : data?.available ? `${data.summary.total_groups} 个群 · ${data.summary.total_silent + data.summary.total_never} 人沉默` : '数据不可用'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-2)] xl:flex">
              <Database size={13} className="text-[var(--accent)]" />
              <span>contact.db + radar.db</span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <EmptyState title="加载失败" text={error} tall />
          ) : loading ? (
            <LoadingState />
          ) : !data?.available ? (
            <EmptyState title="无数据" text="需要 contact.db 和 radar.db 同步数据才能分析沉默成员。" tall />
          ) : (
            <SilenceContent data={data} />
          )}
        </div>
      </main>
    </div>
  );
}

function SilenceContent({ data }: { data: SilenceResp }) {
  return (
    <div className="space-y-5">
      <SummaryTiles summary={data.summary} />
      <div className="space-y-3">
        {data.groups.map((g) => (
          <GroupCard key={g.chatroom_id} group={g} />
        ))}
      </div>
    </div>
  );
}

function SummaryTiles({ summary }: { summary: SilenceResp['summary'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Tile icon={<Users size={15} />} label="分析群数" value={String(summary.total_groups)} sub={`${summary.total_members} 名成员`} />
      <Tile icon={<Volume2 size={15} />} label="活跃成员" value={String(summary.total_members - summary.total_silent - summary.total_never)} sub="7 天内有发言" accent="good" />
      <Tile icon={<VolumeX size={15} />} label="沉默 >30天" value={String(summary.total_silent)} sub={`${pct(summary.total_silent, summary.total_members)} 的成员`} accent="bad" />
      <Tile icon={<Ghost size={15} />} label="从未发言" value={String(summary.total_never)} sub={`${pct(summary.total_never, summary.total_members)} 的成员`} accent="bad" />
    </div>
  );
}

function Tile({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent?: 'good' | 'bad' }) {
  const cls = accent === 'good' ? 'text-[var(--accent)]' : accent === 'bad' ? 'text-[var(--danger)]' : '';
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-2)]">{icon}{label}</div>
      <div className={`mt-2 text-[28px] font-semibold leading-none tabular-nums ${cls}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-[var(--text-3)]">{sub}</div>
    </div>
  );
}

function GroupCard({ group }: { group: GroupSilence }) {
  const [expanded, setExpanded] = useState(false);
  const silentTotal = group.never_count + group.silent_30d_count;
  const silentPct = pct(silentTotal, group.total_members);

  return (
    <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-[var(--surface-2)]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            {silentTotal > 0 ? <VolumeX size={14} className="shrink-0 text-[var(--danger)]" /> : <Volume2 size={14} className="shrink-0 text-[var(--accent)]" />}
            <span className="truncate">{group.group_name}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--text-3)]">{group.chatroom_id}</div>
          <div className="mt-1 text-[11px] text-[var(--text-3)]">
            {group.total_members} 成员 · {silentPct} 沉默/从未
          </div>
        </div>

        {/* Distribution bar */}
        <div className="flex w-[200px] shrink-0 items-center gap-2">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            {(['active', 'occasional', 'silent_30d', 'never'] as SilenceStatus[]).map((s) => {
              const count = s === 'active' ? group.active_count : s === 'occasional' ? group.occasional_count : s === 'silent_30d' ? group.silent_30d_count : group.never_count;
              const w = group.total_members > 0 ? (count / group.total_members) * 100 : 0;
              if (w === 0) return null;
              return <div key={s} className={`h-full ${STATUS_COLOR[s]}`} style={{ width: `${w}%` }} title={`${STATUS_LABEL[s]}: ${count}`} />;
            })}
          </div>
          {expanded ? <ChevronUp size={14} className="shrink-0 text-[var(--text-3)]" /> : <ChevronDown size={14} className="shrink-0 text-[var(--text-3)]" />}
        </div>
      </button>

      {/* Legend */}
      <div className="flex gap-3 border-t border-[var(--border-soft)] px-4 py-1.5 text-[10px] text-[var(--text-3)]">
        <span className="flex items-center gap-1"><span className={`inline-block size-2 rounded-full ${STATUS_COLOR.active}`} />活跃 {group.active_count}</span>
        <span className="flex items-center gap-1"><span className={`inline-block size-2 rounded-full ${STATUS_COLOR.occasional}`} />偶尔 {group.occasional_count}</span>
        <span className="flex items-center gap-1"><span className={`inline-block size-2 rounded-full ${STATUS_COLOR.silent_30d}`} />沉默 {group.silent_30d_count}</span>
        <span className="flex items-center gap-1"><span className={`inline-block size-2 rounded-full ${STATUS_COLOR.never}`} />从未 {group.never_count}</span>
      </div>

      {expanded && (
        <div className="border-t border-[var(--border-soft)] p-3">
          {group.top_silent.length === 0 ? (
            <div className="py-4 text-center text-[12px] text-[var(--text-3)]">该群无沉默成员数据</div>
          ) : (
            <div className="space-y-1">
              <div className="px-2 pb-1 text-[11px] font-semibold text-[var(--text-2)]">沉默 Top {group.top_silent.length}</div>
              {group.top_silent.map((m) => (
                <div key={m.wxid} className="flex items-center gap-3 rounded px-2 py-1.5 text-[11px]">
                  <span className={`inline-block size-2 shrink-0 rounded-full ${STATUS_COLOR[m.status]}`} />
                  <span className="w-[140px] shrink-0 truncate font-medium text-[var(--text)]">{m.display_name}</span>
                  <span className="w-[120px] shrink-0 truncate text-[var(--text-3)]">{m.nick_name !== m.display_name ? m.nick_name : ''}</span>
                  <span className="flex-1 text-[var(--text-3)]">
                    {m.status === 'never' ? '从未发言' : m.days_since != null ? `${m.days_since} 天前` : '—'}
                  </span>
                  {m.last_spoken_ts && (
                    <span className="shrink-0 text-[var(--text-3)]">{formatDate(m.last_spoken_ts)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
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
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface)]" />
        ))}
      </div>
    </div>
  );
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
