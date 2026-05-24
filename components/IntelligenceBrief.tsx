'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  Clipboard,
  ExternalLink,
  Flame,
  Lightbulb,
  Link2,
  Radar,
  Target,
  UserRoundCheck,
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

export default function IntelligenceBrief({ intelligence }: { intelligence?: DashboardIntelligence }) {
  const [copied, setCopied] = useState(false);
  const data =
    intelligence ??
    ({
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
    } satisfies DashboardIntelligence);
  const summary = useMemo(() => buildDailySummary(data), [data]);

  async function copySummary() {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="space-y-4">
      <section className="card flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="report-kicker">Briefing Note</div>
          <div className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold">
            <Radar size={14} className="text-[var(--accent)]" />
            今日情报简报
          </div>
          <div className="mt-1 truncate text-[12px] text-[var(--text-2)]">
            {summary.split('\n').slice(1, 4).join(' · ')}
          </div>
        </div>
        <button
          type="button"
          onClick={copySummary}
          className="btn shrink-0"
          disabled={!data.date}
          title="复制今日情报摘要"
        >
          {copied ? <Check size={13} /> : <Clipboard size={13} />}
          <span>{copied ? '已复制' : '复制摘要'}</span>
        </button>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
        <ActionPanel date={data.date} items={data.action_items} fallback={data.opportunities} />
        <TopicLifecyclePanel topics={data.topic_lifecycle} />
        <AnomalyPanel anomalies={data.anomalies} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
        <LinkHighlightPanel items={data.link_highlights} />
        <PeopleRadarPanel people={data.people_radar} fallback={data.signal_sources} />
        <ContentIdeaPanel ideas={data.content_ideas} />
      </div>

      <MustReadPanel date={data.date} items={data.must_read} />
    </div>
  );
}

