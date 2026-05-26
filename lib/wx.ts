import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  WxDaemonStatus,
  WxMember,
  WxMessage,
  WxNewMessage,
  WxResult,
  WxSession,
  WxStats,
} from './wx-types';
import { readConfig } from './config';
import * as dbAdapter from './wechat-db-adapter';
import type { WxStatsRangeRow } from './wechat-db-adapter';

type SearchHit = WxNewMessage & { date: string };

/** Wrap a legacy `wx` CLI / daemon array result in the WxResult envelope. */
function liveResult<T extends unknown[]>(data: T): WxResult<T> {
  return {
    data,
    source: data.length > 0 ? 'live' : 'none',
    empty_reason: data.length > 0 ? null : 'no_match',
  };
}

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
  if (useDbAdapter()) return dbAdapter.wxSessions(limit);
  return wxJson<WxSession[]>(['sessions', '-n', String(limit)]);
}

export async function wxStats(
  chat: string,
  since: string,
  until: string,
): Promise<WxStats> {
  if (useDbAdapter()) return dbAdapter.wxStats(chat, since, until);
  return wxJson<WxStats>(['stats', chat, '--since', since, '--until', until]);
}

export async function wxHistory(
  chat: string,
  since: string,
  until: string,
  limit = 1000,
): Promise<WxMessage[]> {
  return (await wxHistoryWithMeta(chat, since, until, limit)).data;
}

export async function wxHistoryWithMeta(
  chat: string,
  since: string,
  until: string,
  limit = 1000,
): Promise<WxResult<WxMessage[]>> {
  if (useDbAdapter()) return dbAdapter.wxHistory(chat, since, until, limit);
  const data = await wxJson<WxMessage[]>([
    'history',
    chat,
    '--since',
    since,
    '--until',
    until,
    '-n',
    String(limit),
  ]);
  return liveResult(data);
}

export async function wxNewMessages(limit = 50): Promise<WxNewMessage[]> {
  if (useDbAdapter()) return dbAdapter.wxNewMessages(limit);
  return wxJson<WxNewMessage[]>(['new-messages', '-n', String(limit)]);
}

export async function wxMembers(chat: string): Promise<WxMember[]> {
  if (useDbAdapter()) return dbAdapter.wxMembers(chat);
  return wxJson<WxMember[]>(['members', chat]);
}

export async function wxDaemonStatus(): Promise<WxDaemonStatus> {
  if (useDbAdapter()) return dbAdapter.wxDaemonStatus();
  try {
    const out = await wxRaw(['daemon', 'status']);
    const lower = out.toLowerCase();
    const running = lower.includes('running') || lower.includes('运行');
    const pidMatch = out.match(/pid[^\d]*(\d+)/i);
    return {
      running,
      pid: pidMatch ? Number(pidMatch[1]) : undefined,
      source: 'wx',
    };
  } catch {
    return { running: false, source: 'wx' };
  }
}

export async function wxAvailable(): Promise<boolean> {
  if (useDbAdapter()) return dbAdapter.wxAvailable();
  try {
    await run('wx', ['--version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export async function wxSearchMessages(q: string, limit = 10): Promise<SearchHit[]> {
  return (await wxSearchMessagesWithMeta(q, limit)).data;
}

export async function wxSearchMessagesWithMeta(q: string, limit = 10): Promise<WxResult<SearchHit[]>> {
  if (useDbAdapter()) return dbAdapter.wxSearchMessages(q, limit);
  return liveResult<SearchHit[]>([]);
}

export async function wxStatsRange(since: string, until: string): Promise<WxStatsRangeRow[]> {
  return (await wxStatsRangeWithMeta(since, until)).data;
}

export async function wxStatsRangeWithMeta(since: string, until: string): Promise<WxResult<WxStatsRangeRow[]>> {
  if (useDbAdapter()) return dbAdapter.wxStatsRange(since, until);
  return liveResult<WxStatsRangeRow[]>([]);
}

function useDbAdapter(): boolean {
  return readConfig().wechatDataSource !== 'wx';
}
