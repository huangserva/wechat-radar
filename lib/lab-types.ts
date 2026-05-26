export type LabMode = 'work' | 'couple' | 'family' | 'social' | 'parent_child';
export type LabLevel = '低' | '中' | '高';
export type LabSeverity = '信息' | '提醒' | '风险';
export type LabConfidence = 'low' | 'medium' | 'high';
export type LabProvider = 'codex' | 'openai-compatible' | 'local';
export type LabMessageRole = 'A' | 'B' | 'other' | 'unknown';
export type LabMessageSource = 'local_messages' | 'collector' | 'decrypted_raw' | 'none';

export const LAB_DEFAULT_MODE: LabMode = 'family';
export const LAB_PROMPT_VERSION = 'lab_multimode_v1';
export const LAB_COMPRESSION_VERSION = 'heuristic_sample_v1';

export interface LabDimensionTemplate {
  name: string;
  icon: string;
  description: string;
  scoring_hint: string;
  risk_when?: 'low' | 'high';
}

export interface LabModeTemplate {
  mode: LabMode;
  label: string;
  subtitle: string;
  description: string;
  color: string;
  dimensions: LabDimensionTemplate[];
}

export const LAB_MODE_TEMPLATES: Record<LabMode, LabModeTemplate> = {
  work: {
    mode: 'work',
    label: '职场沟通',
    subtitle: '同事 / 客户 / 合作方',
    description: '看承诺、边界和风险升级。',
    color: 'amber',
    dimensions: [
      { name: '责任承诺', icon: 'ClipboardCheck', description: '是否明确承担任务与结果', scoring_hint: '高分代表承诺清晰且可追踪' },
      { name: '沟通效率', icon: 'Zap', description: '信息是否直接、少绕路', scoring_hint: '高分代表沟通成本低' },
      { name: '边界尊重', icon: 'Shield', description: '是否尊重时间、权限和角色边界', scoring_hint: '低分代表越界风险', risk_when: 'low' },
      { name: '风险升级', icon: 'AlertTriangle', description: '是否出现升级、甩锅或失控信号', scoring_hint: '高分代表风险更明显', risk_when: 'high' },
      { name: '协作意愿', icon: 'Handshake', description: '是否主动补位和推进', scoring_hint: '低分代表协作意愿弱', risk_when: 'low' },
    ],
  },
  couple: {
    mode: 'couple',
    label: '情侣 / 暧昧',
    subtitle: '情侣 / 暧昧 / 同居关系',
    description: '看共情、修复和情绪流动。',
    color: 'rose',
    dimensions: [
      { name: '忠诚度信号', icon: 'Heart', description: '只识别对话信号，不判断事实', scoring_hint: '低分代表信号弱或证据不足', risk_when: 'low' },
      { name: 'PUA操控风险', icon: 'AlertTriangle', description: '是否有控制、贬低、孤立等表达', scoring_hint: '高分代表风险更明显', risk_when: 'high' },
      { name: '主动修复意愿', icon: 'Wrench', description: '冲突后是否主动解释和修复', scoring_hint: '低分代表修复意愿弱', risk_when: 'low' },
      { name: '敷衍程度', icon: 'MinusCircle', description: '是否频繁短回避、无实质回应', scoring_hint: '高分代表敷衍更明显', risk_when: 'high' },
      { name: '情绪投入', icon: 'Sparkles', description: '是否投入情绪、关注和回应', scoring_hint: '低分代表投入弱', risk_when: 'low' },
    ],
  },
  family: {
    mode: 'family',
    label: '家庭 / 父母',
    subtitle: '父母 / 长辈 / 家人',
    description: '看代际差异、情绪克制和修复。',
    color: 'violet',
    dimensions: [
      { name: '代际认知差异', icon: 'GitBranch', description: '观念、经验和信息差造成的错位', scoring_hint: '高分代表差异更明显', risk_when: 'high' },
      { name: '情绪克制', icon: 'Gauge', description: '冲突中是否控制语气和升级', scoring_hint: '低分代表情绪升级风险', risk_when: 'low' },
      { name: '共情成本', icon: 'HeartHandshake', description: '彼此理解需要付出的解释成本', scoring_hint: '高分代表沟通成本更高', risk_when: 'high' },
      { name: '话题切换得体度', icon: 'Shuffle', description: '是否能把敏感话题自然切走或收束', scoring_hint: '低分代表切换生硬或逃避', risk_when: 'low' },
      { name: '主动修复意愿', icon: 'Wrench', description: '冲突后是否主动解释、缓和和补救', scoring_hint: '低分代表修复不足', risk_when: 'low' },
    ],
  },
  social: {
    mode: 'social',
    label: '社交 / 朋友',
    subtitle: '朋友 / 熟人 / 社群关系',
    description: '看互惠、边界和情绪安全感。',
    color: 'cyan',
    dimensions: [
      { name: '互惠程度', icon: 'Repeat2', description: '是否有来有回', scoring_hint: '低分代表单向消耗', risk_when: 'low' },
      { name: '社交边界', icon: 'CircleDashed', description: '是否尊重距离和节奏', scoring_hint: '低分代表边界不清', risk_when: 'low' },
      { name: '主动联系意愿', icon: 'MessageCircle', description: '是否主动开启或延续对话', scoring_hint: '低分代表主动性弱', risk_when: 'low' },
      { name: '情绪安全感', icon: 'ShieldCheck', description: '是否能自然表达而少防御', scoring_hint: '低分代表安全感弱', risk_when: 'low' },
      { name: '话题平衡度', icon: 'Scale', description: '话题是否由双方共同贡献', scoring_hint: '低分代表话题失衡', risk_when: 'low' },
    ],
  },
  parent_child: {
    mode: 'parent_child',
    label: '亲子 / 跟孩子',
    subtitle: '孩子 / 学生 / 晚辈',
    description: '看支持、压力、倾听和规则一致性。',
    color: 'green',
    dimensions: [
      { name: '鼓励支持度', icon: 'BadgeCheck', description: '是否提供支持和正向反馈', scoring_hint: '低分代表支持不足', risk_when: 'low' },
      { name: '控制压力', icon: 'AlertCircle', description: '是否出现过度控制或压力表达', scoring_hint: '高分代表压力更明显', risk_when: 'high' },
      { name: '倾听回应', icon: 'Ear', description: '是否先听懂再回应', scoring_hint: '低分代表倾听不足', risk_when: 'low' },
      { name: '规则一致性', icon: 'ListChecks', description: '规则是否稳定且可解释', scoring_hint: '低分代表规则摇摆', risk_when: 'low' },
      { name: '修复意愿', icon: 'Wrench', description: '误解后是否主动修复', scoring_hint: '低分代表修复不足', risk_when: 'low' },
    ],
  },
};

