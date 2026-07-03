'use client';

import { useState } from 'react';
import { AlertTriangle, Copy, Check, KeyRound } from 'lucide-react';

/**
 * Red banner shown when the WeChat decryption key has expired (微信重启后密钥失效).
 * Consumes the `decrypt_key_expired` SSE signal that Track A emits from the rescan
 * route. Offers a one-click copy of the privileged key-extraction command the user
 * must run manually in a terminal (方案 A: radar guides, never runs sudo itself).
 *
 * Privacy: only the key-scanner command path is rendered — no keys, phone numbers,
 * or decrypted content ever appear here.
 */
export default function KeyExpiredBanner({
  command,
  scope = 'personal',
  onDismiss,
}: {
  command: string;
  scope?: 'personal' | 'wecom' | 'both';
  onDismiss?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const label =
    scope === 'both'
      ? '微信 + 企业微信解密密钥均已失效'
      : scope === 'wecom'
        ? '企业微信解密密钥已失效'
        : '微信解密密钥已失效';

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be blocked; user can still select-copy the <code> text
    }
  }

  return (
    <div
      className="flex items-start gap-3 border-b px-6 py-2.5 text-[12px]"
      style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}
      role="alert"
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--danger)]" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[var(--danger)]">{label}</div>
        <div className="mt-0.5 leading-relaxed text-[var(--text-2)]">
          微信/企业微信重启后旧密钥失效，需在终端重新提取（需 sudo + 微信在运行）。radar
          不会自动执行特权操作，复制下方命令手动运行：
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-[var(--chrome-bg)] px-2 py-1 font-mono text-[11px] text-[var(--text-2)]">
            {command}
          </code>
          <button className="btn shrink-0" onClick={copy} title="复制提取命令">
            {copied ? <Check size={12} className="text-[var(--accent)]" /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      </div>
      {onDismiss && (
        <button
          className="shrink-0 text-[var(--text-3)] hover:text-[var(--text)]"
          onClick={onDismiss}
          title="稍后处理"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function DecryptStatusPill({
  state,
}: {
  state: 'idle' | 'running' | 'expired' | 'unavailable';
}) {
  if (state === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--warn)]">
        <KeyRound size={11} className="animate-pulse" />
        解密刷新中…
      </span>
    );
  }
  if (state === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--danger)]">
        <KeyRound size={11} />
        密钥过期
      </span>
    );
  }
  if (state === 'unavailable') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]">
        <KeyRound size={11} />
        解密未配置
      </span>
    );
  }
  return null;
}
