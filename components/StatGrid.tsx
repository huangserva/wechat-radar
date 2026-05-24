import Link from 'next/link';
import { Activity, MessageCircle, AtSign, MoonStar } from 'lucide-react';

export interface CardsData {
  active_groups: number;
  total_groups: number;
  total_messages: number;
  mentions: number;
  silent_groups: number;
  avg_per_group: number;
}

export default function StatGrid({ cards, days }: { cards?: CardsData; days: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card
        icon={<Activity size={14} className="text-[var(--accent)]" />}
        label="活跃群"
        value={cards?.active_groups ?? '—'}
        sub={cards ? `共扫 ${cards.total_groups} 个群` : '等待扫描'}
      />
      <Card
        icon={<MessageCircle size={14} className="text-[var(--accent)]" />}
        label="总消息"
        value={cards?.total_messages?.toLocaleString() ?? '—'}
        sub={
          cards
            ? `过去 ${days * 24}h · 平均每群 ${cards.avg_per_group} 条`
            : '等待扫描'
        }
      />
      <Card
        icon={<AtSign size={14} className="text-[var(--warn)]" />}
        label="@ 我的"
        value={cards?.mentions ?? 0}
        sub={cards ? '需要回复' : '等待扫描'}
        accent="warn"
        href="/mentions"
      />
      <Card
        icon={<MoonStar size={14} className="text-[var(--text-3)]" />}
        label="静默群"
        value={cards?.silent_groups ?? '—'}
        sub={cards ? `过去 ${days * 24}h 无活动` : '等待扫描'}
      />
    </div>
  );
}

function Card({
  icon,
  label,
  value,
  sub,
  accent,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub: string;
  accent?: 'warn';
  href?: string;
}) {
  const className = `card group relative overflow-hidden px-5 py-4 ${
    href
      ? 'block transition-colors hover:border-[rgba(213,162,83,0.5)] hover:bg-[var(--surface-2)] focus:outline-none focus:ring-1 focus:ring-[var(--warn)]'
      : ''
  }`;
  const content = (
    <>
      <div className={`absolute inset-x-0 top-0 h-px ${accent === 'warn' ? 'bg-[var(--warn)]' : 'bg-[var(--accent)]'} opacity-60`} />
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-2)]">
        <span className="flex items-center gap-1.5">
          {icon}
          <span>{label}</span>
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-3)]">Metric</span>
      </div>
      <div
        className={`mt-3 text-[34px] font-semibold leading-none tabular-nums ${
          accent === 'warn' ? 'text-[var(--warn)]' : 'text-[var(--text)]'
        }`}
      >
        {value}
      </div>
      <div className="mt-2 text-[11px] text-[var(--text-3)]">{sub}</div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} aria-label={`查看${label}消息`}>
        {content}
      </Link>
    );
  }

  return (
    <div className={className}>
      {content}
    </div>
  );
}
