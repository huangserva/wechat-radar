import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DATA_DIR, configStatus, writeConfig } from '@/lib/config';
import { seedDemoData } from '@/lib/demo-data';
import { wxAvailable, wxDaemonStatus } from '@/lib/wx';

export const dynamic = 'force-dynamic';

const SetupSchema = z.object({
  myNicknames: z.array(z.string()).default([]),
  privacyConfirmed: z.boolean(),
  demoMode: z.boolean().default(false),
  defaultSyncDays: z.number().int().min(1).max(365).default(7),
});

export async function GET() {
  const [wxInstalled, daemon] = await Promise.all([wxAvailable(), wxDaemonStatus()]);
  return NextResponse.json({
    ok: true,
    ...configStatus(),
    dataDir: DATA_DIR,
    checks: {
      wxInstalled,
      wxDaemonRunning: daemon.running,
      wxDaemonPid: daemon.pid ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SetupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const names = parsed.data.myNicknames.map((name) => name.trim()).filter(Boolean);
  if (!parsed.data.demoMode && names.length === 0) {
    return NextResponse.json({ ok: false, error: '请至少填写一个自己的微信名或群昵称' }, { status: 400 });
  }
  const config = writeConfig({
    myNicknames: names,
    privacyConfirmed: parsed.data.privacyConfirmed,
    demoMode: parsed.data.demoMode,
    defaultSyncDays: parsed.data.defaultSyncDays,
    setupCompleted: true,
  });
  const demo = parsed.data.demoMode ? seedDemoData() : null;
  return NextResponse.json({ ok: true, configured: true, config, demo });
}
