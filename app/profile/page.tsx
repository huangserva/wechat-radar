'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import {
  Activity,
  CalendarClock,
  Database,
  FileText,
  History,
  Layers3,
  ShieldAlert,
  Sparkles,
  UserCircle,
} from 'lucide-react';

type ProfileFinding = {
  finding: string;
  confidence: string;
  source_count: number;
  first_seen: string | null;
  last_seen: string | null;
  evidence_count: number;
};

type ProfileDimension = {
  key: string;
  label: string;
  description: string;
  count: number;
  findings: ProfileFinding[];
};

type SnapshotDate = {
  date: string;
  total_conclusions: number;
  dimensions: Array<{ key: string; label: string; count: number }>;
};

type ProfileUpdate = {
  date: string;
  action: string;
  source_count: number | null;
  writing_samples: number | null;
  new_conclusions: number | null;
};

type ProfileResp = {
  ok: boolean;
  available: boolean;
  source: 'json' | 'missing';
  source_path: string | null;
  assistant_db_path: string;
  owner_wxid: string | null;
  version: number | null;
  created: string | null;
  last_updated: string | null;
  data_until: string | null;
  total_conclusions: number;
  dimension_count: number;
  stats: {
    total_analyzed: number | null;
    total_writing_samples: number | null;
    last_analysis_date: string | null;
  };
  privacy_notice: string;
  dimensions: ProfileDimension[];
  snapshots: {
    available: boolean;
    rows: number;
    dates: number;
    latest_date: string | null;
    history: SnapshotDate[];
  };
  update_history: ProfileUpdate[];
  error?: string;
};

