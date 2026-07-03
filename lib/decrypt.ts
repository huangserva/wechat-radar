/**
 * M7 · decrypt orchestration (Track A).
 *
 * radar contains NO cryptography. This module only orchestrates the vendored
 * Python/C toolchain under `scripts/decrypt/` as subprocesses (execFile, array
 * args — see SECURITY.md) and interprets their exit codes / stdout.
 *
 * Permission model (方案 A): key extraction needs root and is NEVER run here —
 * we only GENERATE the exact `sudo …` command for the user to run. Decrypt /
 * WAL-refresh / collect need only Full Disk Access and ARE run here.
 *
 * M8 adds the Frida-fallback command generators (fridaExtractCommand /
 * matchKeysCommand / keyExtractStrategies) for when memory-pattern scanning
 * finds 0 keys after a WeChat/WXWork version bump — same plan-A, command-only.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, DATA_DIR, type Config } from './config';

const run = promisify(execFile);

const DEFAULT_OPTS = {
  maxBuffer: 32 * 1024 * 1024,
  timeout: 30 * 60_000, // decrypt of a large first-run DB set can take minutes
} as const;

/** Repo-relative location of the vendored toolchain (override for tests/mono-repos). */
function decryptDir(): string {
  return process.env.WECHAT_RADAR_DECRYPT_DIR || join(process.cwd(), 'scripts', 'decrypt');
}

function scriptPath(...parts: string[]): string {
  return join(decryptDir(), ...parts);
}

/** venv python → config override → repo .venv → system python3. */
export function resolvePython(cfg: Config = readConfig()): string {
  if (cfg.decryptPythonBin && existsSync(cfg.decryptPythonBin)) return cfg.decryptPythonBin;
  const venv = scriptPath('.venv', 'bin', 'python');
  if (existsSync(venv)) return venv;
  return 'python3';
}

export interface ToolchainStatus {
  ready: boolean;
  pythonBin: string;
  pythonVenv: boolean;
  scripts: { refresh: boolean; wecomCollector: boolean; personalScanner: boolean; wecomScanner: boolean; fridaHook: boolean; fridaDriver: boolean };
  keys: { personal: KeyFileStatus; wecom: KeyFileStatus };
  /**
   * True when a key file was produced but holds 0 usable keys — the signal that
   * the memory scanner ran and found nothing (version drift) and the Frida
   * fallback should be offered. `null` when no key file exists yet (scan not run).
   */
  needsFridaFallback: { personal: boolean | null; wecom: boolean | null };
  missing: string[];
}

export interface KeyFileStatus {
  path: string;
  exists: boolean;
  /** epoch seconds of last modification, or null. */
  mtime: number | null;
  /** count of `{rel: {enc_key}}` entries (excludes `_`-prefixed metadata); null if unreadable. */
  keyCount: number | null;
}

/** Count real key entries in a keys JSON (mirrors decrypt_db strip_key_metadata). */
export function countKeys(path: string): number | null {
  if (!path || !existsSync(path)) return null;
  try {
    const obj = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    let n = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_')) continue;
      if (v && typeof v === 'object' && typeof (v as { enc_key?: unknown }).enc_key === 'string') n += 1;
    }
    return n;
  } catch {
    return null;
  }
}

function keyFileStatus(path: string): KeyFileStatus {
  if (!path || !existsSync(path)) return { path, exists: false, mtime: null, keyCount: null };
  try {
    return { path, exists: true, mtime: Math.floor(statSync(path).mtimeMs / 1000), keyCount: countKeys(path) };
  } catch {
    return { path, exists: false, mtime: null, keyCount: null };
  }
}

/** null = scan not run (no file); true = ran but 0 keys → offer Frida; false = keys present. */
function fallbackSignal(k: KeyFileStatus): boolean | null {
  if (!k.exists) return null;
  return (k.keyCount ?? 0) === 0;
}

/** Non-destructive readiness probe for setup/UI. */
export function decryptStatus(cfg: Config = readConfig()): ToolchainStatus {
  const pythonBin = resolvePython(cfg);
  const refresh = existsSync(scriptPath('refresh_decrypt.py'));
  const wecomCollector = existsSync(scriptPath('wecom_collector.py'));
  const personalScanner = existsSync(scriptPath('decrypt', 'find_all_keys_macos'));
  const wecomScanner = existsSync(scriptPath('decrypt', 'find_wecom_keys_macos'));
  const fridaHook = existsSync(scriptPath('frida', 'wechat-key-hook.js'));
  const fridaDriver = existsSync(scriptPath('frida', 'frida_extract.py'));
  const pythonVenv = existsSync(scriptPath('.venv', 'bin', 'python'));

  const missing: string[] = [];
  if (!pythonVenv && pythonBin === 'python3') missing.push('venv (run scripts/decrypt/bootstrap.sh)');
  if (!refresh) missing.push('refresh_decrypt.py');
  if (!personalScanner) missing.push('find_all_keys_macos (compile via bootstrap.sh)');

  const personal = keyFileStatus(cfg.keysFile);
  const wecom = keyFileStatus(cfg.wecomKeysFile);

  return {
    ready: refresh && (pythonVenv || pythonBin !== 'python3'),
    pythonBin,
    pythonVenv,
    scripts: { refresh, wecomCollector, personalScanner, wecomScanner, fridaHook, fridaDriver },
    keys: { personal, wecom },
    needsFridaFallback: { personal: fallbackSignal(personal), wecom: fallbackSignal(wecom) },
    missing,
  };
}

