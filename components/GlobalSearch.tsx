'use client';

import Link from 'next/link';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Result = {
  id: string;
  type: 'group' | 'topic' | 'person' | 'message' | 'link';
  title: string;
  subtitle: string;
  href: string;
  external?: boolean;
};

type SearchResponse = {
  ok: boolean;
  results: Result[];
};

const TYPE_LABEL: Record<Result['type'], string> = {
  group: '群',
  topic: '话题',
  person: '人',
  message: '消息',
  link: '链接',
};

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      return;
    }
    const ctl = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          cache: 'no-store',
          signal: ctl.signal,
        });
        const j = (await r.json()) as SearchResponse;
        if (j.ok) {
          setResults(j.results);
          setOpen(true);
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) console.error(e);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [query]);

  return (
    <div ref={boxRef} className="relative w-[280px]">
      <div className="control-surface flex items-center gap-2 rounded-md px-2.5 py-1.5">
        <Search size={13} className="text-[var(--text-3)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-3)]"
          placeholder="搜索群、话题、人、关键词"
        />
        {loading && <Loader2 size={12} className="animate-spin text-[var(--text-3)]" />}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 max-h-[520px] w-[420px] overflow-y-auto rounded-lg border border-[var(--border-soft)] bg-[var(--surface)] p-2 shadow-[var(--shadow)]">
          {results.length === 0 && !loading ? (
            <div className="px-3 py-8 text-center text-[12px] text-[var(--text-3)]">
              没找到匹配结果
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((item) => (
                <SearchItem key={item.id} item={item} onClick={() => setOpen(false)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchItem({ item, onClick }: { item: Result; onClick: () => void }) {
  const inner = (
    <>
      <span className="mt-0.5 rounded border border-[var(--border-soft)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">
        {TYPE_LABEL[item.type]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--text)]">
          {item.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-3)]">
          {item.subtitle}
        </span>
      </span>
      {item.external && <ExternalLink size={12} className="text-[var(--text-3)]" />}
    </>
  );

  const className =
    'flex items-start gap-2 rounded-md px-2.5 py-2 transition-colors hover:bg-[var(--surface-2)]';

  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={className} onClick={onClick}>
        {inner}
      </a>
    );
  }

  return (
    <Link href={item.href} className={className} onClick={onClick}>
      {inner}
    </Link>
  );
}