function ActionPanel({
  date,
  items,
  fallback,
}: {
  date: string;
  items: DashboardActionItem[];
  fallback: DashboardOpportunityItem[];
}) {
  const displayItems =
    items.length > 0
      ? items
      : fallback.map((item) => ({
          ...item,
          why: '包含明确需求或行动线索，适合进入上下文判断',
          urgency: 'medium' as const,
        }));
  return (
    <section className="card min-h-[300px] p-4">
      <PanelTitle
        icon={<Target size={14} className="text-[var(--warn)]" />}
        title="今日值得出手"
        meta={`${displayItems.length} 条`}
      />
      {displayItems.length === 0 ? (
        <EmptyState text="暂无明确行动项" />
      ) : (
        <div className="mt-3 space-y-2">
          {displayItems.slice(0, 6).map((item) => (
            <Link
              key={`${item.chatroom_id}:${item.local_id}`}
              href={`/groups/${encodeURIComponent(item.chatroom_id)}?date=${date}`}
              className="block rounded-md border border-transparent px-2 py-2 transition-colors hover:border-[rgba(213,162,83,0.34)] hover:bg-[var(--surface-2)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded border border-[rgba(213,162,83,0.22)] bg-[var(--warn-soft)] px-1.5 py-0.5 text-[10px] text-[var(--warn)]">
                  {item.action}
                </span>
                <span className={urgencyClass(item.urgency)}>{urgencyText(item.urgency)}</span>
              </div>
              <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-[var(--text)]">{item.title}</div>
              <div className="mt-1 line-clamp-1 text-[10px] text-[var(--text-3)]">{item.why}</div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function TopicLifecyclePanel({ topics }: { topics: DashboardTopicLifecycle[] }) {
  return (
    <section className="card min-h-[300px] p-4">
      <PanelTitle
        icon={<Flame size={14} className="text-[var(--accent)]" />}
        title="趋势升温"
        meta={`${topics.length} 个话题`}
      />
      {topics.length === 0 ? (
        <EmptyState text="暂无可识别趋势" />
      ) : (
        <div className="mt-3 space-y-2">
          {topics.slice(0, 6).map((topic) => (
            <div key={topic.title} className="rounded-md px-2 py-2 hover:bg-[var(--surface-2)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="line-clamp-1 text-[12px] font-medium text-[var(--text)]">{topic.title}</div>
                  <div className="mt-1 line-clamp-1 text-[10px] text-[var(--text-3)]">{topic.reason}</div>
                </div>
                <span className={topicStatusClass(topic.status)}>{topicStatusText(topic.status)}</span>
              </div>
              <div className="mt-1 flex gap-2 text-[10px] text-[var(--text-3)]">
                <span>{topic.today_count} 条</span>
                <span>{topic.group_count} 群</span>
                <span>均值 {topic.previous_avg}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AnomalyPanel({ anomalies }: { anomalies: DashboardAnomalySignal[] }) {
  return (
    <section className="card min-h-[300px] p-4">
      <PanelTitle
        icon={<AlertTriangle size={14} className="text-[var(--warn)]" />}
        title="异常信号"
        meta={`${anomalies.length} 条`}
      />
      {anomalies.length === 0 ? (
        <EmptyState text="暂无异常波动" />
      ) : (
        <div className="mt-3 space-y-2">
          {anomalies.slice(0, 6).map((item) => {
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
            return item.href ? (
              <a
                key={`${item.kind}:${item.title}`}
                href={item.href}
                target={item.href.startsWith('http') ? '_blank' : undefined}
                rel={item.href.startsWith('http') ? 'noreferrer' : undefined}
                className="block rounded-md px-2 py-2 hover:bg-[var(--surface-2)]"
              >
                {body}
              </a>
            ) : (
              <div key={`${item.kind}:${item.title}`} className="rounded-md px-2 py-2 hover:bg-[var(--surface-2)]">
                {body}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LinkHighlightPanel({ items }: { items: DashboardLinkHighlight[] }) {
  return (
    <section className="card min-h-[300px] p-4">
      <PanelTitle
        icon={<Link2 size={14} className="text-[var(--accent)]" />}
        title="链接精选"
        meta={`${items.length} 条`}
      />
      {items.length === 0 ? (
        <EmptyState text="暂无高价值链接" />
      ) : (
        <div className="mt-3 space-y-2">
          {items.slice(0, 6).map((item) => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md px-2 py-2 hover:bg-[var(--surface-2)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="line-clamp-1 text-[12px] font-medium text-[var(--text)]">{item.title}</div>
                  <div className="mt-1 line-clamp-1 text-[10px] text-[var(--text-3)]">{item.verdict}</div>
                </div>
                <span className="signal-chip rounded px-1.5 py-0.5 text-[10px]">
                  {item.kind === 'tool' ? '工具' : '文章'}
                </span>
              </div>
              <div className="mt-1 flex gap-2 text-[10px] text-[var(--text-3)]">
                <span className="truncate">{item.domain}</span>
                <span>{item.group_count} 群</span>
                <span>{item.count} 次</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function PeopleRadarPanel({
  people,
  fallback,
}: {
  people: DashboardPeopleRadar[];
  fallback: DashboardSignalSource[];
}) {
  const displayPeople =
    people.length > 0
      ? people
      : fallback.map((source) => ({
          sender: source.sender,
          role: '分享者' as const,
          score: source.signal_count,
          group_count: source.group_count,
          signal_count: source.signal_count,
          top_group: source.top_group,
          reason: `${source.signal_count} 条高信号`,
        }));
  return (
    <section className="card min-h-[300px] p-4">
      <PanelTitle
        icon={<UserRoundCheck size={14} className="text-[var(--accent)]" />}
        title="人物雷达"
        meta={`${displayPeople.length} 人`}
      />
      {displayPeople.length === 0 ? (
        <EmptyState text="暂无稳定情报源" />
      ) : (
        <div className="mt-3 space-y-1.5">
          {displayPeople.slice(0, 7).map((person, index) => (
            <div key={`${person.sender}:${person.top_group}`} className="grid grid-cols-[22px_1fr_42px] items-center gap-2 rounded-md px-2 py-2 hover:bg-[var(--surface-2)]">
              <span className="rounded bg-[var(--surface-2)] py-0.5 text-center text-[10px] tabular-nums text-[var(--text-3)]">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12px] text-[var(--text)]">{person.sender}</div>
                <div className="truncate text-[10px] text-[var(--text-3)]">
                  {person.role} · {person.reason}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-semibold tabular-nums text-[var(--accent)]">{person.score}</div>
                <div className="text-[10px] text-[var(--text-3)]">{person.group_count} 群</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ContentIdeaPanel({ ideas }: { ideas: DashboardContentIdea[] }) {
  return (
    <section className="card min-h-[300px] p-4">
      <PanelTitle
        icon={<Lightbulb size={14} className="text-[var(--warn)]" />}
        title="内容选题"
        meta={`${ideas.length} 个`}
      />
      {ideas.length === 0 ? (
        <EmptyState text="暂无可转化选题" />
      ) : (
        <div className="mt-3 space-y-2">
          {ideas.slice(0, 6).map((idea) => (
            <div key={`${idea.suggested_channel}:${idea.title}`} className="rounded-md px-2 py-2 hover:bg-[var(--surface-2)]">
              <div className="flex items-start justify-between gap-2">
                <div className="line-clamp-2 text-[12px] font-medium leading-snug text-[var(--text)]">{idea.title}</div>
                <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-2)]">
                  {idea.suggested_channel}
                </span>
              </div>
              <div className="mt-1 line-clamp-1 text-[10px] text-[var(--text-3)]">{idea.angle}</div>
              <div className="mt-1 text-[10px] text-[var(--text-3)]">证据：{idea.evidence}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MustReadPanel({ date, items }: { date: string; items: DashboardSignalItem[] }) {
  return (
    <section className="card min-h-[300px] p-4">
      <PanelTitle
        icon={<Radar size={14} className="text-[var(--accent)]" />}
        title="最值得关注"
        meta={`${items.length} 条高信号`}
      />
      {items.length === 0 ? (
        <EmptyState text="暂无高信号消息" />
      ) : (
        <div className="mt-3 space-y-1">
          {items.slice(0, 5).map((item, index) => (
            <SignalRow key={`${item.chatroom_id}:${item.local_id}`} item={item} date={date} rank={index + 1} />
          ))}
        </div>
      )}
    </section>
  );
}

function SignalRow({
  item,
  date,
  rank,
}: {
  item: DashboardSignalItem;
  date: string;
  rank: number;
}) {
  return (
    <Link
      href={`/groups/${encodeURIComponent(item.chatroom_id)}?date=${date}`}
      className="grid grid-cols-[22px_1fr_16px] items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-[var(--surface-2)]"
    >
      <span className="rounded bg-[var(--surface-2)] py-0.5 text-center text-[10px] tabular-nums text-[var(--text-3)]">
        {rank}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-start justify-between gap-2">
          <span className="line-clamp-1 text-[12px] font-medium text-[var(--text)]">{item.title}</span>
          <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-3)]">
            {item.score}
          </span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-3)]">
          <span className="truncate">
            {item.chat_name} · {item.sender}
          </span>
          <span className="shrink-0 tabular-nums">{item.time.slice(11)}</span>
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {item.reasons.slice(0, 3).map((reason) => (
            <span
              key={reason}
              className="signal-chip rounded px-1.5 py-0.5 text-[10px]"
              title={reasonExplanation(reason)}
            >
              {reason}
            </span>
          ))}
        </span>
      </span>
      <ExternalLink size={12} className="mt-0.5 text-[var(--text-3)]" />
    </Link>
  );
}

function PanelTitle({ icon, title, meta }: { icon: ReactNode; title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-[14px] font-semibold">
        {icon}
        {title}
      </div>
      <div className="text-[11px] text-[var(--text-3)]">{meta}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-[12px] text-[var(--text-3)]">
      {text}
    </div>
  );
}

function buildDailySummary(data: DashboardIntelligence): string {
  const lines = [`${data.date || '今日'} 情报摘要`];
  lines.push(`出手：${data.action_items.slice(0, 3).map((item) => `${item.action}｜${item.title}`).join('；') || '暂无'}`);
  lines.push(`趋势：${data.topic_lifecycle.slice(0, 3).map((topic) => `${topic.title}(${topicStatusText(topic.status)})`).join('；') || '暂无'}`);
  lines.push(
    `链接：${data.link_highlights.slice(0, 3).map((item) => item.title).join('；') || '暂无'}`,
  );
  lines.push(
    `异常：${data.anomalies.slice(0, 2).map((item) => item.title).join('；') || '暂无'}`,
  );
  return lines.join('\n');
}

function urgencyText(urgency: DashboardActionItem['urgency']): string {
  if (urgency === 'high') return '高';
  if (urgency === 'medium') return '中';
  return '低';
}

function urgencyClass(urgency: DashboardActionItem['urgency']): string {
  const base = 'shrink-0 rounded px-1.5 py-0.5 text-[10px]';
  if (urgency === 'high') return `${base} bg-[var(--warn-soft)] text-[var(--warn)]`;
  if (urgency === 'medium') return `${base} bg-[var(--accent-soft)] text-[var(--accent)]`;
  return `${base} bg-[var(--surface-2)] text-[var(--text-3)]`;
}

function topicStatusText(status: DashboardTopicLifecycle['status']): string {
  if (status === 'spreading') return '扩散';
  if (status === 'rising') return '升温';
  if (status === 'cooling') return '退潮';
  return '高热';
}

function topicStatusClass(status: DashboardTopicLifecycle['status']): string {
  const base = 'shrink-0 rounded px-1.5 py-0.5 text-[10px]';
  if (status === 'spreading') return `${base} bg-[var(--accent-soft)] text-[var(--accent)]`;
  if (status === 'rising') return `${base} bg-[var(--warn-soft)] text-[var(--warn)]`;
  if (status === 'cooling') return `${base} bg-[var(--surface-2)] text-[var(--text-3)]`;
  return `${base} bg-[var(--surface-2)] text-[var(--text-2)]`;
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

function reasonExplanation(reason: string): string {
  const map: Record<string, string> = {
    '机会/需求': '包含合作、采购、报名、求推荐或找资源等可行动信号',
    '工具/产品': '提到了工具、产品、模型、插件、项目或技术栈',
    链接信号: '包含可跳转链接，适合进入原文或资源查看',
    可跟进: '含有联系、报名、评估、试用、帮忙等行动线索',
    长观点: '消息长度较高，可能包含完整观点或经验复盘',
    问题: '包含明确问题，可能适合回复或继续追踪',
  };
  return map[reason] ?? reason;
}
