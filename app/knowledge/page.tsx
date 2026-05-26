'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import { BookOpen, Database, ExternalLink, Hash, Search, Users } from 'lucide-react';
import { safeExternalUrl } from '@/lib/safe-url';

type KnowledgeItem = {
  id: number;
  date: string;
  topic: string;
  summary: string;
  category: string;
  source_group: string;
  sender: string;
  links: string[];
  tags: string[];
};

type CategoryStat = { key: string; count: number };

type KnowledgeResp = {
  ok: boolean;
  available: boolean;
  total: number;
  latest_date: string | null;
  categories: CategoryStat[];
  items: KnowledgeItem[];
  digests: Array<{ date: string; text: string; has_json: boolean }>;
  error?: string;
};

export default function KnowledgePage() {
  const [data, setData] = useState<KnowledgeResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/knowledge', { cache: 'no-store' });
        const j = (await r.json()) as KnowledgeResp;
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

  const filtered = useMemo(() => {
    if (!data) return [];
    const key = query.trim().toLowerCase();
    return data.items.filter((it) => {
      if (category !== 'all' && it.category !== category) return false;
      if (!key) return true;
      return [it.topic, it.summary, it.source_group, it.sender, ...it.tags]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(key));
    });
  }, [data, category, query]);

  const total = data?.total ?? 0;
  const latest = data?.latest_date ?? null;

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="report-kicker">Knowledge Base</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <BookOpen size={16} className="text-[var(--accent)]" />
              <span>知识库 · 群聊干货 / 链接 / 决议</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {loading ? '加载中…' : `${total} 条知识条目${latest ? ` · 数据截至 ${latest}` : ''}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-2)] xl:flex">
              <Database size={13} className="text-[var(--accent)]" />
              <span>hermes assistant.db · 本地读取</span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* filters / stats */}
          <div className="card p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <CategoryChip
                label="全部"
                count={total}
                active={category === 'all'}
                onClick={() => setCategory('all')}
              />
              {(data?.categories ?? []).map((c) => (
                <CategoryChip
                  key={c.key}
                  label={c.key}
                  count={c.count}
                  active={category === c.key}
                  onClick={() => setCategory(c.key)}
                />
              ))}
            </div>
            <div className="control-surface mt-3 flex items-center gap-2 rounded-md px-2.5 py-1.5">
              <Search size={13} className="text-[var(--text-3)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜标题 / 摘要 / 标签 / 来源群"
                className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              />
              {query && (
                <button className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)]" onClick={() => setQuery('')}>
                  清除
                </button>
              )}
            </div>
          </div>

          {/* list */}
          <div className="mt-4">
            {error ? (
              <div className="rounded-md border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-3 text-[12px] text-[var(--danger)]">
                {error}
              </div>
            ) : loading ? (
              <div className="py-20 text-center text-[12px] text-[var(--text-3)]">加载中…</div>
            ) : filtered.length === 0 ? (
              <div className="card py-20 text-center text-[12px] text-[var(--text-3)]">
                {total === 0
                  ? data?.available
                    ? '暂无知识条目（hermes 知识库为空或未扫描）。'
                    : 'assistant.db 不可读，知识库暂不可用。'
                  : '没有匹配当前筛选的条目。'}
              </div>
            ) : (
              <>
                <div className="mb-2 px-1 text-[11px] text-[var(--text-3)]">
                  显示 {filtered.length} / {total} 条
                  {category !== 'all' ? ` · 分类「${category}」` : ''}
                </div>
                <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                  {filtered.map((it) => (
                    <KnowledgeCard key={it.id} item={it} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
          : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums text-[10px] text-[var(--text-3)]">{count}</span>
    </button>
  );
}

function KnowledgeCard({ item }: { item: KnowledgeItem }) {
  return (
    <div className="card flex min-w-0 flex-col p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold leading-snug text-[var(--text)]">{item.topic}</div>
          {item.summary && (
            <div className="mt-1 line-clamp-3 text-[12px] leading-5 text-[var(--text-2)]">{item.summary}</div>
          )}
        </div>
        <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
          {item.category}
        </span>
      </div>

      {item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.slice(0, 8).map((t, i) => (
            <span key={`${t}-${i}`} className="signal-chip flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]">
              <Hash size={9} className="text-[var(--text-3)]" />
              {t}
            </span>
          ))}
        </div>
      )}

      {item.links.length > 0 && (
        <div className="mt-2 space-y-1">
          {item.links.slice(0, 4).map((url, i) => {
            const href = safeExternalUrl(url);
            return href ? (
              <a
                key={`${url}-${i}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5 text-[11px] text-[var(--text-2)] hover:text-[var(--accent)]"
                title={href}
              >
                <ExternalLink size={11} className="shrink-0 text-[var(--text-3)] group-hover:text-[var(--accent)]" />
                <span className="truncate">{url}</span>
              </a>
            ) : (
              <div
                key={`${url}-${i}`}
                className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)]"
                title="非 http(s) 链接，已禁用"
              >
                <ExternalLink size={11} className="shrink-0" />
                <span className="truncate line-through">{url}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--border-soft)] pt-2 text-[10px] text-[var(--text-3)]">
        <span className="flex min-w-0 items-center gap-1 truncate" title={item.source_group}>
          <Users size={10} className="shrink-0" />
          <span className="truncate">{item.source_group || '未知来源'}</span>
          {item.sender ? <span className="shrink-0 text-[var(--text-3)]">· {item.sender}</span> : null}
        </span>
        <span className="shrink-0 tabular-nums">{item.date}</span>
      </div>
    </div>
  );
}
