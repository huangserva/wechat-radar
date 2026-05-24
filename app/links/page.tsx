'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { Calendar, ExternalLink, Newspaper, RefreshCw, Wrench } from 'lucide-react';

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
  }>;
};

type LinkInsightResp = {
  ok: boolean;
  date: string;
  articles: LinkInsight[];
  tools: LinkInsight[];
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
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/topics/links?date=${date}`);
        const j = (await r.json()) as LinkInsightResp;
        if (!cancelled && j.ok) setLinks(j);
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
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] bg-[rgba(8,13,10,0.74)] px-6 py-3 backdrop-blur">
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
                className="bg-transparent text-[12px] outline-none [color-scheme:dark]"
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

        <div className="grid flex-1 grid-cols-1 gap-5 overflow-hidden p-5 xl:grid-cols-2">
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
        </div>
      </main>
    </div>
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
  return (
    <div className="rounded-md border border-transparent px-2 py-2 hover:border-[var(--border-soft)] hover:bg-[var(--surface-2)]">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="group flex min-w-0 items-start justify-between gap-2"
        title={item.title}
      >
        <span className="min-w-0">
          <span className="line-clamp-2 text-[12px] font-medium leading-snug text-[var(--text)] group-hover:text-[var(--accent)]">
            {item.title}
          </span>
          <span className="mt-1 block truncate text-[10px] text-[var(--text-3)]">{item.domain}</span>
        </span>
        <ExternalLink size={12} className="mt-0.5 shrink-0 text-[var(--text-3)] group-hover:text-[var(--accent)]" />
      </a>
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
