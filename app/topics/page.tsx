'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import MessageContent from '@/components/MessageContent';
import { Sparkles, RefreshCw, Calendar } from 'lucide-react';

type Topic = {
  id: number;
  date: string;
  title: string;
  summary: string;
  message_count: number;
  group_count: number;
};

type TopicMessage = {
  chatroom_id: string;
  chat_name: string;
  local_id: number;
  sender: string;
  content: string;
  time: string;
  timestamp: number;
  type: string;
  score: number;
};

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function TopicsPage() {
  const [date, setDate] = useState(() => localToday());
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ topic: Topic; messages: TopicMessage[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | undefined>(undefined);
  const autoBuildDates = useRef(new Set<string>());

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/topics?date=${date}`);
      const j = await r.json();
      if (j.ok) setTopics(j.topics);
    } catch {}
  }, [date]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/topics?date=${date}`);
        const j = await r.json();
        if (!cancelled && j.ok) setTopics(j.topics);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/topics/${selected}`);
      const j = await r.json();
      if (!cancelled && j.ok) {
        setDetail({
          topic: {
            id: j.id,
            date: j.date,
            title: j.title,
            summary: j.summary,
            message_count: j.message_count,
            group_count: j.group_count,
          },
          messages: j.messages,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const selectedDetail = selected ? detail : null;

  const build = useCallback(async () => {
    setBusy(true);
    setInfo('启动 Codex CLI 话题聚合…');
    try {
      const r = await fetch('/api/topics/build', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      if (!r.ok || !r.body) {
        setInfo('构建失败');
        setBusy(false);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 2);
          if (!chunk.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(chunk.slice(5).trim());
            if (evt.type === 'start') {
              setInfo(`${date} · 开始构建话题…`);
            } else if (evt.type === 'load') {
              setInfo(evt.message ?? '加载当日消息…');
            } else if (evt.type === 'llm' && evt.done !== undefined) {
              setInfo(evt.message ?? `Codex 聚合 ${evt.done}/${evt.total}`);
            } else if (evt.type === 'save' && evt.done !== undefined) {
              setInfo(`保存话题 ${evt.done}/${evt.total} · ${evt.message ?? ''}`);
            } else if (evt.type === 'finished' || evt.type === 'done') {
              setInfo(`完成 · ${evt.topics ?? evt.count ?? 0} 个话题`);
            } else if (evt.type === 'error') {
              setInfo('错误：' + evt.error);
            } else if (evt.message) {
              setInfo(evt.message);
            }
          } catch {}
        }
      }
    } catch (e) {
      setInfo('错误：' + (e instanceof Error ? e.message : 'unknown'));
    } finally {
      setBusy(false);
      reload();
    }
  }, [date, reload]);

  useEffect(() => {
    if (busy || topics.length > 0 || autoBuildDates.current.has(date)) return;
    autoBuildDates.current.add(date);
    build();
  }, [build, busy, date, topics.length]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div>
            <div className="report-kicker">Cross-Group Topics</div>
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <Sparkles size={16} className="text-[var(--accent)]" />
              话题雷达 · 跨群聚合
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
              {info ?? `${date} · ${topics.length} 个话题`}
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
            <button className={`btn ${busy ? 'btn-warn' : 'btn-primary'}`} onClick={build} disabled={busy}>
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
              <span>{busy ? '构建中…' : '构建话题'}</span>
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-[420px_1fr] overflow-hidden">
          <div className="overflow-y-auto border-r border-[var(--border-soft)] p-4">
            {topics.length === 0 ? (
              <div className="py-16 text-center text-[12px] text-[var(--text-3)]">
                {busy ? '正在自动构建当日话题…' : '当日暂无可聚合话题'}
              </div>
            ) : (
              <div className="space-y-2">
                {topics.map((t) => (
                  <button
                    key={t.id}
                    className={`card w-full p-4 text-left transition-colors ${
                      selected === t.id ? 'border-[rgba(125,211,168,0.48)] bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'
                    }`}
                    onClick={() => {
                      setDetail(null);
                      setSelected(t.id);
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold text-[var(--text)]">{t.title}</div>
                        {t.summary && (
                          <div className="mt-1 line-clamp-2 text-[11px] text-[var(--text-3)]">
                            {t.summary}
                          </div>
                        )}
                      </div>
                      <div className="text-right text-[10px] text-[var(--text-3)] shrink-0">
                        <div className="font-semibold text-[var(--accent)]">{t.message_count}</div>
                        <div>{t.group_count} 群</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-y-auto p-5">
            {!selectedDetail ? (
              <div className="flex h-full items-center justify-center text-[12px] text-[var(--text-3)]">
                左侧选一个话题查看跨群讨论
              </div>
            ) : (
              <div>
                <div className="mb-2 text-[18px] font-semibold">{selectedDetail.topic.title}</div>
                {selectedDetail.topic.summary && (
                  <div className="mb-4 text-[13px] leading-relaxed text-[var(--text-2)]">
                    {selectedDetail.topic.summary}
                  </div>
                )}
                <div className="mb-4 flex gap-4 text-[11px] text-[var(--text-3)]">
                  <span>消息：{selectedDetail.topic.message_count}</span>
                  <span>跨群：{selectedDetail.topic.group_count}</span>
                  <span>日期：{selectedDetail.topic.date}</span>
                </div>

                <div className="space-y-2">
                  {selectedDetail.messages.map((m) => (
                    <div
                      key={`${m.chatroom_id}-${m.local_id}`}
                      className="card p-3 text-[12px]"
                    >
                      <div className="flex items-center justify-between text-[11px] text-[var(--text-3)]">
                        <span>
                          <Link
                            href={`/groups/${encodeURIComponent(m.chatroom_id)}?date=${selectedDetail.topic.date}`}
                            className="text-[var(--accent)] hover:underline"
                          >
                            {m.chat_name}
                          </Link>
                          {' · '}
                          <span className="font-medium text-[var(--text-2)]">{m.sender}</span>
                        </span>
                        <span className="tabular-nums">{m.time?.slice(11) ?? ''}</span>
                      </div>
                      <div className="mt-1.5 text-[var(--text)]">
                        <MessageContent content={m.content} chatroomId={m.chatroom_id} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
