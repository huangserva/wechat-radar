import type { GroupRow } from './groups';

export function classifyGroupHeuristic(name: string, summary: string, groups: GroupRow[]) {
  const text = `${name} ${summary}`.toLowerCase();
  const lookup = (target: string) => groups.find((g) => g.name.includes(target));

  if (/蝗虫团|huangchong/i.test(name)) {
    const t = lookup('蝗虫');
    if (t) return { group_id: t.id, group_name: t.name, reason: '蝗虫团系列' };
  }
  if (/自营|公众号读者|读者群|用户群|粉丝群/i.test(name)) {
    const t = lookup('自营/读者群');
    if (t) return { group_id: t.id, group_name: t.name, reason: '自营 / 读者群' };
  }
  if (/waytoagi|通往agi|通往ai|通往 ai/i.test(name)) {
    const t = lookup('WaytoAGI');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'WaytoAGI 系列' };
  }
  if (/howoneai|howone/i.test(name)) {
    const t = lookup('HowOneAI');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'HowOneAI 系列' };
  }
  if (
    /vibe.?coding|vibecoding|vibe first|cherry studio|cli|claude.?skills|clawdbot|codepilot|mcp|cola|geoflow|refly|camel|eigent|thinkinai|skills|all in cli/i.test(
      text,
    )
  ) {
    const t = lookup('Vibe Coding');
    if (t) return { group_id: t.id, group_name: t.name, reason: '编程 / Skills / CLI' };
  }
  if (/学术|论文|paper|未来硅世界|研究室|nixy|simonlin|博文视点|knowledge|灵枭/i.test(text)) {
    const t = lookup('AI 学术');
    if (t) return { group_id: t.id, group_name: t.name, reason: '学术 / 论文' };
  }
  if (/seo|geo|商业化|营销|kol|gaidn|adg|vip|生财|appsail|tutti|商业|broker|出版|收付款|社交新品|社群/i.test(text)) {
    const t = lookup('AI 商业');
    if (t) return { group_id: t.id, group_name: t.name, reason: '商业 / 营销 / KOL' };
  }
  if (/aigc|图|视频|音乐|spy|拍我ai|ai媒体|ai音视频|创意|graceful|创作|graphic|listenhub|notetomp|youmind|短视频|video|music|illustrat/i.test(text)) {
    const t = lookup('AIGC');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'AIGC / 内容创作' };
  }
  if (/vip|烟花|修饼|传术师|生财有术|兔子ai|ai领导力|早鸟|内测|种子用户|订阅用户|私董|学员|api 渠道|一人公司|训练营|课程/i.test(text)) {
    const t = lookup('付费社区');
    if (t) return { group_id: t.id, group_name: t.name, reason: '付费 / 内测 / VIP' };
  }
  if (/用户群|用户中文|内测群|jackywine|mindcode|remio|cherry|camel|refly|cola|geoflow|hosi|aigocode|appsail|tutti|api/i.test(text)) {
    const t = lookup('AI 工具用户群');
    if (t) return { group_id: t.id, group_name: t.name, reason: '工具用户群' };
  }
  if (/神的孩子|明人明言|先行者|agi bar|智能体成精|life hacker|超级玩家|未来趋势|agent橘|新物种|创造营|不息为体|未知书社|新互联网/i.test(text)) {
    const t = lookup('AI 圈社交');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'AI 圈社交' };
  }
  if (/donews|何夕|辛亥|对接群|百度世界|央馆|火山方舟|43talks|tgo|商务|媒体/i.test(text)) {
    const t = lookup('大佬');
    if (t) return { group_id: t.id, group_name: t.name, reason: '大佬 / 媒体圈' };
  }
  if (/活动现场|聚餐|筹备组|聚会|开播|直播|线下|大会|分享会|黑客松|日历/i.test(text)) {
    const t = lookup('行业活动');
    if (t) return { group_id: t.id, group_name: t.name, reason: '一次性活动群' };
  }
  if (/钓友|路亚|果粉|大家庭|班级|邻里|小区|羽毛球|健身|跑步|徒步|阅读|共读|英语|校友|歌友|篮球/i.test(text)) {
    const t = lookup('生活');
    if (t) return { group_id: t.id, group_name: t.name, reason: '生活 / 兴趣' };
  }
  if (/粉丝|fans|读者/i.test(text)) {
    const t = lookup('AI 圈社交');
    if (t) return { group_id: t.id, group_name: t.name, reason: '粉丝团 / 读者群' };
  }
  if (/财经|股票|投资|基金|币圈|crypto|trade/i.test(text)) {
    const t = lookup('AI 商业');
    if (t) return { group_id: t.id, group_name: t.name, reason: '财经 / 投资' };
  }
  if (/x boost|twitter|推特|x kol/i.test(text)) {
    const t = lookup('AIGC');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'X / 推特运营' };
  }
  if (/ai|agent|gpt|claude|llm|coding|开源/i.test(text)) {
    const t = lookup('AI 圈社交');
    if (t) return { group_id: t.id, group_name: t.name, reason: '通用 AI（兜底）' };
  }
  return null;
}

export function effectiveGroupIds(
  name: string,
  summary: string,
  explicitIds: number[],
  groups: GroupRow[],
): number[] {
  if (explicitIds.length > 0) return explicitIds;
  const guess = classifyGroupHeuristic(name, summary, groups);
  return guess ? [guess.group_id] : [];
}
