'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clipboard,
  ExternalLink,
  FileText,
  Link2,
  Radar,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';

export interface DashboardSignalItem {
  chatroom_id: string;
  chat_name: string;
  local_id: number;
  sender: string;
  time: string;
  title: string;
  snippet: string;
  score: number;
  reasons: string[];
}

export interface DashboardOpportunityItem extends DashboardSignalItem {
  action: string;
}

export interface DashboardActionItem extends DashboardOpportunityItem {
  why: string;
  urgency: 'high' | 'medium' | 'low';
}

export interface DashboardSignalSource {
  sender: string;
  signal_count: number;
  group_count: number;
  top_group: string;
  last_seen: string;
  strengths: string[];
}

export interface DashboardTopicLifecycle {
  title: string;
  status: 'rising' | 'spreading' | 'hot' | 'cooling';
  today_count: number;
  previous_avg: number;
  group_count: number;
  reason: string;
  keywords: string[];
}

export interface DashboardLinkHighlight {
  kind: 'article' | 'tool';
  title: string;
  url: string;
  domain: string;
  source: string;
  score: number;
  verdict: string;
  count: number;
  group_count: number;
  last_seen: string;
}

export interface DashboardPeopleRadar {
  sender: string;
  role: '分享者' | '需求提出者' | '连接者' | '观点源';
  score: number;
  group_count: number;
  signal_count: number;
  top_group: string;
  reason: string;
}

export interface DashboardContentIdea {
  title: string;
  angle: string;
  suggested_channel: '公众号' | 'X' | '小红书' | '博客';
  evidence: string;
  source_count: number;
}

export interface DashboardAnomalySignal {
  kind: 'spike' | 'cross_group' | 'dense_links' | 'quiet_day';
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  href?: string;
}

export interface DashboardIntelligence {
  date: string;
  must_read: DashboardSignalItem[];
  opportunities: DashboardOpportunityItem[];
  signal_sources: DashboardSignalSource[];
  action_items: DashboardActionItem[];
  topic_lifecycle: DashboardTopicLifecycle[];
  link_highlights: DashboardLinkHighlight[];
  people_radar: DashboardPeopleRadar[];
  content_ideas: DashboardContentIdea[];
  anomalies: DashboardAnomalySignal[];
}

const EMPTY: DashboardIntelligence = {
  date: '',
  must_read: [],
  opportunities: [],
  signal_sources: [],
  action_items: [],
  topic_lifecycle: [],
  link_highlights: [],
  people_radar: [],
  content_ideas: [],
  anomalies: [],
};

type QueueItem = {
  title: string;
  href?: string;
  external?: boolean;
};

export default function IntelligenceBrief({ intelligence }: { intelligence?: DashboardIntelligence }) {
  const data = intelligence ?? EMPTY;
  const articles = data.link_highlights.filter((item) => item.kind === 'article');
  const tools = data.link_highlights.filter((item) => item.kind === 'tool');
  const summary = useMemo(() => buildSummary(data, articles, tools), [data, articles, tools]);
  const queue = useMemo(
    () => ({
      messages: data.must_read.slice(0, 2).map((item) => ({
        title: item.title,
        href: `/groups/${encodeURIComponent(item.chatroom_id)}?date=${data.date}`,
      })),
      articles: articles.slice(0, 2).map((item) => ({
        title: item.title,
        href: item.url,
        external: true,
      })),
      tools: tools.slice(0, 2).map((item) => ({
        title: item.title,
        href: item.url,
        external: true,
      })),
      anomalies: data.anomalies.slice(0, 2).map((item) => ({
        title: item.title,
        href: item.href,
        external: item.href?.startsWith('http') ?? false,
      })),
    }),
    [articles, data.anomalies, data.date, data.must_read, tools],
  );
  const [copied, setCopied] = useState(false);

  async function copySummary() {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="report-kicker">Today Queue</div>
            <div className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold">
              <Sparkles size={14} className="text-[var(--accent)]" />
              今日先看这些
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-4">
              <QueueBlock
                label="消息"
                items={queue.messages}
                empty="暂无高信号消息"
              />
              <QueueBlock
                label="文章"
                items={queue.articles}
                empty="暂无文章"
              />
              <QueueBlock
                label="工具"
                items={queue.tools}
                empty="暂无工具"
              />
              <QueueBlock
                label="异动"
                items={queue.anomalies}
                empty="暂无异动"
              />
            </div>
          </div>
          <button type="button" onClick={copySummary} className="btn shrink-0" disabled={!data.date}>
            {copied ? <Check size={13} /> : <Clipboard size={13} />}
            <span>{copied ? '已复制' : '复制摘要'}</span>
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_1fr_0.85fr]">
        <MustReadPanel date={data.date} items={data.must_read} actions={data.action_items} />
        <ResourcePanel articles={articles} tools={tools} />
        <WatchPanel date={data.date} anomalies={data.anomalies} people={data.people_radar} />
      </div>
    </div>
  );
}

