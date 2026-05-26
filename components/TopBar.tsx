'use client';

import { Calendar, RefreshCw, Database } from 'lucide-react';
import GlobalSearch from './GlobalSearch';

export type RangeKey = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'quarter', label: '季' },
  { key: 'year', label: '年' },
];

export default function TopBar({
  range,
  date,
  onRangeChange,
  onDateChange,
  rescanning,
  onRescan,
  onFullSync,
  rescanInfo,
}: {
  range: RangeKey;
  date: string;
  onRangeChange: (r: RangeKey) => void;
  onDateChange: (date: string) => void;
  rescanning: boolean;
  onRescan: () => void;
  onFullSync?: () => void;
  rescanInfo?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
      <div>
        <div className="report-kicker">Daily Intelligence</div>
        <div className="mt-1 text-[16px] font-semibold tracking-wide">驾驶舱 · 情报看板</div>
        <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
          {rescanInfo ?? '尚未扫描，点击「重扫」加载数据'}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <GlobalSearch />
        <div className="control-surface flex items-center gap-1.5 rounded-md px-2.5 py-1.5">
          <Calendar size={13} className="text-[var(--text-3)]" />
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="theme-date-input min-w-[128px] bg-transparent text-[12px] outline-none"
            title="按日期查看驾驶舱"
          />
        </div>

        <SegGroup>
          <span className="border-r border-[var(--border-soft)] px-2 py-1 text-[11px] text-[var(--text-3)]">
            范围
          </span>
          {RANGES.map((r) => (
            <SegBtn key={r.key} active={range === r.key} onClick={() => onRangeChange(r.key)}>
              {r.label}
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
