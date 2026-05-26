import { db } from './db';
import type {
  LabAnalysisDetail,
  LabAnalysisDimension,
  LabAnalysisHighlight,
  LabAnalysisResult,
  LabCompressionMeta,
  LabConfidence,
  LabEvidence,
  LabLevel,
  LabMode,
  LabProvider,
  LabRunListItem,
  LabRunsListQuery,
  LabSeverity,
  LabStore,
  LabStoreSaveRunInput,
  TargetResolution,
} from './lab-types';

const DEFAULT_RUNS_LIMIT = 50;
const MAX_RUNS_LIMIT = 200;

interface RunRow {
  id: number;
  cache_key: string;
  mode: string;
  chatroom_id: string;
  chat_name: string | null;
  target_wxid: string | null;
  target_display_name: string;
  target_resolution_json: string;
  since: string;
  until: string;
  provider: string;
  model: string;
  prompt_version: string;
  source: string;
  source_message_hash: string;
  dimensions_hash: string;
  compression_version: string;
  compression_json: string;
  profile_context_used: number;
  summary: string;
  model_reading: string;
  avg_score: number;
  detail_count: number;
  risk_count: number;
  confidence: string;
  highlights_json: string;
  created_at: number;
}

interface DimensionRow {
  name: string;
  score: number;
  level: string;
  basis: string;
  icon: string | null;
  evidence_json: string;
}

interface DetailRow {
  title: string;
  category: string;
  content: string;
  severity: string;
  evidence_json: string;
}

type EvidenceBundle = { evidence_msg_ids: number[]; evidence: LabEvidence[] };

export function getCachedRun(cacheKey: string): LabAnalysisResult | null {
  const run = db()
    .prepare('SELECT * FROM conversation_lab_runs WHERE cache_key = ?')
    .get(cacheKey) as RunRow | undefined;
  return run ? hydrateRun(run) : null;
}

/** Replay a stored run by its primary key (history detail / re-open). */
export function getRunById(id: number): LabAnalysisResult | null {
  if (!Number.isFinite(id)) return null;
  const run = db()
    .prepare('SELECT * FROM conversation_lab_runs WHERE id = ?')
    .get(id) as RunRow | undefined;
  return run ? hydrateRun(run) : null;
}

/**
 * History list of run summaries, newest first. Filters are ANDed; `since`/`until`
 * bound the run's own analyzed window (run.since >= since, run.until <= until).
 * Returns the limited page plus the unfiltered-by-limit total for that filter set.
 */
