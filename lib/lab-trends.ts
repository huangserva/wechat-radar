import { db } from './db';
import { LAB_MODE_TEMPLATES, type LabConfidence, type LabLevel, type LabMode } from './lab-types';

/**
 * P3a cross-mode trend data layer (read-only over conversation_lab_runs).
 * Trend types live HERE (not in lib/lab-types.ts — 关羽 is editing that).
 *
 * Identity rules (mirror P1's conservative resolution):
 *  - target_wxid present  → `wxid:<target_wxid>` (the only key allowed to merge
 *    across groups / modes).
 *  - display-only         → `display:<chatroom_id>:<target_display_name>` — NEVER
 *    merged across chatrooms; verified_identity=false → trend_confidence forced low.
 * Timeline uses created_at (when the analysis ran), NOT since/until.
 * Different modes have non-comparable dimension semantics → we only aggregate the
 * generic fields (run_count / avg_score / risk_count); no cross-mode total score.
 */

const VALID_MODES = new Set<LabMode>(['work', 'couple', 'family', 'social', 'parent_child']);
const MAX_LIMIT = 500;

export interface LabTrendDimensionPoint {
  name: string;
  score: number;
  level: LabLevel;
  basis: string;
  evidence_count: number;
}

export interface LabTrendRunPoint {
  run_id: number;
  identity_key: string;
  mode: LabMode;
  chatroom_id: string;
  chat_name?: string;
  target_wxid?: string;
  target_display_name: string;
  since: string;
  until: string;
  created_at: number;
  avg_score: number;
  risk_count: number;
  detail_count: number;
  confidence: LabConfidence;
  profile_context_used: boolean;
  source: string;
  dimensions: LabTrendDimensionPoint[];
}

export interface LabTrendTargetSummary {
  identity_key: string;
  target_wxid: string | null;
  target_display_name: string;
  /** For display-only: the scoped chatroom; for wxid: the latest run's chatroom. */
  chatroom_id: string;
  latest_chat_name?: string;
  run_count: number;
  mode_count: number;
  first_created_at: number;
  last_created_at: number;
  verified_run_count: number;
  display_only_run_count: number;
  latest_confidence: LabConfidence;
  verified_identity: boolean;
}

/** Per-mode aggregate — only generic, cross-mode-comparable fields. */
export interface LabModeTrendSummary {
  mode: LabMode;
  run_count: number;
  avg_score: number;
  avg_risk_count: number;
  total_risk_count: number;
  latest_avg_score: number;
  latest_created_at: number;
}

export interface LabDimensionFamilySummary {
  family: string;
  dimensions: Array<{
    name: string;
    run_count: number;
    avg_score: number;
    latest_score: number;
    risk_when?: 'low' | 'high';
  }>;
}

export interface LabSampleQuality {
  trend_confidence: 'low' | 'medium' | 'high';
  reasons: string[];
  run_count: number;
  mode_count: number;
  time_span_days: number;
  verified_identity: boolean;
}

export interface LabTargetTrend {
  target: LabTrendTargetSummary;
  runs: LabTrendRunPoint[];
  mode_summary: LabModeTrendSummary[];
  dimension_families: LabDimensionFamilySummary[];
  sample_quality: LabSampleQuality;
}

export interface GetLabTargetTrendInput {
  target_wxid?: string;
  target_display_name?: string;
  chatroom_id?: string;
  mode?: LabMode;
  from_created_at?: number;
  to_created_at?: number;
  limit?: number;
}

// Semantic families for cross-mode grouping (titles only, never a unified score).
const DIMENSION_FAMILIES: Record<string, string[]> = {
  risk: ['风险升级', 'PUA操控风险', '控制压力'],
  repair: ['主动修复意愿', '修复意愿'],
  boundary: ['边界尊重', '社交边界'],
  emotion: ['情绪克制', '情绪安全感', '情绪投入'],
  initiative: ['协作意愿', '主动联系意愿', '鼓励支持度'],
  efficiency: ['沟通效率', '责任承诺', '规则一致性'],
};

