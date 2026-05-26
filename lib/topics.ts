import { db } from './db';
import { wxSessions } from './wx';

const MIN_MESSAGES_PER_TOPIC = 4;
const MIN_MESSAGE_LENGTH = 20;
const MAX_MESSAGE_LENGTH = 400;
const MAX_MESSAGES_TO_PROCESS = 3000;
const MAX_TOPICS_TO_SAVE = 30;
const CODEX_CHUNK_SIZE = Number(process.env.WECHAT_RADAR_TOPIC_CHUNK_SIZE ?? 250);
const TOPICS_PER_CHUNK = 12;

// Topic aggregation LLM = openai-compatible (GLM). Defaults to the same env as
// /lab (WECHAT_RADAR_LAB_*); WECHAT_RADAR_TOPIC_* overrides. Switched off the
// codex CLI which exits 1 locally (same gpt-5/auth issue as /lab).
const TOPIC_BASE_URL = process.env.WECHAT_RADAR_TOPIC_BASE_URL ?? process.env.WECHAT_RADAR_LAB_BASE_URL;
const TOPIC_API_KEY = process.env.WECHAT_RADAR_TOPIC_API_KEY ?? process.env.WECHAT_RADAR_LAB_API_KEY;
const TOPIC_MODEL = process.env.WECHAT_RADAR_TOPIC_MODEL ?? process.env.WECHAT_RADAR_LAB_MODEL ?? 'glm-4-flash';
const TOPIC_MAX_TOKENS = Number(process.env.WECHAT_RADAR_TOPIC_MAX_TOKENS ?? 3000);
const TOPIC_TIMEOUT_MS = Number(
  process.env.WECHAT_RADAR_TOPIC_TIMEOUT_MS ?? process.env.WECHAT_RADAR_LAB_CODEX_TIMEOUT_MS ?? 180_000,
);

interface SourceMsg {
  chatroom_id: string;
  local_id: number;
  sender: string;
  content: string;
  time: string;
  timestamp: number;
}

interface LlmTopic {
  title: string;
  summary: string;
  message_ids: string[];
}

interface LlmTopicResponse {
  topics: LlmTopic[];
}

type TopicWithMembers = {
  title: string;
  summary: string;
  members: SourceMsg[];
  groupSet: Set<string>;
};

