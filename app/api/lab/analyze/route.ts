import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getLabLlmConfig,
  LabLlmRunError,
  prepareLabMessagesForPrompt,
  runLabLlm,
} from '@/lib/lab-llm';
import { loadLabProfileContext } from '@/lib/lab-profile';
import {
  LAB_PROMPT_VERSION,
  labDimensionsForMode,
  type LabAnalysisDetail,
  type LabAnalysisDimension,
  type LabAnalysisResult,
  type LabAnalyzeRequest,
  type LabAnalyzeResponse,
  type LabAnalyzeTimingsMs,
  type LabConfidence,
  type LabDimensionTemplate,
  type LabEvidence,
  type LabLlmTimingsMs,
  type LabMode,
  type LabSourceMessage,
  type LabStore,
  type LabStoreModule,
} from '@/lib/lab-types';

export const dynamic = 'force-dynamic';

const ModeSchema = z.enum(['work', 'couple', 'family', 'social', 'parent_child']);
const SourceSchema = z.enum(['local_messages', 'collector', 'decrypted_raw', 'none']);
const ProviderSchema = z.enum(['codex', 'openai-compatible', 'local']);

const MemberCandidateSchema = z
  .object({
    username: z.string(),
    nickname: z.string().optional(),
    remark: z.string().optional(),
    alias: z.string().optional(),
    display_name: z.string(),
  })
  .strict();

const TargetResolutionSchema = z
  .object({
    method: z.enum(['wxid', 'username', 'alias', 'display_unique', 'display_ambiguous', 'manual_display']),
    target_wxid: z.string().optional(),
    target_display_name: z.string(),
    matched_candidates: z.array(MemberCandidateSchema).default([]),
    confidence: z.enum(['verified', 'display_unique', 'ambiguous', 'manual']),
  })
  .strict();

const SourceMessageSchema = z
  .object({
    chatroom_id: z.string().min(1),
    local_id: z.number().int(),
    raw_sender_id: z.union([z.string(), z.number()]).nullable(),
    sender_wxid: z.string().nullable(),
    display_name: z.string(),
    sender: z.string(),
    role: z.enum(['A', 'B', 'other', 'unknown']),
    content: z.string(),
    type: z.string(),
    time: z.string(),
    timestamp: z.number(),
    source: z.enum(['local_messages', 'collector', 'decrypted_raw']),
    truncated: z.boolean().optional(),
  })
  .strict();

