import { NextResponse } from 'next/server';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const dynamic = 'force-dynamic';

interface DayStats {
  date: string;
  preference_count: number;
  writing_samples_count: number;
  category_counts: Record<string, number>;
}

export async function GET() {
  try {
    const dir = join(homedir(), 'wechat-assistant', 'preferences');
    if (!existsSync(dir)) {
      return NextResponse.json({ ok: true, available: false, days: [], totals: { preferences: 0, writing_samples: 0, categories: {} }, total_days: 0 });
    }

    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    const days: DayStats[] = [];
    const categories: Record<string, number> = {};
    let totalPrefs = 0;
    let totalWriting = 0;

    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as {
          date?: string;
          preferences?: unknown[];
          writing_samples?: unknown[];
          stats?: { preference_count?: number; writing_samples_count?: number; category_counts?: Record<string, number> };
        };
        const date = raw.date ?? file.replace('.json', '');
        const prefs = raw.stats?.preference_count ?? raw.preferences?.length ?? 0;
        const writing = raw.stats?.writing_samples_count ?? raw.writing_samples?.length ?? 0;
        const cats = raw.stats?.category_counts ?? {};

        days.push({ date, preference_count: prefs, writing_samples_count: writing, category_counts: cats });
        totalPrefs += prefs;
        totalWriting += writing;
        for (const [k, v] of Object.entries(cats)) {
          categories[k] = (categories[k] ?? 0) + v;
        }
      } catch {
        // skip malformed file
      }
    }

    return NextResponse.json({
      ok: true,
      available: days.length > 0,
      days: days.sort((a, b) => b.date.localeCompare(a.date)),
      totals: { preferences: totalPrefs, writing_samples: totalWriting, categories },
      total_days: days.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    console.error('/api/profile/materials failed', e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