/**
 * The exact `sudo …` command the user must run to (re)extract keys. radar never
 * runs this — root + a running WeChat process are required.
 */
export function personalKeyExtractCommand(cfg: Config = readConfig()): string {
  const scanner = scriptPath('decrypt', 'find_all_keys_macos');
  // scanner writes all_keys.json into its own CWD; run from the keys-file dir.
  const outDir = cfg.keysFile ? cfg.keysFile.replace(/\/[^/]*$/, '') : decryptDir();
  return `cd ${shellQuote(outDir)} && sudo ${shellQuote(scanner)}`;
}

export function wecomKeyExtractCommand(cfg: Config = readConfig()): string {
  const scanner = scriptPath('decrypt', 'find_wecom_keys_macos');
  const profile = cfg.wecomDbDir || '<企业微信 Profiles/<id> 目录>';
  const out = cfg.wecomKeysFile || 'wecom_keys.json';
  return `sudo ${shellQuote(scanner)} <企业微信进程PID> ${shellQuote(profile)} ${shellQuote(out)}`;
}

/**
 * The Frida-fallback command the user runs when the memory scanner finds 0 keys
 * (version drift). radar never runs it — Frida attach needs root + a debuggable
 * target (ad-hoc re-sign / SIP), the same class of prerequisite as the scanners.
 */
export function fridaExtractCommand(cfg: Config = readConfig(), kind: 'personal' | 'wecom' = 'personal'): string {
  const python = resolvePython(cfg);
  const driver = scriptPath('frida', 'frida_extract.py');
  const out = kind === 'wecom' ? (cfg.wecomKeysFile || 'wecom_keys.json') : (cfg.keysFile || 'all_keys.json');
  const dbDir = kind === 'wecom' ? cfg.wecomDbDir : cfg.wechatDbDir;
  const dbArg = dbDir ? ` --db-dir ${shellQuote(dbDir)}` : '';
  return `sudo ${shellQuote(python)} ${shellQuote(driver)} --target ${kind} --out ${shellQuote(out)}${dbArg}`;
}

/** For the PBKDF path, candidate keys have no DB association — resolve by HMAC. */
export function matchKeysCommand(cfg: Config = readConfig(), kind: 'personal' | 'wecom' = 'personal'): string {
  const python = resolvePython(cfg);
  const matcher = scriptPath('frida', 'match_keys.py');
  const keysFile = kind === 'wecom' ? (cfg.wecomKeysFile || 'wecom_keys.json') : (cfg.keysFile || 'all_keys.json');
  const dbDir = kind === 'wecom' ? cfg.wecomDbDir : cfg.wechatDbDir;
  return `${shellQuote(python)} ${shellQuote(matcher)} --keys-file ${shellQuote(keysFile)} --db-dir ${shellQuote(dbDir || '<db_storage dir>')}`;
}

export interface KeyExtractStrategy {
  id: 'memory-scan' | 'frida-fallback' | 'match-keys';
  label: string;
  command: string;
  /** Frida/candidate steps only apply after the memory scan yields 0 keys. */
  when: string;
  prerequisites: string[];
}

/**
 * Ordered key-extraction strategies for a target. Step 1 is the fast memory
 * scanner; step 2 (Frida) is the version-drift fallback; step 3 resolves the
 * PBKDF path's db-less candidate keys. radar surfaces these as commands — plan A,
 * radar never runs any of them (all need root + a running/ debuggable app).
 */
export function keyExtractStrategies(
  cfg: Config = readConfig(),
  kind: 'personal' | 'wecom' = 'personal',
): KeyExtractStrategy[] {
  const scanCmd = kind === 'wecom' ? wecomKeyExtractCommand(cfg) : personalKeyExtractCommand(cfg);
  const macPrereqs = [
    '目标 App 正在运行',
    'App 已 ad-hoc 签名（或关闭 SIP）',
    'sudo / root',
  ];
  const strategies: KeyExtractStrategy[] = [
    {
      id: 'memory-scan',
      label: '内存特征扫描（默认，最快）',
      command: scanCmd,
      when: '首选',
      prerequisites: macPrereqs,
    },
    {
      id: 'frida-fallback',
      label: 'Frida 动态插桩兜底（内存扫描 0 key 时）',
      command: fridaExtractCommand(cfg, kind),
      when: '内存扫描返回 0 key（版本升级致特征失配）',
      prerequisites: [
        ...macPrereqs,
        'App 可被调试（ad-hoc 重签 + get-task-allow，或关闭 SIP）',
        'frida 已安装（scripts/decrypt/bootstrap.sh --with-frida）',
        '默认 attach 非侵入；0 命中可加 --spawn 全量捕获（会重启 App）',
      ],
    },
  ];
  if (kind === 'personal') {
    strategies.push({
      id: 'match-keys',
      label: '解析候选密钥到具体 DB（Frida PBKDF 路径后）',
      command: matchKeysCommand(cfg, kind),
      when: 'Frida 走 CCKeyDerivationPBKDF、产生无 DB 关联的候选 key 后',
      prerequisites: ['已跑过 Frida 提取', '仅需读权限（HMAC 校验，无需 root）'],
    });
  }
  return strategies;
}

