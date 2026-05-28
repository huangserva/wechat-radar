import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTodos, type AssistantTodo } from './assistant-source';
import { readConfig } from './config';

export interface StewardUrgentTodo {
  id: string;
  contact: string;
  title: string;
  created_date: string | null;
}

export interface StewardTodoState {
  available: boolean;
  source_path: string;
  updated_at: string | null;
  active_todos: number;
  urgent_unresolved: number;
  unacked_todos: number;
  urgent_items: StewardUrgentTodo[];
}

type UserStateJson = {
  current?: {
    active_todos?: unknown;
    urgent_unresolved?: unknown;
    unacked_todos?: unknown;
    last_active?: unknown;
  };
};

export function loadAssistantState(): StewardTodoState {
  const sourcePath = join(readConfig().wechatAssistantDir, 'user_state.json');
  if (!existsSync(sourcePath)) return emptyState(sourcePath);

  try {
    const parsed = JSON.parse(readFileSync(sourcePath, 'utf-8')) as UserStateJson;
    const current = parsed.current ?? {};
    const urgentCount = numberOf(current.urgent_unresolved);
    return {
      available: true,
      source_path: sourcePath,
      updated_at: stringOrNull(current.last_active),
      active_todos: numberOf(current.active_todos),
      urgent_unresolved: urgentCount,
      unacked_todos: numberOf(current.unacked_todos),
      urgent_items: loadUrgentTodoTitles(urgentCount),
    };
  } catch {
    return emptyState(sourcePath);
  }
}

function emptyState(sourcePath: string): StewardTodoState {
  return {
    available: false,
    source_path: sourcePath,
    updated_at: null,
    active_todos: 0,
    urgent_unresolved: 0,
    unacked_todos: 0,
    urgent_items: [],
  };
}

function loadUrgentTodoTitles(limit: number): StewardUrgentTodo[] {
  if (limit <= 0) return [];
  return getTodos({ status: 'open', limit: 500 })
    .filter((todo) => isUrgentTodo(todo))
    .slice(0, limit)
    .map((todo) => ({
      id: todo.id,
      contact: todo.contact,
      title: todo.summary,
      created_date: todo.created_date,
    }));
}

function isUrgentTodo(todo: AssistantTodo): boolean {
  return /今天|今晚|明天|马上|尽快|尽早|截止|deadline|urgent|紧急|开会|会议/i.test(`${todo.summary}\n${todo.context}`);
}

function numberOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
