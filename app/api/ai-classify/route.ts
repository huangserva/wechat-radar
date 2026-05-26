import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { wxSessions } from '@/lib/wx';
import { listGroups, listAllTags, tagGroup } from '@/lib/groups';

export const dynamic = 'force-dynamic';

interface Suggestion {
  chatroom_id: string;
  name: string;
  summary: string;
  current_group_ids: number[];
  suggested_group_id: number | null;
  suggested_group_name: string | null;
  reason: string;
}

function classifyHeuristic(name: string, summary: string, groups: ReturnType<typeof listGroups>) {
  const lookup = (target: string) => groups.find((g) => g.name.includes(target));

  // 顺序很重要 — 高优先规则先匹配
  // 1. 蝗虫团（最强信号）
  if (/蝗虫团|huangchong/i.test(name)) {
    const t = lookup('蝗虫');
    if (t) return { group_id: t.id, group_name: t.name, reason: '蝗虫团系列' };
  }

  // 2. 自营/读者群
  if (
    /自营|用户群|粉丝群|公众号读者|读者群/.test(name) ||
    /自营|用户群|粉丝群|公众号读者|读者群/.test(summary)
  ) {
    const t = lookup('自营/读者群');
    if (t) return { group_id: t.id, group_name: t.name, reason: '自营 / 读者群' };
  }

  // 3. WaytoAGI
  if (/waytoagi|通往agi|通往ai|通往 ai/i.test(name)) {
    const t = lookup('WaytoAGI');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'WaytoAGI 系列' };
  }

  // 4. HowOneAI
  if (/howoneai|howone/i.test(name)) {
    const t = lookup('HowOneAI');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'HowOneAI 系列' };
  }

  // 5. Vibe Coding / 编程
  if (
    /vibe.?coding|vibecoding|vibe first|cherry studio|cli|claude.?skills|clawdbot|codepilot|mcp|cola|geoflow|refly|camel|eigent|thinkinai|skills|all in cli/i.test(
      name,
    )
  ) {
    const t = lookup('Vibe Coding');
    if (t) return { group_id: t.id, group_name: t.name, reason: '编程 / Skills / CLI' };
  }

  // 6. AI 学术 / 论文 / 未来硅世界
  if (
    /学术|论文|paper|未来硅世界|研究室|nixy|simonlin|博文视点|《|knowledge|灵枭/i.test(
      name,
    )
  ) {
    const t = lookup('AI 学术');
    if (t) return { group_id: t.id, group_name: t.name, reason: '学术 / 论文' };
  }

  // 7. AI 商业 / 营销
  if (
    /seo|geo|商业化|营销|kol|gaidn|adg|vip|生财|appsail|tutti|商业|broker|出版|2026 共读群|阅读\d|收付款|社交新品|社群/i.test(
      name,
    )
  ) {
    const t = lookup('AI 商业');
    if (t) return { group_id: t.id, group_name: t.name, reason: '商业 / 营销 / KOL' };
  }

  // 8. AIGC / 内容创作（视频、音乐、图、媒体、AIGC）
  if (
    /aigc|图|视频|音乐|spy|拍我ai|ai媒体|ai音视频|创意|graceful|创作|graphic|listenhub|notetomp|youmind|完全ai生成|羊毛|社区|molthuman|aiwriter|短视频|歌|video|music|illustrat|ai春晚|nettalk|dolphin/i.test(
      name,
    )
  ) {
    const t = lookup('AIGC');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'AIGC / 内容创作' };
  }

  // 9. 付费社区
  if (
    /vip|烟花|修饼|传术师|生财有术|沃垠|兔子ai|ai领导力|hicool|早鸟|内测|种子用户|订阅用户|车友|豪车|私董|学员|拍我ai|hosi|hosi.ai|api 渠道|大白|一人公司|小鱼名人|pec/i.test(
      name,
    )
  ) {
    const t = lookup('付费社区');
    if (t) return { group_id: t.id, group_name: t.name, reason: '付费 / 内测 / VIP' };
  }

  // 10. AI 工具用户群（产品周边）
  if (
    /用户群|用户中文|内测群|jackywine|mindcode|remio|listenhub|notetomp|cherry|camel|refly|cola|geoflow|hosi|aigocode|appsail|tutti|爱贝壳|内容同步|api/i.test(
      name,
    )
  ) {
    const t = lookup('AI 工具用户群');
    if (t) return { group_id: t.id, group_name: t.name, reason: '工具用户群' };
  }

  // 11. AI 圈社交（散群、神的孩子、明人明言、agi bar、先行者、智能体成精了）
  if (
    /神的孩子|明人明言|先行者|agi bar|智能体成精|life hacker|超级玩家|love.*death.*agent|未来趋势|agent橘|新物种|创造营|不息为体|未知书社|新互联网/i.test(
      name,
    )
  ) {
    const t = lookup('AI 圈社交');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'AI 圈社交' };
  }

  // 12. 大佬 / 媒体圈（自媒体、大佬、对接群、媒体）
  if (
    /donews|何夕|辛亥|对接群|百度世界|央馆|火山方舟|43talks|tgo|商务|《ai营销/i.test(name)
  ) {
    const t = lookup('大佬');
    if (t) return { group_id: t.id, group_name: t.name, reason: '大佬 / 媒体圈' };
  }

  // 13. 行业活动（一次性活动群）
  if (
    /活动现场|聚餐|筹备组|聚会|开播|直播|线下|大会|分享会|一年五班|落户/i.test(name)
  ) {
    const t = lookup('行业活动');
    if (t) return { group_id: t.id, group_name: t.name, reason: '一次性活动群' };
  }

  // 14. 生活 / 兴趣（钓友、邻居、果粉、班级）
  if (
    /钓友|路亚|果粉|大家庭|班级|班·班|喜相逢|邻里|苑|🏘|楼|班|小区|羽毛球|健身|跑步|徒步|阅读|共读|英语|班级群|6年级|六年级|恩小|对接|车友|校友|曲|歌友|羽毛|篮球/i.test(
      name,
    )
  ) {
    const t = lookup('生活');
    if (t) return { group_id: t.id, group_name: t.name, reason: '生活 / 兴趣' };
  }

  // 15. 粉丝团 / 读者群 → AI 圈社交（除非已经被自营/读者群匹配）
  if (/粉丝|fans|读者/i.test(name)) {
    const t = lookup('AI 圈社交');
    if (t) return { group_id: t.id, group_name: t.name, reason: '粉丝团 / 读者群' };
  }

  // 16. 财经 / 投资类
  if (/财经|股票|投资|基金|币圈|crypto|trade/i.test(name)) {
    const t = lookup('AI 商业');
    if (t) return { group_id: t.id, group_name: t.name, reason: '财经 / 投资' };
  }

  // 17. X / 推特相关
  if (/x boost|twitter|推特|x kol/i.test(name)) {
    const t = lookup('AIGC');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'X / 推特运营' };
  }

  // 18. 课程 / 训练营
  if (/课群|训练营|实训|训练|内训|课程|早鸟|2026共创|日历/i.test(name)) {
    const t = lookup('付费社区');
    if (t) return { group_id: t.id, group_name: t.name, reason: '课程 / 训练营' };
  }

  // 兜底：含 AI / Agent / Coding 关键词 → AI 圈社交
  if (/ai|agent|gpt|claude|llm|coding|开源/i.test(name)) {
    const t = lookup('AI 圈社交');
    if (t) return { group_id: t.id, group_name: t.name, reason: '通用 AI（兜底）' };
  }

  return null;
}

