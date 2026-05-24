export type RangeKey = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

const RANGE_KEYS = new Set<RangeKey>(['day', 'week', 'month', 'quarter', 'year', 'custom']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isRangeKey(value: string | null | undefined): value is RangeKey {
  return !!value && RANGE_KEYS.has(value as RangeKey);
}

export function normalizeRangeKey(value: string | null | undefined, fallback: RangeKey): RangeKey {
  return isRangeKey(value) ? value : fallback;
}

export function normalizeDate(value: string | null | undefined, fallback = todayStr()): string {
  if (!value || !DATE_RE.test(value)) return fallback;
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return fallback;
  return ymd(d) === value ? value : fallback;
}

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return ymd(new Date());
}

export function daysBefore(n: number, anchor = todayStr()): string {
  const [year, month, day] = normalizeDate(anchor).split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() - n);
  return ymd(d);
}

export function rangeToWindow(range: RangeKey, anchorDate = todayStr()): { since: string; until: string; days: number } {
  const until = normalizeDate(anchorDate);
  const map: Record<Exclude<RangeKey, 'custom'>, number> = {
    day: 0,
    week: 6,
    month: 29,
    quarter: 89,
    year: 364,
  };
  if (range === 'custom') {
    return { since: daysBefore(6, until), until, days: 7 };
  }
  const span = map[range];
  return { since: daysBefore(span, until), until, days: span + 1 };
}

export function dateList(since: string, until: string): string[] {
  const out: string[] = [];
  const start = new Date(since);
  const end = new Date(until);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}
