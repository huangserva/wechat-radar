import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { prepareLabMessagesForPrompt } from '@/lib/lab-llm';
import { contactDbPath, fetchLabSourceMessages, listLabMembers, lookupContact } from '@/lib/lab-source';
import type { LabSourceCoverage } from '@/lib/lab-source';
import type {
  LabMemberCandidate,
  LabMessageRole,
  LabReadRequest,
  LabReadResponse,
  LabRoleCounts,
  LabSourceMessage,
  TargetResolution,
} from '@/lib/lab-types';

export const dynamic = 'force-dynamic';

const VALID_MODES = new Set(['work', 'couple', 'family', 'social', 'parent_child']);
const MAX_RANGE_DAYS = 31;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<LabReadRequest> | null;
  if (!body || typeof body !== 'object') {
    return fail('请求体无效');
  }
  const mode = String(body.mode ?? '');
  const chatroomId = String(body.chatroom_id ?? '').trim();
  const targetDisplayName = String(body.target_display_name ?? '').trim();
  const since = String(body.since ?? '').trim();
  const until = String(body.until ?? '').trim();
  const targetWxid = body.target_wxid ? String(body.target_wxid).trim() : undefined;

  if (!VALID_MODES.has(mode)) return fail('mode 不合法');
  if (!chatroomId) return fail('chatroom_id 必填');
  if (!targetDisplayName) return fail('角色 B 显示名必填');
  if (!isDate(since) || !isDate(until)) return fail('日期格式应为 YYYY-MM-DD（且须为真实日期）');
  if (since > until) return fail('开始日期不能晚于结束日期');
  // inclusive: [since,until] spans daysBetween + 1 calendar days.
  if (daysBetween(since, until) + 1 > MAX_RANGE_DAYS) return fail(`最多读取 ${MAX_RANGE_DAYS} 天`);

  try {
    const cfg = readConfig();
    const group = chatroomId.endsWith('@chatroom');

    // ---- self identity (request > radar config > contact display of self wxid)
    const selfWxid = (body.self_wxid && String(body.self_wxid)) || cfg.wechatSelfWxid || '';
    const selfDisplayNames = new Set<string>();
    for (const n of body.self_display_names ?? []) addName(selfDisplayNames, n);
    for (const n of cfg.myNicknames) addName(selfDisplayNames, n);
    if (selfWxid) {
      const selfContact = lookupContact(contactDbPath(), selfWxid);
      if (selfContact) addCandidateNames(selfDisplayNames, selfContact);
    }

    // ---- fetch messages (local -> collector -> decrypted raw)
    const fetched = fetchLabSourceMessages(chatroomId, since, until);

    // ---- resolve role B (verified requires the wxid to be a real member or to
    //      actually appear as a sender in the fetched messages — not just claimed)
    const members = group ? listLabMembers(chatroomId) : labMembersForPrivate(chatroomId);
    const senderWxids = new Set<string>();
    for (const m of fetched.messages) {
      if (m.sender_wxid) senderWxids.add(m.sender_wxid);
    }
    const resolution = resolveTarget(chatroomId, group, targetWxid, targetDisplayName, members, senderWxids);
    const targetDisplayNames = new Set<string>();
    addName(targetDisplayNames, resolution.target_display_name);
    addName(targetDisplayNames, targetDisplayName);
    for (const c of resolution.matched_candidates) addCandidateNames(targetDisplayNames, c);

    // ---- assign roles + count
    const roleCounts: LabRoleCounts = { A: 0, B: 0, other: 0, unknown: 0 };
    const withRoles = fetched.messages.map((m) => {
      const role = assignRole(m, selfWxid, selfDisplayNames, resolution.target_wxid, targetDisplayNames, group);
      roleCounts[role] += 1;
      return { ...m, role };
    });

    const filtered = withRoles.filter((m) => m.role === 'A' || m.role === 'B');
    const prepared = prepareLabMessagesForPrompt(filtered);

    // ---- block checks (mirror /api/lab/analyze data-side gates)
    const blockedReasons = computeBlockedReasons(
      fetched.source,
      fetched.empty_reason,
      resolution,
      roleCounts,
      group,
      Boolean(targetWxid),
      fetched.source_coverage,
    );
    const analysisAllowed = blockedReasons.length === 0;

    const response: LabReadResponse = {
      ok: true,
      mode: mode as LabReadRequest['mode'],
      chatroom_id: chatroomId,
      chat_name: body.chat_name,
      target_resolution: resolution,
      role_counts: roleCounts,
      source: fetched.source,
      empty_reason: fetched.empty_reason,
      message_count: withRoles.length,
      filtered_count: filtered.length,
      analysis_allowed: analysisAllowed,
      blocked_reasons: blockedReasons,
      compression_estimate: prepared.compression,
      members: resolution.matched_candidates,
      messages: filtered,
      preview: filtered.slice(0, 12),
    };
    // Surface source_coverage (full/partial/empty) at the top level so the
    // front-end / verification can observe data completeness, not just inference
    // it from blocked_reasons. (Additive field; LabReadResponse stays unchanged.)
    return NextResponse.json({ ...response, source_coverage: fetched.source_coverage });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/lab/read failed', e);
    return NextResponse.json({ ok: false, error: message } satisfies LabReadResponse, { status: 500 });
  }
}