function cleanContent(s: string): string {
  const text = s
    .replace(/\[图片\]\s*local_id=\d+/g, '')
    .replace(/\[小程序\][^\n]*/g, '')
    .replace(/<\?xml[\s\S]+?\?>[\s\S]*?<\/msg>/g, '')
    .replace(/\[(?:链接|链接\/文件)\]\s*(?:当前(?:微信)?版本不支持展示该内容，请升级至?最新(?:版|版本)|当前版本不支持展示该内容，请升级至最新版本)[。.]?/gi, ' ')
    .replace(/当前(?:微信)?版本不支持展示该内容，请升级至?最新(?:版|版本)[。.]?/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[a-f0-9]{24,}\b/gi, ' ')
    .replace(/\b\d{12,}\b/g, ' ')
    .trim();

  const parts = text
    .split(/↳|\\n|\n/)
    .map((part) =>
      part
        .replace(/^\[引用\]\s*/g, '')
        .replace(/^\[(?:链接|链接\/文件|图片|视频|表情)\]\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((part) => part.length >= MIN_MESSAGE_LENGTH && !isPlaceholderTitle(part));

  return parts[0] ?? text.replace(/\s+/g, ' ').trim();
}

// 这些消息整体就是占位符 / wrapper，无实质内容
const PLACEHOLDER_PATTERNS = [
  /^\[链接\]\s*当前(?:微信)?版本不支持/,
  /^当前(?:微信)?版本不支持展示该内容，请升级至?最新(?:版|版本)[。.]?$/,
  /^\[文件\]\s*[^\s]+\.\w+\s*$/,
  /^\[视频\]\s*$/,
  /^\[音频\]\s*$/,
  /^\[语音\]\s*$/,
  /^\[表情\]\s*$/,
  /^\[图片\]\s*$/,
  /^\[位置\]/,
  /^\[名片\]/,
  /^\[小程序\]\s*[^\s]*\s*$/,
  /^\[转账\]/,
  /^\[红包\]/,
];

function isPlaceholderOnly(content: string): boolean {
  if (!content) return true;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(content)) || isPlaceholderTitle(content);
}

function isPlaceholderTitle(value: string): boolean {
  const text = value
    .replace(/^\[(?:链接|链接\/文件|图片|视频|表情)\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return true;
  return /^(?:当前(?:微信)?版本不支持展示该内容，请升级至?最新(?:版|版本)|当前版本不支持|请升级至最新版本)[。.]?$/i.test(text);
}

function loadCandidateMessages(date: string): SourceMsg[] {
  const rows = db()
    .prepare(
      `SELECT chatroom_id, local_id, sender, content, time, timestamp
       FROM messages
       WHERE date = ?
         AND type IN ('文本', '链接/文件')
         AND length(content) >= ?
       ORDER BY timestamp ASC
       LIMIT ?`,
    )
    .all(date, MIN_MESSAGE_LENGTH, MAX_MESSAGES_TO_PROCESS) as SourceMsg[];

  // 1. 过滤占位符 + 清洗 + 长度筛选
  const cleaned = rows
    .map((r) => ({ ...r, content: cleanContent(r.content).slice(0, MAX_MESSAGE_LENGTH) }))
    .filter((r) => !isPlaceholderOnly(r.content) && r.content.length >= MIN_MESSAGE_LENGTH);

  // 2. 去重：相同内容（同一条转发消息）只保留第一次出现
  // 这是真信号（同一篇文章被多群转发）但不应该堆成「话题」— 简化为信源（前 3 条群即可）
  const seen = new Map<string, SourceMsg>();
  for (const r of cleaned) {
    const key = r.content.slice(0, 80); // 前 80 字相同 ≈ 同一条转发
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values());
}

function sourceId(m: SourceMsg): string {
  return `${m.chatroom_id}#${m.local_id}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function parseJsonOutput<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]) as T;
    const obj = trimmed.match(/\{[\s\S]*\}/);
    if (obj) return JSON.parse(obj[0]) as T;
    throw new Error('topic LLM returned non-JSON');
  }
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * Topic aggregation via openai-compatible (GLM) /chat/completions. Replaces the
 * codex CLI runner (which exits 1 locally). Same JSON-only contract as before —
 * the prompts already describe the `{topics:[...]}` shape; we just enforce
 * response_format=json_object and unwrap a GLM `{answer:...}` wrapper if present.
 */
async function runTopicLlm<T>(prompt: string, timeoutMs = TOPIC_TIMEOUT_MS): Promise<T> {
  if (!TOPIC_BASE_URL) {
    throw new Error('WECHAT_RADAR_TOPIC_BASE_URL / WECHAT_RADAR_LAB_BASE_URL required for topic LLM');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (TOPIC_API_KEY) headers.authorization = `Bearer ${TOPIC_API_KEY}`;

    const response = await fetch(`${TOPIC_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model: TOPIC_MODEL,
        messages: [
          {
            role: 'system',
            content:
              '你是微信群聊「话题雷达」聚合引擎。只输出符合用户要求的严格 JSON（根对象含 topics 数组），不要输出 markdown、解释或 answer/result 等包裹字段。',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: TOPIC_MAX_TOKENS,
        response_format: { type: 'json_object' },
      }),
    });

    const text = await response.text();
    let payload: OpenAIChatResponse | null = null;
    try {
      payload = text ? (JSON.parse(text) as OpenAIChatResponse) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(`topic LLM request failed (${response.status}): ${payload?.error?.message || text.slice(0, 400)}`);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('topic LLM response missing choices[0].message.content');
    }
    const parsed = parseJsonOutput<unknown>(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'answer' in parsed) {
      const answer = (parsed as { answer: unknown }).answer;
      if (typeof answer === 'string') return parseJsonOutput<T>(answer);
      if (answer && typeof answer === 'object') return answer as T;
    }
    return parsed as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('topic LLM timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function formatMessagesForPrompt(messages: SourceMsg[], groupNameMap: Map<string, string>): string {
  return messages
    .map((m) =>
      JSON.stringify({
        id: sourceId(m),
        group: groupNameMap.get(m.chatroom_id) ?? m.chatroom_id,
        sender: m.sender,
        time: m.time,
        content: m.content,
      }),
    )
    .join('\n');
}

function buildExtractionPrompt(
  date: string,
  messages: SourceMsg[],
  groupNameMap: Map<string, string>,
  maxTopics: number,
): string {
  return `你是微信群「话题雷达」的聚合引擎。请直接用 LLM 判断语义相关性，找出 ${date} 的主要讨论话题。

任务要求：
- 只做话题聚合，不要逐条摘要。
- 合并同一事件、产品、工具、论文、观点、问题及其追问/回应/转述。
- 优先保留跨群出现的话题；同一群内高密度连续讨论也可以保留。
- 忽略问候、纯闲聊、广告、无上下文碎片、纯占位内容和过泛的「AI 很火」类讨论。
- 严禁把「当前版本不支持展示该内容」「当前微信版本不支持展示该内容」「请升级至最新版本」这类微信占位文案当作话题标题或摘要。
- 遇到链接/视频/小程序占位时，只能根据前后文里真正有人讨论的对象命名；没有可读上下文就丢弃。
- 每个话题至少包含 ${MIN_MESSAGES_PER_TOPIC} 条消息。
- 最多输出 ${maxTopics} 个话题，按重要性排序。
- title 用 8-15 个汉字，优先写产品名/事件名/讨论焦点。
- summary 用 1-2 句中文说明大家在讨论什么。
- message_ids 必须只使用输入消息的 id；不要编造 id；同一个 id 不要重复。

只输出严格 JSON，格式：
{"topics":[{"title":"...","summary":"...","message_ids":["群id#local_id"]}]}

输入消息为 JSONL：
${formatMessagesForPrompt(messages, groupNameMap)}`;
}

function buildMergePrompt(date: string, drafts: LlmTopic[], maxTopics: number): string {
  const lines = drafts
    .map((t, i) =>
      JSON.stringify({
        id: `draft-${i + 1}`,
        title: t.title,
        summary: t.summary,
        message_ids: t.message_ids,
        message_count: t.message_ids.length,
      }),
    )
    .join('\n');

  return `下面是 ${date} 分批得到的话题草稿。请继续用 LLM 完成最终跨批合并。

任务要求：
- 合并语义相同或强相关的话题草稿，message_ids 取并集。
- 删除过泛、重复、证据不足的话题。
- 删除微信升级提示、资源封面、头像链接、无语义数字串等占位话题。
- 每个最终话题至少包含 ${MIN_MESSAGES_PER_TOPIC} 条消息。
- 最多输出 ${maxTopics} 个最终话题，按重要性排序。
- title 用 8-15 个汉字，summary 用 1-2 句中文。
- message_ids 必须来自输入草稿，不要编造。

只输出严格 JSON：
{"topics":[{"title":"...","summary":"...","message_ids":["群id#local_id"]}]}

话题草稿 JSONL：
${lines}`;
}

function normalizeTopics(rawTopics: LlmTopic[], messageMap: Map<string, SourceMsg>): TopicWithMembers[] {
  const out: TopicWithMembers[] = [];
  const seenSignatures = new Set<string>();

  for (const raw of rawTopics) {
    const ids = Array.from(new Set((raw.message_ids ?? []).filter((id) => messageMap.has(id))));
    if (ids.length < MIN_MESSAGES_PER_TOPIC) continue;

    const members = ids.map((id) => messageMap.get(id)!).sort((a, b) => a.timestamp - b.timestamp);
    const signature = ids.slice().sort().join('|');
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);

    out.push({
      title: cleanTopicTitle(raw.title, members),
      summary: (raw.summary || '').slice(0, 400),
      members,
      groupSet: new Set(members.map((m) => m.chatroom_id)),
    });
  }

  return out.sort((a, b) => b.members.length - a.members.length).slice(0, MAX_TOPICS_TO_SAVE);
}

function cleanTopicTitle(title: string, members: SourceMsg[]): string {
  const cleaned = cleanContent(title || '');
  if (cleaned && !isPlaceholderTitle(cleaned)) return cleaned.slice(0, 80);
  const candidate = members
    .slice()
    .sort((a, b) => b.content.length - a.content.length)
    .map((m) => cleanContent(m.content))
    .find((text) => text.length >= 8 && !isPlaceholderTitle(text));
  return (candidate || '未命名话题').slice(0, 80);
}

async function aggregateWithCodex(
  date: string,
  messages: SourceMsg[],
  groupNameMap: Map<string, string>,
  onProgress?: (p: TopicProgress) => void,
): Promise<TopicWithMembers[]> {
  const messageMap = new Map(messages.map((m) => [sourceId(m), m]));
  const chunks = chunk(messages, Math.max(50, CODEX_CHUNK_SIZE));
  const drafts: LlmTopic[] = [];

  onProgress?.({
    type: 'llm',
    done: 0,
    total: chunks.length,
    message: `LLM 聚合 ${messages.length} 条消息…`,
  });

  // Per-chunk resilient: a single chunk being rejected (e.g. GLM content-safety
  // 400 on real chat content) must NOT abort the whole day — skip it and keep the
  // topics from the chunks that did pass.
  let skipped = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const response = await runTopicLlm<LlmTopicResponse>(
        buildExtractionPrompt(date, chunks[i], groupNameMap, TOPICS_PER_CHUNK),
      );
      drafts.push(...(response.topics ?? []));
      onProgress?.({ type: 'llm', done: i + 1, total: chunks.length, message: `LLM 分批聚合 ${i + 1}/${chunks.length}` });
    } catch (e) {
      skipped += 1;
      onProgress?.({
        type: 'llm',
        done: i + 1,
        total: chunks.length,
        message: `第 ${i + 1}/${chunks.length} 块跳过（${e instanceof Error ? e.message.slice(0, 80) : 'LLM 错误'}）`,
      });
    }
  }
  if (skipped > 0) {
    onProgress?.({
      type: 'llm',
      done: chunks.length,
      total: chunks.length,
      message: `${skipped}/${chunks.length} 块被 LLM 拒绝（多为敏感内容过滤），按可用块聚合`,
    });
  }

  if (drafts.length === 0) return [];

  if (chunks.length > 1) {
    onProgress?.({
      type: 'llm',
      done: chunks.length,
      total: chunks.length,
      message: `LLM 合并 ${drafts.length} 个话题草稿…`,
    });
  }

  let final: LlmTopicResponse;
  if (chunks.length === 1) {
    final = { topics: drafts };
  } else {
    try {
      final = await runTopicLlm<LlmTopicResponse>(buildMergePrompt(date, drafts, MAX_TOPICS_TO_SAVE));
    } catch {
      // Merge rejected (content filter) → keep the unmerged drafts.
      final = { topics: drafts.slice(0, MAX_TOPICS_TO_SAVE) };
    }
  }

  return normalizeTopics(final.topics ?? [], messageMap);
}

