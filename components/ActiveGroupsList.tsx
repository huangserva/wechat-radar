import Link from 'next/link';
import { Flame } from 'lucide-react';

export interface ActiveGroup {
  chatroom_id: string;
  name: string;
  summary: string;
  total: number;
  top_senders: Array<{ sender: string; count: number }>;
}

export default function ActiveGroupsList({ groups }: { groups: ActiveGroup[] }) {
  const max = groups[0]?.total ?? 1;
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[14px] font-semibold">
          <Flame size={14} className="text-[var(--warn)]" />
          智能活跃群
        </div>
        <div className="text-[11px] text-[var(--text-3)]">
          去噪后 {groups.length} 个 · 综合排序
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="py-10 text-center text-[12px] text-[var(--text-3)]">
          暂无数据 · 点击「重扫」加载
        </div>
      ) : (
        <div className="space-y-1">
          {groups.slice(0, 12).map((g, i) => (
            <Row key={g.chatroom_id} group={g} rank={i + 1} max={max} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ group, rank, max }: { group: ActiveGroup; rank: number; max: number }) {
  const initial = group.name.slice(0, 2);
  const senders = group.top_senders
    .slice(0, 3)
    .map((s) => s.sender)
    .join(' · ');
  const pct = (group.total / max) * 100;

  return (
    <Link
      href={`/groups/${encodeURIComponent(group.chatroom_id)}`}
      className="grid grid-cols-[24px_36px_1fr_70px] items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-[var(--surface-2)]"
    >
      <span className="rounded bg-[var(--surface-2)] py-0.5 text-center text-[10px] tabular-nums text-[var(--text-3)]">
        {rank}
      </span>
      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] text-[11px] text-[var(--text-2)]">
        {initial}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] text-[var(--text)]">{group.name}</div>
        {senders && (
          <div className="truncate text-[11px] text-[var(--text-3)]">{senders}</div>
        )}
      </div>
      <div className="text-right">
        <div className="text-[14px] font-semibold tabular-nums text-[var(--text)]">
          {group.total.toLocaleString()}
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--accent)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </Link>
  );
}