function resolveTarget(
  chatroomId: string,
  group: boolean,
  targetWxid: string | undefined,
  targetDisplayName: string,
  members: LabMemberCandidate[],
  senderWxids: Set<string>,
): TargetResolution {
  if (!group) {
    // Private chat: the peer's wxid is the chatroom_id itself.
    const peerWxid = targetWxid || chatroomId;
    const peer = members[0] ?? { username: peerWxid, display_name: targetDisplayName || peerWxid };
    return {
      method: 'wxid',
      target_wxid: peerWxid,
      target_display_name: targetDisplayName || peer.display_name,
      matched_candidates: [peer],
      confidence: 'verified',
    };
  }

  if (targetWxid) {
    const matched = members.find((m) => m.username === targetWxid);
    // Only 'verified' when the wxid is a real group member OR actually appears as
    // a sender in the messages. A claimed-but-absent wxid must NOT be verified —
    // fall through to display resolution (and may end up blocked as not-found).
    if (matched || senderWxids.has(targetWxid)) {
      return {
        method: 'wxid',
        target_wxid: targetWxid,
        target_display_name: matched?.display_name || targetDisplayName,
        matched_candidates: matched ? [matched] : [],
        confidence: 'verified',
      };
    }
  }

  const key = norm(targetDisplayName);
  const matches = members.filter((m) =>
    [m.display_name, m.nickname, m.remark, m.alias, m.username].some((v) => v && norm(v) === key),
  );
  if (matches.length === 1) {
    return {
      method: 'display_unique',
      target_wxid: matches[0].username,
      target_display_name: matches[0].display_name || targetDisplayName,
      matched_candidates: matches,
      confidence: 'display_unique',
    };
  }
  if (matches.length > 1) {
    return {
      method: 'display_ambiguous',
      target_display_name: targetDisplayName,
      matched_candidates: matches,
      confidence: 'ambiguous',
    };
  }
  // No member match — fall back to matching purely by display string in messages.
  return {
    method: 'manual_display',
    target_display_name: targetDisplayName,
    matched_candidates: [],
    confidence: 'manual',
  };
}

function assignRole(
  m: LabSourceMessage,
  selfWxid: string,
  selfDisplayNames: Set<string>,
  targetWxid: string | undefined,
  targetDisplayNames: Set<string>,
  group: boolean,
): LabMessageRole {
  if (isSelf(m, selfWxid, selfDisplayNames)) return 'A';
  if (isTarget(m, targetWxid, targetDisplayNames)) return 'B';
  if (!group) return identifiable(m) ? 'B' : 'unknown';
  return identifiable(m) ? 'other' : 'unknown';
}

