'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import MessageContent from '@/components/MessageContent';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Calendar, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';

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

type TopicTrend = {
  trend_key: string;
  title: string;
  recent_week: string;
  prev_week: string;
  recent_count: number;
  prev_count: number;
  delta_pct: number;
  trend_score: number;
  label: '升温' | '冷却' | '稳定';
  sparkline: number[];
  week_count: number;
  topic_count: number;
  total_messages: number;
  total_groups: number;
};

type TopicTrendsPayload = {
  available: boolean;
  window_weeks: string[];
  summary: {
    total_trends: number;
    warming: number;
    cooling: number;
    stable: number;
  };
  items: TopicTrend[];
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
  const [trends, setTrends] = useState<TopicTrendsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | undefined>(undefined);
  const autoBuildDates = useRef(new Set<string>());

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/topics?date=${date}`);
      const j = await r.json();
      if (j.ok) {
        setTopics(j.topics);
        setTrends(j.trends ?? null);
      }
    } catch {}
  }, [date]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/topics?date=${date}`);
        const j = await r.json();
        if (!cancelled && j.ok) {
          setTopics(j.topics);
          setTrends(j.trends ?? null);
        }
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TopicTrendsStrip trends={trends} />

          <div className="grid min-h-0 flex-1 grid-cols-[420px_1fr] overflow-hidden">
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
        </div>
      </main>
    </div>
  );
}

function TopicTrendsStrip({ trends }: { trends: TopicTrendsPayload | null }) {
  if (!trends?.available || trends.items.length === 0) return null;
  const visible = trends.items.slice(0, 6);
  const weeks = trends.window_weeks.slice(-8);

  return (
    <section className="border-b border-[var(--border-soft)] bg-[var(--surface)] px-5 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <TrendingUp size={15} className="text-[var(--accent)]" />
            话题趋势 · 近 8 周
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--text-3)]">
            {weeks[0]} → {weeks.at(-1)} · 升温 {trends.summary.warming} / 冷却 {trends.summary.cooling}
          </div>
        </div>
        <div className="text-[10px] text-[var(--text-3)]">{trends.summary.total_trends} 条趋势 · 关键词聚合</div>
      </div>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-3 2xl:grid-cols-6">
        {visible.map((item) => <TrendCard key={item.trend_key} item={item} />)}
      </div>
    </section>
  );
}

function TrendCard({ item }: { item: TopicTrend }) {
  const tone = item.label === '升温' ? 'up' : item.label === '冷却' ? 'down' : 'flat';
  const Icon = tone === 'up' ? ArrowUpRight : tone === 'down' ? ArrowDownRight : ArrowRight;
  const textClass = tone === 'up' ? 'text-[var(--accent)]' : tone === 'down' ? 'text-[var(--warn)]' : 'text-[var(--text-3)]';
  const chipClass = tone === 'up'
    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
    : tone === 'down'
      ? 'bg-[var(--warn-soft)] text-[var(--warn)]'
      : 'bg-[var(--surface-2)] text-[var(--text-3)]';

  return (
    <article className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold">{item.title}</div>
          <div className="mt-0.5 text-[10px] text-[var(--text-3)]">{item.week_count} 周 · {item.total_messages} 消息</div>
        </div>
        <div className={`flex shrink-0 items-center gap-0.5 text-[13px] font-semibold tabular-nums ${textClass}`}>
          <Icon size={13} />
          {item.delta_pct > 0 ? '+' : ''}{item.delta_pct}%
        </div>
      </div>

      <Sparkline values={item.sparkline} tone={tone} />

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${chipClass}`}>{item.label}</span>
        <span className="text-[10px] text-[var(--text-3)]">本周 {item.recent_count} / 前周 {item.prev_count}</span>
      </div>
    </article>
  );
}

function Sparkline({ values, tone }: { values: number[]; tone: 'up' | 'down' | 'flat' }) {
  const width = 124;
  const height = 36;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? width : (index / (values.length - 1)) * width;
    const y = height - (value / max) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const stroke = tone === 'up' ? 'var(--accent)' : tone === 'down' ? 'var(--warn)' : 'var(--text-3)';

  return (
    <svg className="mt-2 h-9 w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="话题趋势折线">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((value, index) => {
        const x = values.length <= 1 ? width : (index / (values.length - 1)) * width;
        const y = height - (value / max) * (height - 4) - 2;
        return <circle key={`${index}-${value}`} cx={x} cy={y} r="2" fill={stroke} />;
      })}
    </svg>
  );
}
