import Database from 'better-sqlite3';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './config';

type Sqlite = Database.Database;

export type ProfileConfidence = 'high' | 'medium' | 'low' | 'unknown' | string;

export interface OwnerProfileFinding {
  finding: string;
  confidence: ProfileConfidence;
  source_count: number;
  first_seen: string | null;
  last_seen: string | null;
  evidence_count: number;
}

export interface OwnerProfileDimension {
  key: string;
  label: string;
  description: string;
  count: number;
  findings: OwnerProfileFinding[];
}

export interface OwnerProfileSnapshotDate {
  date: string;
  total_conclusions: number;
  dimensions: Array<{ key: string; label: string; count: number }>;
}

export interface OwnerProfileUpdate {
  date: string;
  action: string;
  source_count: number | null;
  writing_samples: number | null;
  new_conclusions: number | null;
}

export interface OwnerProfilePayload {
  available: boolean;
  source: 'json' | 'missing';
  source_path: string | null;
  assistant_db_path: string;
  owner_wxid: string | null;
  version: number | null;
  created: string | null;
  last_updated: string | null;
  data_until: string | null;
  total_conclusions: number;
  dimension_count: number;
  stats: {
    total_analyzed: number | null;
    total_writing_samples: number | null;
    last_analysis_date: string | null;
  };
  privacy_notice: string;
  dimensions: OwnerProfileDimension[];
  snapshots: {
    available: boolean;
    rows: number;
    dates: number;
    latest_date: string | null;
    history: OwnerProfileSnapshotDate[];
  };
  update_history: OwnerProfileUpdate[];
}

const DIMENSIONS = [
  { key: 'tech_preferences', label: '技术偏好', description: '工具链、模型、工程取舍和基础设施偏好' },
  { key: 'business_insights', label: '商业判断', description: '推广、合作、增长与商业机会判断' },
  { key: 'decision_patterns', label: '决策模式', description: '选择、切换、验证和投入方式' },
  { key: 'communication_style', label: '沟通风格', description: '表达态度、社交协作与反馈方式' },
  { key: 'writing_style', label: '写作风格', description: '句式、语气、用词和内容组织习惯' },
  { key: 'personal_traits', label: '个人特质', description: '长期行为特征与角色背景' },
] as const;

const PRIVACY_NOTICE =
  '这是你自己（主人）从你的消息里归纳的画像，是定性推断而非客观结论；默认不展开原始证据，不用于评价他人。';

export function loadOwnerProfile(): OwnerProfilePayload {
  const config = readConfig();
  const assistantDbPath = join(config.wechatAssistantDir, 'assistant.db');
  const profileFile = findProfileFile(config.wechatAssistantDir, config.wechatSelfWxid);
  const snapshots = loadProfileSnapshots(assistantDbPath);
  const missing = emptyPayload(assistantDbPath, config.wechatSelfWxid || null, profileFile?.expectedPath ?? null, snapshots);

  if (!profileFile?.path) return missing;

  try {
    const raw = parseObject(JSON.parse(readFileSync(profileFile.path, 'utf-8')));
    const dimensions = parseDimensions(raw.dimensions);
    const stats = parseObject(raw.stats);
    const updateHistory = parseUpdateHistory(raw.update_history);
    const lastUpdated = strOrNull(raw.last_updated);
    const lastAnalysisDate = strOrNull(stats.last_analysis_date);

    return {
      available: true,
      source: 'json',
      source_path: profileFile.path,
      assistant_db_path: assistantDbPath,
      owner_wxid: config.wechatSelfWxid || inferWxidFromFilename(profileFile.path),
      version: numOrNull(raw.version),
      created: strOrNull(raw.created),
      last_updated: lastUpdated,
      data_until: lastAnalysisDate ?? lastUpdated ?? latestFindingDate(dimensions),
      total_conclusions: dimensions.reduce((sum, dim) => sum + dim.findings.length, 0),
      dimension_count: dimensions.filter((dim) => dim.findings.length > 0).length,
      stats: {
        total_analyzed: numOrNull(stats.total_analyzed),
        total_writing_samples: numOrNull(stats.total_writing_samples),
        last_analysis_date: lastAnalysisDate,
      },
      privacy_notice: PRIVACY_NOTICE,
      dimensions,
      snapshots,
      update_history: updateHistory,
    };
  } catch {
    return missing;
  }
}

function emptyPayload(
  assistantDbPath: string,
  ownerWxid: string | null,
  expectedPath: string | null,
  snapshots: OwnerProfilePayload['snapshots'],
): OwnerProfilePayload {
  return {
    available: false,
    source: 'missing',
    source_path: expectedPath,
    assistant_db_path: assistantDbPath,
    owner_wxid: ownerWxid,
    version: null,
    created: null,
    last_updated: null,
    data_until: snapshots.latest_date,
    total_conclusions: 0,
    dimension_count: 0,
    stats: {
      total_analyzed: null,
      total_writing_samples: null,
      last_analysis_date: null,
    },
    privacy_notice: PRIVACY_NOTICE,
    dimensions: DIMENSIONS.map((dim) => ({ ...dim, count: 0, findings: [] })),
    snapshots,
    update_history: [],
  };
}

