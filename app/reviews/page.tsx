'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import { AlertTriangle, Database, ExternalLink, FileText, Flame, History, Link2, Search, Users } from 'lucide-react';
import { safeExternalUrl } from '@/lib/safe-url';

type ReviewTopic = {
  keyword: string;
  total_mentions: number;
  active_days: number;
  groups_count: number;
  source_groups: string[];
};
type ReviewLink = { url: string; title: string; shares: number; first_seen: string; first_group: string };
type ReviewDigest = { date: string; kind: 'json' | 'text' | 'empty'; text: string; top3: string[]; groups_count: number };
type TechItem = { scan_date: string; category: string; keyword: string; count: number; groups: number };

type ReviewsResp = {
  ok: boolean;
  available: boolean;
  since: string;
  until: string;
  freshness: { trending: string | null; digests: string | null; tech: string | null };
  stats: {
    topic_count: number;
    link_count: number;
    digest_days: number;
    empty_digest_days: number;
    tech_status: 'present' | 'stale' | 'missing';
  };
  topics: ReviewTopic[];
  links: ReviewLink[];
  digests: ReviewDigest[];
  tech: { status: 'present' | 'stale' | 'missing'; latest_date: string | null; items: TechItem[] };
  error?: string;
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const PERIODS = [
  { key: 'week', label: '本周' },
  { key: 'last', label: '上周' },
  { key: 'month', label: '近30天' },
  { key: 'custom', label: '自定义' },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];

function windowFor(period: PeriodKey, customSince: string, customUntil: string): { since: string; until: string } {
  const today = localToday();
  if (period === 'week') return { since: addDays(today, -6), until: today };
  if (period === 'last') return { since: addDays(today, -13), until: addDays(today, -7) };
  if (period === 'month') return { since: addDays(today, -29), until: today };
  return { since: customSince, until: customUntil };
}

export default function ReviewsPage() {
  const [period, setPeriod] = useState<PeriodKey>('week');
  const [customSince, setCustomSince] = useState(() => addDays(localToday(), -6));
  const [customUntil, setCustomUntil] = useState(() => localToday());
  const [data, setData] = useState<ReviewsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [minMentions, setMinMentions] = useState(0);

  const win = useMemo(() => windowFor(period, customSince, customUntil), [period, customSince, customUntil]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/reviews?since=${win.since}&until=${win.until}`, { cache: 'no-store' });
        const j = (await r.json()) as ReviewsResp;
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
  }, [win.since, win.until]);

  const topics = useMemo(() => {
    if (!data) return [];
    const key = query.trim().toLowerCase();
    return data.topics.filter(
      (t) =>
        t.total_mentions >= minMentions &&
        (!key || [t.keyword, ...t.source_groups].some((v) => v.toLowerCase().includes(key))),
    );
  }, [data, query, minMentions]);

  const links = useMemo(() => {
    if (!data) return [];
    const key = query.trim().toLowerCase();
    if (!key) return data.links;
    return data.links.filter((l) => [l.title, l.url, l.first_group].filter(Boolean).some((v) => v.toLowerCase().includes(key)));
  }, [data, query]);

  const stats = data?.stats;
  const fresh = data?.freshness;

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="report-kicker">Review</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <History size={16} className="text-[var(--accent)]" />
              <span>复盘 · 周期回看</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {loading
                ? '加载中…'
                : `${data?.since} ~ ${data?.until} · 来自 hermes assistant.db 产物回看（非重新分析）`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] text-[var(--text-2)] xl:flex">
              <Database size={12} className="text-[var(--accent)]" />
              <span>
                tech 截至 {fresh?.tech ?? '—'} · digest 截至 {fresh?.digests ?? '—'} · 热点 {fresh?.trending ?? '—'}
              </span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* period + filters */}
          <div className="card flex flex-wrap items-center gap-2 p-3">
            <div className="flex items-center gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`rounded-md border px-2.5 py-1 text-[12px] ${
                    period === p.key
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                      : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customSince}
                  onChange={(e) => setCustomSince(e.target.value)}
                  className="theme-date-input control-surface rounded-md px-2 py-1 text-[12px] outline-none"
                />
                <span className="text-[11px] text-[var(--text-3)]">~</span>
                <input
                  type="date"
                  value={customUntil}
                  onChange={(e) => setCustomUntil(e.target.value)}
                  className="theme-date-input control-surface rounded-md px-2 py-1 text-[12px] outline-none"
                />
              </div>
            )}
            <div className="control-surface flex min-w-[180px] flex-1 items-center gap-2 rounded-md px-2.5 py-1.5">
              <Search size={13} className="text-[var(--text-3)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜话题 / 来源群 / 链接"
                className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              />
            </div>
            <div className="flex items-center gap-1">
              {[0, 3, 5, 10].map((m) => (
                <button
                  key={m}
                  onClick={() => setMinMentions(m)}
                  className={`rounded-md border px-2 py-1 text-[12px] ${
                    minMentions === m
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                      : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {m === 0 ? '全部' : `${m}+`}
                </button>
              ))}
            </div>
          </div>

          {/* stat band */}
          <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric icon={<Flame size={14} />} label="周期热点" value={stats?.topic_count ?? '--'} />
            <Metric icon={<Link2 size={14} />} label="高热链接" value={stats?.link_count ?? '--'} />
            <Metric
              icon={<FileText size={14} />}
              label="可用摘要天数"
              value={stats?.digest_days ?? '--'}
              sub={stats ? `空摘要 ${stats.empty_digest_days} 天` : undefined}
            />
            <TechStatusMetric status={stats?.tech_status} latest={fresh?.tech ?? null} />
          </div>

          {error ? (
            <div className="mt-4 rounded-md border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-3 text-[12px] text-[var(--danger)]">
              {error}
            </div>
          ) : loading ? (
            <div className="py-20 text-center text-[12px] text-[var(--text-3)]">加载中…</div>
          ) : !data?.available ? (
            <div className="card mt-4 py-20 text-center text-[12px] text-[var(--text-3)]">assistant.db 不可读，复盘暂不可用。</div>
          ) : data.topics.length === 0 && data.links.length === 0 && data.digests.length === 0 ? (
            <div className="card mt-4 py-20 text-center text-[12px] text-[var(--text-3)]">
              {data.since} ~ {data.until} 周期内暂无可回看数据。
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {/* 1. 周期主题 */}
              <Section title="周期主题" icon={<Flame size={14} className="text-[var(--accent)]" />} count={topics.length}>
                {topics.length === 0 ? (
                  <Empty text="本周期没有匹配的热点主题" />
                ) : (
                  <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
                    {topics.map((t) => (
                      <div key={t.keyword} className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold text-[var(--text)]">{t.keyword}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {t.source_groups.slice(0, 3).map((g, i) => (
                                <span key={`${g}-${i}`} className="signal-chip rounded px-1.5 py-0.5 text-[10px]">
                                  {g}
                                </span>
                              ))}
                              {t.source_groups.length > 3 && (
                                <span className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">
                                  +{t.source_groups.length - 3}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[16px] font-semibold tabular-nums text-[var(--text)]">{t.total_mentions}</div>
                            <div className="text-[10px] text-[var(--text-3)]">{t.active_days} 天 · {t.groups_count} 群</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* 2. 链接回看 */}
              <Section title="链接回看" icon={<Link2 size={14} className="text-[var(--warn)]" />} count={links.length}>
                {links.length === 0 ? (
                  <Empty text="本周期没有热点链接" />
                ) : (
                  <div className="space-y-1.5">
                    {links.map((l, i) => (
                      <LinkRow key={`${l.url}-${i}`} item={l} />
                    ))}
                  </div>
                )}
              </Section>

              {/* 3. 技术讨论 / 摘要（降级区）*/}
              <Section
                title="技术讨论 / 摘要"
                icon={<FileText size={14} className="text-[var(--accent)]" />}
                count={data.digests.length}
              >
                {data.tech.status !== 'present' ? (
                  <div className="mb-2 flex items-start gap-2 rounded-md border border-[var(--warn-soft)] bg-[var(--warn-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--warn)]">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      {data.tech.status === 'stale'
                        ? `技术讨论扫描停在 ${data.tech.latest_date ?? '未知'}，本周期无新数据，仅供历史参考。`
                        : '技术讨论数据缺失（tech_highlights 表为空或不可读）。'}
                    </span>
                  </div>
                ) : (
                  <div className="mb-2">
                    <div className="mb-1.5 text-[11px] text-[var(--text-3)]">本周期技术讨论 {data.tech.items.length} 条（tech_highlights，新鲜）</div>
                    <div className="flex flex-wrap gap-1.5">
                      {data.tech.items.slice(0, 20).map((t, i) => (
                        <span
                          key={`${t.category}-${t.keyword}-${i}`}
                          className="signal-chip flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                          title={`${t.category} · ${t.scan_date} · ${t.groups} 群`}
                        >
                          <span className="text-[var(--text-3)]">{t.category}</span>
                          <span className="font-medium">{t.keyword}</span>
                          <span className="tabular-nums text-[var(--text-3)]">{t.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {stats && stats.empty_digest_days > 0 && (
                  <div className="mb-2 text-[11px] text-[var(--text-3)]">本周期有 {stats.empty_digest_days} 天摘要为空（计为「摘要缺失」，未隐藏）。</div>
                )}
                {data.digests.length === 0 ? (
                  <Empty text="本周期没有可用的 digest 摘要（多为空）" />
                ) : (
                  <div className="space-y-2">
                    {data.digests.map((d) => (
                      <div key={d.date} className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold text-[var(--text)]">{d.date}</span>
                          <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                            {d.kind === 'json' ? '结构化摘要' : '文本摘要'}
                          </span>
                        </div>
                        {d.top3.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {d.top3.map((x, i) => (
                              <span key={`${x}-${i}`} className="signal-chip rounded px-1.5 py-0.5 text-[10px]">
                                {x}
                              </span>
                            ))}
                            {d.groups_count > 0 && <span className="text-[10px] text-[var(--text-3)]">· {d.groups_count} 群</span>}
                          </div>
                        )}
                        {d.text && <div className="mt-1.5 line-clamp-4 text-[11px] leading-5 text-[var(--text-2)]">{d.text}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          )}

          <div className="mt-4 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2 text-[11px] leading-5 text-[var(--text-3)]">
            复盘是对 hermes assistant.db 既有产物（热点 / 链接 / 摘要 / 技术讨论扫描）的周期回看与计数归并，不是重新 AI 分析；stale / 缺失状态如实标注。
          </div>
        </div>
      </main>
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          {icon}
          <span>{title}</span>
        </div>
        <span className="text-[10px] text-[var(--text-3)]">{count} 条</span>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-[11px] text-[var(--text-3)]">{text}</div>;
}

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
        <span className="text-[var(--accent)]">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-[24px] font-semibold tabular-nums text-[var(--text)]">{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[10px] text-[var(--text-3)]">{sub}</div> : null}
    </div>
  );
}

function TechStatusMetric({ status, latest }: { status?: 'present' | 'stale' | 'missing'; latest: string | null }) {
  const map = {
    present: { text: '新鲜', cls: 'text-[var(--accent)]' },
    stale: { text: '过期', cls: 'text-[var(--warn)]' },
    missing: { text: '缺失', cls: 'text-[var(--danger)]' },
  } as const;
  const m = status ? map[status] : { text: '--', cls: 'text-[var(--text)]' };
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
        <span className="text-[var(--accent)]">
          <AlertTriangle size={14} />
        </span>
        技术讨论数据
      </div>
      <div className={`mt-2 text-[24px] font-semibold ${m.cls}`}>{m.text}</div>
      <div className="mt-0.5 truncate text-[10px] text-[var(--text-3)]">{latest ? `截至 ${latest}` : '无数据'}</div>
    </div>
  );
}

function LinkRow({ item }: { item: ReviewLink }) {
  const href = safeExternalUrl(item.url);
  const label = item.title || item.url;
  return (
    <div className="rounded-md border border-transparent px-2 py-2 hover:border-[var(--border-soft)] hover:bg-[var(--surface-2)]">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="group block min-w-0" title={href}>
          <div className="line-clamp-2 flex items-start gap-1.5 text-[12px] font-medium leading-snug text-[var(--text)] group-hover:text-[var(--accent)]">
            <ExternalLink size={12} className="mt-0.5 shrink-0 text-[var(--text-3)] group-hover:text-[var(--accent)]" />
            <span className="min-w-0">{label}</span>
          </div>
        </a>
      ) : (
        <div className="line-clamp-2 flex items-start gap-1.5 text-[12px] font-medium leading-snug text-[var(--text-3)]" title="非 http(s) 链接，已禁用">
          <ExternalLink size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 line-through">{label}</span>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-2 pl-5 text-[10px] text-[var(--text-3)]">
        <span className="flex min-w-0 items-center gap-1 truncate" title={item.first_group}>
          <Users size={10} className="shrink-0" />
          <span className="truncate">{item.first_group || '未知来源'}</span>
          <span className="shrink-0">· 首现 {item.first_seen}</span>
        </span>
        <span className="shrink-0 tabular-nums">分享 {item.shares}</span>
      </div>
    </div>
  );
}
