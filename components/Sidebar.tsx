'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Star,
  Folder,
  Inbox,
  LayoutDashboard,
  Sparkles,
  Link2,
  FlaskConical,
  CheckSquare,
  BookOpen,
  Flame,
  Users,
  CalendarClock,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

type Category = {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
  member_count?: number;
};

type SidebarData = {
  ok: boolean;
  total: number;
  categories: Category[];
};

type DaemonStatus = {
  ok: boolean;
  running: boolean;
  pid?: number;
};

export default function Sidebar() {
  const pathname = usePathname();
  const [data, setData] = useState<SidebarData | null>(null);
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);
  const [unsorted, setUnsorted] = useState(0);
  const [favorites, setFavorites] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/sessions');
        const j = await r.json();
        setData(j);
      } catch {}
      try {
        const r = await fetch('/api/stats?range=week');
        const j = await r.json();
        if (j.ok && j.sidebar_counts) {
          setUnsorted(j.sidebar_counts.unsorted);
          setFavorites(j.sidebar_counts.favorites);
        }
      } catch {}
      try {
        const r = await fetch('/api/daemon');
        const j = await r.json();
        setDaemon(j);
      } catch {}
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="flex h-screen w-[236px] shrink-0 flex-col border-r border-[var(--border-soft)] bg-[var(--sidebar-bg)] backdrop-blur">
      <div className="border-b border-[var(--border-soft)] px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="min-w-0">
            <div className="report-kicker">Qiaomu Radar</div>
            <div className="mt-1 text-[15px] font-semibold tracking-wide text-[var(--text)]">
              微信群聊情报
            </div>
          </Link>
          <ThemeToggle />
        </div>
        <div className="mt-2 text-[11px] text-[var(--text-3)]">私有看板 · 高信号优先</div>
      </div>

      <nav className="px-2 pb-2 pt-3">
        <NavItem
          href="/"
          icon={<LayoutDashboard size={15} />}
          label="看板"
          badge="Brief"
          active={pathname === '/'}
        />
        <NavItem
          href="/topics"
          icon={<Sparkles size={15} />}
          label="话题雷达"
          badge="Cross"
          active={pathname === '/topics'}
        />
        <NavItem
          href="/hotspots"
          icon={<Flame size={15} />}
          label="热点信号"
          badge="Hot"
          active={pathname === '/hotspots'}
        />
        <NavItem
          href="/links"
          icon={<Link2 size={15} />}
          label="链接情报"
          badge="Link"
          active={pathname === '/links'}
        />
        <NavItem
          href="/commitments"
          icon={<CheckSquare size={15} />}
          label="承诺追踪"
          badge="Due"
          active={pathname === '/commitments'}
        />
        <NavItem
          href="/people"
          icon={<Users size={15} />}
          label="人物驾驶舱"
          badge="Top"
          active={pathname === '/people'}
        />
        <NavItem
          href="/knowledge"
          icon={<BookOpen size={15} />}
          label="知识库"
          badge="KB"
          active={pathname === '/knowledge'}
        />
        <NavItem
          href="/reviews"
          icon={<CalendarClock size={15} />}
          label="复盘"
          badge="Week"
          active={pathname === '/reviews'}
        />
        <NavItem
          href="/lab"
          icon={<FlaskConical size={15} />}
          label="对话实验室"
          badge="AI"
          active={pathname === '/lab'}
        />
      </nav>

      <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
        Groups
      </div>
      <nav className="px-2">
        <NavItem href="/groups" icon={<Inbox size={15} />} label="所有群" count={data?.total} />
        <NavItem href="/groups?filter=favorites" icon={<Star size={15} />} label="收藏" count={favorites} />
        <NavItem
          href="/groups?filter=unsorted"
          icon={<Folder size={15} />}
          label="未分组"
          count={unsorted}
        />
      </nav>

      <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
        Collections
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {(data?.categories ?? []).map((c) => (
          <CategoryItem key={c.id} category={c} />
        ))}
      </div>

      <div className="border-t border-[var(--border-soft)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        {daemon?.running ? (
          <span>
            <span className="inline-block size-2 rounded-full bg-[var(--accent)] mr-1.5 align-middle" />
            解密 DB 可读 / 数据源在线
          </span>
        ) : (
          <span>
            <span className="inline-block size-2 rounded-full bg-[var(--danger)] mr-1.5 align-middle" />
            数据源不可读
          </span>
        )}
      </div>
    </aside>
  );
}

function NavItem({
  href,
  icon,
  label,
  badge,
  count,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
        active
          ? 'bg-[var(--accent-soft)] text-[var(--text)]'
          : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
      }`}
    >
      {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--accent)]" />}
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {badge && (
        <span className="signal-chip rounded px-1.5 py-0.5 text-[10px] font-medium">
          {badge}
        </span>
      )}
      {count !== undefined && (
        <span className="text-[11px] text-[var(--text-3)] tabular-nums">{count}</span>
      )}
    </Link>
  );
}

function CategoryItem({ category }: { category: Category }) {
  return (
    <Link
      href={`/groups?filter=group&group_id=${category.id}`}
      className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
    >
      <span className="flex items-center gap-2 truncate">
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: category.color }}
        />
        <span className="truncate">
          {category.emoji ? `${category.emoji} ` : ''}
          {category.name}
        </span>
      </span>
      <span className="text-[11px] text-[var(--text-3)] tabular-nums">
        {category.member_count ?? 0}
      </span>
    </Link>
  );
}
