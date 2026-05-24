import type { GroupRow } from './groups';

export function classifyGroupHeuristic(name: string, summary: string, groups: GroupRow[]) {
  const text = `${name} ${summary}`.toLowerCase();
  const lookup = (target: string) => groups.find((g) => g.name.toLowerCase().includes(target.toLowerCase()));

  if (/vibe.?coding|coding|代码|编程|developer|dev|cli|mcp|skills?|github|开源|agent|gpt|claude|llm/i.test(text)) {
    const t = lookup('AI / Coding');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'AI / Coding keywords' };
  }
  if (/工具|产品|插件|内测|api|chrome|notion|obsidian|飞书|workflow|workspace|效率/i.test(text)) {
    const t = lookup('Tools');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'Tools / product keywords' };
  }
  if (/文章|公众号|日报|newsletter|读者|知识库|教程|报告|访谈|paper|论文/i.test(text)) {
    const t = lookup('Articles');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'Articles / knowledge keywords' };
  }
  if (/商业|营销|增长|seo|geo|销售|客户|采购|团购|合作|商务|创业|投资/i.test(text)) {
    const t = lookup('Business');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'Business keywords' };
  }
  if (/活动|报名|直播|大会|线下|分享会|训练营|课程|会议|meetup|workshop/i.test(text)) {
    const t = lookup('Events');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'Event keywords' };
  }
  if (/研究|学术|论文|paper|模型|实验|benchmark|评测/i.test(text)) {
    const t = lookup('Research');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'Research keywords' };
  }
  if (/生活|阅读|运动|小区|邻里|钓鱼|健身|跑步|英语|校友|投资主题/i.test(text)) {
    const t = lookup('Lifestyle');
    if (t) return { group_id: t.id, group_name: t.name, reason: 'Lifestyle keywords' };
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