export default function ProfilePage() {
  const [data, setData] = useState<ProfileResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/profile', { cache: 'no-store' });
        const j = (await r.json()) as ProfileResp;
        if (cancelled) return;
        if (!j.ok) throw new Error(j.error ?? '加载失败');
        setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const versionText = data?.version ? `v${data.version}` : '未标版本';
  const untilText = data?.data_until ?? data?.last_updated ?? '—';

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="report-kicker">Owner Profile</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <UserCircle size={17} className="text-[var(--accent)]" />
              <span>我的画像 · 主人用户画像</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {loading ? '加载中…' : `${versionText} · ${data?.total_conclusions ?? 0} 条结论 · 数据截至 ${untilText}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-2)] xl:flex">
              <Database size={13} className="text-[var(--accent)]" />
              <span>{data?.source === 'json' ? 'profile json + assistant.db' : 'profile 暂缺'}</span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <EmptyState title="画像加载失败" text={error} tall />
          ) : loading ? (
            <LoadingState />
          ) : !data?.available ? (
            <EmptyState
              title="画像文件暂不可读"
              text={`未找到 ${data?.source_path ?? 'profile/*_profile.json'}；页面会保持空态，不写入任何数据。`}
              tall
            />
          ) : (
            <ProfileContent data={data} />
          )}
        </div>
      </main>
    </div>
  );
}

function ProfileContent({ data }: { data: ProfileResp }) {
  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[rgba(213,162,83,0.32)] bg-[var(--warn-soft)] px-4 py-3 text-[12px] leading-6 text-[var(--text-2)]">
        <div className="flex items-center gap-2 font-semibold text-[var(--warn)]">
          <ShieldAlert size={14} />
          隐私与边界
        </div>
        <div className="mt-1">{data.privacy_notice}</div>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard icon={<Sparkles size={14} />} label="画像版本" value={data.version ? `v${data.version}` : '—'} sub={`创建 ${data.created ?? '—'}`} />
        <MetricCard icon={<FileText size={14} />} label="总结论" value={data.total_conclusions} sub={`${data.dimension_count} 个维度`} />
        <MetricCard icon={<Activity size={14} />} label="分析素材" value={data.stats.total_analyzed ?? '—'} sub={`写作样本 ${data.stats.total_writing_samples ?? '—'}`} />
        <MetricCard icon={<History size={14} />} label="快照历史" value={data.snapshots.rows} sub={`${data.snapshots.dates} 个日期 · 最新 ${data.snapshots.latest_date ?? '—'}`} />
      </div>

      <section className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        {data.dimensions.map((dimension) => (
          <DimensionPanel key={dimension.key} dimension={dimension} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 2xl:grid-cols-[1.3fr_0.7fr]">
        <SnapshotPanel snapshots={data.snapshots} />
        <UpdatePanel updates={data.update_history} lastUpdated={data.last_updated} ownerWxid={data.owner_wxid} />
      </section>
    </div>
  );
}

function DimensionPanel({ dimension }: { dimension: ProfileDimension }) {
  return (
    <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-soft)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Layers3 size={14} className="text-[var(--accent)]" />
            <span>{dimension.label}</span>
          </div>
          <div className="mt-1 text-[11px] leading-5 text-[var(--text-3)]">{dimension.description}</div>
        </div>
        <span className="signal-chip shrink-0 rounded px-2 py-1 text-[11px]">{dimension.count} 条</span>
      </div>
      <div className="space-y-2 p-3">
        {dimension.findings.length === 0 ? (
          <SmallEmpty text="该维度暂无结论。" />
        ) : (
          dimension.findings.map((finding, index) => (
            <FindingCard key={`${dimension.key}-${index}`} finding={finding} />
          ))
        )}
      </div>
    </section>
  );
}

function FindingCard({ finding }: { finding: ProfileFinding }) {
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2.5">
      <div className="text-[12px] font-medium leading-6 text-[var(--text)]">{finding.finding}</div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <ConfidenceChip confidence={finding.confidence} />
        <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[var(--text-3)]">来源 {finding.source_count}</span>
        <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[var(--text-3)]">证据 {finding.evidence_count} 条未展开</span>
        <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[var(--text-3)]">
          {finding.first_seen ?? '—'} → {finding.last_seen ?? '—'}
        </span>
      </div>
    </div>
  );
}

function ConfidenceChip({ confidence }: { confidence: string }) {
  const label = confidence === 'high' ? '高置信' : confidence === 'medium' ? '中置信' : confidence === 'low' ? '低置信' : confidence || '未知';
  const tone =
    confidence === 'high'
      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
      : confidence === 'medium'
        ? 'bg-[var(--warn-soft)] text-[var(--warn)]'
        : 'bg-[var(--surface)] text-[var(--text-3)]';
  return <span className={`rounded px-1.5 py-0.5 ${tone}`}>{label}</span>;
}

function SnapshotPanel({ snapshots }: { snapshots: ProfileResp['snapshots'] }) {
  return (
    <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <CalendarClock size={14} className="text-[var(--accent)]" />
          快照历史
        </div>
        <div className="text-[10px] text-[var(--text-3)]">profile_snapshots · {snapshots.rows} 行</div>
      </div>
      <div className="space-y-2 p-3">
        {!snapshots.available || snapshots.history.length === 0 ? (
          <SmallEmpty text="assistant.db profile_snapshots 暂无可读历史。" />
        ) : (
          snapshots.history.map((snapshot) => <SnapshotRow key={snapshot.date} snapshot={snapshot} />)
        )}
      </div>
    </section>
  );
}

function SnapshotRow({ snapshot }: { snapshot: SnapshotDate }) {
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] font-semibold">{snapshot.date}</div>
        <div className="text-[10px] text-[var(--text-3)]">{snapshot.total_conclusions} 条结论</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {snapshot.dimensions.map((dim) => (
          <span key={dim.key} className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-2)]">
            {dim.label} {dim.count}
          </span>
        ))}
      </div>
    </div>
  );
}

function UpdatePanel({ updates, lastUpdated, ownerWxid }: { updates: ProfileUpdate[]; lastUpdated: string | null; ownerWxid: string | null }) {
  return (
    <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
        <div className="text-[13px] font-semibold">版本记录</div>
        <div className="text-[10px] text-[var(--text-3)]">更新 {lastUpdated ?? '—'}</div>
      </div>
      <div className="p-3">
        <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 text-[11px] leading-5 text-[var(--text-3)]">
          主人 wxid：{ownerWxid ?? '未配置'}。当前面板仅读取 profile JSON 与 assistant.db 快照，不调用 LLM，也不展开原始证据。
        </div>
        <div className="mt-3 space-y-2">
          {updates.length === 0 ? (
            <SmallEmpty text="profile JSON 暂无 update_history。" />
          ) : (
            updates.map((item, index) => (
              <div key={`${item.date}-${index}`} className="rounded-md border border-[var(--border-soft)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-medium">{item.action || '画像更新'}</div>
                  <div className="text-[10px] text-[var(--text-3)]">{item.date || '—'}</div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-[var(--text-3)]">
                  <span>来源 {item.source_count ?? '—'}</span>
                  <span>写作样本 {item.writing_samples ?? '—'}</span>
                  {item.new_conclusions != null ? <span>新增结论 {item.new_conclusions}</span> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number | string; sub: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-2)]">
        <span className="flex items-center gap-1.5 text-[var(--text-2)]">
          {icon}
          {label}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-3)]">Profile</span>
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-[var(--text-3)]">{sub}</div>
    </div>
  );
}

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
    <div className="space-y-4">
      <div className="h-[78px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface)]" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-[96px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-[260px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface)]" />
        ))}
      </div>
    </div>
  );
}
