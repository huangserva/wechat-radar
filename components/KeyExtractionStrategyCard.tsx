'use client';

import { useState } from 'react';
import { KeyRound, Copy, Check, Cpu, Anchor, Link2, ShieldAlert } from 'lucide-react';

/**
 * M8 · Key-extraction strategy card for the setup page.
 *
 * Consumes the real strategy chain from `lib/decrypt.ts` `keyExtractStrategies()`
 * (landed by Track A): memory-scan → Frida fallback → match-keys. Each strategy
 * carries its own `when` / `prerequisites` / `command`. The card highlights the
 * active step based on `needsFridaFallback` (null=not scanned, true=0 keys→Frida,
 * false=keys present) and surfaces a copyable command + prerequisite checklist.
 *
 * 方案 A: radar only generates commands + checklist — it NEVER runs sudo / attach
 * / resign. Privacy: only command paths + checklist state rendered; no keys,
 * phone numbers, or decrypted content.
 */
export type KeyExtractStrategy = {
  id: 'memory-scan' | 'frida-fallback' | 'match-keys';
  label: string;
  command: string;
  when: string;
  prerequisites: string[];
};

export type KeyExtractionState = {
  /** Ordered strategy chain from keyExtractStrategies(). */
  strategies?: KeyExtractStrategy[];
  /** null=scan not run; true=ran but 0 keys (offer Frida); false=keys present. */
  needsFridaFallback?: { personal: boolean | null; wecom: boolean | null } | boolean | null;
  /** Both frida hook JS + driver script present. */
  fridaAvailable?: boolean;
};

function readFallback(state: KeyExtractionState): { personal: boolean | null; wecom: boolean | null } {
  const nf = state.needsFridaFallback;
  if (nf && typeof nf === 'object') return nf;
  const v = typeof nf === 'boolean' ? nf : null;
  return { personal: v, wecom: null };
}

export default function KeyExtractionStrategyCard({ state }: { state: KeyExtractionState }) {
  const fallback = readFallback(state);
  const strategies = state.strategies ?? [];
  const showFrida = fallback.personal === true;

  return (
    <section className="card p-5 lg:col-span-2">
      <div className="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--text)]">
        <KeyRound size={15} />
        密钥提取策略
        {showFrida && (
          <span
            className="ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
          >
            内存扫描 0 key · Frida 兜底
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-3)]">
        两级策略：①内存特征扫描（快、免 attach）→ ②Frida 动态插桩兜底（版本升级致内存布局变时仍能截获密钥）。
        radar 只生成命令 + 检查清单，绝不代跑 sudo / attach / 重签。
      </p>

      {strategies.length === 0 ? (
        <div className="mt-3 rounded-md border border-[var(--border-soft)] bg-[var(--chrome-bg)] px-3 py-2 text-[11px] text-[var(--text-3)]">
          策略链待 Track A 骨架就绪后生成。
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {strategies.map((s, i) => (
            <StrategyRow key={s.id} index={i + 1} strategy={s} active={activeFor(s.id, showFrida)} fridaAvailable={state.fridaAvailable} />
          ))}
        </div>
      )}

      {fallback.wecom === true && (
        <div className="mt-2 text-[11px]" style={{ color: 'var(--warn)' }}>
          ⚠ 企业微信密钥也需 Frida 兜底（内存扫描 0 key）。
        </div>
      )}
    </section>
  );
}

function activeFor(id: string, showFrida: boolean): boolean {
  if (id === 'memory-scan') return true;
  if (id === 'frida-fallback') return showFrida;
  if (id === 'match-keys') return showFrida;
  return false;
}

function StrategyRow({
  index,
  strategy,
  active,
  fridaAvailable,
}: {
  index: number;
  strategy: KeyExtractStrategy;
  active: boolean;
  fridaAvailable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const icon =
    strategy.id === 'memory-scan' ? <Cpu size={13} /> : strategy.id === 'frida-fallback' ? <Anchor size={13} /> : <Link2 size={13} />;

  const tone = !active
    ? { cls: 'text-[var(--text-3)]', color: 'var(--text-3)', label: '待命' }
    : strategy.id === 'frida-fallback' && fridaAvailable === false
      ? { cls: 'text-[var(--danger)]', color: 'var(--danger)', label: '未安装' }
      : { cls: 'text-[var(--accent)]', color: 'var(--accent)', label: '就绪' };

  async function copy() {
    try {
      await navigator.clipboard.writeText(strategy.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked; user can select-copy the <code> text
    }
  }

  return (
    <div
      className="rounded-md border px-3 py-2.5 text-[12px]"
      style={{
        borderColor: active && strategy.id === 'frida-fallback' ? 'var(--warn)' : 'var(--border-soft)',
        background: active && strategy.id === 'frida-fallback' ? 'var(--warn-soft)' : 'var(--chrome-bg)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-[var(--text-3)]">{index}.</span>
        <span className={tone.cls}>{icon}</span>
        <span className="font-medium text-[var(--text)]">{strategy.label}</span>
        <span className="ml-auto text-[11px]" style={{ color: tone.color }}>
          {tone.label}
        </span>
      </div>
      {!active && <div className="mt-1 text-[11px] text-[var(--text-3)]">{strategy.when}</div>}

      {active && (
        <>
          <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-2)]">{strategy.when}</div>

          {strategy.prerequisites.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {strategy.prerequisites.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-[11px] text-[var(--text-3)]">
                  <ShieldAlert size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} />
                  {p}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1.5 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-[var(--bg)] px-2 py-1 font-mono text-[11px] text-[var(--text-2)]">
              {strategy.command}
            </code>
            <button className="btn shrink-0" onClick={copy} title="复制命令">
              {copied ? <Check size={12} className="text-[var(--accent)]" /> : <Copy size={12} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
