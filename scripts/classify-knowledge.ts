import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Load .env.local
const envPath = join(projectRoot, '.env.local');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const DATA_DIR = process.env.WECHAT_RADAR_DATA_DIR || join(homedir(), '.wechat-radar');
const ASSISTANT_DB = join(homedir(), 'wechat-assistant', 'assistant.db');
const RADAR_DB = join(DATA_DIR, 'radar.db');

const BASE_URL = process.env.WECHAT_RADAR_TOPIC_BASE_URL ?? process.env.WECHAT_RADAR_LAB_BASE_URL;
const API_KEY = process.env.WECHAT_RADAR_TOPIC_API_KEY ?? process.env.WECHAT_RADAR_LAB_API_KEY;
const MODEL = process.env.WECHAT_RADAR_TOPIC_MODEL ?? process.env.WECHAT_RADAR_LAB_MODEL ?? 'glm-4-flash';

const EXISTING_CATEGORIES = [
  '产品动态', '产品反馈', '产品推荐', '产品更新', '动态提醒',
  '实战案例', '工具产品', '工具动态', '工具对比', '工具推荐', '工具更新',
  '平台商单', '平台运营', '开源项目', '技术方案', '技术讨论', '技术评测',
  '政策变化', '教程资源', '新闻政策', '方法技巧', '生图技巧', '硬件动态',
  '行业洞察', '资源链接', '踩坑记录', '运营指引', '重要通知', '防骗/经验',
];

interface KnowledgeItem {
  id: number;
  topic: string;
  summary: string;
  tags: string;
}

interface ClassifyResult {
  category: string;
  confidence: number;
}

async function main() {
  if (!existsSync(ASSISTANT_DB)) { console.error('assistant.db not found'); process.exit(1); }
  if (!existsSync(RADAR_DB)) { console.error('radar.db not found'); process.exit(1); }
  if (!BASE_URL) { console.error('WECHAT_RADAR_LAB_BASE_URL required'); process.exit(1); }

  // Read unclassified items
  const adb = new Database(ASSISTANT_DB, { readonly: true, fileMustExist: true });
  adb.pragma('query_only = ON');
  const items = adb
    .prepare('SELECT id, topic, summary, tags FROM knowledge_items WHERE category = ?')
    .all('') as KnowledgeItem[];
  adb.close();

  console.log(`Found ${items.length} unclassified knowledge items`);

  // Create output table in radar.db
  const rdb = new Database(RADAR_DB);
  rdb.pragma('journal_mode = WAL');
  rdb.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_category_inferred (
      item_id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      confidence REAL NOT NULL,
      computed_at INTEGER NOT NULL
    )
  `);

  const upsert = rdb.prepare(`
    INSERT INTO knowledge_category_inferred (item_id, category, confidence, computed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      category = excluded.category,
      confidence = excluded.confidence,
      computed_at = excluded.computed_at
  `);

  let success = 0, failed = 0;
  const now = Date.now();

  // Process in batches of 10
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    console.log(`Processing batch ${Math.floor(i / 10) + 1}/${Math.ceil(items.length / 10)} (${batch.length} items)...`);

    for (const item of batch) {
      let result: ClassifyResult | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await classifyItem(item);
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`  Attempt ${attempt + 1} failed for item ${item.id}: ${msg.slice(0, 100)}`);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }

      if (result) {
        upsert.run(item.id, result.category, result.confidence, now);
        success++;
        console.log(`  [${item.id}] ${item.topic?.slice(0, 40)} → ${result.category} (${result.confidence})`);
      } else {
        failed++;
        console.error(`  [${item.id}] FAILED after 3 attempts`);
      }
    }
  }

  rdb.close();
  console.log(`\nDone: success=${success} failed=${failed}`);
}

async function classifyItem(item: KnowledgeItem): Promise<ClassifyResult> {
  const tags = (() => {
    try { return JSON.parse(item.tags).join(', '); } catch { return item.tags || ''; }
  })();

  const prompt = `将以下知识条目分类到最合适的一个类别。

知识条目：
- 主题：${item.topic || '无'}
- 摘要：${item.summary || '无'}
- 标签：${tags || '无'}

可选类别（必须从以下选一个）：
${EXISTING_CATEGORIES.join('、')}

输出 JSON：{"category": "类别名", "confidence": 0.0-1.0}`;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;

  const response = await fetch(`${BASE_URL!.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你是知识分类器。只输出 JSON，格式：{"category": "类别名", "confidence": 0.0-1.0}' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM ${response.status}: ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(content) as { category?: string; confidence?: number };

  if (!parsed.category || !EXISTING_CATEGORIES.includes(parsed.category)) {
    // Fallback: try to find closest match
    const closest = EXISTING_CATEGORIES.find((c) => parsed.category?.includes(c) || c.includes(parsed.category ?? ''));
    if (closest) return { category: closest, confidence: parsed.confidence ?? 0.5 };
    return { category: '行业洞察', confidence: 0.3 };
  }

  return { category: parsed.category, confidence: parsed.confidence ?? 0.7 };
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
