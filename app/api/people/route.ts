import { NextResponse } from 'next/server';
import {
  assistantDbAvailable,
  assistantDbInventory,
  getCalendarEvents,
  getKnowledgeItems,
  getTodos,
  type AssistantCalendarEvent,
  type AssistantKnowledgeItem,
  type AssistantTodo,
} from '@/lib/assistant-source';
import { loadLabProfileContext } from '@/lib/lab-profile';

export const dynamic = 'force-dynamic';

type SourceKind = 'todo' | 'calendar' | 'knowledge';

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

type PersonRecord = {
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

type MutablePerson = Omit<PersonRecord, 'top_categories' | 'source_kinds'> & {
  category_counts: Map<string, number>;
  source_kind_set: Set<SourceKind>;
};

export async function GET() {
  try {
    const today = localToday();
    const todos = getTodos({ limit: 1000 });
    const events = getCalendarEvents({ limit: 1000 });
    const knowledge = getKnowledgeItems({ limit: 1000 });
    const people = buildPeople(todos, events, knowledge, today);
    const inventory = assistantDbInventory();
    const profile = loadLabProfileContext();

    return NextResponse.json({
      ok: true,
      available: assistantDbAvailable(),
      today,
      identity_notice: '姓名来自 assistant.db 的 contact/sender 文本字段，未做微信 ID 消歧；可能合并同名或拆分同一人。',
      freshness: {
        todos_latest_date: latestFor(inventory, 'todos'),
        calendar_latest_date: latestFor(inventory, 'calendar_events'),
        knowledge_latest_date: latestFor(inventory, 'knowledge_items'),
      },
      stats: {
        people_total: people.length,
        with_open_todos: people.filter((p) => p.open_todos > 0).length,
        with_upcoming_events: people.filter((p) => p.upcoming_events > 0).length,
        knowledge_contributors: people.filter((p) => p.knowledge_items > 0).length,
      },
      categories: categoryStats(people),
      profile_context: {
        available: profile.available,
        source: profile.source,
        updated_at: profile.updated_at ?? null,
        dimensions: profile.dimensions,
        highlights: profileHighlights(profile.text),
      },
      people,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/people failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function buildPeople(
  todos: AssistantTodo[],
  events: AssistantCalendarEvent[],
  knowledge: AssistantKnowledgeItem[],
  today: string,
): PersonRecord[] {
  const people = new Map<string, MutablePerson>();

  for (const todo of todos) {
    const person = getPerson(people, todo.contact);
    if (!person) continue;
    const group = todoGroup(todo.status);
    person.source_kind_set.add('todo');
    if (group === 'open') person.open_todos += 1;
    if (group === 'done') person.done_todos += 1;
    updateLatest(person, todo.created_date);
    updateLatest(person, todo.resolved_date);
    person.todos.push({
      id: todo.id,
      summary: todo.summary,
      status: todo.status,
      group,
      created_date: todo.created_date,
      resolved_date: todo.resolved_date,
      context: todo.context,
    });
  }

  for (const event of events) {
    const person = getPerson(people, event.contact);
    if (!person) continue;
    if (!isActiveCalendarStatus(event.status)) continue;
    person.source_kind_set.add('calendar');
    if (event.event_date && event.event_date >= today) person.upcoming_events += 1;
    updateLatest(person, event.event_date);
    updateLatest(person, event.scan_date);
    person.events.push({
      id: event.id,
      event_date: event.event_date,
      scan_date: event.scan_date,
      content: event.content,
      status: event.status,
    });
  }

  for (const item of knowledge) {
    const person = getPerson(people, item.sender);
    if (!person) continue;
    const category = item.category.trim() || '未分类';
    person.source_kind_set.add('knowledge');
    person.knowledge_items += 1;
    person.category_counts.set(category, (person.category_counts.get(category) ?? 0) + 1);
    updateLatest(person, item.date);
    person.knowledge.push({
      id: item.id,
      date: item.date,
      topic: item.topic,
      summary: item.summary,
      category,
      source_group: item.source_group,
      links: item.links,
      tags: item.tags,
    });
  }

  return Array.from(people.values())
    .map(toPublicPerson)
    .sort(comparePeople);
}

function getPerson(people: Map<string, MutablePerson>, rawName: string): MutablePerson | null {
  const name = rawName.trim();
  if (!name) return null;
  const existing = people.get(name);
  if (existing) return existing;
  const person: MutablePerson = {
    name,
    open_todos: 0,
    done_todos: 0,
    upcoming_events: 0,
    knowledge_items: 0,
    latest_activity_date: null,
    category_counts: new Map(),
    source_kind_set: new Set(),
    todos: [],
    events: [],
    knowledge: [],
  };
  people.set(name, person);
  return person;
}

function toPublicPerson(person: MutablePerson): PersonRecord {
  person.todos.sort((a, b) => compareDateDesc(a.created_date, b.created_date));
  person.events.sort((a, b) => compareDateDesc(a.event_date ?? a.scan_date, b.event_date ?? b.scan_date));
  person.knowledge.sort((a, b) => compareDateDesc(a.date, b.date));
  return {
    name: person.name,
    open_todos: person.open_todos,
    done_todos: person.done_todos,
    upcoming_events: person.upcoming_events,
    knowledge_items: person.knowledge_items,
    top_categories: Array.from(person.category_counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
      .slice(0, 3)
      .map(([category]) => category),
    latest_activity_date: person.latest_activity_date,
    source_kinds: Array.from(person.source_kind_set).sort(),
    todos: person.todos,
    events: person.events,
    knowledge: person.knowledge,
  };
}

function todoGroup(status: string): PersonTodo['group'] {
  if (status === 'open') return 'open';
  if (status === 'done' || status === 'completed') return 'done';
  return 'other';
}

function isActiveCalendarStatus(status: string): boolean {
  return status === 'pending' || status === 'confirmed';
}

function comparePeople(a: PersonRecord, b: PersonRecord): number {
  return (
    b.open_todos - a.open_todos ||
    b.upcoming_events - a.upcoming_events ||
    b.knowledge_items - a.knowledge_items ||
    compareDateDesc(a.latest_activity_date, b.latest_activity_date) ||
    a.name.localeCompare(b.name, 'zh-Hans-CN')
  );
}

function compareDateDesc(a: string | null | undefined, b: string | null | undefined): number {
  return (b ?? '').localeCompare(a ?? '');
}

function updateLatest(person: MutablePerson, date: string | null | undefined) {
  if (!date) return;
  if (!person.latest_activity_date || date > person.latest_activity_date) {
    person.latest_activity_date = date;
  }
}

function categoryStats(people: PersonRecord[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const person of people) {
    for (const item of person.knowledge) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-Hans-CN'));
}

function latestFor(rows: Array<{ table: string; latest_date: string | null }>, table: string): string | null {
  return rows.find((row) => row.table === table)?.latest_date ?? null;
}

function profileHighlights(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
    .slice(0, 3);
}

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
