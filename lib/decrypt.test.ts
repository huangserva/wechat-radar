/**
 * Tests for lib/decrypt orchestration helpers — the pure-logic parts:
 * refresh-summary parsing and the sudo-command generator (which must NEVER
 * actually run sudo, only produce a string).
 *
 * Run: `pnpm test` (or `pnpm exec tsx lib/decrypt.test.ts`). Tiny assert runner.
 */
import assert from 'node:assert/strict';
import {
  parseRefreshSummary,
  personalKeyExtractCommand,
  wecomKeyExtractCommand,
  fridaExtractCommand,
  matchKeysCommand,
  keyExtractStrategies,
} from './decrypt';
import type { Config } from './config';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

// --- parseRefreshSummary ---
check('parses a real [refresh] line', () => {
  const line = '[refresh] 42 个DB: 1 全量解密, 3 WAL patch, 38 跳过 | 512 页 | 71ms';
  const s = parseRefreshSummary(line);
  assert.deepEqual(s, { dbs: 42, full: 1, wal: 3, skipped: 38, pages: 512, ms: 71 });
});

check('parses line embedded in multi-line stdout', () => {
  const out = 'loading keys...\n[refresh] 5 个DB: 5 全量解密, 0 WAL patch, 0 跳过 | 12345 页 | 8800ms\ndone';
  const s = parseRefreshSummary(out);
  assert.equal(s?.dbs, 5);
  assert.equal(s?.full, 5);
  assert.equal(s?.ms, 8800);
});

check('returns null when no summary line', () => {
  assert.equal(parseRefreshSummary('nothing here'), null);
  assert.equal(parseRefreshSummary(''), null);
});

// --- sudo command generators must produce a string containing sudo + scanner,
//     and must never be executed. We only assert on the returned string shape. ---
const cfg = {
  keysFile: '/Users/x/wechat-assistant/all_keys.json',
  wecomKeysFile: '/Users/x/wechat-assistant/wecom_keys.json',
  wecomDbDir: '/Users/x/Library/Containers/com.tencent.WeWorkMac/Data/Documents/Profiles/ABC',
} as unknown as Config;

check('personalKeyExtractCommand mentions sudo + scanner + cd to keys dir', () => {
  const cmd = personalKeyExtractCommand(cfg);
  assert.ok(cmd.includes('sudo'), 'has sudo');
  assert.ok(cmd.includes('find_all_keys_macos'), 'has scanner');
  assert.ok(cmd.includes('/Users/x/wechat-assistant'), 'cd to keys dir');
});

check('wecomKeyExtractCommand mentions sudo + wecom scanner + profile', () => {
  const cmd = wecomKeyExtractCommand(cfg);
  assert.ok(cmd.includes('sudo'), 'has sudo');
  assert.ok(cmd.includes('find_wecom_keys_macos'), 'has wecom scanner');
  assert.ok(cmd.includes('Profiles/ABC'), 'has profile dir');
});

// --- Frida fallback (M8): command generators must produce strings only,
//     mention the driver, and never run anything. ---
const fcfg = {
  keysFile: '/Users/x/wechat-assistant/all_keys.json',
  wecomKeysFile: '/Users/x/wechat-assistant/wecom_keys.json',
  wechatDbDir: '/Users/x/Library/.../db_storage',
  wecomDbDir: '/Users/x/Library/.../Profiles/ABC',
  decryptPythonBin: '',
} as unknown as Config;

check('fridaExtractCommand personal: sudo + driver + target + out', () => {
  const cmd = fridaExtractCommand(fcfg, 'personal');
  assert.ok(cmd.includes('sudo'), 'has sudo');
  assert.ok(cmd.includes('frida_extract.py'), 'has driver');
  assert.ok(cmd.includes('--target personal'), 'target personal');
  assert.ok(cmd.includes('all_keys.json'), 'personal out');
});

check('fridaExtractCommand wecom: target wecom + wecom out + db-dir', () => {
  const cmd = fridaExtractCommand(fcfg, 'wecom');
  assert.ok(cmd.includes('--target wecom'), 'target wecom');
  assert.ok(cmd.includes('wecom_keys.json'), 'wecom out');
  assert.ok(cmd.includes('--db-dir'), 'has db-dir when configured');
});

check('matchKeysCommand: matcher + keys-file + db-dir, no sudo (read-only)', () => {
  const cmd = matchKeysCommand(fcfg, 'personal');
  assert.ok(cmd.includes('match_keys.py'), 'has matcher');
  assert.ok(cmd.includes('--keys-file'), 'has keys-file');
  assert.ok(cmd.includes('--db-dir'), 'has db-dir');
  assert.ok(!cmd.startsWith('sudo'), 'match_keys needs no root');
});

check('keyExtractStrategies personal: ordered scan → frida → match', () => {
  const s = keyExtractStrategies(fcfg, 'personal');
  assert.deepEqual(s.map((x) => x.id), ['memory-scan', 'frida-fallback', 'match-keys']);
  assert.ok(s[0].command.includes('find_all_keys_macos'), 'step1 memory scan');
  assert.ok(s[1].command.includes('frida_extract.py'), 'step2 frida');
});

check('keyExtractStrategies wecom: scan → frida (no match-keys step)', () => {
  const s = keyExtractStrategies(fcfg, 'wecom');
  assert.deepEqual(s.map((x) => x.id), ['memory-scan', 'frida-fallback']);
  assert.ok(s[0].command.includes('find_wecom_keys_macos'), 'step1 wecom scan');
});

const total = passed + failed;
if (failed > 0) {
  console.error(`\ndecrypt: ${passed}/${total} passed, ${failed} FAILED`);
  process.exit(1);
}
console.log(`decrypt: all ${total} tests passed ✓`);
