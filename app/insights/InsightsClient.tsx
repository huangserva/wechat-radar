'use client';

import { Fragment, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import { safeExternalUrl } from '@/lib/safe-url';
import {
  CalendarClock,
  Database,
  ExternalLink,
  Flame,
  Lightbulb,
  Link2,
  RadioTower,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

type HeatRankItem = {
  id: number;
  rank: number;
  title: string;
  subtitle: string;
  value: number;
  value_label: string;
  heat_percent: number;
  date: string;
};

type TopicRankItem = HeatRankItem & {
  groups_count: number;
  source_groups: string[];
  is_merged: boolean;
};

type LinkRankItem = HeatRankItem & {
  url: string;
  first_group: string;
  first_time: string;
};

type DigestEventItem = HeatRankItem & {
  summary: string;
  source_group: string;
  category: string;
  links: string[];
};

type InsightsResp = {
  ok: boolean;
  available: boolean;
  assistant_db_path: string;
  generated_at: string;
  latest_date: string | null;
  totals: {
    hot_topics: number;
    hot_links: number;
    digest_rows: number;
    nonempty_digest_rows: number;
    parsed_digest_rows: number;
    digest_events: number;
    knowledge_items: number;
    tech_highlights: number;
  };
  rankings: {
    topics: { max_value: number; visible_count: number; items: TopicRankItem[] };
    links: { max_value: number; visible_count: number; items: LinkRankItem[] };
    events: { max_value: number; visible_count: number; items: DigestEventItem[] };
  };
  error?: string;
};

export default function InsightsClient({ initialData }: { initialData: InsightsResp }) {
  const data = initialData;
  const topTopic = data.rankings.topics.items[0] ?? null;

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="report-kicker">Insights</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <Lightbulb size={17} className="text-[var(--accent)]" />
              <span>洞察 · 热度排行榜</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {topTopic
                ? `当前最热：${topTopic.title} · ${topTopic.value_label}${data.latest_date ? ` · 数据截至 ${data.latest_date}` : ''}`
                : `暂无热度信号${data.latest_date ? ` · 数据截至 ${data.latest_date}` : ''}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-2)] xl:flex">
              <Database size={13} className="text-[var(--accent)]" />
              <span>assistant.db · readonly</span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!data.available ? (
            <EmptyState title="assistant.db 暂不可读" text={`未找到或无法只读打开 ${data.assistant_db_path}`} tall />
          ) : (
            <InsightsDashboard data={data} />
          )}
        </div>
      </main>
    </div>
  );
}

function InsightsDashboard({ data }: { data: InsightsResp }) {
  const digestQuality = useMemo(() => {
    if (data.totals.nonempty_digest_rows <= 0) return '无有效摘要';
    return `${data.totals.nonempty_digest_rows} 天非空 · ${data.totals.parsed_digest_rows} 天可解析`;
  }, [data.totals.nonempty_digest_rows, data.totals.parsed_digest_rows]);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <HeroSignal topic={data.rankings.topics.items[0] ?? null} />
        <div className="grid grid-cols-2 gap-3">
          <MetricCard icon={<Flame size={14} />} label="热门话题" value={data.totals.hot_topics} sub="按提及次数排名" />
          <MetricCard icon={<Link2 size={14} />} label="热转链接" value={data.totals.hot_links} sub="按转发次数排名" />
          <MetricCard icon={<CalendarClock size={14} />} label="有效摘要" value={data.totals.nonempty_digest_rows} sub={digestQuality} />
          <MetricCard icon={<Sparkles size={14} />} label="本周大事" value={data.totals.digest_events} sub="来自可解析摘要" />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_0.9fr]">
        <RankingPanel
          title="热门话题榜"
          icon={<Flame size={15} />}
          meta={`Top ${data.rankings.topics.visible_count} / ${data.totals.hot_topics}`}
          items={data.rankings.topics.items}
          visibleCount={data.rankings.topics.visible_count}
          renderItem={(item) => <TopicRow item={item as TopicRankItem} />}
        />
        <RankingPanel
          title="最多人转的链接"
          icon={<ExternalLink size={15} />}
          meta={`Top ${data.rankings.links.visible_count} / ${data.totals.hot_links}`}
          items={data.rankings.links.items}
          visibleCount={data.rankings.links.visible_count}
          renderItem={(item) => <LinkRow item={item as LinkRankItem} />}
        />
      </section>

      <RankingPanel
        title="本周大事"
        icon={<RadioTower size={15} />}
        meta={`${data.rankings.events.items.length} 条 · 仅可解析摘要`}
        items={data.rankings.events.items}
        visibleCount={data.rankings.events.visible_count}
        grid
        renderItem={(item) => <DigestEventRow item={item as DigestEventItem} />}
      />
    </div>
  );
}

function HeroSignal({ topic }: { topic: TopicRankItem | null }) {
  if (!topic) {
    return (
      <section className="card flex min-h-[172px] items-center justify-center px-5 py-4">
        <div className="text-center">
          <div className="text-[14px] font-semibold">暂无热度信号</div>
          <div className="mt-1 text-[12px] text-[var(--text-3)]">trending_topics 为空或暂不可读。</div>
        </div>
      </section>
    );
  }
  return (
    <section className="relative overflow-hidden rounded-md border border-[rgba(125,211,168,0.36)] bg-[linear-gradient(135deg,rgba(125,211,168,0.16),rgba(255,255,255,0.025))] px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="report-kicker">Hottest Now</div>
          <div className="mt-2 flex items-center gap-2 text-[30px] font-semibold leading-tight">
            <span className="rounded-md bg-[var(--accent)] px-2 py-1 text-[16px] font-bold text-black">#1</span>
            <span className="truncate">{topic.title}</span>
          </div>
          <div className="mt-2 text-[13px] text-[var(--text-2)]">{topic.subtitle}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[38px] font-semibold leading-none tabular-nums text-[var(--accent)]">{topic.value}</div>
          <div className="mt-1 text-[11px] text-[var(--text-3)]">次提及</div>
        </div>
      </div>
      <div className="mt-5 h-2 rounded-full bg-[var(--surface)]">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${topic.heat_percent}%` }} />
      </div>
      {topic.source_groups.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {topic.source_groups.slice(0, 5).map((group) => (
            <span key={group} className="rounded bg-[rgba(255,255,255,0.06)] px-2 py-1 text-[10px] text-[var(--text-2)]">
              {group}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RankingPanel({
  title,
  icon,
  meta,
  items,
  visibleCount,
  renderItem,
  grid,
}: {
  title: string;
  icon: React.ReactNode;
  meta: string;
  items: HeatRankItem[];
  visibleCount: number;
  renderItem: (item: HeatRankItem) => React.ReactNode;
  grid?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, visibleCount);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-soft)] px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <span className="text-[var(--accent)]">{icon}</span>
          {title}
        </div>
        <div className="text-[10px] text-[var(--text-3)]">{meta}</div>
      </div>
      <div className="p-3">
        {items.length === 0 ? (
          <SmallEmpty text={`${title} 暂无有效数据。`} />
        ) : (
          <div className={grid ? 'grid grid-cols-1 gap-2 xl:grid-cols-2' : 'space-y-2'}>
            {visibleItems.map((item) => (
              <Fragment key={`${item.id}-${item.rank}`}>
                {renderItem(item)}
              </Fragment>
            ))}
          </div>
        )}
        {hiddenCount > 0 ? (
          <button
            onClick={() => setExpanded(true)}
            className="mt-3 w-full rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 text-[11px] text-[var(--text-2)] hover:text-[var(--accent)]"
          >
            展开其余 {hiddenCount} 条
          </button>
        ) : null}
      </div>
    </section>
  );
}

function TopicRow({ item }: { item: TopicRankItem }) {
  return (
    <RankCard item={item}>
      <div className="mt-2 flex flex-wrap gap-1">
        {item.source_groups.slice(0, 4).map((group) => (
          <span key={group} className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">
            {group}
          </span>
        ))}
        {item.is_merged ? <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">merged</span> : null}
      </div>
    </RankCard>
  );
}

function LinkRow({ item }: { item: LinkRankItem }) {
  return (
    <RankCard item={item}>
      <div className="mt-2">
        <ExternalLinkChip url={item.url} />
      </div>
    </RankCard>
  );
}

function DigestEventRow({ item }: { item: DigestEventItem }) {
  return (
    <RankCard item={item}>
      <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--text-2)]">{item.summary}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.category ? <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">{item.category}</span> : null}
        {item.links.slice(0, 2).map((url, index) => <ExternalLinkChip key={`${item.id}-${url}-${index}`} url={url} compact />)}
      </div>
    </RankCard>
  );
}

function RankCard({ item, children }: { item: HeatRankItem; children?: React.ReactNode }) {
  const top = item.rank <= 3;
  return (
    <div className={`rounded-md border px-3 py-2.5 ${top ? 'border-[rgba(125,211,168,0.38)] bg-[var(--accent-soft)]' : 'border-[var(--border-soft)] bg-[var(--surface-2)]'}`}>
      <div className="flex items-start gap-3">
        <RankBadge rank={item.rank} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={`${top ? 'text-[14px]' : 'text-[12px]'} truncate font-semibold leading-snug`}>{item.title}</div>
              <div className="mt-1 truncate text-[10px] text-[var(--text-3)]">{item.subtitle}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`${top ? 'text-[18px]' : 'text-[14px]'} font-semibold leading-none tabular-nums text-[var(--accent)]`}>{item.value}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-3)]">{item.value_label.replace(String(item.value), '').trim()}</div>
            </div>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--surface)]">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${item.heat_percent}%` }} />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const hot = rank <= 3;
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[12px] font-bold ${hot ? 'bg-[var(--accent)] text-black' : 'bg-[var(--surface)] text-[var(--text-2)]'}`}>
      {hot ? `🔥${rank}` : `#${rank}`}
    </div>
  );
}

function ExternalLinkChip({ url, compact }: { url: string; compact?: boolean }) {
  const href = toSafeHref(url);
  const label = compact ? '链接' : url;
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-2)] hover:text-[var(--accent)]"
      title={href}
    >
      <ExternalLink size={10} className="shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  ) : (
    <span className="inline-flex max-w-full items-center gap-1 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)] line-through" title="非 http(s) 链接，已禁用">
      <ExternalLink size={10} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function toSafeHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return safeExternalUrl(candidate);
}

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number | string; sub: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-2)]">
        <span className="flex items-center gap-1.5 text-[var(--text-2)]">{icon}{label}</span>
        <TrendingUp size={12} className="text-[var(--text-3)]" />
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
