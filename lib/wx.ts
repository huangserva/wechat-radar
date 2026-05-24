import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  WxDaemonStatus,
  WxMember,
  WxMessage,
  WxNewMessage,
  WxSession,
  WxStats,
} from './wx-types';

const run = promisify(execFile);

const DEFAULT_OPTS = {
  maxBuffer: 64 * 1024 * 1024,
  timeout: 60_000,
} as const;

async function wxRaw(args: string[], opts = DEFAULT_OPTS): Promise<string> {
  const { stdout } = await run('wx', args, opts);
  return stdout;
}

async function wxJson<T>(args: string[], opts = DEFAULT_OPTS): Promise<T> {
  const stdout = await wxRaw([...args, '--json'], opts);
  return JSON.parse(stdout) as T;
}

export async function wxSessions(limit = 500): Promise<WxSession[]> {
  return wxJson<WxSession[]>(['sessions', '-n', String(limit)]);
}

export async function wxStats(
  chat: string,
  since: string,
  until: string,
): Promise<WxStats> {
  return wxJson<WxStats>(['stats', chat, '--since', since, '--until', until]);
}

export async function wxHistory(
  chat: string,
  since: string,
  until: string,
  limit = 1000,
): Promise<WxMessage[]> {
  return wxJson<WxMessage[]>([
    'history',
    chat,
    '--since',
    since,
    '--until',
    until,
    '-n',
    String(limit),
  ]);
}

export async function wxNewMessages(limit = 50): Promise<WxNewMessage[]> {
  return wxJson<WxNewMessage[]>(['new-messages', '-n', String(limit)]);
}

export async function wxMembers(chat: string): Promise<WxMember[]> {
  return wxJson<WxMember[]>(['members', chat]);
}

export async function wxDaemonStatus(): Promise<WxDaemonStatus> {
  try {
    const out = await wxRaw(['daemon', 'status']);
    const lower = out.toLowerCase();
    const running = lower.includes('running') || lower.includes('运行');
    const pidMatch = out.match(/pid[^\d]*(\d+)/i);
    return {
      running,
      pid: pidMatch ? Number(pidMatch[1]) : undefined,
    };
  } catch {
    return { running: false };
  }
}

export async function wxAvailable(): Promise<boolean> {
  try {
    await run('wx', ['--version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
