import { NextRequest, NextResponse } from 'next/server';
import {
  assistantDbAvailable,
  assistantDbInventory,
  getCalendarEvents,
  getTodos,
  type AssistantCalendarEvent,
  type AssistantTodo,
} from '@/lib/assistant-source';

export const dynamic = 'force-dynamic';

type TodoGroup = 'open' | 'done';
type TodoStatusFilter = 'all' | TodoGroup;
type EventStatusFilter = 'all' | 'pending' | 'confirmed' | 'expired';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const todoStatus = normalizeTodoStatus(url.searchParams.get('todo_status'));
    const eventStatus = normalizeEventStatus(url.searchParams.get('event_status'));
    const contact = clean(url.searchParams.get('contact'));
    const since = clean(url.searchParams.get('since'));

    const rawTodos = getTodos({
      status: todoStatus === 'open' ? 'open' : undefined,
      contact: contact || undefined,
      limit: 500,
    });
    const queriedEvents = getCalendarEvents({
      since: since || undefined,
      status: eventStatus === 'all' ? undefined : eventStatus,
      limit: 500,
    });
    const rawEvents = contact
      ? queriedEvents.filter((event) => event.contact === contact)
      : queriedEvents;
    const allContacts = uniqueContacts(
      contact ? getTodos({ limit: 500 }) : rawTodos,
      contact || eventStatus !== 'all' || since ? getCalendarEvents({ limit: 500 }) : queriedEvents,
    );

    const today = localToday();
    const todos = rawTodos
      .map((todo) => normalizeTodo(todo, today))
      .filter((todo) => todoStatus === 'all' || todo.group === todoStatus);
    const calendar_events = rawEvents.map((event) => normalizeEvent(event, today));
    const inventory = assistantDbInventory();
    const todosInventory = inventory.find((row) => row.table === 'todos');
    const calendarInventory = inventory.find((row) => row.table === 'calendar_events');

    const openTodos = todos.filter((todo) => todo.group === 'open');
    const doneTodos = todos.filter((todo) => todo.group === 'done');
    const activeEvents = calendar_events.filter((event) => event.status === 'pending' || event.status === 'confirmed');
    const expiredEvents = calendar_events.filter((event) => event.status === 'expired');
    const overdueEvents = calendar_events.filter((event) => event.status === 'expired' || event.is_overdue);

    return NextResponse.json({
      ok: true,
      available: assistantDbAvailable(),
      filters: {
        todo_status: todoStatus,
        event_status: eventStatus,
        contact,
        since,
      },
      freshness: {
        latest_date: maxDate([todosInventory?.latest_date, calendarInventory?.latest_date]),
        todos_latest_date: todosInventory?.latest_date ?? null,
        calendar_latest_date: calendarInventory?.latest_date ?? null,
      },
      stats: {
        todos_total: todos.length,
        todos_open: openTodos.length,
        todos_done: doneTodos.length,
        urgent_todos: todos.filter((todo) => todo.urgent).length,
        calendar_total: calendar_events.length,
        calendar_active: activeEvents.length,
        calendar_expired: expiredEvents.length,
        due_today: todos.filter((todo) => todo.deadline_date === today).length
          + calendar_events.filter((event) => event.event_date === today).length,
        overdue: todos.filter((todo) => todo.is_overdue).length + overdueEvents.length,
      },
      contacts: allContacts,
      todos,
      calendar_events,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/commitments failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function normalizeTodo(todo: AssistantTodo, today: string) {
  const status = todo.status || 'open';
  const group: TodoGroup = isDoneStatus(status) ? 'done' : 'open';
  const deadlineDate = extractDate([todo.summary, todo.context].join('\n'))
    ?? (group === 'done' ? todo.resolved_date : null);
  const urgent = group === 'open' && (
    hasUrgentKeyword(`${todo.summary}\n${todo.context}`)
    || Boolean(deadlineDate && daysBetween(today, deadlineDate) <= 1)
  );

  return {
    id: todo.id,
    contact: todo.contact,
    summary: todo.summary,
    status,
    group,
    created_date: todo.created_date,
    resolved_date: todo.resolved_date,
    deadline_date: deadlineDate,
    urgent,
    is_overdue: group === 'open' && Boolean(deadlineDate && deadlineDate < today),
    context: todo.context,
    updated_ts: todo.updated_ts,
  };
}

function normalizeEvent(event: AssistantCalendarEvent, today: string) {
  const status = event.status || 'pending';
  return {
    id: event.id,
    scan_date: event.scan_date,
    event_date: event.event_date,
    content: event.content,
    contact: event.contact,
    status,
    is_overdue: (status === 'pending' || status === 'confirmed') && Boolean(event.event_date && event.event_date < today),
  };
}

function normalizeTodoStatus(value: string | null): TodoStatusFilter {
  if (value === 'open' || value === 'done') return value;
  return 'all';
}

function normalizeEventStatus(value: string | null): EventStatusFilter {
  if (value === 'pending' || value === 'confirmed' || value === 'expired') return value;
  return 'all';
}

function isDoneStatus(status: string): boolean {
  return status === 'done' || status === 'completed' || status === 'cancelled';
}

function clean(value: string | null): string {
  return value?.trim() ?? '';
}

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function extractDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const monthDay = text.match(/\b(\d{1,2})[月/-](\d{1,2})日?\b/);
  if (monthDay) {
    return `${new Date().getFullYear()}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
  }
  return null;
}

function hasUrgentKeyword(text: string): boolean {
  return /今天|今晚|明天|马上|尽快|尽早|截止|deadline|urgent|紧急|开会|会议/i.test(text);
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.floor((end - start) / 86_400_000);
}

function maxDate(values: Array<string | null | undefined>): string | null {
  const dates = values.filter((date): date is string => Boolean(date));
  return dates.length ? dates.sort().at(-1) ?? null : null;
}

function uniqueContacts(todos: AssistantTodo[], events: AssistantCalendarEvent[]): string[] {
  const contacts = new Set<string>();
  for (const todo of todos) {
    if (todo.contact) contacts.add(todo.contact);
  }
  for (const event of events) {
    if (event.contact) contacts.add(event.contact);
  }
  return Array.from(contacts).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).slice(0, 120);
}
