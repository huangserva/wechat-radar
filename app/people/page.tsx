'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import { safeExternalUrl } from '@/lib/safe-url';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Database,
  ExternalLink,
  Search,
  ShieldAlert,
  UserRound,
  Users,
} from 'lucide-react';

type SourceKind = 'todo' | 'calendar' | 'knowledge';
type PeopleFilter = 'all' | 'open' | 'calendar' | 'knowledge';

type PersonTodo = {
  id: string;
  summary: string;
  status: string;
  group: 'open' | 'done' | 'other';
  created_date: string | null;
  resolved_date: string | null;
  context: string;
};

type PersonEvent = {
  id: number;
  event_date: string | null;
  scan_date: string;
  content: string;
  status: string;
};

type PersonKnowledge = {
  id: number;
  date: string;
  topic: string;
  summary: string;
  category: string;
  source_group: string;
  links: string[];
  tags: string[];
};

type PersonSummary = {
  name: string;
  open_todos: number;
  done_todos: number;
  upcoming_events: number;
  knowledge_items: number;
  top_categories: string[];
  latest_activity_date: string | null;
  source_kinds: SourceKind[];
  todos: PersonTodo[];
  events: PersonEvent[];
  knowledge: PersonKnowledge[];
};

type PeopleResp = {
  ok: boolean;
  available: boolean;
  today: string;
  identity_notice: string;
  freshness: {
    todos_latest_date: string | null;
    calendar_latest_date: string | null;
    knowledge_latest_date: string | null;
  };
  stats: {
    people_total: number;
    with_open_todos: number;
    with_upcoming_events: number;
    knowledge_contributors: number;
  };
  categories: Array<{ key: string; count: number }>;
  profile_context: {
    available: boolean;
    source: string;
    updated_at: string | null;
    dimensions: string[];
    highlights: string[];
  };
  people: PersonSummary[];
  error?: string;
};

const FILTERS: Array<{ key: PeopleFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '有未完成承诺' },
  { key: 'calendar', label: '有近期日程' },
  { key: 'knowledge', label: '有知识贡献' },
];