export function listRuns(query: LabRunsListQuery = {}): { runs: LabRunListItem[]; total: number } {
  const d = db();
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (query.chatroom_id) {
    where.push('chatroom_id = ?');
    params.push(query.chatroom_id);
  }
  if (query.target_wxid) {
    where.push('target_wxid = ?');
    params.push(query.target_wxid);
  }
  if (query.target_display_name) {
    where.push('target_display_name = ?');
    params.push(query.target_display_name);
  }
  if (query.mode) {
    where.push('mode = ?');
    params.push(query.mode);
  }
  if (query.since) {
    where.push('since >= ?');
    params.push(query.since);
  }
  if (query.until) {
    where.push('until <= ?');
    params.push(query.until);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    d.prepare(`SELECT COUNT(*) AS n FROM conversation_lab_runs ${whereSql}`).get(...params) as { n: number }
  ).n;

  const limit = clampLimit(query.limit);
  const rows = d
    .prepare(
      `SELECT id, mode, chatroom_id, chat_name, target_wxid, target_display_name, since, until,
              avg_score, risk_count, confidence, provider, model, summary, detail_count, created_at
       FROM conversation_lab_runs
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...params, limit) as Array<
    Pick<
      RunRow,
      | 'id'
      | 'mode'
      | 'chatroom_id'
      | 'chat_name'
      | 'target_wxid'
      | 'target_display_name'
      | 'since'
      | 'until'
      | 'avg_score'
      | 'risk_count'
      | 'confidence'
      | 'provider'
      | 'model'
      | 'summary'
      | 'detail_count'
      | 'created_at'
    >
  >;

  const runs: LabRunListItem[] = rows.map((r) => ({
    id: r.id,
    mode: r.mode as LabMode,
    chatroom_id: r.chatroom_id,
    chat_name: r.chat_name ?? undefined,
    target_wxid: r.target_wxid ?? undefined,
    target_display_name: r.target_display_name,
    since: r.since,
    until: r.until,
    avg_score: r.avg_score,
    risk_count: r.risk_count,
    confidence: r.confidence as LabConfidence,
    provider: r.provider as LabProvider,
    model: r.model,
    summary: r.summary,
    detail_count: r.detail_count,
    created_at: r.created_at,
  }));
  return { runs, total };
}

/** Load a run row's children and rebuild the full analysis result. */
function hydrateRun(run: RunRow): LabAnalysisResult {
  const d = db();
  const dimensionRows = d
    .prepare(
      'SELECT name, score, level, basis, icon, evidence_json FROM conversation_lab_dimensions WHERE run_id = ? ORDER BY sort_order ASC, id ASC',
    )
    .all(run.id) as DimensionRow[];
  const detailRows = d
    .prepare(
      'SELECT title, category, content, severity, evidence_json FROM conversation_lab_details WHERE run_id = ? ORDER BY sort_order ASC, id ASC',
    )
    .all(run.id) as DetailRow[];
  return reconstructResult(run, dimensionRows, detailRows);
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_RUNS_LIMIT;
  return Math.min(Math.floor(limit), MAX_RUNS_LIMIT);
}

export function saveRun(input: LabStoreSaveRunInput): LabAnalysisResult {
  const d = db();
  const { result } = input;

  const tx = d.transaction((): number => {
    // INSERT OR REPLACE on the UNIQUE(cache_key) row would change the rowid and
    // orphan children; delete-then-insert keeps FK cascade clean and idempotent.
    d.prepare('DELETE FROM conversation_lab_runs WHERE cache_key = ?').run(input.cache_key);

    const info = d
      .prepare(
        `INSERT INTO conversation_lab_runs (
           cache_key, mode, chatroom_id, chat_name, target_wxid, target_display_name,
           target_resolution_json, since, until, provider, model, prompt_version,
           source, source_message_hash, dimensions_hash, compression_version, compression_json,
           profile_context_used, summary, model_reading, avg_score, detail_count, risk_count,
           confidence, highlights_json, created_at
         ) VALUES (
           @cache_key, @mode, @chatroom_id, @chat_name, @target_wxid, @target_display_name,
           @target_resolution_json, @since, @until, @provider, @model, @prompt_version,
           @source, @source_message_hash, @dimensions_hash, @compression_version, @compression_json,
           @profile_context_used, @summary, @model_reading, @avg_score, @detail_count, @risk_count,
           @confidence, @highlights_json, @created_at
         )`,
      )
      .run({
        cache_key: input.cache_key,
        mode: result.mode,
        chatroom_id: result.chatroom_id,
        chat_name: result.chat_name ?? null,
        target_wxid: result.target_resolution.target_wxid ?? result.target_wxid ?? null,
        target_display_name: result.target_display_name,
        target_resolution_json: input.target_resolution_json,
        since: result.since,
        until: result.until,
        provider: result.provider,
        model: result.model,
        prompt_version: result.prompt_version,
        source: input.request.source,
        source_message_hash: input.source_message_hash,
        dimensions_hash: input.dimensions_hash,
        compression_version: input.compression_version,
        compression_json: JSON.stringify(result.compression),
        profile_context_used: result.profile_context_used ? 1 : 0,
        summary: result.summary,
        model_reading: result.model_reading,
        avg_score: Math.round(result.avg_score),
        detail_count: result.detail_count,
        risk_count: result.risk_count,
        confidence: result.confidence,
        highlights_json: JSON.stringify(result.highlights ?? []),
        created_at: result.created_at,
      });

    const runId = Number(info.lastInsertRowid);

    const insertDimension = d.prepare(
      `INSERT INTO conversation_lab_dimensions (run_id, sort_order, name, score, level, basis, icon, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    result.dimensions.forEach((dim, index) => {
      insertDimension.run(
        runId,
        index,
        dim.name,
        clampScore(dim.score),
        dim.level,
        dim.basis,
        dim.icon ?? null,
        JSON.stringify({ evidence_msg_ids: dim.evidence_msg_ids ?? [], evidence: dim.evidence ?? [] } satisfies EvidenceBundle),
      );
    });

    const insertDetail = d.prepare(
      `INSERT INTO conversation_lab_details (run_id, sort_order, title, category, content, severity, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    result.details.forEach((detail, index) => {
      insertDetail.run(
        runId,
        index,
        detail.title,
        detail.category,
        detail.content,
        detail.severity,
        JSON.stringify({ evidence_msg_ids: detail.evidence_msg_ids ?? [], evidence: detail.evidence ?? [] } satisfies EvidenceBundle),
      );
    });

    return runId;
  });

  const runId = tx();
  return { ...result, id: runId };
}

export const labStore: LabStore = { getCachedRun, saveRun };

function reconstructResult(run: RunRow, dimensionRows: DimensionRow[], detailRows: DetailRow[]): LabAnalysisResult {
  const dimensions: LabAnalysisDimension[] = dimensionRows.map((row) => {
    const bundle = parseEvidence(row.evidence_json);
    return {
      name: row.name,
      score: row.score,
      level: row.level as LabLevel,
      basis: row.basis,
      icon: row.icon ?? undefined,
      evidence_msg_ids: bundle.evidence_msg_ids,
      evidence: bundle.evidence,
    };
  });

  const details: LabAnalysisDetail[] = detailRows.map((row) => {
    const bundle = parseEvidence(row.evidence_json);
    return {
      title: row.title,
      category: row.category,
      content: row.content,
      severity: row.severity as LabSeverity,
      evidence_msg_ids: bundle.evidence_msg_ids,
      evidence: bundle.evidence,
    };
  });

  return {
    id: run.id,
    cache_key: run.cache_key,
    mode: run.mode as LabMode,
    chatroom_id: run.chatroom_id,
    chat_name: run.chat_name ?? undefined,
    target_wxid: run.target_wxid ?? undefined,
    target_display_name: run.target_display_name,
    target_resolution: safeParse<TargetResolution>(run.target_resolution_json, {
      method: 'manual_display',
      target_display_name: run.target_display_name,
      matched_candidates: [],
      confidence: 'manual',
    }),
    since: run.since,
    until: run.until,
    provider: run.provider as LabProvider,
    model: run.model,
    prompt_version: run.prompt_version,
    source_message_hash: run.source_message_hash,
    compression: safeParse<LabCompressionMeta>(run.compression_json, {
      compression_version: run.compression_version,
      compression_strategy: 'raw',
      total_count: 0,
      sampled_count: 0,
      omitted_count: 0,
      time_coverage: {},
    }),
    profile_context_used: run.profile_context_used === 1,
    summary: run.summary,
    model_reading: run.model_reading,
    avg_score: run.avg_score,
    detail_count: run.detail_count,
    risk_count: run.risk_count,
    confidence: run.confidence as LabConfidence,
    dimensions,
    details,
    highlights: safeParse<LabAnalysisHighlight[]>(run.highlights_json, []),
    created_at: run.created_at,
  };
}

function parseEvidence(json: string): EvidenceBundle {
  const parsed = safeParse<Partial<EvidenceBundle>>(json, {});
  return {
    evidence_msg_ids: Array.isArray(parsed.evidence_msg_ids) ? parsed.evidence_msg_ids : [],
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
  };
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}