const ApplySchema = z.object({
  picks: z.array(
    z.object({
      chatroom_id: z.string().min(1),
      group_id: z.number().int().positive(),
    }),
  ),
});

export async function GET() {
  const sessions = await wxSessions(500);
  const groupSessions = sessions.filter((s) => s.is_group);
  const groups = listGroups();
  const tags = listAllTags();
  const tagged = new Map<string, number[]>();
  for (const t of tags) {
    const arr = tagged.get(t.chatroom_id) ?? [];
    arr.push(t.group_id);
    tagged.set(t.chatroom_id, arr);
  }

  const suggestions: Suggestion[] = groupSessions
    .filter((g) => !tagged.has(g.username))
    .slice(0, 200)
    .map((g) => {
      const guess = classifyHeuristic(g.chat, g.summary, groups);
      return {
        chatroom_id: g.username,
        name: g.chat,
        summary: g.summary,
        current_group_ids: tagged.get(g.username) ?? [],
        suggested_group_id: guess?.group_id ?? null,
        suggested_group_name: guess?.group_name ?? null,
        reason: guess?.reason ?? '未匹配到关键词',
      };
    });

  return NextResponse.json({ ok: true, groups, suggestions });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = ApplySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  for (const p of parsed.data.picks) {
    tagGroup(p.chatroom_id, p.group_id);
  }
  return NextResponse.json({ ok: true, applied: parsed.data.picks.length });
}