function isSelf(m: LabSourceMessage, selfWxid: string, selfDisplayNames: Set<string>): boolean {
  if (m.sender === '__self__') return true;
  if (selfWxid && m.sender_wxid && m.sender_wxid === selfWxid) return true;
  return matchesAny(m, selfDisplayNames);
}

function isTarget(m: LabSourceMessage, targetWxid: string | undefined, targetDisplayNames: Set<string>): boolean {
  if (targetWxid && m.sender_wxid && m.sender_wxid === targetWxid) return true;
  return matchesAny(m, targetDisplayNames);
}

function matchesAny(m: LabSourceMessage, names: Set<string>): boolean {
  if (names.size === 0) return false;
  if (m.display_name && names.has(norm(m.display_name))) return true;
  if (m.sender && names.has(norm(m.sender))) return true;
  if (m.sender_wxid && names.has(norm(m.sender_wxid))) return true;
  return false;
}

function identifiable(m: LabSourceMessage): boolean {
  if (m.sender_wxid) return true;
  const d = (m.display_name || m.sender || '').trim();
  return d.length > 0 && d !== '(unknown)';
}

function computeBlockedReasons(
  source: LabReadResponse['source'],
  emptyReason: string | null | undefined,
  resolution: TargetResolution,
  roleCounts: LabRoleCounts,
  group: boolean,
  targetWxidProvided: boolean,
  sourceCoverage: LabSourceCoverage,
): string[] {
  const reasons: string[] = [];
  if (source === 'none' || emptyReason) {
    reasons.push(emptyReason ? `没有可分析的消息来源（${emptyReason}）。` : '没有可分析的消息来源。');
  }
  if (resolution.method === 'display_ambiguous') {
    reasons.push('角色 B 仅 display 匹配且候选不唯一，请先消歧。');
  }
  // A provided target_wxid that we could not verify (not a member, not seen in
  // messages) AND that did not resolve to any member by display name → not found.
  if (group && targetWxidProvided && resolution.confidence !== 'verified' && resolution.matched_candidates.length === 0) {
    reasons.push('指定的角色 B（target_wxid）不在群成员或消息中，且显示名未匹配到成员，无法确认。');
  }
  if (roleCounts.A <= 0) {
    reasons.push('无法确认角色 A（我）的消息，不能分析。');
  }
  if (roleCounts.B <= 0) {
    reasons.push('未读到角色 B 的消息，不能分析。');
  }
  const total = roleCounts.A + roleCounts.B + roleCounts.other + roleCounts.unknown;
  if (roleCounts.unknown > 50 || (total > 0 && roleCounts.unknown / total > 0.2)) {
    reasons.push('unknown 消息比例过高，请先修正身份解析。');
  }
  // Source could not be confirmed to cover the whole window and no complete
  // fallback existed → don't analyze partial data silently.
  if (sourceCoverage === 'partial') {
    reasons.push('数据源未覆盖完整时间窗（无 raw 兜底），结果可能残缺，已阻止分析。');
  }
  return reasons;
}

function labMembersForPrivate(chatroomId: string): LabMemberCandidate[] {
  return listLabMembers(chatroomId);
}

function addCandidateNames(set: Set<string>, c: LabMemberCandidate) {
  addName(set, c.display_name);
  addName(set, c.nickname);
  addName(set, c.remark);
  addName(set, c.alias);
}

function addName(set: Set<string>, value: string | undefined | null) {
  if (!value) return;
  const n = norm(value);
  if (n) set.add(n);
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  // round-trip: reject overflow dates like 2026-02-31 (rolls into March).
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function daysBetween(since: string, until: string): number {
  const start = new Date(`${since}T00:00:00`).getTime();
  const end = new Date(`${until}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

function fail(message: string) {
  return NextResponse.json({ ok: false, error: message } satisfies LabReadResponse, { status: 400 });
}
