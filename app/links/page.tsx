'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { Calendar, ExternalLink, Newspaper, RefreshCw, Wrench } from 'lucide-react';
import { safeExternalUrl } from '@/lib/safe-url';

type LinkInsight = {
  kind: 'article' | 'tool';
  url: string;
  canonical_url: string;
  title: string;
  domain: string;
  count: number;
  group_count: number;
  first_seen: string;
  last_seen: string;
  sources: Array<{
    chatroom_id: string;
    chat_name: string;
    sender: string;
    time: string;
    local_id: number;
    snippet: string;
    source: string;
  }>;
};

type LinkInsightResp = {
  ok: boolean;
  date: string;
  articles: LinkInsight[];
  tools: LinkInsight[];
};

type RawWechatLink = {
  chatroom_id: string;
  chat_name: string;
  local_id: number;
  sender: string;
  time: string;
  url: string;
  canonical_url: string;
  title: string | null;
  domain: string;
  source: string;
  raw_kind: string;
};

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function LinksPage() {
  const [date, setDate] = useState(() => localToday());
  const [links, setLinks] = useState<LinkInsightResp | null>(null);
  const [rawLinks, setRawLinks] = useState<RawWechatLink[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/topics/links?date=${date}`);
        const j = (await r.json()) as LinkInsightResp;
        if (!cancelled && j.ok) setLinks(j);
      } catch {}
      try {
        const r = await fetch(`/api/message-links/raw?date=${date}`, { cache: 'no-store' });
        const j = (await r.json()) as { ok: boolean; links?: RawWechatLink[] };
        if (!cancelled && j.ok) setRawLinks(j.links ?? []);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const loading = links?.date !== date;

  async function refreshLinks() {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/topics/links?date=${date}&refresh=1`, { cache: 'no-store' });
      const j = (await r.json()) as LinkInsightResp;
      if (j.ok) setLinks(j);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div>
            <div className="report-kicker">Link Intelligence</div>
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <Newspaper size={16} className="text-[var(--accent)]" />
              链接情报 · 文章与工具
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
              {loading
                ? `${date} · 加载中…`
                : `${date} · ${links.articles.length} 篇文章 · ${links.tools.length} 个工具/资源`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="control-surface flex items-center gap-1.5 rounded-md px-2.5 py-1.5">
              <Calendar size={13} className="text-[var(--text-3)]" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="theme-date-input bg-transparent text-[12px] outline-none"
              />
            </div>
            <button
              type="button"
              onClick={refreshLinks}
              disabled={refreshing}
              className="btn"
              title="重新整理当天链接标题和去重结果"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? '整理中' : '重新整理'}
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-5 overflow-hidden p-5 xl:grid-cols-3">
          <LinkInsightPanel
            title="文章链接"
            icon={<Newspaper size={14} className="text-[var(--accent)]" />}
            items={loading ? [] : links.articles}
            date={date}
            loading={loading}
            empty="当天还没有文章链接"
          />
          <LinkInsightPanel
            title="工具与资源"
            icon={<Wrench size={14} className="text-[var(--warn)]" />}
            items={loading ? [] : links.tools}
            date={date}
            loading={loading}
            empty="当天还没有工具链接"
          />
          <RawWechatPanel date={date} items={loading ? [] : rawLinks} loading={loading} />
        </div>
      </main>
    </div>
  );
}

