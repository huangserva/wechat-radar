'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import {
  AlertTriangle,
  Calendar,
  CheckSquare,
  CircleCheck,
  Clock,
  Filter,
  RefreshCw,
} from 'lucide-react';

type TodoGroup = 'open' | 'done';
type TodoStatusFilter = 'all' | TodoGroup;
type EventStatusFilter = 'all' | 'pending' | 'confirmed' | 'expired';

type CommitmentTodo = {
  id: string;
  contact: string;
  summary: string;
  status: string;
  group: TodoGroup;
  created_date: string | null;
  resolved_date: string | null;
  deadline_date: string | null;
  urgent: boolean;
  is_overdue: boolean;
  context: string;
};

type CommitmentEvent = {
  id: number;
  scan_date: string;
  event_date: string | null;
  content: string;
  contact: string;
  status: string;
  is_overdue: boolean;
};

type CommitmentsResponse = {
  ok: boolean;
  available: boolean;
  freshness: {
    latest_date: string | null;
    todos_latest_date: string | null;
    calendar_latest_date: string | null;
  };
  stats: {
    todos_total: number;
    todos_open: number;
    todos_done: number;
    urgent_todos: number;
    calendar_total: number;
    calendar_active: number;
    calendar_expired: number;
    due_today: number;
    overdue: number;
  };
  contacts: string[];
  todos: CommitmentTodo[];
  calendar_events: CommitmentEvent[];
  error?: string;
};

const TODO_FILTERS: Array<{ key: TodoStatusFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
];

const EVENT_FILTERS: Array<{ key: EventStatusFilter; label: string }> = [
  { key: 'all', label: '全部日程' },
  { key: 'pending', label: '待确认' },
  { key: 'confirmed', label: '已确认' },
  { key: 'expired', label: '已过期' },
];