function findProfileFile(assistantDir: string, selfWxid: string): { path: string | null; expectedPath: string } | null {
  const profileDir = join(assistantDir, 'profile');
  const expectedPath = join(profileDir, `${selfWxid || 'servasyy'}_profile.json`);
  if (!existsSync(profileDir)) return { path: null, expectedPath };

  const candidates: string[] = [];
  if (selfWxid) candidates.push(join(profileDir, `${selfWxid}_profile.json`));
  candidates.push(expectedPath);

  for (const path of unique(candidates)) {
    if (existsSync(path)) return { path, expectedPath };
  }

  const fallback = readdirSync(profileDir)
    .filter((file) => file.endsWith('_profile.json'))
    .map((file) => join(profileDir, file))
    .sort((a, b) => safeMtimeMs(b) - safeMtimeMs(a))[0];

  return { path: fallback ?? null, expectedPath };
}

function parseDimensions(value: unknown): OwnerProfileDimension[] {
  const raw = parseObject(value);
  return DIMENSIONS.map((dim) => {
    const dimRaw = parseObject(raw[dim.key]);
    const conclusions = Array.isArray(dimRaw.conclusions) ? dimRaw.conclusions : [];
    const findings = conclusions
      .map(parseFinding)
      .filter((finding): finding is OwnerProfileFinding => Boolean(finding?.finding));
    return {
      ...dim,
      count: numOrNull(dimRaw.conclusions_count) ?? findings.length,
      findings,
    };
  });
}

function parseFinding(value: unknown): OwnerProfileFinding | null {
  const raw = parseObject(value);
  const finding = str(raw.finding).trim();
  if (!finding) return null;
  return {
    finding,
    confidence: str(raw.confidence).trim() || 'unknown',
    source_count: numOrNull(raw.source_count) ?? 0,
    first_seen: strOrNull(raw.first_seen),
    last_seen: strOrNull(raw.last_seen),
    evidence_count: Array.isArray(raw.evidence) ? raw.evidence.length : 0,
  };
}

function parseUpdateHistory(value: unknown): OwnerProfileUpdate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const raw = parseObject(item);
      return {
        date: str(raw.date),
        action: str(raw.action),
        source_count: numOrNull(raw.source_count),
        writing_samples: numOrNull(raw.writing_samples),
        new_conclusions: numOrNull(raw.new_conclusions),
      };
    })
    .filter((item) => item.date || item.action);
}

function loadProfileSnapshots(assistantDbPath: string): OwnerProfilePayload['snapshots'] {
  if (!existsSync(assistantDbPath)) {
    return { available: false, rows: 0, dates: 0, latest_date: null, history: [] };
  }
  let d: Sqlite | null = null;
  try {
    d = new Database(assistantDbPath, { readonly: true, fileMustExist: true });
    d.pragma('query_only = ON');
    if (!tableExists(d, 'profile_snapshots')) {
      return { available: false, rows: 0, dates: 0, latest_date: null, history: [] };
    }
    const rows = d
      .prepare('SELECT date, dimension, conclusions FROM profile_snapshots ORDER BY date DESC, dimension ASC')
      .all() as Array<{ date: string; dimension: string; conclusions: string }>;
    const byDate = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const date = str(row.date);
      const dimension = str(row.dimension);
      if (!date || !dimension) continue;
      const counts = byDate.get(date) ?? new Map<string, number>();
      counts.set(dimension, jsonArrayLength(row.conclusions));
      byDate.set(date, counts);
    }
    const history = Array.from(byDate.entries()).map(([date, counts]) => {
      const dimensions = DIMENSIONS.map((dim) => ({
        key: dim.key,
        label: dim.label,
        count: counts.get(dim.key) ?? 0,
      }));
      return {
        date,
        total_conclusions: dimensions.reduce((sum, dim) => sum + dim.count, 0),
        dimensions,
      };
    });
    history.sort((a, b) => b.date.localeCompare(a.date));
    return {
      available: true,
      rows: rows.length,
      dates: history.length,
      latest_date: history[0]?.date ?? null,
      history,
    };
  } catch {
    return { available: false, rows: 0, dates: 0, latest_date: null, history: [] };
  } finally {
    d?.close();
  }
}

function tableExists(d: Sqlite, table: string): boolean {
  const row = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function jsonArrayLength(value: unknown): number {
  try {
    const parsed = JSON.parse(str(value));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function latestFindingDate(dimensions: OwnerProfileDimension[]): string | null {
  let latest: string | null = null;
  for (const dim of dimensions) {
    for (const finding of dim.findings) {
      if (finding.last_seen && finding.last_seen > (latest ?? '')) latest = finding.last_seen;
    }
  }
  return latest;
}

function inferWxidFromFilename(path: string): string | null {
  const file = path.split('/').pop() ?? '';
  return file.endsWith('_profile.json') ? file.slice(0, -'_profile.json'.length) : null;
}

function parseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}

function strOrNull(value: unknown): string | null {
  const text = str(value).trim();
  return text || null;
}

function numOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function safeMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