function RawWechatPanel({
  date,
  items,
  loading,
}: {
  date: string;
  items: RawWechatLink[];
  loading: boolean;
}) {
  return (
    <section className="card flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <ExternalLink size={14} className="text-[var(--accent)]" />
          <span>微信文章链接</span>
        </div>
        <div className="text-[10px] text-[var(--text-3)]">{loading ? '加载中' : `${items.length} 条`}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="py-16 text-center text-[11px] text-[var(--text-3)]">加载中…</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-[11px] text-[var(--text-3)]">当天没有解析到微信文章链接</div>
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => {
              const href = safeExternalUrl(item.url);
              return (
              <div key={`${item.chatroom_id}:${item.local_id}:${item.canonical_url}`} className="rounded-md border border-transparent px-2 py-2 hover:border-[var(--border-soft)] hover:bg-[var(--surface-2)]">
                {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="group block min-w-0" title={href}>
                  <div className="line-clamp-2 text-[12px] font-medium leading-snug text-[var(--text)] group-hover:text-[var(--accent)]">
                    {item.title || item.domain || item.raw_kind}
                  </div>
                  <div className="mt-1 break-all text-[10px] leading-snug text-[var(--text-3)]">
                    {item.url}
                  </div>
                </a>
                ) : (
                <div className="block min-w-0" title="非 http(s) 链接，已禁用">
                  <div className="line-clamp-2 text-[12px] font-medium leading-snug text-[var(--text-3)] line-through">
                    {item.title || item.domain || item.raw_kind}
                  </div>
                  <div className="mt-1 break-all text-[10px] leading-snug text-[var(--text-3)]">{item.url}</div>
                </div>
                )}
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-3)]">
                  <Link
                    href={`/groups/${encodeURIComponent(item.chatroom_id)}?date=${date}`}
                    className="min-w-0 truncate text-[var(--text-2)] hover:text-[var(--accent)]"
                  >
                    {item.chat_name} · {item.sender}
                  </Link>
                  <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[var(--accent)]">
                    {item.raw_kind}
                  </span>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function LinkInsightPanel({
  title,
  icon,
  items,
  date,
  loading,
  empty,
}: {
  title: string;
  icon: ReactNode;
  items: LinkInsight[];
  date: string;
  loading: boolean;
  empty: string;
}) {
  return (
    <section className="card flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          {icon}
          <span>{title}</span>
        </div>
        <div className="text-[10px] text-[var(--text-3)]">{loading ? '加载中' : `${items.length} 条`}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="py-16 text-center text-[11px] text-[var(--text-3)]">加载中…</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-[11px] text-[var(--text-3)]">{empty}</div>
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => (
              <LinkInsightRow key={item.canonical_url} item={item} date={date} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function LinkInsightRow({ item, date }: { item: LinkInsight; date: string }) {
  const first = item.sources[0];
  const href = safeExternalUrl(item.url);
  const inner = (
    <>
      <span className="min-w-0">
        <span className="line-clamp-2 text-[12px] font-medium leading-snug text-[var(--text)] group-hover:text-[var(--accent)]">
          {item.title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-[var(--text-3)]">
          <span className={sourceClass(first?.source)}>{sourceLabel(first?.source)}</span>
          <span className="truncate">{item.domain}</span>
        </span>
      </span>
      <ExternalLink size={12} className="mt-0.5 shrink-0 text-[var(--text-3)] group-hover:text-[var(--accent)]" />
    </>
  );
  return (
    <div className="rounded-md border border-transparent px-2 py-2 hover:border-[var(--border-soft)] hover:bg-[var(--surface-2)]">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex min-w-0 items-start justify-between gap-2"
          title={href}
        >
          {inner}
        </a>
      ) : (
        <div className="group flex min-w-0 items-start justify-between gap-2 opacity-70" title="非 http(s) 链接，已禁用">
          {inner}
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--text-3)]">
        <Link
          href={`/groups/${encodeURIComponent(first.chatroom_id)}?date=${date}`}
          className="min-w-0 truncate text-[var(--text-2)] hover:text-[var(--accent)]"
          title={`${first.chat_name} · ${first.sender}`}
        >
          {first.chat_name} · {first.sender}
        </Link>
        <span className="shrink-0 tabular-nums">
          {item.count > 1 ? `${item.count} 次 · ` : ''}
          {item.last_seen?.slice(11) ?? ''}
        </span>
      </div>
      {first.snippet && (
        <div className="mt-1 line-clamp-1 text-[10px] text-[var(--text-3)]">{first.snippet}</div>
      )}
    </div>
  );
}

function sourceLabel(source?: string): string {
  if (source === 'wechat_raw') return '微信原文';
  if (source === 'public_search') return '公开补链';
  if (source === 'manual') return '手动补链';
  return '网页链接';
}

function sourceClass(source?: string): string {
  const base = 'shrink-0 rounded px-1.5 py-0.5';
  if (source === 'wechat_raw') return `${base} bg-[var(--accent-soft)] text-[var(--accent)]`;
  if (source === 'public_search' || source === 'manual') return `${base} bg-[var(--warn-soft)] text-[var(--warn)]`;
  return `${base} bg-[var(--surface-2)] text-[var(--text-3)]`;
}
