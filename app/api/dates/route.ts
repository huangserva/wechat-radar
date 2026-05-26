import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = db()
    .prepare(
      `SELECT date, COUNT(*) AS count
       FROM messages
       GROUP BY date
       ORDER BY date DESC
       LIMIT 90`,
    )
    .all() as Array<{ date: string; count: number }>;

  return NextResponse.json({ ok: true, dates: rows });
}
