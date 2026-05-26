'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import { Database, ExternalLink, Flame, GitMerge, Link2, Search, TrendingUp, Users } from 'lucide-react';
import { safeExternalUrl } from '@/lib/safe-url';

type HotTopic = {
  keyword: string;
  total_mentions: number;
  groups_count: number;
  source_groups: string[];
  is_merged: boolean;
};

type HotUrl = {
  url: string;
  title: string;
  share_count: number;
  first_group: string;
  first_time: string;
};

type HotspotsResp = {
  ok: boolean;
  available: boolean;
  date: string;
  latest_date: string | null;
  available_dates: string[];
  stats: { topic_count: number; url_count: number; group_estimate: number; max_mentions: number };
  topics: HotTopic[];
  urls: HotUrl[];
  error?: string;
};

const MENTION_FILTERS = [
  { label: '全部', min: 0 },
  { label: '3+', min: 3 },
  { label: '5+', min: 5 },
  { label: '10+', min: 10 },
];

export default function HotspotsPage() {
  const [data, setData] = useState<HotspotsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string>('');
  const [query, setQuery] = useState('');
  const [minMentions, setMinMentions] = useState(0);
  const [mergedOnly, setMergedOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/hotspots${date ? `?date=${encodeURIComponent(date)}` : ''}`, { cache: 'no-store' });
        const j = (await r.json()) as HotspotsResp;
        if (cancelled) return;
        if (!j.ok) throw new Error(j.error ?? '加载失败');
        setData(j);
        if (!date && j.date) setDate(j.date);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const topics = useMemo(() => {
    if (!data) return [];
    const key = query.trim().toLowerCase();
    return data.topics.filter((t) => {
      if (t.total_mentions < minMentions) return false;
      if (mergedOnly && !t.is_merged) return false;
      if (!key) return true;
      return [t.keyword, ...t.source_groups].filter(Boolean).some((v) => v.toLowerCase().includes(key));
    });
  }, [data, query, minMentions, mergedOnly]);

  const urls = useMemo(() => {
    if (!data) return [];
    const key = query.trim().toLowerCase();
    if (!key) return data.urls;
    return data.urls.filter((u) => [u.title, u.url, u.first_group].filter(Boolean).some((v) => v.toLowerCase().includes(key)));
  }, [data, query]);

  const stats = data?.stats;
  const latest = data?.latest_date ?? null;
  const isStale = Boolean(latest && date && date !== latest);

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="report-kicker">Trending Signals</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <Flame size={16} className="text-[var(--accent)]" />
              <span>热点 · 信号（hermes 热点扫描）</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {loading
                ? '加载中…'
                : `${stats?.topic_count ?? 0} 热点话题 · ${stats?.url_count ?? 0} 链接${latest ? ` · 热点截至 ${latest}` : ''}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <select
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="control-surface rounded-md px-2.5 py-1.5 text-[12px] outline-none"
            >
              {(data?.available_dates ?? (date ? [date] : [])).map((d) => (
                <option key={d} value={d}>
                  {d}
                  {d === latest ? ' · 最新' : ''}
                </option>
              ))}
            </select>
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-2)] xl:flex">
              <Database size={13} className="text-[var(--accent)]" />
              <span>hermes trending</span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* top metrics */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric icon={<Flame size={14} />} label="当日热点" value={stats?.topic_count ?? '--'} />
            <Metric icon={<Users size={14} />} label="涉及群数" value={stats?.group_estimate ?? '--'} sub="来自来源群聚合" />
            <Metric icon={<Link2 size={14} />} label="热门链接" value={stats?.url_count ?? '--'} />
            <Metric icon={<TrendingUp size={14} />} label="最高提及" value={stats?.max_mentions ?? '--'} accent />
          </div>

          {/* filters */}
          <div className="card mt-3 flex flex-wrap items-center gap-2 p-3">
            <div className="control-surface flex min-w-[220px] flex-1 items-center gap-2 rounded-md px-2.5 py-1.5">
              <Search size={13} className="text-[var(--text-3)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜话题 / 来源群 / 链接标题"
                className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              />
            </div>
            <div className="flex items-center gap-1">
              {MENTION_FILTERS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => setMinMentions(f.min)}
                  className={`rounded-md border px-2.5 py-1 text-[12px] ${
                    minMentions === f.min
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                      : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setMergedOnly((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] ${
                mergedOnly
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                  : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'
              }`}
            >
              <GitMerge size={12} />
              仅合并话题
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-md border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-3 text-[12px] text-[var(--danger)]">
              {error}
            </div>
          ) : loading ? (
            <div className="py-20 text-center text-[12px] text-[var(--text-3)]">加载中…</div>
          ) : !data?.available ? (
            <div className="card mt-4 py-20 text-center text-[12px] text-[var(--text-3)]">
              assistant.db 不可读，热点暂不可用。
            </div>
          ) : data.topics.length === 0 && data.urls.length === 0 ? (
            <div className="card mt-4 py-20 text-center text-[12px] text-[var(--text-3)]">
              {date} 暂无热点扫描结果。{isStale && latest ? `最新数据在 ${latest}。` : ''}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
              {/* topics */}
              <section className="card flex min-h-0 flex-col">
                <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-2">
                  <div className="flex items-center gap-2 text-[12px] font-semibold">
                    <Flame size={14} className="text-[var(--accent)]" />
                    <span>热点话题</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-3)]">{topics.length} 条</span>
                </div>
                <div className="space-y-1.5 p-2">
                  {topics.length === 0 ? (
                    <div className="py-12 text-center text-[11px] text-[var(--text-3)]">没有匹配当前筛选的话题</div>
                  ) : (
                    topics.map((t) => <TopicRow key={t.keyword} topic={t} />)
                  )}
                </div>
              </section>

              {/* urls */}
              <section className="card flex min-h-0 flex-col">
                <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-2">
                  <div className="flex items-center gap-2 text-[12px] font-semibold">
                    <Link2 size={14} className="text-[var(--warn)]" />
                    <span>热点链接</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-3)]">{urls.length} 条</span>
                </div>
                <div className="space-y-1.5 p-2">
                  {urls.length === 0 ? (
                    <div className="py-12 text-center text-[11px] text-[var(--text-3)]">当日没有热点链接</div>
                  ) : (
                    urls.map((u, i) => <UrlRow key={`${u.url}-${i}`} item={u} />)
                  )}
                </div>
              </section>
            </div>
          )}

          <div className="mt-4 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-[11px] leading-5 text-[var(--text-3)]">
            来源为 hermes trending scan（热点扫描产物），不等同 /signals 的实时消息流；来源群为群名文本，暂不支持点击跳转群详情。
          </div>
        </div>
      </main>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
        <span className={accent ? 'text-[var(--warn)]' : 'text-[var(--accent)]'}>{icon}</span>
        {label}
      </div>
      <div className={`mt-2 text-[24px] font-semibold tabular-nums ${accent ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 truncate text-[10px] text-[var(--text-3)]">{sub}</div> : null}
    </div>
  );
}

function TopicRow({ topic }: { topic: HotTopic }) {
  const shown = topic.source_groups.slice(0, 3);
  const extra = topic.source_groups.length - shown.length;
  return (
    <div className="rounded-md border border-transparent px-2.5 py-2 hover:border-[var(--border-soft)] hover:bg-[var(--surface-2)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-[var(--text)]">{topic.keyword}</span>
            {topic.is_merged && (
              <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] text-[var(--accent)]">
                合并
              </span>
            )}
          </div>
          {shown.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {shown.map((g, i) => (
                <span key={`${g}-${i}`} className="signal-chip rounded px-1.5 py-0.5 text-[10px]">
                  {g}
                </span>
              ))}
              {extra > 0 && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">+{extra}</span>}
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-[var(--text-3)]">跨 {topic.groups_count} 群</div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[18px] font-semibold tabular-nums text-[var(--text)]">{topic.total_mentions}</div>
          <div className="text-[10px] text-[var(--text-3)]">{topic.groups_count} 群提及</div>
        </div>
      </div>
    </div>
  );
}

function UrlRow({ item }: { item: HotUrl }) {
  const href = safeExternalUrl(item.url);
  const label = item.title || item.url;
  return (
    <div className="rounded-md border border-transparent px-2.5 py-2 hover:border-[var(--border-soft)] hover:bg-[var(--surface-2)]">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="group block min-w-0" title={href}>
          <div className="line-clamp-2 flex items-start gap-1.5 text-[12px] font-medium leading-snug text-[var(--text)] group-hover:text-[var(--accent)]">
            <ExternalLink size={12} className="mt-0.5 shrink-0 text-[var(--text-3)] group-hover:text-[var(--accent)]" />
            <span className="min-w-0">{label}</span>
          </div>
        </a>
      ) : (
        <div
          className="line-clamp-2 flex items-start gap-1.5 text-[12px] font-medium leading-snug text-[var(--text-3)]"
          title="非 http(s) 链接，已禁用"
        >
          <ExternalLink size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 line-through">{label}</span>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-2 pl-5 text-[10px] text-[var(--text-3)]">
        <span className="min-w-0 truncate" title={item.first_group}>
          {item.first_group || '未知来源'}
        </span>
        <span className="shrink-0 tabular-nums">分享 {item.share_count}</span>
      </div>
    </div>
  );
}