export interface LabSourceMessage {
  chatroom_id: string;
  local_id: number;
  raw_sender_id: string | number | null;
  sender_wxid: string | null;
  display_name: string;
  sender: string;
  role: LabMessageRole;
  content: string;
  type: string;
  time: string;
  timestamp: number;
  source: Exclude<LabMessageSource, 'none'>;
  truncated?: boolean;
}

export interface LabMemberCandidate {
  username: string;
  nickname?: string;
  remark?: string;
  alias?: string;
  display_name: string;
}

export type TargetResolutionMethod =
  | 'wxid'
  | 'username'
  | 'alias'
  | 'display_unique'
  | 'display_ambiguous'
  | 'manual_display';

export interface TargetResolution {
  method: TargetResolutionMethod;
  target_wxid?: string;
  target_display_name: string;
  matched_candidates: LabMemberCandidate[];
  confidence: 'verified' | 'display_unique' | 'ambiguous' | 'manual';
}

export interface LabRoleCounts {
  A: number;
  B: number;
  other: number;
  unknown: number;
}

export interface LabCompressionMeta {
  compression_version: string;
  compression_strategy: 'raw' | 'heuristic_sample' | 'chunk_summary';
  total_count: number;
  sampled_count: number;
  omitted_count: number;
  time_coverage: {
    since?: string;
    until?: string;
    first_sampled_at?: string;
    last_sampled_at?: string;
  };
}

export interface LabConsentMeta {
  accepted: boolean;
  provider: LabProvider;
  model: string;
  sampled_count: number;
  profile_context_used: boolean;
  accepted_at: number;
}

export interface LabReadRequest {
  mode: LabMode;
  chatroom_id: string;
  chat_name?: string;
  target_wxid?: string;
  target_display_name: string;
  since: string;
  until: string;
  self_wxid?: string;
  self_display_names?: string[];
}

export interface LabReadResponse {
  ok: boolean;
  error?: string;
  mode?: LabMode;
  chatroom_id?: string;
  chat_name?: string;
  target_resolution?: TargetResolution;
  role_counts?: LabRoleCounts;
  source?: LabMessageSource;
  empty_reason?: string | null;
  message_count?: number;
  filtered_count?: number;
  analysis_allowed?: boolean;
  blocked_reasons?: string[];
  compression_estimate?: LabCompressionMeta;
  members?: LabMemberCandidate[];
  messages?: LabSourceMessage[];
  preview?: LabSourceMessage[];
}

export interface LabAnalyzeRequest extends LabReadRequest {
  messages: LabSourceMessage[];
  role_counts: LabRoleCounts;
  target_resolution: TargetResolution;
  source: LabMessageSource;
  empty_reason?: string | null;
  custom_dimensions?: string[];
  force?: boolean;
  use_profile_context?: boolean;
  consent: LabConsentMeta;
}

export interface LabEvidence {
  chatroom_id: string;
  local_id: number;
  time: string;
  sender: string;
  snippet: string;
}

export interface LabAnalysisDimension {
  name: string;
  score: number;
  level: LabLevel;
  basis: string;
  icon?: string;
  evidence_msg_ids: number[];
  evidence: LabEvidence[];
}

