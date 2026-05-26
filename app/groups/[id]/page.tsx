'use client';

import { useEffect, useMemo, useState, use } from 'react';
import dynamicImport from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import MessageContent from '@/components/MessageContent';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Check,
  Copy,
  History,
  ListFilter,
  MessageSquare,
  Star,
  Trophy,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';

const ReactECharts = dynamicImport(() => import('echarts-for-react'), { ssr: false });

export const dynamic = 'force-dynamic';

type DailyHistory = { date: string; total: number };

type Detail = {
  ok: boolean;
  chatroom_id: string;
  date: string;
  stats: {
    chat: string;
    total: number;
    by_hour: Array<{ hour: number; count: number }>;
    by_type: Array<{ type: string; count: number }>;
    top_senders: Array<{ sender: string; count: number }>;
  } | null;
  recent: Array<{
    local_id: number;
    sender: string;
    content: string;
    time: string;
    timestamp: number;
    type: string;
  }>;
  daily_history: DailyHistory[];
};

export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const chatroomId = decodeURIComponent(id);
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get('date');
  const requestedLocalIdRaw = searchParams.get('local_id');
  const requestedLocalId =
    requestedLocalIdRaw && /^\d+$/.test(requestedLocalIdRaw)
      ? Number(requestedLocalIdRaw)
      : null;

  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  const [date, setDate] = useState(requestedDate ?? today);
  const [data, setData] = useState<Detail | null>(null);
  const [fav, setFav] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [targetNotFound, setTargetNotFound] = useState(false);

  const load = async (d: string) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/group/${encodeURIComponent(chatroomId)}?date=${d}&limit=500`);
      const j = (await r.json()) as Detail;
      if (!j.ok) {
        setErr('详情加载失败');
      } else {
        setData(j);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void load(date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatroomId, date]);

  useEffect(() => {
    if (!requestedLocalId) {
      setTargetNotFound(false);
      return;
    }
    if (loading || !data) return;

    const exists = data.recent.some((m) => m.local_id === requestedLocalId);
    if (!exists) {
      setTargetNotFound(true);
      return;
    }

    setTargetNotFound(false);
    let cancelled = false;
    let attempts = 0;
    const timers: number[] = [];
    const scrollToTarget = () => {
      if (cancelled) return;
      const target = document.querySelector<HTMLElement>(
        `[data-local-id="${requestedLocalId}"]`,
      );
      target?.scrollIntoView({ behavior: 'auto', block: 'center' });
      attempts += 1;
      if (attempts < 5) timers.push(window.setTimeout(scrollToTarget, 180));
    };
    const raf = window.requestAnimationFrame(scrollToTarget);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [data, loading, requestedLocalId]);

  useEffect(() => {
    if (requestedDate || !data || date !== today || (data.stats?.total ?? 0) > 0) return;
    const latest = data.daily_history
      .filter((d) => d.total > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (latest && latest.date !== date) queueMicrotask(() => setDate(latest.date));
  }, [data, date, requestedDate, today]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/group-tags?chatroom_id=${encodeURIComponent(chatroomId)}`);
        const j = await r.json();
        if (j.ok && Array.isArray(j.group_ids)) setFav(false); // tags only, fav read separately if needed
      } catch {}
    })();
  }, [chatroomId]);

  const toggleFav = async () => {
    const next = !fav;
    setFav(next);
    await fetch('/api/group-tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatroom_id: chatroomId, fav: next }),
    });
  };

  const copyMessages = async () => {
    const messages = data?.recent ?? [];
    if (messages.length === 0) return;
    const title = data?.stats?.chat ?? chatroomId;
    const text = [
      `# ${title} ${date}`,
      '',
      ...messages.map((m) => {
        const time = m.time.slice(11, 16);
        const content = m.content.replace(/\s+/g, ' ').trim();
        return `[${time}] ${m.sender}: ${content}`;
      }),
    ].join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const hourOption: EChartsOption | null = data?.stats
    ? {
        grid: { top: 20, right: 16, bottom: 28, left: 36 },
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#101812',
          borderColor: '#27342c',
          textStyle: { color: '#edf1e8' },
        },
        xAxis: {
          type: 'category',
          data: data.stats.by_hour.map((h) => `${h.hour}:00`),
          axisLine: { lineStyle: { color: '#27342c' } },
          axisLabel: { color: '#737f75', fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: 'rgba(154,174,158,0.12)' } },
          axisLabel: { color: '#737f75', fontSize: 10 },
        },
        series: [
          {
            type: 'bar',
            data: data.stats.by_hour.map((h) => h.count),
            itemStyle: { color: '#7dd3a8' },
            barWidth: 12,
          },
        ],
      }
    : null;

  const dailyOption: EChartsOption | null =
    data?.daily_history && data.daily_history.length > 0
      ? {
          grid: { top: 20, right: 16, bottom: 30, left: 36 },
          tooltip: {
            trigger: 'axis',
            backgroundColor: '#101812',
            borderColor: '#27342c',
            textStyle: { color: '#edf1e8' },
          },
          xAxis: {
            type: 'category',
            data: data.daily_history.map((d) => d.date.slice(5)),
            axisLine: { lineStyle: { color: '#27342c' } },
            axisLabel: { color: '#737f75', fontSize: 10 },
          },
          yAxis: {
            type: 'value',
            splitLine: { lineStyle: { color: 'rgba(154,174,158,0.12)' } },
            axisLabel: { color: '#737f75', fontSize: 10 },
          },
          series: [
            {
              type: 'bar',
              data: data.daily_history.map((d) => ({
                value: d.total,
                itemStyle: { color: d.date === date ? '#7dd3a8' : '#28372f' },
              })),
              barWidth: 14,
            },
          ],
        }
      : null;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="shrink-0 text-[var(--text-3)] hover:text-[var(--text)]">
              <ArrowLeft size={16} />
            </Link>
            <div className="min-w-0">
              <div className="report-kicker">Group Brief</div>
              <div className="truncate text-[15px] font-semibold">
                {data?.stats?.chat ?? (loading ? '加载中…' : chatroomId)}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
                {date} · 当日 {data?.stats?.total ?? 0} 条 · 历史 {data?.daily_history?.length ?? 0} 天
              </div>
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
            <button className={`btn ${fav ? 'btn-warn' : ''}`} onClick={toggleFav}>
              <Star size={13} />
              {fav ? '已收藏' : '收藏'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {err && <div className="card p-4 text-[12px] text-[var(--danger)]">{err}</div>}

          {/* 历史日活跃柱图 */}
          {dailyOption && (
            <div className="card p-5">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[14px] font-semibold">
                  <History size={14} className="text-[var(--accent)]" />
                  历史每日消息量
                </div>
                <div className="text-[11px] text-[var(--text-3)]">
                  共 {data!.daily_history.length} 天 · 点选日期查看
                </div>
              </div>
              <ReactECharts
                option={dailyOption}
                style={{ height: 160 }}
                onEvents={{
                  click: (e: { name: string }) => {
                    const matched = data?.daily_history.find((d) => d.date.slice(5) === e.name);
                    if (matched) setDate(matched.date);
                  },
                }}
              />
            </div>
          )}

          {/* 当日 24 小时分布 */}
          {hourOption && (data?.stats?.total ?? 0) > 0 && (
            <div className="card mt-4 p-5">
              <div className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold">
                <BarChart3 size={14} className="text-[var(--accent)]" />
                {date} 24 小时分布
              </div>
              <ReactECharts option={hourOption} style={{ height: 200 }} />
            </div>
          )}

          {/* Top 发言人 + 消息类型 */}
          {data?.stats && data.stats.total > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="card p-5">
                <div className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold">
                  <Trophy size={14} className="text-[var(--warn)]" />
                  Top 发言人
                </div>
                <div className="space-y-1">
                  {data.stats.top_senders.slice(0, 12).map((s, i) => (
                    <div
                      key={`${s.sender}-${i}`}
                      className="flex items-center justify-between text-[13px]"
                    >
                      <span className="truncate text-[var(--text-2)]">
                        {i + 1}. {s.sender}
                      </span>
                      <span className="tabular-nums text-[var(--text)]">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-5">
                <div className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold">
                  <ListFilter size={14} className="text-[var(--accent)]" />
                  消息类型
                </div>
                <div className="space-y-1">
                  {data.stats.by_type.map((t, i) => (
                    <div
                      key={`${t.type}-${i}`}
                      className="flex items-center justify-between text-[13px]"
                    >
                      <span className="text-[var(--text-2)]">{t.type}</span>
                      <span className="tabular-nums text-[var(--text)]">{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 当日完整消息列表 */}
          <div className="card mt-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-3">
              <div className="flex items-center gap-1.5 text-[14px] font-semibold">
                <MessageSquare size={14} className="text-[var(--accent)]" />
                {date} 完整消息
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn py-1 text-[12px]"
                  onClick={copyMessages}
                  disabled={loading || (data?.recent.length ?? 0) === 0}
                  title="复制当日完整消息"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
                <div className="text-[11px] text-[var(--text-3)]">
                  {loading ? '加载中…' : `共 ${data?.recent.length ?? 0} 条`}
                </div>
              </div>
            </div>
            {targetNotFound && (
              <div className="border-b border-[var(--border-soft)] bg-[rgba(245,158,11,0.08)] px-5 py-2 text-[12px] text-[var(--warn)]">
                未找到目标消息，可能不在当日或当前数据源。
              </div>
            )}
            {!loading && data?.recent && data.recent.length === 0 ? (
              <div className="py-12 text-center text-[12px] text-[var(--text-3)]">
                当日无消息
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-soft)]">
                {(data?.recent ?? []).map((m) => (
                  <div
                    key={m.local_id}
                    data-local-id={m.local_id}
                    className={`grid scroll-mt-24 grid-cols-[120px_1fr_60px_70px] gap-3 px-5 py-2 text-[12px] transition-colors hover:bg-[var(--surface-2)] ${
                      requestedLocalId === m.local_id
                        ? 'border-l-2 border-[var(--accent)] bg-[rgba(125,211,168,0.14)] ring-1 ring-inset ring-[rgba(125,211,168,0.45)]'
                        : 'border-l-2 border-transparent'
                    }`}
                  >
                    <span className="truncate font-medium text-[var(--text)]">{m.sender}</span>
                    <div className="text-[var(--text-2)]">
                      <MessageContent content={m.content} chatroomId={chatroomId} />
                    </div>
                    <span className="text-right text-[10px] text-[var(--text-3)]">{m.type}</span>
                    <span className="text-right text-[var(--text-3)] tabular-nums">
                      {m.time.slice(11)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