export interface TopicProgress {
  type: 'load' | 'llm' | 'save' | 'done' | 'error';
  done?: number;
  total?: number;
  count?: number;
  message?: string;
  error?: string;
}

export async function buildTopicsForDate(
  date: string,
  onProgress?: (p: TopicProgress) => void,
): Promise<{ topics: number; messages: number }> {
  onProgress?.({ type: 'load', message: '加载当日消息…' });
  const msgs = loadCandidateMessages(date);
  if (msgs.length === 0) {
    onProgress?.({ type: 'done', count: 0 });
    return { topics: 0, messages: 0 };
  }

  const sessions = await wxSessions(500).catch(() => []);
  const groupNameMap = new Map<string, string>();
  for (const s of sessions) groupNameMap.set(s.username, s.chat);

  const valid = await aggregateWithCodex(date, msgs, groupNameMap, onProgress);

  // 清空当日旧话题
  db().prepare('DELETE FROM topics WHERE date = ?').run(date);

  let savedTopics = 0;
  let savedMessages = 0;
  for (let i = 0; i < valid.length; i++) {
    const c = valid[i];
    onProgress?.({
      type: 'save',
      done: i + 1,
      total: valid.length,
      message: c.title,
    });

    const insertTopic = db().prepare(
      'INSERT INTO topics (date, title, summary, message_count, group_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertMsg = db().prepare(
      'INSERT OR IGNORE INTO topic_messages (topic_id, chatroom_id, local_id, score) VALUES (?, ?, ?, ?)',
    );

    const tx = db().transaction(() => {
      const info = insertTopic.run(
        date,
        c.title,
        c.summary,
        c.members.length,
        c.groupSet.size,
        Date.now(),
      );
      const tid = Number(info.lastInsertRowid);
      for (let index = 0; index < c.members.length; index++) {
        const member = c.members[index];
        insertMsg.run(tid, member.chatroom_id, member.local_id, 1 - index / 1000);
        savedMessages++;
      }
    });
    tx();
    savedTopics++;
  }

  onProgress?.({ type: 'done', count: savedTopics });
  return { topics: savedTopics, messages: savedMessages };
}