interface RunRow {
  id: number;
  mode: string;
  chatroom_id: string;
  chat_name: string | null;
  target_wxid: string | null;
  target_display_name: string;
  since: string;
  until: string;
  source: string;
  avg_score: number;
  risk_count: number;
  detail_count: number;
  confidence: string;
  profile_context_used: number;
  created_at: number;
}

const RUN_COLS =
  'id, mode, chatroom_id, chat_name, target_wxid, target_display_name, since, until, source, avg_score, risk_count, detail_count, confidence, profile_context_used, created_at';

const DAY_MS = 86_400_000;

export function identityKeyOf(targetWxid: string | null, chatroomId: string, displayName: string): string {
  return targetWxid ? `wxid:${targetWxid}` : `display:${chatroomId}:${displayName}`;
}

/**
 * trend_confidence gate. Uses raw `spanMs` for thresholds — NOT a rounded day
 * count — so 6.5 days stays `low` (Math.round would have promoted it to 7) and
 * 29.5 days doesn't prematurely reach `high`.
 */
export function trendConfidence(input: {
  runCount: number;
  spanMs: number;
  verified: boolean;
  modesWith3: number;
}): { confidence: 'low' | 'medium' | 'high'; reasons: string[] } {
  const { runCount, spanMs, verified, modesWith3 } = input;
  const lowReasons: string[] = [];
  if (runCount < 3) lowReasons.push('run_count < 3（样本不足）');
  if (spanMs < 7 * DAY_MS) lowReasons.push('time_span_days < 7（样本集中/跨度不足）');
  if (!verified) lowReasons.push('display-only / 未通过 wxid 强校验（近似归集）');
  if (lowReasons.length > 0) return { confidence: 'low', reasons: lowReasons };
  if (runCount >= 8 && spanMs >= 30 * DAY_MS && modesWith3 >= 2) {
    return { confidence: 'high', reasons: ['样本覆盖较充分（run_count>=8 且跨度>=30 天 且 >=2 个 mode 各 3+ runs）'] };
  }
  if (modesWith3 >= 1) {
    return { confidence: 'medium', reasons: ['样本基本充足（run_count>=3 且跨度>=7 天 且至少 1 个 mode 有 3+ runs）'] };
  }
  return { confidence: 'low', reasons: ['无单一 mode 达到 3+ runs，趋势不稳定'] };
}

/** List targets that have lab history, aggregated by identity key. */
export function listLabTrendTargets(
  opts: { q?: string; limit?: number; verified_only?: boolean } = {},
): LabTrendTargetSummary[] {
  const rows = db()
    .prepare(`SELECT ${RUN_COLS} FROM conversation_lab_runs ORDER BY created_at ASC, id ASC`)
    .all() as RunRow[];

  const byKey = new Map<string, RunRow[]>();
  for (const r of rows) {
    if (opts.verified_only && !r.target_wxid) continue;
    const key = identityKeyOf(r.target_wxid, r.chatroom_id, r.target_display_name);
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }

  const q = opts.q?.trim().toLowerCase();
  const summaries = Array.from(byKey.entries())
    .map(([key, runs]) => summarizeTarget(key, runs))
    .filter((s) => {
      if (!q) return true;
      return [s.target_display_name, s.latest_chat_name, s.target_wxid].some((v) => v && v.toLowerCase().includes(q));
    })
    .sort((a, b) => b.last_created_at - a.last_created_at);

  const limit = clampLimit(opts.limit);
  return summaries.slice(0, limit);
}