export interface LabAnalysisDetail {
  title: string;
  category: string;
  content: string;
  severity: LabSeverity;
  evidence_msg_ids: number[];
  evidence: LabEvidence[];
}

export interface LabAnalysisHighlight {
  label: string;
  score: number;
  icon?: string;
}

export interface LabAnalysisResult {
  id?: number;
  cache_key: string;
  mode: LabMode;
  chatroom_id: string;
  chat_name?: string;
  target_wxid?: string;
  target_display_name: string;
  target_resolution: TargetResolution;
  since: string;
  until: string;
  provider: LabProvider;
  model: string;
  prompt_version: string;
  source_message_hash: string;
  compression: LabCompressionMeta;
  profile_context_used: boolean;
  summary: string;
  model_reading: string;
  avg_score: number;
  detail_count: number;
  risk_count: number;
  confidence: LabConfidence;
  dimensions: LabAnalysisDimension[];
  details: LabAnalysisDetail[];
  highlights: LabAnalysisHighlight[];
  created_at: number;
}

export type LabAnalyzeResponse =
  | { ok: true; cached: boolean; result: LabAnalysisResult; illegal_evidence_count: number }
  | { ok: false; error: string; code?: string };

export interface LabRunListItem {
  id: number;
  mode: LabMode;
  chatroom_id: string;
  chat_name?: string;
  target_wxid?: string;
  target_display_name: string;
  since: string;
  until: string;
  avg_score: number;
  risk_count: number;
  confidence: LabConfidence;
  provider: LabProvider;
  model: string;
  summary?: string;
  detail_count?: number;
  created_at: number;
}

export interface LabRunsListQuery {
  chatroom_id?: string;
  target_wxid?: string;
  target_display_name?: string;
  mode?: LabMode;
  since?: string;
  until?: string;
  limit?: number;
}

export type LabRunsListResponse =
  | { ok: true; runs: LabRunListItem[]; total: number }
  | { ok: false; error: string; code?: string };

export type LabRunDetailResponse =
  | { ok: true; result: LabAnalysisResult }
  | { ok: false; error: string; code?: string };

export interface LabStoreSaveRunInput {
  request: LabAnalyzeRequest;
  result: LabAnalysisResult;
  cache_key: string;
  source_message_hash: string;
  dimensions_hash: string;
  target_resolution_json: string;
  compression_version: string;
}

export interface LabStore {
  getCachedRun(cacheKey: string): Promise<LabAnalysisResult | null> | LabAnalysisResult | null;
  saveRun(input: LabStoreSaveRunInput): Promise<LabAnalysisResult> | LabAnalysisResult;
}

export interface LabStoreModule {
  labStore?: LabStore;
  default?: LabStore;
  getCachedRun?: LabStore['getCachedRun'];
  saveRun?: LabStore['saveRun'];
}

export interface LabLlmRawDimension {
  name: string;
  score: number;
  level: LabLevel;
  basis: string;
  icon?: string;
  evidence_msg_ids?: number[];
}

export interface LabLlmRawDetail {
  title: string;
  category: string;
  content: string;
  severity?: LabSeverity | string;
  evidence_msg_ids?: number[];
}

export interface LabLlmRawResponse {
  summary: string;
  model_reading: string;
  dimensions: LabLlmRawDimension[];
  details: LabLlmRawDetail[];
  highlights: LabAnalysisHighlight[];
  risk_count: number;
  confidence: LabConfidence;
}

export const LAB_LLM_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'model_reading', 'dimensions', 'details', 'highlights', 'risk_count', 'confidence'],
  properties: {
    summary: { type: 'string', maxLength: 180 },
    model_reading: { type: 'string', maxLength: 240 },
    dimensions: {
      type: 'array',
      minItems: 3,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'score', 'level', 'basis'],
        properties: {
          name: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          level: { type: 'string', enum: ['低', '中', '高'] },
          basis: { type: 'string', maxLength: 160 },
          icon: { type: 'string' },
          evidence_msg_ids: {
            type: 'array',
            items: { type: 'integer' },
            maxItems: 5,
          },
        },
      },
    },
    details: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'category', 'content'],
        properties: {
          title: { type: 'string', maxLength: 40 },
          category: { type: 'string' },
          content: { type: 'string', maxLength: 220 },
          severity: { type: 'string', enum: ['信息', '提醒', '风险'] },
          evidence_msg_ids: {
            type: 'array',
            items: { type: 'integer' },
            maxItems: 5,
          },
        },
      },
    },
    highlights: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'score'],
        properties: {
          label: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          icon: { type: 'string' },
        },
      },
    },
    risk_count: { type: 'integer', minimum: 0 },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
} as const;

export function labLevelForScore(score: number): LabLevel {
  if (score <= 39) return '低';
  if (score <= 69) return '中';
  return '高';
}

export function labDimensionsForMode(mode: LabMode): LabDimensionTemplate[] {
  return LAB_MODE_TEMPLATES[mode]?.dimensions ?? LAB_MODE_TEMPLATES.family.dimensions;
}
