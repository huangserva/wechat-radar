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
  // --- M7 decrypt toolchain (Track A) ---
  /** Encrypted personal-WeChat DB source dir (…/xwechat_files/<account>/db_storage). */
  wechatDbDir: string;
  /** Encrypted Enterprise-WeChat profile dir (…/com.tencent.WeWorkMac/…/Profiles/<id>). */
  wecomDbDir: string;
  /** Decrypted Enterprise-WeChat output dir. */
  wecomDecryptedDir: string;
  /** all_keys.json produced by find_all_keys_macos (plaintext keys — gitignored). */
  keysFile: string;
  /** wecom_keys.json produced by find_wecom_keys_macos (plaintext keys — gitignored). */
  wecomKeysFile: string;
  /** venv python for the vendored decrypt scripts; '' → auto-detect in lib/decrypt.ts. */
  decryptPythonBin: string;
  /** Master switch: run decrypt/refresh before sync in rescan. */
  decryptEnabled: boolean;
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

function keysFileFromEnv(workDir: string): string {
  return expandHome(process.env.WECHAT_RADAR_KEYS_FILE || join(workDir, 'all_keys.json'));
}

function wecomKeysFileFromEnv(workDir: string): string {
  return expandHome(process.env.WECHAT_RADAR_WECOM_KEYS_FILE || join(workDir, 'wecom_keys.json'));
}

function wecomDecryptedDirFromEnv(workDir: string): string {
  return expandHome(process.env.WECHAT_RADAR_WECOM_DECRYPTED_DIR || join(workDir, 'wecom-decrypted'));
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
    wechatDbDir: process.env.WECHAT_RADAR_WECHAT_DB_DIR
      ? expandHome(process.env.WECHAT_RADAR_WECHAT_DB_DIR)
      : expandHome(config.wechatDbDir),
    wecomDbDir: process.env.WECHAT_RADAR_WECOM_DB_DIR
      ? expandHome(process.env.WECHAT_RADAR_WECOM_DB_DIR)
      : expandHome(config.wecomDbDir),
    wecomDecryptedDir: process.env.WECHAT_RADAR_WECOM_DECRYPTED_DIR
      ? wecomDecryptedDirFromEnv(workDir)
      : assistantDirOverridden
        ? wecomDecryptedDirFromEnv(workDir)
        : expandHome(config.wecomDecryptedDir),
    keysFile: process.env.WECHAT_RADAR_KEYS_FILE
      ? keysFileFromEnv(workDir)
      : assistantDirOverridden
        ? keysFileFromEnv(workDir)
        : expandHome(config.keysFile),
    wecomKeysFile: process.env.WECHAT_RADAR_WECOM_KEYS_FILE
      ? wecomKeysFileFromEnv(workDir)
      : assistantDirOverridden
        ? wecomKeysFileFromEnv(workDir)
        : expandHome(config.wecomKeysFile),
    decryptPythonBin: process.env.WECHAT_RADAR_DECRYPT_PYTHON
      ? expandHome(process.env.WECHAT_RADAR_DECRYPT_PYTHON)
      : config.decryptPythonBin,
    decryptEnabled: process.env.WECHAT_RADAR_DECRYPT_ENABLED
      ? process.env.WECHAT_RADAR_DECRYPT_ENABLED === '1'
      : config.decryptEnabled,
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
  wechatDbDir: expandHome(process.env.WECHAT_RADAR_WECHAT_DB_DIR || ''),
  wecomDbDir: expandHome(process.env.WECHAT_RADAR_WECOM_DB_DIR || ''),
  wecomDecryptedDir: wecomDecryptedDirFromEnv(DEFAULT_ASSISTANT_DIR),
  keysFile: keysFileFromEnv(DEFAULT_ASSISTANT_DIR),
  wecomKeysFile: wecomKeysFileFromEnv(DEFAULT_ASSISTANT_DIR),
  decryptPythonBin: expandHome(process.env.WECHAT_RADAR_DECRYPT_PYTHON || ''),
  decryptEnabled: process.env.WECHAT_RADAR_DECRYPT_ENABLED === '1',
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

export const PLACEHOLDER_NICKNAMES = new Set(['你的微信名', '微信名', 'yourwechatname', 'yourname']);

export function isPlaceholderNickname(name: string): boolean {
  const normalized = name
    .trim()
    .replace(/[\s[\]【】()（）<>《》〈〉\u201c\u201d\u2018\u2019"']/g, '')
    .toLowerCase();
  return PLACEHOLDER_NICKNAMES.has(normalized);
}

export function stripPlaceholderNicknames(names: string[]): string[] {
  return names.filter((n) => n.trim() && !isPlaceholderNickname(n));
}

export function writeConfig(patch: Partial<Config>): Config {
  const cur = readConfig();
  let merged = { ...cur, ...patch };
  if (merged.demoMode === false) {
    const stripped = stripPlaceholderNicknames(merged.myNicknames);
    if (stripped.length !== merged.myNicknames.length) {
      merged = { ...merged, myNicknames: stripped };
    }
  }
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
