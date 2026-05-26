import { NextRequest, NextResponse } from 'next/server';
import { getLabTargetTrend } from '@/lib/lab-trends';
import type { LabMode } from '@/lib/lab-types';

export const dynamic = 'force-dynamic';

const VALID_MODES = new Set<LabMode>(['work', 'couple', 'family', 'social', 'parent_child']);

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const targetWxid = sp.get('target_wxid')?.trim() || '';
  const chatroomId = sp.get('chatroom_id')?.trim() || '';
  const targetDisplayName = sp.get('target_display_name')?.trim() || '';
  const modeParam = sp.get('mode')?.trim() || '';
  // Don't silently widen the dataset on bad params — reject them.
  if (modeParam && !VALID_MODES.has(modeParam as LabMode)) {
    return fail(`mode 不合法（只接受 ${Array.from(VALID_MODES).join('/')}）`, 'invalid_mode', 400);
  }
  const mode = modeParam ? (modeParam as LabMode) : undefined;
  const from = parseTs(sp.get('from'));
  if (from === INVALID) return fail('from 必须是数字时间戳（ms）', 'invalid_from', 400);
  const to = parseTs(sp.get('to'));
  if (to === INVALID) return fail('to 必须是数字时间戳（ms）', 'invalid_to', 400);
  const limit = parseIntOr(sp.get('limit'));
  if (limit === INVALID) return fail('limit 必须是数字', 'invalid_limit', 400);

  // Identity selector required: wxid, OR display-only that MUST carry chatroom_id.
  if (!targetWxid) {
    if (!targetDisplayName) {
      return fail('需要 target_wxid，或 chatroom_id + target_display_name', 'missing_target', 400);
    }
    if (!chatroomId) {
      return fail('display-only 目标必须带 chatroom_id（不跨群合并）', 'display_requires_chatroom', 400);
    }
  }

  try {
    const trend = getLabTargetTrend({
      target_wxid: targetWxid || undefined,
      chatroom_id: chatroomId || undefined,
      target_display_name: targetDisplayName || undefined,
      mode,
      from_created_at: from,
      to_created_at: to,
      limit,
    });
    if (!trend) {
      return NextResponse.json({ ok: false, error: '该对象没有 lab 历史 run', code: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      target: trend.target,
      runs: trend.runs,
      mode_summary: trend.mode_summary,
      dimension_families: trend.dimension_families,
      sample_quality: trend.sample_quality,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unknown error' }, { status: 500 });
  }
}

const INVALID = Symbol('invalid');
function parseTs(v: string | null): number | undefined | typeof INVALID {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : INVALID;
}
function parseIntOr(v: string | null): number | undefined | typeof INVALID {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : INVALID;
}
function fail(message: string, code: string, status: number) {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}