export default function PeoplePage() {
  const [data, setData] = useState<PeopleResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [category, setCategory] = useState('all');
  const [selectedName, setSelectedName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/people', { cache: 'no-store' });
        const j = (await r.json()) as PeopleResp;
        if (cancelled) return;
        if (!j.ok) throw new Error(j.error ?? '加载失败');
        setData(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.people.filter((person) => {
      if (filter === 'open' && person.open_todos <= 0) return false;
      if (filter === 'calendar' && person.upcoming_events <= 0) return false;
      if (filter === 'knowledge' && person.knowledge_items <= 0) return false;
      if (category !== 'all' && !person.knowledge.some((item) => item.category === category)) return false;
      if (!q) return true;
      return personMatches(person, q);
    });
  }, [category, data, filter, query]);

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedName !== null) setSelectedName(null);
      return;
    }
    if (!selectedName || !filtered.some((person) => person.name === selectedName)) {
      setSelectedName(filtered[0].name);
    }
  }, [filtered, selectedName]);

  const selected = filtered.find((person) => person.name === selectedName) ?? filtered[0] ?? null;
  const latestText = data
    ? `待办 ${data.freshness.todos_latest_date ?? '—'} / 日程 ${data.freshness.calendar_latest_date ?? '—'} / 知识 ${data.freshness.knowledge_latest_date ?? '—'}`
    : '加载中…';

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="report-kicker">People Cockpit</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <Users size={16} className="text-[var(--accent)]" />
              <span>人物驾驶舱 · 互动对象 / 贡献者索引</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {loading ? '加载中…' : `${data?.stats.people_total ?? 0} 个显示名 · 无专表 · display name 聚合`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-2)] xl:flex">
              <Database size={13} className="text-[var(--accent)]" />
              <span>{latestText}</span>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[380px_1fr]">
          <aside className="flex min-h-0 flex-col border-r border-[var(--border-soft)] p-4">
            <div className="rounded-md border border-[rgba(213,162,83,0.28)] bg-[var(--warn-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--text-2)]">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--warn)]">
                <ShieldAlert size={13} />
                近似视图
              </div>
              {data?.identity_notice ?? '姓名来自文本字段，未做微信 ID 消歧。'}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniMetric label="未完成" value={data?.stats.with_open_todos ?? '--'} />
              <MiniMetric label="近期日程" value={data?.stats.with_upcoming_events ?? '--'} />
              <MiniMetric label="知识贡献者" value={data?.stats.knowledge_contributors ?? '--'} />
              <MiniMetric label="显示名" value={data?.stats.people_total ?? '--'} />
            </div>

            <div className="control-surface mt-3 flex items-center gap-2 rounded-md px-2.5 py-1.5">
              <Search size={13} className="text-[var(--text-3)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜人名 / 承诺 / 日程 / 知识"
                className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
              />
              {query && (
                <button className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)]" onClick={() => setQuery('')}>
                  清除
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setFilter(item.key)}
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    filter === item.key
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                      : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="control-surface mt-2 rounded-md px-2.5 py-1.5 text-[12px] outline-none"
            >
              <option value="all">全部知识类别</option>
              {(data?.categories ?? []).map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key} · {item.count}
                </option>
              ))}
            </select>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {error ? (
                <EmptyState title="人物数据加载失败" text={error} />
              ) : loading ? (
                <LoadingRows />
              ) : !data?.available && filtered.length === 0 ? (
                <EmptyState title="assistant.db 暂不可读" text="请先运行 hermes wechat-assistant 同步任务。" />
              ) : filtered.length === 0 ? (
                <EmptyState title="没有匹配人物" text="换一个关键词或筛选条件。" />
              ) : (
                <div className="space-y-1.5">
                  {filtered.map((person) => (
                    <PersonRow
                      key={person.name}
                      person={person}
                      active={person.name === selected?.name}
                      onClick={() => setSelectedName(person.name)}
                    />
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto p-5">
            {!selected ? (
              <EmptyState title="选择一个显示名" text="左侧列表为空或筛选条件没有命中。" tall />
            ) : (
              <PersonDetail person={selected} profile={data?.profile_context ?? null} identityNotice={data?.identity_notice ?? ''} />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function PersonDetail({
  person,
  profile,
  identityNotice,
}: {
  person: PersonSummary;
  profile: PeopleResp['profile_context'] | null;
  identityNotice: string;
}) {
  const activeTodos = person.todos.filter((todo) => todo.group === 'open');
  const doneTodos = person.todos.filter((todo) => todo.group === 'done');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="report-kicker">Display Name</div>
          <div className="mt-1 flex items-center gap-2 text-[22px] font-semibold">
            <UserRound size={20} className="text-[var(--accent)]" />
            <span className="truncate">{person.name}</span>
          </div>
          <div className="mt-1 text-[12px] text-[var(--text-3)]">
            最新活动 {person.latest_activity_date ?? '—'} · 来源 {sourceLabel(person.source_kinds)}
          </div>
        </div>
        <div className="rounded-md border border-[rgba(213,162,83,0.28)] bg-[var(--warn-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--text-2)]">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--warn)]">
            <AlertTriangle size={13} />
            身份边界
          </div>
          <div className="mt-0.5 max-w-[420px]">{identityNotice}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard icon={<CheckIcon />} label="未完成承诺" value={person.open_todos} sub={`Done ${person.done_todos}`} />
        <MetricCard icon={<CalendarClock size={14} />} label="近期日程" value={person.upcoming_events} sub={`${person.events.length} 条 active 日程`} />
        <MetricCard icon={<BookOpen size={14} />} label="知识贡献" value={person.knowledge_items} sub={person.top_categories.join(' / ') || '暂无类别'} />
        <MetricCard icon={<Users size={14} />} label="来源类型" value={person.source_kinds.length} sub={sourceLabel(person.source_kinds)} />
      </div>

      <ProfileCard profile={profile} />

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1fr_1fr]">
        <Panel title="承诺列表" meta={`Open ${activeTodos.length} · Done ${doneTodos.length}`}>
          {person.todos.length === 0 ? (
            <SmallEmpty text="没有从 todos.contact 派生到承诺。" />
          ) : (
            <div className="space-y-2">
              {activeTodos.map((todo) => <TodoCard key={todo.id} todo={todo} />)}
              {doneTodos.slice(0, 8).map((todo) => <TodoCard key={todo.id} todo={todo} muted />)}
            </div>
          )}
        </Panel>

        <Panel title="日程列表" meta={`${person.events.length} 条 pending/confirmed`}>
          {person.events.length === 0 ? (
            <SmallEmpty text="没有从 calendar.contact 派生到近期日程。" />
          ) : (
            <div className="space-y-2">
              {person.events.slice(0, 16).map((event) => <EventCard key={event.id} event={event} />)}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="知识贡献" meta={`${person.knowledge_items} 条 · 按 sender 文本聚合`}>
        {person.knowledge.length === 0 ? (
          <SmallEmpty text="没有从 knowledge.sender 派生到知识贡献。" />
        ) : (
          <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
            {person.knowledge.slice(0, 20).map((item) => <KnowledgeCard key={item.id} item={item} />)}
          </div>
        )}
      </Panel>
    </div>
  );
}

function PersonRow({ person, active, onClick }: { person: PersonSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        active
          ? 'border-[rgba(125,211,168,0.48)] bg-[var(--accent-soft)]'
          : 'border-[var(--border-soft)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--text)]">{person.name}</div>
          <div className="mt-0.5 text-[10px] text-[var(--text-3)]">最新 {person.latest_activity_date ?? '—'}</div>
        </div>
        <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">
          {sourceLabel(person.source_kinds)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {person.open_todos > 0 && <CountChip label="Open" value={person.open_todos} tone="warn" />}
        {person.upcoming_events > 0 && <CountChip label="日程" value={person.upcoming_events} />}
        {person.knowledge_items > 0 && <CountChip label="知识" value={person.knowledge_items} />}
      </div>
    </button>
  );
}

function ProfileCard({ profile }: { profile: PeopleResp['profile_context'] | null }) {
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <ShieldAlert size={14} className="text-[var(--accent)]" />
          我的沟通偏好背景
        </div>
        <div className="text-[10px] text-[var(--text-3)]">
          {profile?.available ? `${profile.source} · ${profile.updated_at ?? '未标日期'}` : '未读取'}
        </div>
      </div>
      <div className="mt-1 text-[11px] leading-5 text-[var(--text-3)]">
        只描述 A（我）的表达偏好，用来提醒解读语境；不是他人画像，也不作为任何人的证据。
      </div>
      {profile?.available && profile.highlights.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-[11px] leading-5 text-[var(--text-2)] xl:grid-cols-3">
          {profile.highlights.slice(0, 3).map((item, index) => (
            <li key={`${item}-${index}`} className="rounded bg-[var(--surface-2)] px-2 py-1.5">
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TodoCard({ todo, muted }: { todo: PersonTodo; muted?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${muted ? 'border-[var(--border-soft)] bg-[var(--surface)] opacity-78' : 'border-[var(--border-soft)] bg-[var(--surface-2)]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="line-clamp-2 text-[12px] font-medium">{todo.summary}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[var(--text-3)]">
            <span>创建 {todo.created_date ?? '—'}</span>
            {todo.resolved_date ? <span>完成 {todo.resolved_date}</span> : null}
          </div>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${todo.group === 'open' ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
          {todo.status}
        </span>
      </div>
      {todo.context ? <div className="mt-1 line-clamp-2 text-[11px] text-[var(--text-3)]">{todo.context}</div> : null}
    </div>
  );
}

function EventCard({ event }: { event: PersonEvent }) {
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="line-clamp-2 text-[12px] font-medium">{event.content || '未标内容'}</div>
          <div className="mt-1 text-[10px] text-[var(--text-3)]">时间 {event.event_date ?? event.scan_date ?? '—'} · 扫描 {event.scan_date || '—'}</div>
        </div>
        <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">{event.status}</span>
      </div>
    </div>
  );
}

function KnowledgeCard({ item }: { item: PersonKnowledge }) {
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold leading-snug">{item.topic}</div>
          {item.summary ? <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--text-2)]">{item.summary}</div> : null}
        </div>
        <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">{item.category}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-[var(--text-3)]">
        <span>{item.date}</span>
        <span>{item.source_group || '未知来源群'}</span>
      </div>
      {item.links.length > 0 ? (
        <div className="mt-2 space-y-1">
          {item.links.slice(0, 3).map((url, index) => {
            const href = safeExternalUrl(url);
            return href ? (
              <a
                key={`${url}-${index}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5 text-[11px] text-[var(--text-2)] hover:text-[var(--accent)]"
                title={href}
              >
                <ExternalLink size={11} className="shrink-0 text-[var(--text-3)] group-hover:text-[var(--accent)]" />
                <span className="truncate">{url}</span>
              </a>
            ) : (
              <div key={`${url}-${index}`} className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)]" title="非 http(s) 链接，已禁用">
                <ExternalLink size={11} className="shrink-0" />
                <span className="truncate line-through">{url}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Panel({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-2">
        <div className="text-[12px] font-semibold">{title}</div>
        <div className="text-[10px] text-[var(--text-3)]">{meta}</div>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number | string; sub: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-2)]">
        <span className="flex items-center gap-1.5 text-[var(--text-2)]">{icon}{label}</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-3)]">Metric</span>
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-[var(--text-3)]">{sub}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2">
      <div className="text-[10px] text-[var(--text-3)]">{label}</div>
      <div className="mt-1 text-[20px] font-semibold leading-none tabular-nums">{value}</div>
    </div>
  );
}

function CountChip({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${tone === 'warn' ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>
      {label} {value}
    </span>
  );
}

function SmallEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--border-soft)] px-3 py-8 text-center text-[12px] text-[var(--text-3)]">
      {text}
    </div>
  );
}

function EmptyState({ title, text, tall }: { title: string; text: string; tall?: boolean }) {
  return (
    <div className={`flex items-center justify-center rounded-md border border-dashed border-[var(--border-soft)] px-4 py-8 text-center ${tall ? 'min-h-[420px]' : ''}`}>
      <div>
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="mt-1 text-[11px] leading-5 text-[var(--text-3)]">{text}</div>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="h-[72px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface)]" />
      ))}
    </div>
  );
}

function CheckIcon() {
  return <AlertTriangle size={14} />;
}

function sourceLabel(kinds: SourceKind[]): string {
  const labels = kinds.map((kind) => {
    if (kind === 'todo') return '承诺';
    if (kind === 'calendar') return '日程';
    return '知识';
  });
  return labels.join(' / ') || '—';
}

function personMatches(person: PersonSummary, q: string): boolean {
  if (person.name.toLowerCase().includes(q)) return true;
  return [
    ...person.todos.flatMap((todo) => [todo.summary, todo.context]),
    ...person.events.map((event) => event.content),
    ...person.knowledge.flatMap((item) => [item.topic, item.summary, item.category, item.source_group, ...item.tags]),
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(q));
}
