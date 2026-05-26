import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DATA_DIR =
  process.env.WECHAT_RADAR_DATA_DIR ||
  join(homedir(), '.wechat-radar');

const CONFIG_PATH = join(DATA_DIR, 'config.json');
const DEFAULT_WECHAT_ASSISTANT_DIR = join(homedir(), 'wechat-assistant');

export type WechatDataSource = 'db' | 'wx';

export interface Config {
  myNicknames: string[];
  defaultRange: 'day' | 'week' | 'month' | 'quarter' | 'year';
  rescanConcurrency: number;
  privacyConfirmed: boolean;
  setupCompleted: boolean;
  demoMode: boolean;
  defaultSyncDays: number;
  wechatDataSource: WechatDataSource;
  wechatAssistantDir: string;
  wechatCollectorDb: string;
  wechatDecryptedDir: string;
  wechatSelfWxid: string;
}

function envNames(): string[] {
  return (process.env.WECHAT_RADAR_MY_NAMES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function envDataSource(): WechatDataSource {
  return process.env.WECHAT_RADAR_DATA_SOURCE === 'wx' ? 'wx' : 'db';
}

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function assistantDirFromEnv(): string {
  return expandHome(process.env.WECHAT_RADAR_WECHAT_ASSISTANT_DIR || DEFAULT_WECHAT_ASSISTANT_DIR);
}

function collectorDbFromEnv(workDir: string): string {
  return expandHome(process.env.WECHAT_RADAR_COLLECTOR_DB || join(workDir, 'collector.db'));
}

function decryptedDirFromEnv(workDir: string): string {
  return expandHome(process.env.WECHAT_RADAR_DECRYPTED_DIR || join(workDir, 'decrypted'));
}

function withEnvOverrides(config: Config): Config {
  const workDir = assistantDirFromEnv();
  const assistantDirOverridden = Boolean(process.env.WECHAT_RADAR_WECHAT_ASSISTANT_DIR);
  return {
    ...config,
    myNicknames: envNames().length > 0 ? envNames() : config.myNicknames,
    demoMode: process.env.WECHAT_RADAR_DEMO === '1' ? true : config.demoMode,
    wechatDataSource: process.env.WECHAT_RADAR_DATA_SOURCE ? envDataSource() : config.wechatDataSource,
    wechatAssistantDir: assistantDirOverridden ? workDir : expandHome(config.wechatAssistantDir),
    wechatCollectorDb: process.env.WECHAT_RADAR_COLLECTOR_DB
      ? collectorDbFromEnv(workDir)
      : assistantDirOverridden
        ? collectorDbFromEnv(workDir)
        : expandHome(config.wechatCollectorDb),
    wechatDecryptedDir: process.env.WECHAT_RADAR_DECRYPTED_DIR
      ? decryptedDirFromEnv(workDir)
      : assistantDirOverridden
        ? decryptedDirFromEnv(workDir)
        : expandHome(config.wechatDecryptedDir),
    wechatSelfWxid: process.env.WECHAT_RADAR_SELF_WXID || config.wechatSelfWxid,
  };
}

const DEFAULT_ASSISTANT_DIR = assistantDirFromEnv();

const DEFAULTS: Config = {
  myNicknames: envNames(),
  defaultRange: 'week',
  rescanConcurrency: 5,
  privacyConfirmed: false,
  setupCompleted: false,
  demoMode: process.env.WECHAT_RADAR_DEMO === '1',
  defaultSyncDays: 7,
  wechatDataSource: envDataSource(),
  wechatAssistantDir: DEFAULT_ASSISTANT_DIR,
  wechatCollectorDb: collectorDbFromEnv(DEFAULT_ASSISTANT_DIR),
  wechatDecryptedDir: decryptedDirFromEnv(DEFAULT_ASSISTANT_DIR),
  wechatSelfWxid: process.env.WECHAT_RADAR_SELF_WXID || '',
};

export function readConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf-8');
    return withEnvOverrides(DEFAULTS);
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    const merged = { ...DEFAULTS, ...parsed };
    return withEnvOverrides(merged);
  } catch {
    return withEnvOverrides(DEFAULTS);
  }
}

export function writeConfig(patch: Partial<Config>): Config {
  const cur = readConfig();
  const merged = { ...cur, ...patch };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

export function configStatus() {
  const cfg = readConfig();
  return {
    dataDir: DATA_DIR,
    configPath: CONFIG_PATH,
    configured: cfg.setupCompleted && cfg.privacyConfirmed && (cfg.demoMode || cfg.myNicknames.length > 0),
    config: cfg,
  };
}
