#!/usr/bin/env node

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dataDir = process.env.WECHAT_RADAR_DATA_DIR || join(homedir(), '.wechat-radar');
const source = join(dataDir, 'radar.db');
const backupDir = join(dataDir, 'backups');

if (!existsSync(source)) {
  console.error(`radar.db not found: ${source}`);
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(backupDir, `radar-${stamp}.db`);

const db = new Database(source, { readonly: true, fileMustExist: true });

try {
  await db.backup(target);
  console.log(target);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  db.close();
}
