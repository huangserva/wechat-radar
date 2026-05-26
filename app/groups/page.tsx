'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { Star, ChevronRight, Search } from 'lucide-react';

type Group = {
  chatroom_id: string;
  name: string;
  summary: string;
  time: string;
  timestamp: number;
  unread: number;
  is_favorite: boolean;
  group_ids: number[];
};

type SessionsResp = {
  ok: boolean;
  total: number;
  groups: Group[];
  categories: Array<{ id: number; name: string; color: string; emoji: string | null }>;
};

export default function GroupsListPage() {
  return (
    <Suspense fallback={<GroupsListFallback />}>
      <GroupsListContent />
    </Suspense>
  );
}

function GroupsListContent() {
  const params = useSearchParams();
  const filter = params.get('filter') ?? 'all';
  const groupId = params.get('group_id');

  const [data, setData] = useState<SessionsResp | null>(null);
  const [q, setQ] = useState('');
  const [bumping, setBumping] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await fetch('/api/sessions');
    setData(await r.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch('/api/sessions');
      const json = (await r.json()) as SessionsResp;
      if (!cancelled) setData(json);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.groups;
    if (filter === 'favorites') list = list.filter((g) => g.is_favorite);
    if (filter === 'unsorted') list = list.filter((g) => g.group_ids.length === 0);
    if (filter === 'group' && groupId)
      list = list.filter((g) => g.group_ids.includes(Number(groupId)));
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      list = list.filter(
        (g) => g.name.toLowerCase().includes(k) || g.summary.toLowerCase().includes(k),
      );
    }
    return [...list].sort((a, b) => b.timestamp - a.timestamp);
  }, [data, filter, groupId, q]);

  const title = useMemo(() => {
    if (filter === 'favorites') return '收藏的群';
    if (filter === 'unsorted') return '未分组的群';
    if (filter === 'group' && groupId && data) {
      const c = data.categories.find((c) => c.id === Number(groupId));
      return c ? `分组：${c.emoji ?? ''} ${c.name}` : '分组';
    }
    return '所有群';
  }, [filter, groupId, data]);

  const toggleFav = async (chatroomId: string, current: boolean) => {
    setBumping(chatroomId);
    await fetch('/api/group-tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatroom_id: chatroomId, fav: !current }),
    });
    setBumping(null);
    reload();
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div>
            <div className="report-kicker">Group Directory</div>
            <div className="text-[15px] font-semibold">{title}</div>
            <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
              {filtered.length} / {data?.total ?? 0} 个群
            </div>
          </div>
          <div className="control-surface flex items-center gap-2 rounded-md px-2.5 py-1.5">
            <Search size={13} className="text-[var(--text-3)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索群名或最近消息…"
              className="w-60 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-3)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!data ? (
            <div className="py-20 text-center text-[12px] text-[var(--text-3)]">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-[12px] text-[var(--text-3)]">没有匹配的群</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((g) => (
                <div
                  key={g.chatroom_id}
                  className="group grid grid-cols-[1fr_140px_60px_24px] items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-[13px] hover:border-[var(--border-soft)] hover:bg-[var(--surface-2)]"
                >
                  <Link
                    href={`/groups/${encodeURIComponent(g.chatroom_id)}`}
                    className="min-w-0"
                  >
                    <div className="flex items-center gap-2">
                      <div className="truncate font-medium text-[var(--text)]">{g.name}</div>
                      {g.unread > 0 && (
                        <span className="shrink-0 rounded bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {g.unread}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-[var(--text-3)]">{g.summary}</div>
                  </Link>
                  <div className="text-right text-[11px] text-[var(--text-3)]">{g.time}</div>
                  <button
                    className={bumping === g.chatroom_id ? 'opacity-50' : ''}
                    onClick={() => toggleFav(g.chatroom_id, g.is_favorite)}
                    title={g.is_favorite ? '取消收藏' : '加入收藏'}
                  >
                    <Star
                      size={14}
                      className={
                        g.is_favorite ? 'fill-[var(--warn)] text-[var(--warn)]' : 'text-[var(--text-3)] hover:text-[var(--text)]'
                      }
                    />
                  </button>
                  <Link
                    href={`/groups/${encodeURIComponent(g.chatroom_id)}`}
                    className="text-[var(--text-3)] hover:text-[var(--text)]"
                  >
                    <ChevronRight size={14} />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function GroupsListFallback() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div>
            <div className="report-kicker">Group Directory</div>
            <div className="text-[15px] font-semibold">所有群</div>
            <div className="mt-0.5 text-[11px] text-[var(--text-3)]">加载中…</div>
          </div>
          <div className="control-surface flex items-center gap-2 rounded-md px-2.5 py-1.5">
            <Search size={13} className="text-[var(--text-3)]" />
            <div className="h-4 w-60" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="py-20 text-center text-[12px] text-[var(--text-3)]">加载中…</div>
        </div>
      </main>
    </div>
  );
}