const AnalyzeSchema = z
  .object({
    mode: ModeSchema,
    chatroom_id: z.string().min(1),
    chat_name: z.string().optional(),
    target_wxid: z.string().optional(),
    target_display_name: z.string().min(1),
    since: z.string().min(8),
    until: z.string().min(8),
    self_wxid: z.string().optional(),
    self_display_names: z.array(z.string()).optional(),
    messages: z.array(SourceMessageSchema).min(1),
    role_counts: z
      .object({
        A: z.number().int().min(0),
        B: z.number().int().min(0),
        other: z.number().int().min(0),
        unknown: z.number().int().min(0),
      })
      .strict(),
    target_resolution: TargetResolutionSchema,
    source: SourceSchema,
    empty_reason: z.string().nullable().optional(),
    custom_dimensions: z.array(z.string().trim().min(1).max(18)).max(8).optional(),
    force: z.boolean().optional(),
    use_profile_context: z.boolean().optional(),
    consent: z
      .object({
        accepted: z.boolean(),
        provider: ProviderSchema,
        model: z.string().min(1),
        sampled_count: z.number().int().min(0),
        profile_context_used: z.boolean(),
        accepted_at: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export async function GET() {
  const profile = loadLabProfileContext();
  return NextResponse.json({
    ok: true,
    ...getLabLlmConfig(),
    use_profile_context_default: false,
    profile_available: profile.available,
    profile_source: profile.source,
    profile_updated_at: profile.updated_at,
  });
}

export async function POST(req: NextRequest) {
  const routeStartedAt = performance.now();
  const timings: Partial<LabAnalyzeTimingsMs> = {};
  let attemptCount = 0;

  const requestParseStartedAt = performance.now();
  const body = await req.json().catch(() => null);
  setTiming(timings, 'request_parse', requestParseStartedAt);

  const schemaValidateStartedAt = performance.now();
  const parsed = AnalyzeSchema.safeParse(body);
  addTiming(timings, 'validate', schemaValidateStartedAt);
  if (!parsed.success) {
    return error('invalid_request', parsed.error.message, 400, timings, routeStartedAt, attemptCount);
  }

  const request = parsed.data as LabAnalyzeRequest;
  const requestValidateStartedAt = performance.now();
  const blocked = validateAnalyzeRequest(request);
  addTiming(timings, 'validate', requestValidateStartedAt);
  if (blocked) return error(blocked.code, blocked.message, 400, timings, routeStartedAt, attemptCount);

  const config = getLabLlmConfig();
  const prepareStartedAt = performance.now();
  const prepared = prepareLabMessagesForPrompt(request.messages);
  setTiming(timings, 'prepare', prepareStartedAt);

  const consentValidateStartedAt = performance.now();
  const consentError = validateConsent(request, config, prepared.compression.sampled_count);
  addTiming(timings, 'validate', consentValidateStartedAt);
  if (consentError) return error(consentError.code, consentError.message, 400, timings, routeStartedAt, attemptCount);

  const profileStartedAt = performance.now();
  const profileContext = request.use_profile_context ? loadLabProfileContext() : null;
  const profileHash = request.use_profile_context ? (profileContext?.hash ?? 'profile-empty') : 'profile-disabled';
  setTiming(timings, 'profile', profileStartedAt);

  const storeStartedAt = performance.now();
  const store = await loadLabStore();
  setTiming(timings, 'store', storeStartedAt);
  if (!store) {
    return error(
      'lab_store_missing',
      'lib/lab-store.ts 尚未接入；等待后端持久化实现后 /api/lab/analyze 才会发送消息给模型。',
      501,
      timings,
      routeStartedAt,
      attemptCount,
    );
  }

  const dimensions = dimensionsForRequest(request.mode, request.custom_dimensions);
  const sourceMessageHash = hashSourceMessages(request.messages);
  const dimensionsHash = sha256(dimensions.map((d) => d.name).join('\n'));
  const cacheKey = buildCacheKey(request, dimensionsHash, sourceMessageHash, config.model, profileHash);

  if (!request.force) {
    const cacheStartedAt = performance.now();
    const cached = await store.getCachedRun(cacheKey);
    setTiming(timings, 'cache_lookup', cacheStartedAt);
    if (cached) {
      return NextResponse.json({
        ok: true,
        cached: true,
        illegal_evidence_count: 0,
        timings_ms: finalizeTimings(timings, routeStartedAt),
        attempt_count: attemptCount,
        result: cached,
      } satisfies LabAnalyzeResponse);
    }
  } else {
    timings.cache_lookup = 0;
  }

  try {
    const llmStartedAt = performance.now();
    const llm = await runLabLlm({
      mode: request.mode,
      chatroom_id: request.chatroom_id,
      chat_name: request.chat_name,
      target_resolution: request.target_resolution,
      since: request.since,
      until: request.until,
      dimensions,
      custom_dimensions: request.custom_dimensions,
      messages: request.messages,
      profile_context: profileContext?.text,
      use_profile_context: Boolean(request.use_profile_context),
    });
    attemptCount = llm.attempt_count;
    setTiming(timings, 'llm_total', llmStartedAt);
    applyLlmTimings(timings, llm.timings_ms);

    const evidenceStartedAt = performance.now();
    const messageMap = buildMessageMap(request.messages);
    const evidenceStats = { invalid: 0 };
    const dimensionsWithEvidence = llm.dimensions.map((d) => withEvidence(d, messageMap, evidenceStats));
    const detailsWithEvidence = llm.details.map((d) => withDetailEvidence(d, messageMap, evidenceStats));
    setTiming(timings, 'evidence', evidenceStartedAt);

    const result: LabAnalysisResult = {
      cache_key: cacheKey,
      mode: request.mode,
      chatroom_id: request.chatroom_id,
      chat_name: request.chat_name,
      target_wxid: request.target_resolution.target_wxid ?? request.target_wxid,
      target_display_name: request.target_resolution.target_display_name,
      target_resolution: request.target_resolution,
      since: request.since,
      until: request.until,
      provider: config.provider,
      model: config.model,
      prompt_version: LAB_PROMPT_VERSION,
      source_message_hash: sourceMessageHash,
      compression: llm.compression,
      profile_context_used: Boolean(request.use_profile_context && profileContext?.available),
      summary: llm.summary,
      model_reading: llm.model_reading,
      avg_score: averageScore(llm.dimensions),
      detail_count: llm.details.length,
      risk_count: llm.risk_count,
      confidence: llm.confidence,
      dimensions: dimensionsWithEvidence,
      details: detailsWithEvidence,
      highlights: llm.highlights,
      created_at: Date.now(),
    };
    if (evidenceStats.invalid > 0) {
      result.confidence = degradeConfidence(result.confidence);
    }

    const saveStartedAt = performance.now();
    const saved = await store.saveRun({
      request,
      result,
      cache_key: cacheKey,
      source_message_hash: sourceMessageHash,
      dimensions_hash: dimensionsHash,
      target_resolution_json: JSON.stringify(request.target_resolution),
      compression_version: llm.compression.compression_version,
    });
    setTiming(timings, 'save', saveStartedAt);

    return NextResponse.json({
      ok: true,
      cached: false,
      illegal_evidence_count: evidenceStats.invalid,
      timings_ms: finalizeTimings(timings, routeStartedAt),
      attempt_count: attemptCount,
      result: saved,
    } satisfies LabAnalyzeResponse);
  } catch (e) {
    if (e instanceof LabLlmRunError) {
      attemptCount = e.attempt_count;
      applyLlmTimings(timings, e.timings_ms);
    }
    return error(
      'lab_analysis_failed',
      e instanceof Error ? e.message : 'unknown error',
      500,
      timings,
      routeStartedAt,
      attemptCount,
    );
  }
}

function validateAnalyzeRequest(request: LabAnalyzeRequest): { code: string; message: string } | null {
  if (request.source === 'none' || request.empty_reason) {
    return { code: 'empty_source', message: request.empty_reason || '没有可分析的消息来源。' };
  }
  if (request.target_resolution.method === 'display_ambiguous') {
    return { code: 'target_ambiguous', message: '角色 B 仅 display 匹配且候选不唯一，请先消歧。' };
  }
  if (request.role_counts.A <= 0) {
    return { code: 'missing_role_a', message: '无法确认角色 A（我）的消息，不能分析。' };
  }
  if (request.role_counts.B <= 0) {
    return { code: 'missing_role_b', message: '未读到角色 B 的消息，不能分析。' };
  }
  const total = request.role_counts.A + request.role_counts.B + request.role_counts.other + request.role_counts.unknown;
  if (request.role_counts.unknown > 50 || (total > 0 && request.role_counts.unknown / total > 0.2)) {
    return { code: 'too_many_unknown', message: 'unknown 消息比例过高，请先修正身份解析。' };
  }
  return null;
}

function validateConsent(
  request: LabAnalyzeRequest,
  config: ReturnType<typeof getLabLlmConfig>,
  actualSampledCount: number,
): { code: string; message: string } | null {
  if (!request.consent.accepted) {
    return { code: 'consent_required', message: '需要显式同意后才能发送消息给 AI provider/model。' };
  }
  if (request.consent.provider !== config.provider || request.consent.model !== config.model) {
    return { code: 'provider_changed', message: '当前 provider/model 与用户同意时不一致，请重新确认。' };
  }
  if (request.consent.profile_context_used !== Boolean(request.use_profile_context)) {
    return { code: 'profile_consent_changed', message: 'Profile 开关与 consent 中展示的不一致，请重新确认。' };
  }
  if (request.consent.sampled_count < actualSampledCount) {
    return { code: 'sample_count_changed', message: '实际发送样本数超过 consent 中展示的数量，请重新确认。' };
  }
  return null;
}

function dimensionsForRequest(mode: LabMode, customDimensions: string[] = []): LabDimensionTemplate[] {
  const defaults = labDimensionsForMode(mode);
  const seen = new Set(defaults.map((d) => normalizeDimensionName(d.name)));
  const custom: LabDimensionTemplate[] = [];
  for (const rawName of customDimensions) {
    if (custom.length >= Math.max(0, 8 - defaults.length)) break;
    const name = normalizeDimensionName(rawName);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    custom.push({
      name,
      icon: 'Sparkles',
      description: '用户自定义检测维度',
      scoring_hint: '按对话证据给 0-100 定性分',
    });
  }
  return [...defaults, ...custom].slice(0, 8);
}

function normalizeDimensionName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 18);
}

function buildMessageMap(messages: LabSourceMessage[]): Map<number, LabEvidence> {
  const map = new Map<number, LabEvidence>();
  for (const message of messages) {
    if (message.role !== 'A' && message.role !== 'B') continue;
    map.set(message.local_id, {
      chatroom_id: message.chatroom_id,
      local_id: message.local_id,
      time: message.time,
      sender: message.display_name || message.sender,
      snippet: message.content.replace(/\s+/g, ' ').trim().slice(0, 120),
    });
  }
  return map;
}

function withEvidence(
  dimension: Omit<LabAnalysisDimension, 'evidence'>,
  messageMap: Map<number, LabEvidence>,
  stats: { invalid: number },
): LabAnalysisDimension {
  const evidence = evidenceForIds(dimension.evidence_msg_ids, messageMap, stats);
  return {
    ...dimension,
    evidence_msg_ids: evidence.map((item) => item.local_id),
    evidence,
  };
}

function withDetailEvidence(
  detail: Omit<LabAnalysisDetail, 'evidence'>,
  messageMap: Map<number, LabEvidence>,
  stats: { invalid: number },
): LabAnalysisDetail {
  const evidence = evidenceForIds(detail.evidence_msg_ids, messageMap, stats);
  return {
    ...detail,
    evidence_msg_ids: evidence.map((item) => item.local_id),
    evidence,
  };
}

function evidenceForIds(
  ids: number[],
  messageMap: Map<number, LabEvidence>,
  stats: { invalid: number },
): LabEvidence[] {
  const out: LabEvidence[] = [];
  for (const id of ids) {
    const found = messageMap.get(id);
    if (found) out.push(found);
    else stats.invalid++;
  }
  return out;
}

function averageScore(dimensions: Array<Pick<LabAnalysisDimension, 'score'>>): number {
  if (dimensions.length === 0) return 0;
  return Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);
}

function degradeConfidence(confidence: LabConfidence): LabConfidence {
  if (confidence === 'high') return 'medium';
  if (confidence === 'medium') return 'low';
  return 'low';
}

function hashSourceMessages(messages: LabSourceMessage[]): string {
  return sha256(
    JSON.stringify(
      messages.map((m) => ({
        chatroom_id: m.chatroom_id,
        local_id: m.local_id,
        sender_wxid: m.sender_wxid,
        role: m.role,
        timestamp: m.timestamp,
        content: m.content,
      })),
    ),
  );
}

function buildCacheKey(
  request: LabAnalyzeRequest,
  dimensionsHash: string,
  sourceMessageHash: string,
  model: string,
  profileHash: string,
): string {
  const resolvedTarget =
    request.target_resolution.target_wxid ||
    `${request.target_resolution.method}:${request.target_resolution.target_display_name}:${request.target_resolution.matched_candidates
      .map((c) => c.username)
      .join('|')}`;
  return sha256(
    JSON.stringify({
      mode: request.mode,
      chatroom_id: request.chatroom_id,
      target: resolvedTarget,
      since: request.since,
      until: request.until,
      dimensions_hash: dimensionsHash,
      profile_hash: profileHash,
      prompt_version: LAB_PROMPT_VERSION,
      provider: request.consent.provider,
      model,
      compression_version: 'heuristic_sample_v1',
      source_message_hash: sourceMessageHash,
    }),
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function loadLabStore(): Promise<LabStore | null> {
  try {
    const specifier = '@/lib/' + 'lab-store';
    const mod = (await import(specifier)) as LabStoreModule;
    const store = mod.labStore ?? mod.default ?? mod;
    if (typeof store.getCachedRun === 'function' && typeof store.saveRun === 'function') {
      return store as LabStore;
    }
    return null;
  } catch (e) {
    if (e instanceof Error && /Cannot find module|module not found|ERR_MODULE_NOT_FOUND/i.test(e.message)) {
      return null;
    }
    throw e;
  }
}

function error(
  code: string,
  message: string,
  status: number,
  timings?: Partial<LabAnalyzeTimingsMs>,
  routeStartedAt?: number,
  attemptCount?: number,
) {
  return NextResponse.json(
    {
      ok: false,
      code,
      error: message,
      timings_ms: timings && routeStartedAt !== undefined ? finalizeTimings(timings, routeStartedAt) : undefined,
      attempt_count: attemptCount,
    } satisfies LabAnalyzeResponse,
    { status },
  );
}

function setTiming(
  timings: Partial<LabAnalyzeTimingsMs>,
  key: Exclude<keyof LabAnalyzeTimingsMs, 'total'>,
  startedAt: number,
) {
  timings[key] = Math.round(performance.now() - startedAt);
}

function addTiming(
  timings: Partial<LabAnalyzeTimingsMs>,
  key: Exclude<keyof LabAnalyzeTimingsMs, 'total'>,
  startedAt: number,
) {
  timings[key] = Math.round((timings[key] ?? 0) + performance.now() - startedAt);
}

function applyLlmTimings(timings: Partial<LabAnalyzeTimingsMs>, llmTimings: LabLlmTimingsMs) {
  timings.llm_prepare = llmTimings.prepare;
  timings.llm_prompt = llmTimings.prompt;
  timings.llm_provider = llmTimings.provider;
  timings.llm_validate = llmTimings.validate;
  timings.llm_total = timings.llm_total ?? llmTimings.total;
}

function finalizeTimings(timings: Partial<LabAnalyzeTimingsMs>, routeStartedAt: number): LabAnalyzeTimingsMs {
  return {
    ...timings,
    total: Math.round(performance.now() - routeStartedAt),
  };
}
