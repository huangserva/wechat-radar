'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import MessageContent from '@/components/MessageContent';
import { AtSign, ChevronRight, Search } from 'lucide-react';

type MentionItem = {
  chatroom_id: string;
  chat_name: string;
  local_id: number;
  sender: string;
  content: string;
  time: string;
  timestamp: number;
  seen: number;
};

type MentionsResp = {
  ok: boolean;
  total: number;
  items: MentionItem[];
};

function dateOf(time: string) {
  return time?.slice(0, 10) || '';
}

export default function MentionsPage() {
  const [data, setData] = useState<MentionsResp | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/mentions?limit=5000');
        const j = (await r.json()) as MentionsResp;
        if (!cancelled && j.ok) setData(j);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const keyword = q.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) => {
      const haystack = `${item.chat_name} ${item.sender} ${item.content}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [data, q]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <AtSign size={16} className="text-[var(--warn)]" />
              @ 我的消息
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
              {data ? `${filtered.length} / ${data.total} 条` : '加载中…'}
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5">
            <Search size={13} className="text-[var(--text-3)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索群名、发送人或内容…"
              className="w-72 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-3)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!data ? (
            <div className="py-20 text-center text-[12px] text-[var(--text-3)]">加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-[12px] text-[var(--text-3)]">没有匹配的 @ 消息</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((item) => {
                const date = dateOf(item.time);
                return (
                  <div key={`${item.chatroom_id}-${item.local_id}`} className="card p-3 text-[12px]">
                    <div className="flex items-start justify-between gap-3 text-[11px] text-[var(--text-3)]">
                      <div className="min-w-0">
                        <Link
                          href={`/groups/${encodeURIComponent(item.chatroom_id)}${date ? `?date=${date}` : ''}`}
                          className="text-[var(--accent)] hover:underline"
                        >
                          {item.chat_name}
                        </Link>
                        <span>{' · '}</span>
                        <span className="font-medium text-[var(--text-2)]">{item.sender || '未知发送人'}</span>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <div>{item.time || '未知时间'}</div>
                      </div>
                    </div>
                    <div className="mt-2 leading-relaxed text-[var(--text)]">
                      <MessageContent content={item.content} chatroomId={item.chatroom_id} />
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Link
                        href={`/groups/${encodeURIComponent(item.chatroom_id)}${date ? `?date=${date}` : ''}`}
                        className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)] hover:text-[var(--text)]"
                      >
                        <span>查看群记录</span>
                        <ChevronRight size={13} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
