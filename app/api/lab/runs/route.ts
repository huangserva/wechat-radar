import { NextRequest, NextResponse } from 'next/server';
import { getRunById, listRuns } from '@/lib/lab-store';
import type {
  LabMode,
  LabRunDetailResponse,
  LabRunsListQuery,
  LabRunsListResponse,
} from '@/lib/lab-types';

export const dynamic = 'force-dynamic';

const VALID_MODES = new Set<LabMode>(['work', 'couple', 'family', 'social', 'parent_child']);

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;

  // ?id= → single run detail (replay)
  const idParam = sp.get('id');
  if (idParam !== null) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { ok: false, error: 'id 必须是正整数', code: 'invalid_id' } satisfies LabRunDetailResponse,
        { status: 400 },
      );
    }
    try {
      const result = getRunById(id);
      if (!result) {
        return NextResponse.json(
          { ok: false, error: '未找到该 run', code: 'not_found' } satisfies LabRunDetailResponse,
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, result } satisfies LabRunDetailResponse);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : 'unknown error' } satisfies LabRunDetailResponse,
        { status: 500 },
      );
    }
  }

  // otherwise → filtered list of run summaries
  try {
    const query = parseListQuery(sp);
    const { runs, total } = listRuns(query);
    return NextResponse.json({ ok: true, runs, total } satisfies LabRunsListResponse);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown error' } satisfies LabRunsListResponse,
      { status: 500 },
    );
  }
}

function parseListQuery(sp: URLSearchParams): LabRunsListQuery {
  const query: LabRunsListQuery = {};
  const chatroomId = sp.get('chatroom_id')?.trim();
  if (chatroomId) query.chatroom_id = chatroomId;
  const targetWxid = sp.get('target_wxid')?.trim();
  if (targetWxid) query.target_wxid = targetWxid;
  const targetDisplay = sp.get('target_display_name')?.trim();
  if (targetDisplay) query.target_display_name = targetDisplay;
  const mode = sp.get('mode')?.trim();
  if (mode && VALID_MODES.has(mode as LabMode)) query.mode = mode as LabMode;
  const since = sp.get('since')?.trim();
  if (since) query.since = since;
  const until = sp.get('until')?.trim();
  if (until) query.until = until;
  const limit = sp.get('limit');
  if (limit && Number.isFinite(Number(limit))) query.limit = Number(limit);
  return query;
}
