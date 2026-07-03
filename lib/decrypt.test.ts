/**
 * Tests for lib/decrypt orchestration helpers — the pure-logic parts:
 * refresh-summary parsing and the sudo-command generator (which must NEVER
 * actually run sudo, only produce a string).
 *
 * Run: `pnpm test` (or `pnpm exec tsx lib/decrypt.test.ts`). Tiny assert runner.
 */
import assert from 'node:assert/strict';
import { parseRefreshSummary, personalKeyExtractCommand, wecomKeyExtractCommand } from './decrypt';
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

const total = passed + failed;
if (failed > 0) {
  console.error(`\ndecrypt: ${passed}/${total} passed, ${failed} FAILED`);
  process.exit(1);
}
console.log(`decrypt: all ${total} tests passed ✓`);