export interface TopicListItem {
  id: number;
  date: string;
  title: string;
  summary: string;
  message_count: number;
  group_count: number;
}

export function listTopics(date: string): TopicListItem[] {
  return db()
    .prepare(
      'SELECT id, date, title, summary, message_count, group_count FROM topics WHERE date = ? ORDER BY message_count DESC',
    )
    .all(date) as TopicListItem[];
}

export interface TopicDetail extends TopicListItem {
  messages: Array<{
    chatroom_id: string;
    chat_name: string;
    local_id: number;
    sender: string;
    content: string;
    time: string;
    timestamp: number;
    type: string;
    score: number;
  }>;
}

export async function getTopicDetail(id: number): Promise<TopicDetail | null> {
  const topic = db()
    .prepare(
      'SELECT id, date, title, summary, message_count, group_count FROM topics WHERE id = ?',
    )
    .get(id) as TopicListItem | undefined;
  if (!topic) return null;

  const rows = db()
    .prepare(
      `SELECT m.chatroom_id, m.local_id, m.sender, m.content, m.time, m.timestamp, m.type, tm.score
       FROM topic_messages tm
       JOIN messages m ON m.chatroom_id = tm.chatroom_id AND m.local_id = tm.local_id
       WHERE tm.topic_id = ?
       ORDER BY tm.score DESC, m.timestamp ASC`,
    )
    .all(id) as Array<{
    chatroom_id: string;
    local_id: number;
    sender: string;
    content: string;
    time: string;
    timestamp: number;
    type: string;
    score: number;
  }>;

  const sessions = await wxSessions(500).catch(() => []);
  const nameMap = new Map<string, string>();
  for (const s of sessions) nameMap.set(s.username, s.chat);

  return {
    ...topic,
    messages: rows.map((r) => ({
      ...r,
      chat_name: nameMap.get(r.chatroom_id) ?? r.chatroom_id,
    })),
  };
}
