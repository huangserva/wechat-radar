import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { wxSessions } from '@/lib/wx';
import { listGroups, listAllTags, tagGroup } from '@/lib/groups';
import { classifyGroupHeuristic } from '@/lib/group-classifier';

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
      const guess = classifyGroupHeuristic(g.chat, g.summary, groups);
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