/** Full trend for one target (wxid, or display-only scoped to a chatroom). */
export function getLabTargetTrend(input: GetLabTargetTrendInput): LabTargetTrend | null {
  const d = db();
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (input.target_wxid) {
    where.push('target_wxid = ?');
    params.push(input.target_wxid);
  } else if (input.chatroom_id && input.target_display_name) {
    // display-only: MUST be scoped to a chatroom — never merge across groups.
    where.push('target_wxid IS NULL AND chatroom_id = ? AND target_display_name = ?');
    params.push(input.chatroom_id, input.target_display_name);
  } else {
    return null; // caller must provide a valid identity selector
  }
  if (input.mode && VALID_MODES.has(input.mode)) {
    where.push('mode = ?');
    params.push(input.mode);
  }
  if (typeof input.from_created_at === 'number' && Number.isFinite(input.from_created_at)) {
    where.push('created_at >= ?');
    params.push(input.from_created_at);
  }
  if (typeof input.to_created_at === 'number' && Number.isFinite(input.to_created_at)) {
    where.push('created_at <= ?');
    params.push(input.to_created_at);
  }

  const runRows = d
    .prepare(
      `SELECT ${RUN_COLS} FROM conversation_lab_runs WHERE ${where.join(' AND ')} ORDER BY created_at ASC, id ASC LIMIT ?`,
    )
    .all(...params, clampLimit(input.limit)) as RunRow[];
  if (runRows.length === 0) return null;

  // Hydrate dimensions for all runs in one query.
  const ids = runRows.map((r) => r.id);
  const dimRows = d
    .prepare(
      `SELECT run_id, name, score, level, basis, evidence_json
       FROM conversation_lab_dimensions
       WHERE run_id IN (${ids.map(() => '?').join(',')})
       ORDER BY run_id ASC, sort_order ASC, id ASC`,
    )
    .all(...ids) as Array<{ run_id: number; name: string; score: number; level: string; basis: string; evidence_json: string }>;
  const dimsByRun = new Map<number, LabTrendDimensionPoint[]>();
  for (const row of dimRows) {
    const arr = dimsByRun.get(row.run_id) ?? [];
    arr.push({
      name: row.name,
      score: row.score,
      level: row.level as LabLevel,
      basis: row.basis,
      evidence_count: evidenceCount(row.evidence_json),
    });
    dimsByRun.set(row.run_id, arr);
  }

  const key = identityKeyOf(runRows[0].target_wxid, runRows[0].chatroom_id, runRows[0].target_display_name);
  const runs: LabTrendRunPoint[] = runRows.map((r) => ({
    run_id: r.id,
    identity_key: key,
    mode: r.mode as LabMode,
    chatroom_id: r.chatroom_id,
    chat_name: r.chat_name ?? undefined,
    target_wxid: r.target_wxid ?? undefined,
    target_display_name: r.target_display_name,
    since: r.since,
    until: r.until,
    created_at: r.created_at,
    avg_score: r.avg_score,
    risk_count: r.risk_count,
    detail_count: r.detail_count,
    confidence: r.confidence as LabConfidence,
    profile_context_used: r.profile_context_used === 1,
    source: r.source,
    dimensions: dimsByRun.get(r.id) ?? [],
  }));

  return {
    target: summarizeTarget(key, runRows),
    runs,
    mode_summary: buildModeSummary(runRows),
    dimension_families: buildDimensionFamilies(runs),
    sample_quality: buildSampleQuality(runRows),
  };
}

// ---- helpers ---------------------------------------------------------------

function summarizeTarget(identityKey: string, runs: RunRow[]): LabTrendTargetSummary {
  const sorted = [...runs].sort((a, b) => a.created_at - b.created_at);
  const latest = sorted[sorted.length - 1];
  const modes = new Set(sorted.map((r) => r.mode));
  const verifiedCount = sorted.filter((r) => r.target_wxid).length;
  return {
    identity_key: identityKey,
    target_wxid: latest.target_wxid,
    target_display_name: latest.target_display_name,
    chatroom_id: latest.chatroom_id,
    latest_chat_name: latest.chat_name ?? undefined,
    run_count: sorted.length,
    mode_count: modes.size,
    first_created_at: sorted[0].created_at,
    last_created_at: latest.created_at,
    verified_run_count: verifiedCount,
    display_only_run_count: sorted.length - verifiedCount,
    latest_confidence: latest.confidence as LabConfidence,
    verified_identity: Boolean(latest.target_wxid),
  };
}

