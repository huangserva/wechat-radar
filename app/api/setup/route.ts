import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { DATA_DIR, configStatus, writeConfig, isPlaceholderNickname } from '@/lib/config';
import { seedDemoData } from '@/lib/demo-data';
import { wxAvailable, wxDaemonStatus } from '@/lib/wx';
import { wxDbAvailable, wxDbPaths } from '@/lib/wechat-db-adapter';
import { decryptStatus, personalKeyExtractCommand, keyExtractStrategies } from '@/lib/decrypt';

export const dynamic = 'force-dynamic';

const SetupSchema = z.object({
  myNicknames: z.array(z.string()).default([]),
  privacyConfirmed: z.boolean(),
  demoMode: z.boolean().default(false),
  defaultSyncDays: z.number().int().min(1).max(365).default(7),
});

export async function GET() {
  const [wxInstalled, daemon] = await Promise.all([wxAvailable(), wxDaemonStatus()]);
  const status = configStatus();
  const paths = wxDbPaths();
  const toolchain = decryptStatus(status.config);
  // Key freshness heuristic: a key json modified within 24h is "fresh" (WeChat
  // hasn't been restarted since extraction). null mtime = file absent.
  const STALE_AFTER_S = 24 * 60 * 60;
  const nowS = Math.floor(Date.now() / 1000);
  const personalFresh = toolchain.keys.personal.exists
    ? toolchain.keys.personal.mtime !== null && nowS - toolchain.keys.personal.mtime < STALE_AFTER_S
    : null;
  const wecomFresh = toolchain.keys.wecom.exists
    ? toolchain.keys.wecom.mtime !== null && nowS - toolchain.keys.wecom.mtime < STALE_AFTER_S
    : null;
  return NextResponse.json({
    ok: true,
    ...status,
    dataDir: DATA_DIR,
    suggestedNicknames: suggestNicknames(status.config.wechatSelfWxid, paths.contactDb),
    decrypt: {
      enabled: status.config.decryptEnabled,
      venvReady: toolchain.pythonVenv,
      keyFresh: personalFresh,
      wecomKeyFresh: wecomFresh,
      needsSudo:
        (!toolchain.keys.personal.exists && Boolean(status.config.keysFile)) ||
        (!toolchain.keys.wecom.exists && Boolean(status.config.wecomKeysFile)),
      needsFullDiskAccess: false, // not detectable from server-side; UI shows hint
      extractCommand: personalKeyExtractCommand(status.config),
      scope: 'personal',
      keyExtraction: {
        needsFridaFallback: toolchain.needsFridaFallback,
        fridaAvailable: toolchain.scripts.fridaHook && toolchain.scripts.fridaDriver,
        // Personal-WeChat strategy chain (memory-scan → frida → match-keys).
        // Wecom is covered by needsFridaFallback.wecom; its strategies share the
        // same shape if needed later.
        strategies: keyExtractStrategies(status.config, 'personal'),
      },
    },
    checks: {
      wxInstalled,
      wxDaemonRunning: daemon.running,
      wxDaemonPid: daemon.pid ?? null,
      collectorDb: paths.collectorDb,
      decryptedDir: paths.decryptedDir,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SetupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  if (!parsed.data.privacyConfirmed) {
    return NextResponse.json({ ok: false, error: '请先确认隐私说明' }, { status: 400 });
  }
  let demoMode = parsed.data.demoMode === true;
  if (!demoMode) {
    // Real setup: verify real data source exists
    if (!wxDbAvailable()) {
      return NextResponse.json(
        { ok: false, error: '未检测到真实数据源（collector.db / decrypted DB），请先解密微信数据或勾选 demo 模式' },
        { status: 400 },
      );
    }
  }
  if (demoMode && wxDbAvailable()) {
    console.warn('[setup] Real data source detected but demoMode was requested — forcing demoMode=false');
    demoMode = false;
  }
  const names = sanitizeNicknames(parsed.data.myNicknames);
  if (!demoMode && names.length === 0) {
    return NextResponse.json({ ok: false, error: '请填写真实微信显示名，不能使用"你的微信名"占位符' }, { status: 400 });
  }
  const demo = demoMode ? seedDemoData() : null;
  const config = writeConfig({
    myNicknames: demoMode ? (names.length > 0 ? names : ['你的微信名']) : names,
    privacyConfirmed: parsed.data.privacyConfirmed,
    demoMode,
    defaultSyncDays: parsed.data.defaultSyncDays,
    wechatDataSource: 'db',
    setupCompleted: true,
  });
  return NextResponse.json({ ok: true, configured: true, config, demo });
}

function sanitizeNicknames(names: string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || isPlaceholderNickname(name) || seen.has(name)) continue;
    seen.add(name);
    clean.push(name);
  }
  return clean;
}

function suggestNicknames(selfWxid: string, contactDb: string): string[] {
  const candidates: string[] = [];
  if (existsSync(contactDb)) {
    let d: Database.Database | null = null;
    try {
      d = new Database(contactDb, { readonly: true, fileMustExist: true });
      const hasContact = d
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'contact'")
        .get();
      if (hasContact) {
        const findByUsername = d.prepare('SELECT username, nick_name, remark, alias FROM contact WHERE username = ?');
        for (const username of [selfWxid, '__self__']) {
          if (!username) continue;
          const row = findByUsername.get(username) as { username?: string; nick_name?: string | null; remark?: string | null; alias?: string | null } | undefined;
          if (row) {
            candidates.push(row.remark ?? '', row.nick_name ?? '', row.alias ?? '');
          }
        }
      }
    } catch {
      // Best-effort setup hint only; POST validation remains authoritative.
    } finally {
      d?.close();
    }
  }
  if (selfWxid) candidates.push(selfWxid);
  return sanitizeNicknames(candidates).slice(0, 3);
}
