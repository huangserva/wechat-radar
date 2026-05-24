import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createGroup, deleteGroup, listGroups } from '@/lib/groups';

export const dynamic = 'force-dynamic';

const CreateSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  emoji: z.string().max(8).optional(),
});

export async function GET() {
  return NextResponse.json({ ok: true, groups: listGroups() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  try {
    const id = createGroup(parsed.data);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  deleteGroup(id);
  return NextResponse.json({ ok: true });
}
