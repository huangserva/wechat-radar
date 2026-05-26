/**
 * P3a trend data-layer tests (identity merge rules, trend_confidence thresholds,
 * legacy-schema index guard). Plain node:assert runner — run via `pnpm test`.
 */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { identityKeyOf, trendConfidence } from './lab-trends';
import { getLabTargetTrend } from './lab-trends';
import { createLabTrendIndexes } from './db';

const DAY = 86_400_000;
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

// ---- identity key: wxid merges across chats; display-only never does ----
check('wxid merges across chatrooms', () => {
  assert.equal(identityKeyOf('wxid_A', 'chatX@chatroom', '王猛'), identityKeyOf('wxid_A', 'chatY@chatroom', '王猛别名'));
  assert.equal(identityKeyOf('wxid_A', 'chatX@chatroom', '王猛'), 'wxid:wxid_A');
});
check('display-only same name in different chats does NOT merge', () => {
  const a = identityKeyOf(null, 'chatX@chatroom', '小明');
  const b = identityKeyOf(null, 'chatY@chatroom', '小明');
  assert.notEqual(a, b);
  assert.equal(a, 'display:chatX@chatroom:小明');
});

// ---- getLabTargetTrend rejects display-only without chatroom (returns null, no DB) ----
check('display-only without chatroom_id → null', () => {
  assert.equal(getLabTargetTrend({ target_display_name: '小明' }), null);
  assert.equal(getLabTargetTrend({}), null);
});

// ---- trend_confidence thresholds use raw span (B2 regression) ----
check('6.5 days stays low (no round-up to 7)', () => {
  const r = trendConfidence({ runCount: 5, spanMs: 6.5 * DAY, verified: true, modesWith3: 2 });
  assert.equal(r.confidence, 'low');
  assert.ok(r.reasons.some((x) => x.includes('time_span_days < 7')));
});
check('exactly 7 days, verified, 1 mode 3+ → medium', () => {
  assert.equal(trendConfidence({ runCount: 5, spanMs: 7 * DAY, verified: true, modesWith3: 1 }).confidence, 'medium');
});
check('29.5 days does NOT reach high', () => {
  const r = trendConfidence({ runCount: 10, spanMs: 29.5 * DAY, verified: true, modesWith3: 2 });
  assert.equal(r.confidence, 'medium');
});
check('30 days + 8 runs + 2 modes + verified → high', () => {
  assert.equal(trendConfidence({ runCount: 8, spanMs: 30 * DAY, verified: true, modesWith3: 2 }).confidence, 'high');
});
check('display-only (unverified) forced low even with lots of data', () => {
  const r = trendConfidence({ runCount: 20, spanMs: 60 * DAY, verified: false, modesWith3: 3 });
  assert.equal(r.confidence, 'low');
  assert.ok(r.reasons.some((x) => x.includes('display-only')));
});

// ---- B1: index guard does not crash on a legacy table missing trend columns ----
check('createLabTrendIndexes skips (no throw) on legacy schema missing columns', () => {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE conversation_lab_runs (id INTEGER PRIMARY KEY, cache_key TEXT)'); // legacy: no trend cols
  assert.doesNotThrow(() => createLabTrendIndexes(d));
  const idx = d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_lab_runs_target%'").all();
  assert.equal(idx.length, 0, 'indexes must be skipped, not created');
  d.close();
});
check('createLabTrendIndexes builds 3 indexes on a compatible table', () => {
  const d = new Database(':memory:');
  d.exec(
    'CREATE TABLE conversation_lab_runs (id INTEGER PRIMARY KEY, target_wxid TEXT, chatroom_id TEXT, target_display_name TEXT, mode TEXT, created_at INTEGER)',
  );
  createLabTrendIndexes(d);
  const idx = d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_lab_runs_target%'").all();
  assert.equal(idx.length, 3);
  d.close();
});

const total = passed + failed;
if (failed > 0) {
  console.error(`\nlab-trends: ${passed}/${total} passed, ${failed} FAILED`);
  process.exit(1);
}
console.log(`lab-trends: all ${total} tests passed ✓`);
