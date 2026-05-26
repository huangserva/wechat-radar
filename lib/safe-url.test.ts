/**
 * Security tests for safeExternalUrl — untrusted external links must only ever
 * resolve to http(s); javascript:/data:/vbscript:/file:/etc. must be blocked.
 *
 * Run: `pnpm test` (or `pnpm exec tsx lib/safe-url.test.ts`). No test framework —
 * a tiny assert runner that exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import { safeExternalUrl, isSafeExternalUrl } from './safe-url';

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

// --- must be BLOCKED (return null) ---
const blocked: Array<[string, string | null | undefined]> = [
  ['javascript: scheme', 'javascript:alert(1)'],
  ['javascript: uppercase', 'JAVASCRIPT:alert(1)'],
  ['javascript: leading/trailing space', '  javascript:alert(1)  '],
  ['javascript: mixed case', 'JaVaScRiPt:alert(1)'],
  ['data: html', 'data:text/html,<script>alert(1)</script>'],
  ['vbscript:', 'vbscript:msgbox(1)'],
  ['file://', 'file:///etc/passwd'],
  ['empty string', ''],
  ['whitespace only', '   '],
  ['null', null],
  ['undefined', undefined],
  ['garbage with space', 'not a real url'],
];
for (const [name, input] of blocked) {
  check(`BLOCK ${name}`, () => {
    assert.equal(safeExternalUrl(input), null, `expected null, got ${safeExternalUrl(input)}`);
    assert.equal(isSafeExternalUrl(input), false);
  });
}

// --- must be ALLOWED (http/https) ---
const allowed: Array<[string, string]> = [
  ['plain http', 'http://example.com/x'],
  ['plain https', 'https://mp.weixin.qq.com/s/abc'],
  ['bare domain → https', 'mp.weixin.qq.com?__biz=xxx&mid=1'],
  ['protocol-relative → https', '//evil.com/x'],
  ['https with port/path', 'https://host.example:8443/a/b?c=1#f'],
];
for (const [name, input] of allowed) {
  check(`ALLOW ${name}`, () => {
    const out = safeExternalUrl(input);
    assert.ok(out !== null, 'expected non-null');
    assert.ok(out!.startsWith('http://') || out!.startsWith('https://'), `expected http(s), got ${out}`);
    assert.equal(isSafeExternalUrl(input), true);
  });
}

// --- specific value expectations ---
check('http url preserved', () => assert.equal(safeExternalUrl('http://example.com/x'), 'http://example.com/x'));
check('bare domain upgraded to https', () =>
  assert.ok(safeExternalUrl('mp.weixin.qq.com/s/abc')?.startsWith('https://mp.weixin.qq.com/')));

const total = passed + failed;
if (failed > 0) {
  console.error(`\nsafe-url: ${passed}/${total} passed, ${failed} FAILED`);
  process.exit(1);
}
console.log(`safe-url: all ${total} tests passed ✓`);