function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Write the YAML config the vendored personal-WeChat scripts consume. */
function writePersonalConfigYaml(cfg: Config): string {
  mkdirSync(DATA_DIR, { recursive: true });
  const yamlPath = join(DATA_DIR, 'decrypt-config.yaml');
  const y = [
    '# generated by lib/decrypt.ts — paths only, no secrets. do not commit.',
    'wechat:',
    `  db_dir: ${yamlStr(cfg.wechatDbDir)}`,
    `  decrypted_dir: ${yamlStr(cfg.wechatDecryptedDir)}`,
    `  collector_db: ${yamlStr(cfg.wechatCollectorDb)}`,
    `  keys_file: ${yamlStr(cfg.keysFile)}`,
    `  self_wxid: ${yamlStr(cfg.wechatSelfWxid)}`,
    '',
  ].join('\n');
  writeFileSync(yamlPath, y, 'utf-8');
  return yamlPath;
}

function yamlStr(s: string): string {
  return JSON.stringify(s ?? '');
}

export interface RefreshResult {
  ok: boolean;
  /** true when refresh_decrypt.py exited 2 → keys stale (WeChat restarted). */
  keyExpired: boolean;
  exitCode: number;
  /** parsed from `[refresh] … {full} 全量解密, {wal} WAL patch, {skip} 跳过 | {pages} 页 | {ms}ms` */
  summary: RefreshSummary | null;
  stdout: string;
  stderr: string;
}

export interface RefreshSummary {
  dbs: number;
  full: number;
  wal: number;
  skipped: number;
  pages: number;
  ms: number;
}

/** Parse the `[refresh] …` line emitted by refresh_decrypt.py. */
export function parseRefreshSummary(stdout: string): RefreshSummary | null {
  const m = stdout.match(
    /\[refresh\]\s*(\d+)\s*个DB:\s*(\d+)\s*全量解密,\s*(\d+)\s*WAL patch,\s*(\d+)\s*跳过\s*\|\s*(\d+)\s*页\s*\|\s*(\d+)ms/,
  );
  if (!m) return null;
  return {
    dbs: Number(m[1]),
    full: Number(m[2]),
    wal: Number(m[3]),
    skipped: Number(m[4]),
    pages: Number(m[5]),
    ms: Number(m[6]),
  };
}

/**
 * Personal WeChat: full first run, WAL-incremental afterward (~70ms/DB).
 * Exit code 2 → keys expired (surface to UI, prompt re-extract). No root needed.
 */
export async function refreshDecrypt(
  opts: { full?: boolean; cfg?: Config } = {},
): Promise<RefreshResult> {
  const cfg = opts.cfg ?? readConfig();
  const python = resolvePython(cfg);
  const yamlPath = writePersonalConfigYaml(cfg);
  const args = [scriptPath('refresh_decrypt.py'), '--config', yamlPath];
  if (opts.full) args.push('--full');

  try {
    const { stdout, stderr } = await run(python, args, DEFAULT_OPTS);
    return {
      ok: true,
      keyExpired: false,
      exitCode: 0,
      summary: parseRefreshSummary(stdout),
      stdout,
      stderr,
    };
  } catch (e) {
    const err = e as NodeExecError;
    const exitCode = typeof err.code === 'number' ? err.code : 1;
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? (err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      keyExpired: exitCode === 2,
      exitCode,
      summary: parseRefreshSummary(stdout),
      stdout,
      stderr,
    };
  }
}

export interface WecomSyncResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Enterprise WeChat: decrypt latest Messages1 + collect into collector.db.
 * Uses explicit flags (wecom paths differ from personal). No root needed.
 */
export async function wecomSync(opts: { cfg?: Config } = {}): Promise<WecomSyncResult> {
  const cfg = opts.cfg ?? readConfig();
  const python = resolvePython(cfg);
  const args = [
    scriptPath('wecom_collector.py'),
    '--sync',
    '--db-dir',
    cfg.wecomDbDir,
    '--keys-file',
    cfg.wecomKeysFile,
    '--decrypted-dir',
    cfg.wecomDecryptedDir,
    '--collector-db',
    cfg.wechatCollectorDb,
  ];
  if (cfg.wechatSelfWxid) args.push('--self-vid', cfg.wechatSelfWxid);

  try {
    const { stdout, stderr } = await run(python, args, DEFAULT_OPTS);
    return { ok: true, exitCode: 0, stdout, stderr };
  } catch (e) {
    const err = e as NodeExecError;
    return {
      ok: false,
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? (err instanceof Error ? err.message : String(err)),
    };
  }
}

interface NodeExecError extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}
