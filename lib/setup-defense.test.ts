/**
 * Setup defense hardening tests.
 *
 * 1. writeConfig strips placeholder nicknames when demoMode=false
 * 2. writeConfig preserves placeholder nicknames when demoMode=true (demo)
 * 3. seedDemoData refuses to overwrite real config
 *
 * Run: `pnpm exec tsx lib/setup-defense.test.ts`
 * The WECHAT_RADAR_DATA_DIR env is set in setup-defense.env before tsx loads.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripPlaceholderNicknames, isPlaceholderNickname, writeConfig, readConfig, DATA_DIR } from './config';

const testDir = DATA_DIR; // Set by env file before module load

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

// --- isPlaceholderNickname (exported, unified) ---
check('isPlaceholderNickname: Chinese placeholder', () => {
  assert.equal(isPlaceholderNickname('你的微信名'), true);
});
check('isPlaceholderNickname: bracketed placeholder', () => {
  assert.equal(isPlaceholderNickname('[你的微信名]'), true);
});
check('isPlaceholderNickname: angle bracket 〈你的微信名〉', () => {
  assert.equal(isPlaceholderNickname('〈你的微信名〉'), true);
});
check('isPlaceholderNickname: curly double quote "你的微信名"', () => {
  assert.equal(isPlaceholderNickname('\u201c你的微信名\u201d'), true);
});
check('isPlaceholderNickname: curly single quote', () => {
  assert.equal(isPlaceholderNickname('\u2018你的微信名\u2019'), true);
});
check('isPlaceholderNickname: English yourname', () => {
  assert.equal(isPlaceholderNickname('yourname'), true);
});
check('isPlaceholderNickname: real name returns false', () => {
  assert.equal(isPlaceholderNickname('张三'), false);
});

// --- stripPlaceholderNicknames (pure function) ---
check('strips Chinese placeholder 你的微信名', () => {
  assert.deepEqual(stripPlaceholderNicknames(['你的微信名', '张三']), ['张三']);
});
check('strips bracketed placeholder [你的微信名]', () => {
  assert.deepEqual(stripPlaceholderNicknames(['[你的微信名]', '李四']), ['李四']);
});
check('strips English placeholder yourwechatname', () => {
  assert.deepEqual(stripPlaceholderNicknames(['yourwechatname', 'Alice']), ['Alice']);
});
check('strips all placeholders, returns empty', () => {
  assert.deepEqual(stripPlaceholderNicknames(['你的微信名', '微信名']), []);
});
check('keeps real names intact', () => {
  assert.deepEqual(stripPlaceholderNicknames(['张三', 'San Zhang']), ['张三', 'San Zhang']);
});
check('filters empty strings', () => {
  assert.deepEqual(stripPlaceholderNicknames(['', '  ', '张三']), ['张三']);
});

// --- writeConfig: demoMode=false strips placeholders ---
check('writeConfig strips placeholders when demoMode=false', () => {
  const cfg = writeConfig({
    myNicknames: ['你的微信名', '张三', '[你的微信名]'],
    demoMode: false,
    setupCompleted: true,
    privacyConfirmed: true,
  });
  assert.deepEqual(cfg.myNicknames, ['张三']);
});

check('writeConfig keeps all names when demoMode=true', () => {
  const cfg = writeConfig({
    myNicknames: ['你的微信名'],
    demoMode: true,
    setupCompleted: true,
    privacyConfirmed: true,
  });
  assert.deepEqual(cfg.myNicknames, ['你的微信名']);
});

check('writeConfig does not touch nicknames when demoMode is undefined', () => {
  writeConfig({ myNicknames: ['你的微信名', '张三'], demoMode: false });
  const cfg = writeConfig({ defaultSyncDays: 30 });
  assert.deepEqual(cfg.myNicknames, ['张三']);
});

// --- writeConfig: config file on disk matches ---
check('config file on disk has no placeholders after real setup', () => {
  writeConfig({
    myNicknames: ['你的微信名', '王五'],
    demoMode: false,
    setupCompleted: true,
    privacyConfirmed: true,
  });
  const raw = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
  assert.deepEqual(raw.myNicknames, ['王五']);
  assert.equal(raw.demoMode, false);
});

check('config file on disk keeps placeholders in demo mode', () => {
  writeConfig({
    myNicknames: ['你的微信名'],
    demoMode: true,
    setupCompleted: true,
    privacyConfirmed: true,
  });
  const raw = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
  assert.deepEqual(raw.myNicknames, ['你的微信名']);
  assert.equal(raw.demoMode, true);
});

// --- seedDemoData guard ---
async function runSeedDemoDataTests() {
  const { seedDemoData } = await import('./demo-data');

  check('seedDemoData skips when real config exists', () => {
    writeConfig({
      myNicknames: ['张三'],
      demoMode: false,
      setupCompleted: true,
      privacyConfirmed: true,
    });
    const result = seedDemoData();
    assert.equal(result.skipped, true);
    assert.equal(result.groups, 0);
    const cfg = readConfig();
    assert.equal(cfg.demoMode, false);
    assert.deepEqual(cfg.myNicknames, ['张三']);
  });

  check('seedDemoData runs when config is demo', () => {
    writeConfig({
      myNicknames: ['你的微信名'],
      demoMode: true,
      setupCompleted: true,
      privacyConfirmed: true,
    });
    const result = seedDemoData();
    assert.equal(result.skipped, undefined);
    assert.ok(result.groups > 0);
  });

  check('seedDemoData runs when config is not setup', () => {
    writeConfig({
      myNicknames: [],
      demoMode: false,
      setupCompleted: false,
      privacyConfirmed: false,
    });
    const result = seedDemoData();
    assert.equal(result.skipped, undefined);
    assert.ok(result.groups > 0);
  });
}

runSeedDemoDataTests()
  .then(() => {
    const total = passed + failed;
    if (failed > 0) {
      console.error(`\nsetup-defense: ${passed}/${total} passed, ${failed} FAILED`);
      process.exit(1);
    }
    console.log(`setup-defense: all ${total} tests passed ✓`);
  })
  .catch((e) => {
    console.error('Test runner error:', e);
    process.exit(1);
  });
