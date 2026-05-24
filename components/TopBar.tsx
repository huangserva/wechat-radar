'use client';

import { Calendar, RefreshCw, Database } from 'lucide-react';

export type RangeKey = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
export type RefreshMode = 'auto' | 'hour' | 'day' | 'week';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'quarter', label: '季' },
  { key: 'year', label: '年' },
  { key: 'custom', label: '自定义' },
];

const MODES: { key: RefreshMode; label: string }[] = [
  { key: 'auto', label: '自动' },
  { key: 'hour', label: '时' },
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
];

export default function TopBar({
  range,
  date,
  onRangeChange,
  onDateChange,
  mode,
  onModeChange,
  rescanning,
  onRescan,
  onFullSync,
  rescanInfo,
}: {
  range: RangeKey;
  date: string;
  onRangeChange: (r: RangeKey) => void;
  onDateChange: (date: string) => void;
  mode: RefreshMode;
  onModeChange: (m: RefreshMode) => void;
  rescanning: boolean;
  onRescan: () => void;
  onFullSync?: () => void;
  rescanInfo?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-soft)] bg-[rgba(8,13,10,0.74)] px-6 py-3 backdrop-blur">
      <div>
        <div className="report-kicker">Daily Intelligence</div>
        <div className="mt-1 text-[16px] font-semibold tracking-wide">微信雷达 · 情报看板</div>
        <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
          {rescanInfo ?? '尚未扫描，点击「重扫」加载数据'}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="control-surface flex items-center gap-1.5 rounded-md px-2.5 py-1.5">
          <Calendar size={13} className="text-[var(--text-3)]" />
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="bg-transparent text-[12px] outline-none [color-scheme:dark]"
            title="按日期查看微信雷达"
          />
        </div>

        <SegGroup>
          {RANGES.map((r) => (
            <SegBtn key={r.key} active={range === r.key} onClick={() => onRangeChange(r.key)}>
              {r.label}
            </SegBtn>
          ))}
        </SegGroup>

        <SegGroup>
          {MODES.map((m) => (
            <SegBtn key={m.key} active={mode === m.key} onClick={() => onModeChange(m.key)}>
              {m.label}
            </SegBtn>
          ))}
        </SegGroup>

        {onFullSync && (
          <button
            className="btn"
            onClick={onFullSync}
            disabled={rescanning}
            title="一次性同步过去 365 天的所有消息到本地数据库"
          >
            <Database size={13} />
            <span>全量同步</span>
          </button>
        )}

        <button
          className={`btn ${rescanning ? 'btn-warn' : 'btn-primary'}`}
          onClick={onRescan}
          disabled={rescanning}
        >
          <RefreshCw size={13} className={rescanning ? 'animate-spin' : ''} />
          <span>{rescanning ? '同步中…' : '重扫'}</span>
        </button>
      </div>
    </div>
  );
}

function SegGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="control-surface flex overflow-hidden rounded-md">
      {children}
    </div>
  );
}

function SegBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'text-[var(--text-2)] hover:text-[var(--text)]'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
