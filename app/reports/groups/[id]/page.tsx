'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { ArrowLeft, Check, Copy, ExternalLink, FileText, Link2, MessageSquare, Trophy } from 'lucide-react';

type Detail = {
  ok: boolean;
  chatroom_id: string;
  date: string;
  stats: {
    chat: string;
    total: number;
    top_senders: Array<{ sender: string; count: number }>;
  } | null;
  recent: Array<{
    local_id: number;
    sender: string;
    content: string;
    time: string;
    type: string;
  }>;
};

export const dynamic = 'force-dynamic';

export default function GroupDailyReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const chatroomId = decodeURIComponent(id);
  const date = useSearchParams().get('date') ?? localToday();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/group/${encodeURIComponent(chatroomId)}?date=${date}&limit=500`, {
          cache: 'no-store',
        });
        const j = (await r.json()) as Detail;
        if (!cancelled) setData(j);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatroomId, date]);

  const reportText = useMemo(() => buildReportText(data, chatroomId, date), [data, chatroomId, date]);

  const copyReport = useCallback(async () => {
    await navigator.clipboard.writeText(reportText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [reportText]);

  const title = data?.stats?.chat ?? chatroomId;
  const report = useMemo(() => analyzeReport(data?.recent ?? []), [data?.recent]);

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="shrink-0 text-[var(--text-3)] hover:text-[var(--text)]">
              <ArrowLeft size={16} />
            </Link>
            <div className="min-w-0">
              <div className="report-kicker">Group Daily Report</div>
              <h1 className="truncate text-[16px] font-semibold">{title}</h1>
              <div className="mt-0.5 text-[11px] text-[var(--text-3)]">
                {date} · {loading ? '加载中…' : `${data?.stats?.total ?? 0} 条消息`} · 日报地址
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={copyReport} disabled={!data?.ok}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? '已复制' : '复制日报'}</span>
            </button>
            <Link
              className="btn"
              href={`/groups/${encodeURIComponent(chatroomId)}?date=${date}`}
              title="查看完整群消息"
            >
              <ExternalLink size={13} />
              <span>完整消息</span>
            </Link>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <section className="card p-5">
            <div className="flex items-center gap-1.5 text-[14px] font-semibold">
              <FileText size={15} className="text-[var(--accent)]" />
              日报摘要
            </div>
            <p className="mt-3 text-[13px] leading-6 text-[var(--text-2)]">
              {loading
                ? '正在生成日报视图…'
                : `今天这个群共产生 ${data?.stats?.total ?? 0} 条消息，按摘要策略提炼为核心主题、证据引用、资源链接和可跟进项。`}
            </p>
          </section>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <section className="card p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[14px] font-semibold">
                  <MessageSquare size={15} className="text-[var(--accent)]" />
                  核心主题
                </div>
                <div className="text-[11px] text-[var(--text-3)]">{report.topics.length} 个</div>
              </div>
              <div className="mt-3 space-y-3">
                {report.topics.length === 0 ? (
                  <div className="py-10 text-center text-[12px] text-[var(--text-3)]">暂无可聚合主题</div>
                ) : (
                  report.topics.map((topic, i) => (
                    <article key={topic.title} className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="report-title text-[16px] font-semibold text-[var(--text)]">
                          {i + 1}. {topic.title}
                        </h2>
                        <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                          {topic.count} 条
                        </span>
                      </div>
                      <div className="mt-2 text-[12px] leading-5 text-[var(--text-2)]">
                        <span className="font-medium text-[var(--text)]">聊了什么：</span>
                        {topic.what}
                      </div>
                      <div className="mt-1 text-[12px] leading-5 text-[var(--text-2)]">
                        <span className="font-medium text-[var(--text)]">为什么重要：</span>
                        {topic.why}
                      </div>
                      {topic.quote && (
                        <blockquote className="mt-2 border-l-2 border-[var(--accent)] pl-3 text-[11px] leading-5 text-[var(--text-3)]">
                          {topic.quote.sender}：「{topic.quote.text}」
                        </blockquote>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>

            <div className="space-y-4">
              <section className="card p-5">
                <div className="flex items-center gap-1.5 text-[14px] font-semibold">
                  <Link2 size={15} className="text-[var(--accent)]" />
                  工具/文章/链接
                </div>
                <div className="mt-3 space-y-2">
                  {report.links.length === 0 ? (
                    <div className="py-6 text-center text-[12px] text-[var(--text-3)]">暂无链接</div>
                  ) : (
                    report.links.slice(0, 10).map((link) => (
                      <a key={link.key} href={link.url} target="_blank" rel="noreferrer" className="block rounded-md px-2 py-2 hover:bg-[var(--surface-2)]">
                        <div className="line-clamp-2 text-[12px] font-medium text-[var(--text)]">{link.title}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-[var(--text-3)]">
                          <span className="truncate">{link.url}</span>
                          {(link.count > 1 || link.urlCount > 1) && (
                            <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[var(--accent)]">
                              合并 {link.count} 次 / {link.urlCount} 链接
                            </span>
                          )}
                        </div>
                      </a>
                    ))
                  )}
                </div>
              </section>

              <section className="card p-5">
                <div className="flex items-center gap-1.5 text-[14px] font-semibold">
                  <FileText size={15} className="text-[var(--warn)]" />
                  可跟进
                </div>
                <div className="mt-3 space-y-2">
                  {report.followups.length === 0 ? (
                    <div className="py-6 text-center text-[12px] text-[var(--text-3)]">暂无明确问题</div>
                  ) : (
                    report.followups.slice(0, 8).map((m) => (
                      <div key={m.local_id} className="rounded-md px-2 py-2 text-[12px] leading-5 text-[var(--text-2)] hover:bg-[var(--surface-2)]">
                        <span className="font-medium text-[var(--text)]">{m.sender}：</span>
                        {cleanMessage(m.content)}
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="card p-5">
                <div className="flex items-center gap-1.5 text-[14px] font-semibold">
                  <Trophy size={15} className="text-[var(--warn)]" />
                  Top 发言人
                </div>
                <div className="mt-3 space-y-2">
                  {(data?.stats?.top_senders ?? []).slice(0, 8).map((sender, i) => (
                    <div key={`${sender.sender}:${i}`} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="truncate text-[var(--text-2)]">{i + 1}. {sender.sender}</span>
                      <span className="tabular-nums text-[var(--text)]">{sender.count}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

type ReportMessage = Detail['recent'][number];

type TopicReport = {
  title: string;
  count: number;
  what: string;
  why: string;
  quote?: { sender: string; text: string };
};

type TopicRule = {
  title: string;
  re: RegExp;
  why: string;
  priority: number;
};

const TOPIC_RULES: TopicRule[] = [
  {
    title: 'AI 编程与 Agent 工作流',
    re: /codex|claude code|agent|mcp|skills?|cli|vibe.?coding|编程|代码/i,
    why: '这类讨论通常直接影响个人和团队的生产方式，适合沉淀成工作流、工具清单或实践经验。',
    priority: 5,
  },
  {
    title: '新工具、新模型与产品体验',
    re: /工具|产品|模型|内测|API|插件|开源|github|huggingface|modelscope/i,
    why: '群里对工具和模型的实测反馈，比单纯发布新闻更接近真实采用价值，适合优先试用和收藏。',
    priority: 4,
  },
  {
    title: '活动、报名与社群机会',
    re: /报名|活动|直播|大会|训练营|课程|线下|名额|招募/i,
    why: '这些信息有时间窗口，错过就失效，适合当天判断是否参与、转发或对接。',
    priority: 6,
  },
  {
    title: '内容创作、AIGC 与传播',
    re: /内容|小红书|公众号|视频|图像|封面|传播|选题|日报|文章/i,
    why: '这类讨论可以转化为公开内容、选题储备或素材库，对后续写作和传播有复用价值。',
    priority: 3,
  },
  {
    title: '需求、问题与可回复线索',
    re: /求推荐|有没有|谁有|怎么|如何|能不能|可不可以|问题|方案/i,
    why: '明确问题背后往往有真实需求，适合用你的经验、资源或产品线索去回应。',
    priority: 7,
  },
];

function analyzeReport(messages: ReportMessage[]) {
  const clean = messages
    .map((m) => ({ ...m, content: cleanMessage(m.content) }))
    .map((m) => ({ ...m, content: meaningfulMessageText(m.content) }))
    .filter((m) => m.content.length >= 6 && !isLowValueMessage(m.content));
  const topics = clusterTopics(clean);

  const links = extractLinks(clean).slice(0, 24);
  const followups = clean
    .filter((m) => /求推荐|有没有|谁有|怎么|如何|能不能|可不可以|请教|帮忙/i.test(m.content))
    .slice(0, 12);

  return {
    topics: topics.sort((a, b) => b.count - a.count).slice(0, 5),
    links,
    followups,
  };
}

function clusterTopics(messages: ReportMessage[]): TopicReport[] {
  const assigned = new Set<number>();
  const clusters = new Map<string, { rule: TopicRule; messages: ReportMessage[] }>();

  for (const m of messages) {
    if (assigned.has(m.local_id)) continue;
    const rule = bestTopicRule(m.content);
    if (!rule) continue;
    const key = discussionKey(m.content, rule.title);
    const existing = clusters.get(key);
    if (existing) {
      existing.messages.push(m);
    } else {
      clusters.set(key, { rule, messages: [m] });
    }
    assigned.add(m.local_id);
  }

  return Array.from(clusters.values())
    .map(({ rule, messages: hits }) => {
      const unique = dedupeMessages(hits);
      const representative = unique
        .slice()
        .sort((a, b) => scoreMessage(b.content) - scoreMessage(a.content))[0];
      return {
        title: specificTopicTitle(representative?.content ?? rule.title, rule.title),
        count: unique.length,
        what: summarizeTopic(unique),
        why: rule.why,
        quote: representative
          ? { sender: representative.sender, text: stripUrls(representative.content).slice(0, 120) }
          : undefined,
      };
    })
    .filter((topic) => topic.count >= 2 || scoreMessage(topic.what) >= 8)
    .sort((a, b) => b.count - a.count || b.what.length - a.what.length)
    .slice(0, 5);
}

function bestTopicRule(content: string): TopicRule | null {
  const matches = TOPIC_RULES.filter((rule) => rule.re.test(content));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.priority - a.priority)[0];
}

function dedupeMessages(messages: ReportMessage[]): ReportMessage[] {
  const seen = new Set<string>();
  const out: ReportMessage[] = [];
  for (const m of messages) {
    const key = messageFingerprint(m.content);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function discussionKey(content: string, fallback: string): string {
  const url = firstUrl(content);
  if (url) return `url:${normalizeResourceUrl(url)}`;
  const title = bracketTitle(content);
  if (title) return `title:${textFingerprint(title)}`;
  return `text:${textFingerprint(content).slice(0, 48) || fallback}`;
}

function messageFingerprint(content: string): string {
  const url = firstUrl(content);
  if (url) return `url:${normalizeResourceUrl(url)}`;
  return textFingerprint(stripUrls(content)).slice(0, 80);
}

function textFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, '')
    .slice(0, 120);
}

function firstUrl(content: string): string | null {
  const match = content.match(/https?:\/\/[^\s<>"']+/);
  return match ? match[0].replace(/[),，。；;!?！？、\]}>]+$/g, '') : null;
}

function bracketTitle(content: string): string | null {
  const match = content.match(/\[(?:链接|链接\/文件)\]\s*([^\n。；;]{4,80})/);
  const title = match?.[1]?.trim();
  if (!title || isMeaninglessTitle(title)) return null;
  return title;
}

function specificTopicTitle(content: string, fallback: string): string {
  const title = bracketTitle(content);
  if (title) return title.replace(/^【|】$/g, '').slice(0, 28);
  const cleaned = meaningfulMessageText(content)
    .replace(/^\[引用\]\s*/g, '')
    .replace(/^\[(?:链接|链接\/文件)\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const product = cleaned.match(/(Claude Code|GPT-Image-2|ChatGPT|Codex|MCP|InkOS|Munger Models|awesome-mac|Sloth-Poster-Den|Bloome|Stitch)/i)?.[0];
  if (product) return `${product} 相关讨论`.slice(0, 28);
  return (cleaned.split(/[。！？!?；;]/)[0] || fallback).slice(0, 28);
}

function summarizeTopic(messages: ReportMessage[]): string {
  const top = messages
    .slice()
    .sort((a, b) => scoreMessage(b.content) - scoreMessage(a.content))
    .slice(0, 3)
    .map((m) => meaningfulMessageText(m.content))
    .filter((text) => text.length >= 6 && !isMeaninglessTitle(text));
  if (top.length === 0) return '当天有零散讨论，但缺少足够完整的上下文。';
  return top.join('；').slice(0, 220);
}

function scoreMessage(content: string): number {
  let score = Math.min(content.length / 18, 8);
  if (/https?:\/\/|<url>|github|工具|模型|报名|求推荐/i.test(content)) score += 4;
  if (/我觉得|实测|经验|方案|问题|原因|为什么/i.test(content)) score += 2;
  return score;
}

function extractLinks(messages: ReportMessage[]) {
  const groups = new Map<string, { title: string; urls: Set<string>; count: number; score: number }>();
  for (const m of messages) {
    for (const match of m.content.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      const url = match[0].replace(/[),，。；;!?！？、\]}>]+$/g, '');
      if (isNoiseUrl(url)) continue;
      const title = titleFromMessage(m.content, url);
      if (isMeaninglessTitle(title)) continue;
      const key = linkGroupKey(title, url);
      const current = groups.get(key);
      const nextScore = scoreMessage(m.content);
      if (current) {
        current.urls.add(url);
        current.count++;
        if (nextScore > current.score) {
          current.title = title;
          current.score = nextScore;
        }
      } else {
        groups.set(key, { title, urls: new Set([url]), count: 1, score: nextScore });
      }
    }
  }
  const rows = Array.from(groups.entries())
    .map(([key, item]) => ({
      key,
      title: item.title,
      url: Array.from(item.urls)[0],
      count: item.count,
      urlCount: item.urls.size,
    }));

  const byUrl = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const urlKey = normalizeResourceUrl(row.url);
    const current = byUrl.get(urlKey);
    if (!current) {
      byUrl.set(urlKey, row);
      continue;
    }
    current.key = `${current.key}|${row.key}`;
    current.count += row.count;
    current.urlCount = Math.max(current.urlCount, row.urlCount);
    if (row.title.length > current.title.length) current.title = row.title;
  }

  return Array.from(byUrl.values())
    .sort((a, b) => b.count - a.count || b.urlCount - a.urlCount);
}

function titleFromMessage(content: string, url: string): string {
  const text = meaningfulMessageText(content)
    .replace(/^\[(?:链接|链接\/文件)\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || domainFromUrl(url)).slice(0, 96);
}

function linkGroupKey(title: string, url: string): string {
  const titleKey = textFingerprint(title).slice(0, 48);
  if (titleKey.length >= 12) return `title:${titleKey}`;
  return `url:${normalizeResourceUrl(url)}`;
}

function normalizeResourceUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^(utm_|spm|from|share_|vd_source|scene|clicktime|enterid)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    return `${u.hostname}${u.pathname}${u.searchParams.toString() ? `?${u.searchParams.toString()}` : ''}`;
  } catch {
    return url;
  }
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function stripUrls(content: string): string {
  return content.replace(/https?:\/\/\S+/g, '').trim();
}

const MEANINGLESS_TITLE_RE =
  /^(?:\[?链接\]?\s*)?(?:当前(?:微信)?版本不支持展示该内容，请升级至?最新(?:版|版本)|当前版本不支持|请升级至最新版本)[。.]?$/i;

const NOISE_URL_HOSTS = new Set([
  'support.weixin.qq.com',
  'wx.qlogo.cn',
  'dldir1v6.qq.com',
  'finder.video.qq.com',
]);

function meaningfulMessageText(content: string): string {
  const withoutUrls = stripUrls(content)
    .replace(/&amp;/g, '&')
    .replace(/\[(?:链接|链接\/文件)\]\s*(?:当前(?:微信)?版本不支持展示该内容，请升级至?最新(?:版|版本)|当前版本不支持展示该内容，请升级至最新版本)[。.]?/gi, ' ')
    .replace(/当前(?:微信)?版本不支持展示该内容，请升级至?最新(?:版|版本)[。.]?/gi, ' ')
    .replace(/\[图片\]\s*local_id=\d+/gi, ' ')
    .replace(/\b[a-f0-9]{24,}\b/gi, ' ')
    .replace(/\b\d{12,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = withoutUrls
    .split(/↳|\\n|\n/)
    .map((part) =>
      part
        .replace(/^\[引用\]\s*/g, '')
        .replace(/^\[(?:链接|链接\/文件|图片|视频|表情)\]\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((part) => part.length >= 6 && !isMeaninglessTitle(part));

  return (parts[0] ?? withoutUrls).trim();
}

function isMeaninglessTitle(title: string): boolean {
  const text = stripUrls(title)
    .replace(/^\[(?:链接|链接\/文件|图片|视频|表情)\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return true;
  if (MEANINGLESS_TITLE_RE.test(text)) return true;
  return /^(?:xml_url_text|网页链接|视频号|finder|wx\.qlogo\.cn)$/i.test(text);
}

function isLowValueMessage(content: string): boolean {
  const text = meaningfulMessageText(content);
  if (isMeaninglessTitle(text)) return true;
  return /^[\d\s._-]+$/.test(text) || text.length < 6;
}

function isNoiseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return NOISE_URL_HOSTS.has(host);
  } catch {
    return false;
  }
}

function buildReportText(data: Detail | null, chatroomId: string, date: string): string {
  const title = data?.stats?.chat ?? chatroomId;
  const messages = data?.recent ?? [];
  const report = analyzeReport(messages);
  return [
    `# ${title} ${date} 群日报`,
    '',
    `今天共 ${data?.stats?.total ?? 0} 条消息。`,
    '',
    '## 核心主题',
    ...report.topics.flatMap((topic, i) => [
      '',
      `### ${i + 1}. ${topic.title}`,
      `聊了什么：${topic.what}`,
      `为什么重要：${topic.why}`,
      topic.quote ? `引用/证据：${topic.quote.sender}：「${topic.quote.text}」` : '',
    ]),
    '',
    '## 工具/文章/链接',
    ...report.links.map((link) => `- ${link.title}: ${link.url}`),
    '',
    '## 未解决/可跟进',
    ...report.followups.map((m) => `- ${m.sender}: ${cleanMessage(m.content)}`),
  ].filter(Boolean).join('\n');
}

function cleanMessage(content: string): string {
  return content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