export default function CommitmentsPage() {
  const [todoStatus, setTodoStatus] = useState<TodoStatusFilter>('all');
  const [eventStatus, setEventStatus] = useState<EventStatusFilter>('all');
  const [contact, setContact] = useState('');
  const [data, setData] = useState<CommitmentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set('todo_status', todoStatus);
    params.set('event_status', eventStatus);
    if (contact) params.set('contact', contact);

    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await fetch(`/api/commitments?${params.toString()}`, { cache: 'no-store' });
        const j = (await r.json()) as CommitmentsResponse;
        if (cancelled) return;
        if (!r.ok || !j.ok) {
          setError(j.error ?? '加载失败');
          return;
        }
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
  }, [contact, eventStatus, todoStatus]);

  const groupedTodos = useMemo(() => ({
    open: data?.todos.filter((todo) => todo.group === 'open') ?? [],
    done: data?.todos.filter((todo) => todo.group === 'done') ?? [],
  }), [data]);

  const groupedEvents = useMemo(() => ({
    pending: data?.calendar_events.filter((event) => event.status === 'pending') ?? [],
    confirmed: data?.calendar_events.filter((event) => event.status === 'confirmed') ?? [],
    expired: data?.calendar_events.filter((event) => event.status === 'expired') ?? [],
  }), [data]);

  const freshness = data?.freshness.latest_date
    ? `数据截至 ${data.freshness.latest_date}`
    : data?.available === false
      ? 'assistant.db 不可读'
      : '等待 hermes 产物';

  const statusLine = loading
    ? '加载承诺与日程…'
    : error
      ? `错误：${error}`
      : `${freshness} · 待办 ${data?.stats.todos_total ?? 0} · 日程 ${data?.stats.calendar_total ?? 0}`;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div>
            <div className="report-kicker">Commitment Tracker</div>
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <CheckSquare size={16} className="text-[var(--accent)]" />
              承诺追踪 · 待办+截止
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-3)]">{statusLine}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-2)] xl:flex">
              <Calendar size={13} className="text-[var(--text-3)]" />
              <span>待办 {data?.freshness.todos_latest_date ?? '—'} / 日程 {data?.freshness.calendar_latest_date ?? '—'}</span>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setTodoStatus('all');
                setEventStatus('all');
                setContact('');
              }}
              disabled={loading}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              重置
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<CheckSquare size={14} className="text-[var(--accent)]" />}
              label="待办总数"
              value={loading ? '—' : data?.stats.todos_total ?? 0}
              sub={`Open ${data?.stats.todos_open ?? 0} · Done ${data?.stats.todos_done ?? 0}`}
            />
            <MetricCard
              icon={<AlertTriangle size={14} className="text-[var(--warn)]" />}
              label="紧急待办"
              value={loading ? '—' : data?.stats.urgent_todos ?? 0}
              sub="基于截止时间与紧急关键词"
              accent="warn"
            />
            <MetricCard
              icon={<Clock size={14} className="text-[var(--accent)]" />}
              label="今日截止"
              value={loading ? '—' : data?.stats.due_today ?? 0}
              sub="待办截止 + 日程时间"
            />
            <MetricCard
              icon={<CircleCheck size={14} className="text-[var(--danger)]" />}
              label="逾期/过期"
              value={loading ? '—' : data?.stats.overdue ?? 0}
              sub={`日程 ${data?.stats.calendar_expired ?? 0} · 待办含截止`}
              accent="danger"
            />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SegmentedFilter
              label="待办"
              options={TODO_FILTERS}
              value={todoStatus}
              onChange={setTodoStatus}
            />
            <SegmentedFilter
              label="日程"
              options={EVENT_FILTERS}
              value={eventStatus}
              onChange={setEventStatus}
            />
            <label className="control-surface flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]">
              <Filter size={13} className="text-[var(--text-3)]" />
              <select
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                className="bg-transparent text-[12px] outline-none"
              >
                <option value="">全部联系人</option>
                {(data?.contacts ?? []).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>

          {error ? (
            <EmptyPanel title="承诺数据加载失败" text={error} />
          ) : !loading && data && !data.available && data.todos.length === 0 && data.calendar_events.length === 0 ? (
            <EmptyPanel title="assistant.db 暂不可读" text="请先运行 hermes wechat-assistant 同步任务；页面会在数据可用后自动显示待办和日程。" />
          ) : (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)]">
              <section className="card min-w-0 overflow-hidden">
                <PanelHeader
                  title="待办"
                  count={data?.todos.length ?? 0}
                  meta="按 open / done 分组"
                />
                <div className="max-h-[calc(100vh-286px)] overflow-y-auto p-3">
                  {loading ? (
                    <LoadingRows />
                  ) : (
                    <div className="space-y-4">
                      {shouldShowTodoGroup(todoStatus, 'open') && (
                        <TodoGroup title="Open" items={groupedTodos.open} empty="暂无 open 待办" />
                      )}
                      {shouldShowTodoGroup(todoStatus, 'done') && (
                        <TodoGroup title="Done" items={groupedTodos.done} empty="暂无 done 待办" />
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="card min-w-0 overflow-hidden">
                <PanelHeader
                  title="日程"
                  count={data?.calendar_events.length ?? 0}
                  meta="pending / confirmed / expired"
                />
                <div className="max-h-[calc(100vh-286px)] overflow-y-auto p-3">
                  {loading ? (
                    <LoadingRows />
                  ) : (
                    <div className="space-y-4">
                      {shouldShowEventGroup(eventStatus, 'pending') && (
                        <EventGroup title="Pending" items={groupedEvents.pending} empty="暂无待确认日程" />
                      )}
                      {shouldShowEventGroup(eventStatus, 'confirmed') && (
                        <EventGroup title="Confirmed" items={groupedEvents.confirmed} empty="暂无已确认日程" />
                      )}
                      {shouldShowEventGroup(eventStatus, 'expired') && (
                        <EventGroup title="Expired" items={groupedEvents.expired} empty="暂无过期日程" />
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub: string;
  accent?: 'warn' | 'danger';
}) {
  const color = accent === 'danger' ? 'text-[var(--danger)]' : accent === 'warn' ? 'text-[var(--warn)]' : 'text-[var(--text)]';
  const top = accent === 'danger' ? 'bg-[var(--danger)]' : accent === 'warn' ? 'bg-[var(--warn)]' : 'bg-[var(--accent)]';

  return (
    <div className="card relative overflow-hidden px-5 py-4">
      <div className={`absolute inset-x-0 top-0 h-px ${top} opacity-70`} />
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-2)]">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-3)]">Metric</span>
      </div>
      <div className={`mt-3 text-[34px] font-semibold leading-none tabular-nums ${color}`}>{value}</div>
      <div className="mt-2 text-[11px] text-[var(--text-3)]">{sub}</div>
    </div>
  );
}

function SegmentedFilter<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="control-surface flex overflow-hidden rounded-md">
      <span className="border-r border-[var(--border-soft)] px-2 py-1.5 text-[11px] text-[var(--text-3)]">{label}</span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`px-2.5 py-1.5 text-[12px] transition-colors ${
            value === option.key
              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'text-[var(--text-2)] hover:text-[var(--text)]'
          }`}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PanelHeader({ title, count, meta }: { title: string; count: number; meta: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
      <div>
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="mt-0.5 text-[10px] text-[var(--text-3)]">{meta}</div>
      </div>
      <span className="signal-chip rounded px-2 py-1 text-[11px] tabular-nums">{count} 条</span>
    </div>
  );
}

function TodoGroup({ title, items, empty }: { title: string; items: CommitmentTodo[]; empty: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">
        <span>{title}</span>
        <span className="tabular-nums">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border-soft)] px-3 py-8 text-center text-[12px] text-[var(--text-3)]">{empty}</div>
      ) : (
        <div className="space-y-2">
          {items.map((todo) => (
            <TodoRow key={todo.id} todo={todo} />
          ))}
        </div>
      )}
    </div>
  );
}

