#!/usr/bin/env node
/**
 * Test runner for setup-defense: creates a temp dir, sets WECHAT_RADAR_DATA_DIR,
 * then dynamically imports the test module (so env is set before config loads).
 */
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execSync } = require('node:child_process');

const testDir = mkdtempSync(join(tmpdir(), 'wechat-radar-test-'));
const envFile = join(testDir, '.env');
writeFileSync(envFile, `WECHAT_RADAR_DATA_DIR=${testDir}\n`);

try {
  execSync(`pnpm exec tsx --env-file "${envFile}" lib/setup-defense.test.ts`, {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
  });
} finally {
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
}