function QueueBlock({
  label,
  items,
  empty,
}: {
  label: string;
  items: QueueItem[];
  empty: string;
}) {
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">{label}</div>
      <div className="mt-1 space-y-1">
        {items.length === 0 ? (
          <div className="text-[12px] text-[var(--text-3)]">{empty}</div>
        ) : (
          items.map((item, i) => (
            <QueueLink key={`${label}:${i}:${item.title}`} item={item} />
          ))
        )}
      </div>
    </div>
  );
}

function QueueLink({ item }: { item: QueueItem }) {
  const content = (
    <>
      <span className="line-clamp-2 min-w-0 flex-1">{item.title}</span>
      {item.href ? (
        item.external ? (
          <ExternalLink size={11} className="mt-1 shrink-0 text-[var(--text-3)]" />
        ) : (
          <ArrowRight size={11} className="mt-1 shrink-0 text-[var(--text-3)]" />
        )
      ) : null}
    </>
  );
  const className =
    'flex items-start gap-2 rounded px-1.5 py-1 text-[12px] leading-5 text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]';

  if (!item.href) return <div className={className}>{content}</div>;
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    );
  }
  return (
    <Link href={item.href} className={className}>
      {content}
    </Link>
  );
}

function MustReadPanel({
  date,
  items,
  actions,
}: {
  date: string;
  items: DashboardSignalItem[];
  actions: DashboardActionItem[];
}) {
  const promoted = mergeSignals(actions, items).slice(0, 7);
  return (
    <section className="card min-h-[360px] p-4">
      <PanelTitle
        icon={<Radar size={14} className="text-[var(--accent)]" />}
        title="关键话题与消息"
        meta={`${promoted.length} 条`}
      />
      {promoted.length === 0 ? (
        <EmptyState text="暂无高信号消息" />
      ) : (
        <div className="mt-3 space-y-1.5">
          {promoted.map((item, index) => (
            <Link
              key={`${item.chatroom_id}:${item.local_id}`}
              href={`/groups/${encodeURIComponent(item.chatroom_id)}?date=${date}`}
              className="grid grid-cols-[24px_1fr_16px] items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className="rounded bg-[var(--surface-2)] py-0.5 text-center text-[10px] tabular-nums text-[var(--text-3)]">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-[12px] font-medium leading-snug text-[var(--text)]">
                    {item.title}
                  </span>
                  {'action' in item && (
                    <span className={urgencyClass((item as DashboardActionItem).urgency)}>
                      {(item as DashboardActionItem).action}
                    </span>
                  )}
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-3)]">
                  <span className="truncate">
                    {item.chat_name} · {item.sender}
                  </span>
                  <span className="shrink-0 tabular-nums">{item.time.slice(11)}</span>
                </span>
                <span className="mt-1 line-clamp-1 text-[10px] text-[var(--text-3)]">
                  {'why' in item ? (item as DashboardActionItem).why : item.reasons.join(' / ')}
                </span>
              </span>
              <ArrowRight size={12} className="mt-0.5 text-[var(--text-3)]" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ResourcePanel({
  articles,
  tools,
}: {
  articles: DashboardLinkHighlight[];
  tools: DashboardLinkHighlight[];
}) {
  return (
    <section className="card min-h-[360px] p-4">
      <PanelTitle
        icon={<Link2 size={14} className="text-[var(--accent)]" />}
        title="链接情报"
        meta={`${articles.length + tools.length} 条`}
      />
      <div className="mt-3 grid grid-cols-1 gap-3 2xl:grid-cols-2">
        <ResourceColumn icon={<FileText size={13} />} title="文章 / 内容" items={articles.slice(0, 5)} />
        <ResourceColumn icon={<Wrench size={13} />} title="工具 / 资源" items={tools.slice(0, 5)} />
      </div>
    </section>
  );
}

function ResourceColumn({
  icon,
  title,
  items,
}: {
  icon: ReactNode;
  title: string;
  items: DashboardLinkHighlight[];
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-2)]">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <div className="mt-3 rounded-md border border-[var(--border-soft)] px-3 py-8 text-center text-[12px] text-[var(--text-3)]">
          暂无
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {items.map((item) => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md px-2 py-2 transition-colors hover:bg-[var(--surface-2)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="line-clamp-2 text-[12px] font-medium leading-snug text-[var(--text)]">
                  {item.title}
                </div>
                <ExternalLink size={12} className="mt-0.5 shrink-0 text-[var(--text-3)]" />
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-[var(--text-3)]">
                <span className={sourceClass(item.source)}>{sourceLabel(item.source)}</span>
                <span className="truncate">{item.domain}</span>
                <span>{item.group_count} 群</span>
                <span>{item.count} 次</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function sourceLabel(source: string): string {
  if (source === 'wechat_raw') return '微信原文';
  if (source === 'public_search') return '公开补链';
  if (source === 'manual') return '手动补链';
  return '网页链接';
}

function sourceClass(source: string): string {
  const base = 'shrink-0 rounded px-1.5 py-0.5';
  if (source === 'wechat_raw') return `${base} bg-[var(--accent-soft)] text-[var(--accent)]`;
  if (source === 'public_search' || source === 'manual') return `${base} bg-[var(--warn-soft)] text-[var(--warn)]`;
  return `${base} bg-[var(--surface-2)] text-[var(--text-3)]`;
}

function WatchPanel({
  date,
  anomalies,
  people,
}: {
  date: string;
  anomalies: DashboardAnomalySignal[];
  people: DashboardPeopleRadar[];
}) {
  return (
    <section className="card min-h-[360px] p-4">
      <PanelTitle
        icon={<AlertTriangle size={14} className="text-[var(--warn)]" />}
        title="需要盯一下"
        meta={`${anomalies.length} 个异动`}
      />
      <div className="mt-3 space-y-2">
        {anomalies.length === 0 ? (
          <EmptyState compact text="暂无明显异动" />
        ) : (
          anomalies.slice(0, 4).map((item) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="line-clamp-1 text-[12px] font-medium text-[var(--text)]">{item.title}</div>
                  <span className={severityClass(item.severity)}>{severityText(item.severity)}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-[var(--text-3)]">
                  {item.description}
                </div>
              </>
            );
            if (!item.href) {
              return (
                <div key={`${item.kind}:${item.title}`} className="rounded-md px-2 py-2 hover:bg-[var(--surface-2)]">
                  {body}
                </div>
              );
            }
            if (item.href.startsWith('http')) {
              return (
                <a
                  key={`${item.kind}:${item.title}`}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md px-2 py-2 hover:bg-[var(--surface-2)]"
                >
                  {body}
                </a>
              );
            }
            return (
              <Link key={`${item.kind}:${item.title}`} href={item.href} className="block rounded-md px-2 py-2 hover:bg-[var(--surface-2)]">
                {body}
              </Link>
            );
          })
        )}
      </div>

      <div className="mt-4 border-t border-[var(--border-soft)] pt-3">
        <div className="text-[12px] font-medium text-[var(--text-2)]">高信号人物</div>
        <div className="mt-2 space-y-1.5">
          {people.slice(0, 4).map((person) => (
            <div key={`${person.sender}:${person.top_group}`} className="rounded-md px-2 py-1.5 hover:bg-[var(--surface-2)]">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[12px] text-[var(--text)]">{person.sender}</div>
                <div className="text-[11px] tabular-nums text-[var(--accent)]">{person.score}</div>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-[var(--text-3)]">
                {person.role} · {person.reason} · {date}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function mergeSignals(actions: DashboardActionItem[], mustRead: DashboardSignalItem[]) {
  const seen = new Set<string>();
  const out: Array<DashboardSignalItem | DashboardActionItem> = [];
  for (const item of [...actions.slice(0, 4), ...mustRead]) {
    const key = `${item.chatroom_id}:${item.local_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildSummary(
  data: DashboardIntelligence,
  articles: DashboardLinkHighlight[],
  tools: DashboardLinkHighlight[],
): string {
  const lines = [`${data.date || '今日'} 情报队列`];
  lines.push(`消息：${data.must_read.slice(0, 2).map((item) => item.title).join('；') || '暂无'}`);
  lines.push(`文章：${articles.slice(0, 2).map((item) => item.title).join('；') || '暂无'}`);
  lines.push(`工具：${tools.slice(0, 2).map((item) => item.title).join('；') || '暂无'}`);
  lines.push(`异动：${data.anomalies.slice(0, 2).map((item) => item.title).join('；') || '暂无'}`);
  return lines.join('\n');
}

function PanelTitle({ icon, title, meta }: { icon: ReactNode; title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 text-[14px] font-semibold">
        {icon}
        {title}
      </div>
      <div className="shrink-0 text-[11px] text-[var(--text-3)]">{meta}</div>
    </div>
  );
}

function EmptyState({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center text-[12px] text-[var(--text-3)] ${compact ? 'h-[96px]' : 'h-[220px]'}`}>
      {text}
    </div>
  );
}

function urgencyClass(urgency: DashboardActionItem['urgency']): string {
  const base = 'shrink-0 rounded px-1.5 py-0.5 text-[10px]';
  if (urgency === 'high') return `${base} bg-[var(--warn-soft)] text-[var(--warn)]`;
  if (urgency === 'medium') return `${base} bg-[var(--accent-soft)] text-[var(--accent)]`;
  return `${base} bg-[var(--surface-2)] text-[var(--text-3)]`;
}

function severityText(severity: DashboardAnomalySignal['severity']): string {
  if (severity === 'high') return '高';
  if (severity === 'medium') return '中';
  return '低';
}

function severityClass(severity: DashboardAnomalySignal['severity']): string {
  const base = 'shrink-0 rounded px-1.5 py-0.5 text-[10px]';
  if (severity === 'high') return `${base} bg-[var(--warn-soft)] text-[var(--warn)]`;
  if (severity === 'medium') return `${base} bg-[var(--accent-soft)] text-[var(--accent)]`;
  return `${base} bg-[var(--surface-2)] text-[var(--text-3)]`;
}
