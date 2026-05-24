'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

const COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#7dd3a8',
  '#10b981',
  '#06b6d4',
  '#0ea5e9',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
];

export default function NewGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setErr('分组名不能为空');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color, emoji: emoji.trim() || undefined }),
      });
      const j = await r.json();
      if (!j.ok) {
        setErr(j.error ?? '创建失败');
        setBusy(false);
        return;
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '未知错误');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card w-[400px] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-semibold">新建分组</div>
          <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text)]">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] text-[var(--text-3)]">分组名</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：AI · 编程"
              className="control-surface mt-1 w-full rounded-md px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-3)]">Emoji（可选）</label>
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="🤖"
              maxLength={4}
              className="control-surface mt-1 w-full rounded-md px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-3)]">颜色</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`size-6 rounded-full ring-2 transition-all ${
                    color === c ? 'ring-white' : 'ring-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          {err && <div className="text-[12px] text-[var(--danger)]">{err}</div>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
