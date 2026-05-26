import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type LabProfileSource = 'json' | 'assistant_db' | 'none';

export interface LabProfileContext {
  available: boolean;
  source: LabProfileSource;
  updated_at?: string;
  hash: string;
  text: string;
  dimensions: string[];
}

type ProfileDoc = {
  last_updated?: string;
  dimensions?: Record<string, { conclusions?: unknown[]; conclusions_count?: number }>;
};

type ProfileRow = {
  dimension: string;
  conclusions: string;
  date: string;
};

const PROFILE_DIMENSIONS = [
  ['communication_style', '沟通风格'],
  ['writing_style', '表达/写作风格'],
  ['decision_patterns', '决策偏好'],
] as const;

const MAX_FINDINGS_PER_DIMENSION = 4;
const MAX_PROFILE_CHARS = 1600;

export function loadLabProfileContext(): LabProfileContext {
  const fromJson = readProfileJson();
  if (fromJson.available) return fromJson;

  const fromDb = readProfileDb();
  if (fromDb.available) return fromDb;

  return emptyProfileContext();
}

export function emptyProfileContext(): LabProfileContext {
  return {
    available: false,
    source: 'none',
    hash: 'profile-empty',
    text: '',
    dimensions: [],
  };
}

function readProfileJson(): LabProfileContext {
  const profilePath =
    process.env.WECHAT_RADAR_LAB_PROFILE_JSON ??
    join(assistantWorkDir(), 'profile', 'servasyy_profile.json');
  if (!existsSync(profilePath)) return emptyProfileContext();

  try {
    const doc = JSON.parse(readFileSync(profilePath, 'utf8')) as ProfileDoc;
    return buildContext(doc, 'json', doc.last_updated);
  } catch {
    return emptyProfileContext();
  }
}

function readProfileDb(): LabProfileContext {
  const dbPath =
    process.env.WECHAT_RADAR_LAB_ASSISTANT_DB ??
    join(assistantWorkDir(), 'assistant.db');
  if (!existsSync(dbPath)) return emptyProfileContext();

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const columns = db.prepare('PRAGMA table_info(profile_snapshots)').all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    const valueColumn = names.has('conclusions') ? 'conclusions' : names.has('value') ? 'value' : null;
    if (!valueColumn) return emptyProfileContext();

    const rows = db
      .prepare(
        `SELECT dimension, ${valueColumn} AS conclusions, date
         FROM profile_snapshots
         WHERE date = (SELECT MAX(date) FROM profile_snapshots)`,
      )
      .all() as ProfileRow[];
    if (!rows.length) return emptyProfileContext();

    const dimensions: NonNullable<ProfileDoc['dimensions']> = {};
    for (const row of rows) {
      dimensions[row.dimension] = { conclusions: parseArray(row.conclusions) };
    }
    return buildContext({ last_updated: rows[0]?.date, dimensions }, 'assistant_db', rows[0]?.date);
  } catch {
    return emptyProfileContext();
  } finally {
    db?.close();
  }
}

function buildContext(
  doc: ProfileDoc,
  source: LabProfileSource,
  updatedAt?: string,
): LabProfileContext {
  const lines: string[] = [
    'A 背景只描述“我”的表达/决策偏好，仅用于理解 A 的语气和上下文。',
    '不要把以下内容当作关于 B 的事实；不要用它生成 evidence_msg_ids。',
  ];
  const usedDimensions: string[] = [];

  for (const [key, label] of PROFILE_DIMENSIONS) {
    const findings = (doc.dimensions?.[key]?.conclusions ?? [])
      .map(conclusionToFinding)
      .filter(Boolean)
      .slice(0, MAX_FINDINGS_PER_DIMENSION);
    if (!findings.length) continue;
    usedDimensions.push(key);
    lines.push(`${label}:`);
    findings.forEach((finding) => lines.push(`- ${finding}`));
  }

  if (!usedDimensions.length) return emptyProfileContext();
  const text = lines.join('\n').slice(0, MAX_PROFILE_CHARS);
  return {
    available: true,
    source,
    updated_at: updatedAt,
    hash: sha256(JSON.stringify({ source, updatedAt, text })),
    text,
    dimensions: usedDimensions,
  };
}

function conclusionToFinding(value: unknown): string {
  if (typeof value === 'string') return cleanFinding(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  const finding = record.finding ?? record.summary ?? record.content;
  if (typeof finding !== 'string') return '';
  const confidence = typeof record.confidence === 'string' ? `（置信度 ${record.confidence}）` : '';
  return cleanFinding(`${finding}${confidence}`);
}

function cleanFinding(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function parseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function assistantWorkDir(): string {
  return process.env.WECHAT_RADAR_ASSISTANT_WORK_DIR ?? join(homedir(), 'wechat-assistant');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