function buildModeSummary(runs: RunRow[]): LabModeTrendSummary[] {
  const byMode = new Map<string, RunRow[]>();
  for (const r of runs) {
    const arr = byMode.get(r.mode) ?? [];
    arr.push(r);
    byMode.set(r.mode, arr);
  }
  return Array.from(byMode.entries())
    .map(([mode, list]) => {
      const sorted = [...list].sort((a, b) => a.created_at - b.created_at);
      const latest = sorted[sorted.length - 1];
      const totalRisk = sorted.reduce((s, r) => s + r.risk_count, 0);
      return {
        mode: mode as LabMode,
        run_count: sorted.length,
        avg_score: round(mean(sorted.map((r) => r.avg_score))),
        avg_risk_count: round1(mean(sorted.map((r) => r.risk_count))),
        total_risk_count: totalRisk,
        latest_avg_score: latest.avg_score,
        latest_created_at: latest.created_at,
      };
    })
    .sort((a, b) => b.run_count - a.run_count);
}

function buildDimensionFamilies(runs: LabTrendRunPoint[]): LabDimensionFamilySummary[] {
  const riskWhen = dimensionRiskWhenMap();
  // collect per dimension name: scores + latest
  const perDim = new Map<string, { scores: number[]; latest: { created_at: number; score: number } }>();
  for (const run of runs) {
    for (const dim of run.dimensions) {
      const cur = perDim.get(dim.name) ?? { scores: [], latest: { created_at: -1, score: dim.score } };
      cur.scores.push(dim.score);
      if (run.created_at >= cur.latest.created_at) cur.latest = { created_at: run.created_at, score: dim.score };
      perDim.set(dim.name, cur);
    }
  }
  const families: LabDimensionFamilySummary[] = [];
  for (const [family, names] of Object.entries(DIMENSION_FAMILIES)) {
    const dims = names
      .filter((n) => perDim.has(n))
      .map((n) => {
        const e = perDim.get(n)!;
        return {
          name: n,
          run_count: e.scores.length,
          avg_score: round(mean(e.scores)),
          latest_score: e.latest.score,
          ...(riskWhen.get(n) ? { risk_when: riskWhen.get(n) } : {}),
        };
      });
    if (dims.length > 0) families.push({ family, dimensions: dims });
  }
  return families;
}

function buildSampleQuality(runs: RunRow[]): LabSampleQuality {
  const runCount = runs.length;
  const created = runs.map((r) => r.created_at);
  // Raw span drives the thresholds; the day count is display-only (floor, so a
  // partial day never rounds up past the >=7 / >=30 gates).
  const spanMs = created.length ? Math.max(...created) - Math.min(...created) : 0;
  const timeSpanDays = Math.floor(spanMs / DAY_MS);
  const verified = runCount > 0 && runs.every((r) => r.target_wxid);
  const modeCounts = new Map<string, number>();
  for (const r of runs) modeCounts.set(r.mode, (modeCounts.get(r.mode) ?? 0) + 1);
  const modeCount = modeCounts.size;
  const modesWith3 = Array.from(modeCounts.values()).filter((n) => n >= 3).length;

  const { confidence, reasons } = trendConfidence({ runCount, spanMs, verified, modesWith3 });
  return { trend_confidence: confidence, reasons, run_count: runCount, mode_count: modeCount, time_span_days: timeSpanDays, verified_identity: verified };
}

function dimensionRiskWhenMap(): Map<string, 'low' | 'high'> {
  const map = new Map<string, 'low' | 'high'>();
  for (const tmpl of Object.values(LAB_MODE_TEMPLATES)) {
    for (const dim of tmpl.dimensions) {
      if (dim.risk_when && !map.has(dim.name)) map.set(dim.name, dim.risk_when);
    }
  }
  return map;
}

function evidenceCount(json: string): number {
  try {
    const parsed = JSON.parse(json) as { evidence?: unknown[]; evidence_msg_ids?: unknown[] };
    if (Array.isArray(parsed.evidence)) return parsed.evidence.length;
    if (Array.isArray(parsed.evidence_msg_ids)) return parsed.evidence_msg_ids.length;
    return 0;
  } catch {
    return 0;
  }
}

function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((s, n) => s + n, 0) / nums.length;
}
function round(n: number): number {
  return Math.round(n);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return MAX_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}