function TodoRow({ todo }: { todo: CommitmentTodo }) {
  const dateLabel = todo.deadline_date
    ? `${todo.group === 'done' ? '完成' : '截止'} ${todo.deadline_date}`
    : '截止未识别';
  return (
    <div className={`rounded-md border px-3 py-3 ${
      todo.is_overdue
        ? 'border-[rgba(223,107,107,0.34)] bg-[var(--danger-soft)]'
        : todo.urgent
          ? 'border-[rgba(213,162,83,0.34)] bg-[var(--warn-soft)]'
          : 'border-[var(--border-soft)] bg-[var(--surface-2)]'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-[13px] font-medium leading-snug text-[var(--text)]">{todo.summary}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-3)]">
            <span>{todo.contact || '未标联系人'}</span>
            <span>创建 {todo.created_date ?? '—'}</span>
            <span>{dateLabel}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusChip status={todo.group === 'done' ? 'done' : todo.status} />
          {todo.is_overdue ? <RiskChip label="逾期" tone="danger" /> : todo.urgent ? <RiskChip label="紧急" tone="warn" /> : null}
        </div>
      </div>
      {todo.context && (
        <div className="mt-2 line-clamp-2 rounded bg-[var(--surface)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--text-3)]">{todo.context}</div>
      )}
    </div>
  );
}

function EventGroup({ title, items, empty }: { title: string; items: CommitmentEvent[]; empty: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">
        <span>{title}</span>
        <span className="tabular-nums">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border-soft)] px-3 py-8 text-center text-[12px] text-[var(--text-3)]">{empty}</div>
      ) : (
        <div className="space-y-2">
          {items.map((event) => (
            <EventRow key={`${event.id}-${event.status}`} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: CommitmentEvent }) {
  return (
    <div className={`rounded-md border px-3 py-3 ${
      event.status === 'expired' || event.is_overdue
        ? 'border-[rgba(223,107,107,0.34)] bg-[var(--danger-soft)]'
        : 'border-[var(--border-soft)] bg-[var(--surface-2)]'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-[13px] font-medium leading-snug">{event.content}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-3)]">
            <span>{event.contact || '未标联系人'}</span>
            <span>时间 {event.event_date ?? event.scan_date ?? '—'}</span>
            <span>扫描 {event.scan_date || '—'}</span>
          </div>
        </div>
        <StatusChip status={event.status} />
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone = status === 'done' || status === 'confirmed'
    ? 'text-[var(--accent)] border-[rgba(125,211,168,0.24)] bg-[var(--accent-soft)]'
    : status === 'expired' || status === 'cancelled'
      ? 'text-[var(--danger)] border-[rgba(223,107,107,0.24)] bg-[var(--danger-soft)]'
      : 'text-[var(--warn)] border-[rgba(213,162,83,0.24)] bg-[var(--warn-soft)]';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}

function RiskChip({ label, tone }: { label: string; tone: 'warn' | 'danger' }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
      tone === 'danger' ? 'bg-[var(--danger)] text-white' : 'bg-[var(--warn)] text-white'
    }`}>
      {label}
    </span>
  );
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="card flex min-h-[360px] items-center justify-center p-8 text-center">
      <div>
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-2 max-w-[520px] text-[12px] leading-relaxed text-[var(--text-3)]">{text}</div>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-[78px] animate-pulse rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)]" />
      ))}
    </div>
  );
}

function shouldShowTodoGroup(filter: TodoStatusFilter, group: TodoGroup): boolean {
  return filter === 'all' || filter === group;
}

function shouldShowEventGroup(filter: EventStatusFilter, group: Exclude<EventStatusFilter, 'all'>): boolean {
  return filter === 'all' || filter === group;
}

function statusLabel(status: string): string {
  if (status === 'open') return 'Open';
  if (status === 'done' || status === 'completed') return 'Done';
  if (status === 'pending') return 'Pending';
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'expired') return 'Expired';
  if (status === 'cancelled') return 'Cancelled';
  return status || 'Unknown';
}
