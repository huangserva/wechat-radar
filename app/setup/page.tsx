'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Database, ShieldCheck, UserRound, Wrench, KeyRound } from 'lucide-react';
import KeyExtractionStrategyCard, { type KeyExtractionState } from '@/components/KeyExtractionStrategyCard';

type DecryptCapability = {
  enabled?: boolean;
  venvReady?: boolean;
  keyFresh?: boolean | null;
  wecomKeyFresh?: boolean | null;
  needsSudo?: boolean;
  needsFullDiskAccess?: boolean;
  extractCommand?: string;
  scope?: 'personal' | 'wecom' | 'both';
  /** M8 Frida fallback strategy state (Track A lands the server-side fields). */
  keyExtraction?: KeyExtractionState;
};

type SetupStatus = {
  ok: boolean;
  dataDir: string;
  configured: boolean;
  suggestedNicknames?: string[];
  decrypt?: DecryptCapability;
  config: {
    myNicknames: string[];
    demoMode: boolean;
    privacyConfirmed: boolean;
    defaultSyncDays: number;
    wechatDataSource: 'db' | 'wx';
    wechatCollectorDb: string;
    wechatDecryptedDir: string;
  };
  checks: {
    wxInstalled: boolean;
    wxDaemonRunning: boolean;
    wxDaemonPid: number | null;
    collectorDb: string;
    decryptedDir: string;
  };
};

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [names, setNames] = useState('');
  const [demoMode, setDemoMode] = useState(false);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [defaultSyncDays, setDefaultSyncDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedNicknames, setSuggestedNicknames] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/setup', { cache: 'no-store' });
      const json = (await res.json()) as SetupStatus;
      const existingNames = sanitizeNicknames(json.config.myNicknames);
      const suggestions = sanitizeNicknames(json.suggestedNicknames ?? []);
      setStatus(json);
      setSuggestedNicknames(suggestions);
      setNames(existingNames.length > 0 ? existingNames.join(', ') : suggestions.join(', '));
      setDemoMode(false);
      setPrivacyConfirmed(json.config.privacyConfirmed);
      setDefaultSyncDays(json.config.defaultSyncDays ?? 7);
    })();
  }, []);

  async function submit() {
    const cleanNames = sanitizeNicknames(names.split(','));
    if (!demoMode && cleanNames.length === 0) {
      setError('请填写真实微信显示名，不能使用“你的微信名”占位符');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          myNicknames: cleanNames,
          demoMode,
          privacyConfirmed,
          defaultSyncDays,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '保存失败');
      window.location.href = '/';
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] px-6 py-8 text-[var(--text)]">
      <div className="mx-auto max-w-4xl">
        <div className="report-kicker">WeChat Radar Setup</div>
        <h1 className="mt-2 text-[28px] font-semibold">配置微信雷达</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-2)]">
          首次运行需要确认本地环境、填写你的微信名，并选择是否使用示例数据。所有数据默认保存在本机。
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="card p-5">
            <SectionTitle icon={<Wrench size={15} />} title="环境检查" />
            <CheckRow label="数据源" ok={status?.checks.wxInstalled ?? false} detail={status?.config.wechatDataSource === 'wx' ? 'wx-cli / wx-daemon' : '解密 DB adapter'} />
            <CheckRow label="读取状态" ok={status?.checks.wxDaemonRunning ?? false} detail={status?.checks.wxDaemonRunning ? '已检测到可读数据' : '未检测到数据，可先使用 demo 模式'} />
            <CheckRow label="collector.db" ok={status?.checks.wxInstalled ?? false} detail={status?.checks.collectorDb ?? '加载中'} />
            <CheckRow label="decrypted" ok={status?.checks.wxInstalled ?? false} detail={status?.checks.decryptedDir ?? '加载中'} />
            <CheckRow label="数据目录" ok detail={status?.dataDir ?? '加载中'} />
          </section>

          <section className="card p-5">
            <SectionTitle icon={<UserRound size={15} />} title="你的微信名" />
            <label className="mt-3 block text-[12px] text-[var(--text-3)]">多个名称用英文逗号分隔</label>
            <input
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder="张三, San Zhang, zhangsan"
              className="control-surface mt-2 w-full rounded-md px-3 py-2 text-[13px] outline-none"
            />
            <p className="mt-2 text-[11px] text-[var(--text-3)]">
              用于识别 @我的、自己相关讨论和提醒。{suggestedNicknames.length > 0 ? '已从本地微信身份预填，可修改。' : '不要填写“你的微信名”占位符。'}
            </p>
          </section>

          <section className="card p-5">
            <SectionTitle icon={<Database size={15} />} title="数据模式" />
            <label className="mt-4 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} />
              使用示例数据体验
            </label>
            <p className="mt-2 text-[11px] leading-5 text-[var(--text-3)]">
              未勾选时使用真实解密 DB 数据，并写入 demoMode=false。
            </p>
            <label className="mt-4 block text-[12px] text-[var(--text-3)]">首次同步天数</label>
            <select
              value={defaultSyncDays}
              onChange={(e) => setDefaultSyncDays(Number(e.target.value))}
              className="control-surface mt-2 rounded-md px-3 py-2 text-[13px] outline-none"
            >
              <option value={1}>最近 1 天</option>
              <option value={7}>最近 7 天</option>
              <option value={30}>最近 30 天</option>
              <option value={365}>最近 365 天</option>
            </select>
          </section>

          <section className="card p-5">
            <SectionTitle icon={<ShieldCheck size={15} />} title="隐私确认" />
            <label className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed">
              <input className="mt-1" type="checkbox" checked={privacyConfirmed} onChange={(e) => setPrivacyConfirmed(e.target.checked)} />
              <span>我理解聊天数据会存储在本地 SQLite 中，不会自动上传；我会自行确认数据读取和处理符合相关规则。</span>
            </label>
          </section>

          {status?.decrypt && status.decrypt.enabled !== undefined && (
            <section className="card p-5 lg:col-span-2">
              <SectionTitle icon={<KeyRound size={15} />} title="解密能力（密文 DB → 明文）" />
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-3)]">
                radar 只编排解密子进程，不代跑 sudo。密钥 json / 解密后 DB / venv
                均在本地、已 gitignore，不会入库。
              </p>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 lg:grid-cols-4">
                <CheckRow label="Python venv" ok={status.decrypt.venvReady ?? false} detail={status.decrypt.venvReady ? '就绪' : '未安装'} />
                <CheckRow label="个人微信密钥" ok={status.decrypt.keyFresh !== false} detail={keyFreshDetail(status.decrypt.keyFresh)} />
                <CheckRow label="企业微信密钥" ok={status.decrypt.wecomKeyFresh !== false} detail={keyFreshDetail(status.decrypt.wecomKeyFresh)} />
                <CheckRow label="Full Disk Access" ok={!status.decrypt.needsFullDiskAccess} detail={status.decrypt.needsFullDiskAccess ? '需授权' : '已授权'} />
              </div>
              {status.decrypt.needsSudo && status.decrypt.extractCommand && (
                <div className="mt-3 rounded-md border border-[var(--border-soft)] bg-[var(--chrome-bg)] px-3 py-2">
                  <div className="text-[11px] text-[var(--text-3)]">密钥提取需在终端手动运行（sudo + 微信在运行）：</div>
                  <code className="mt-1 block overflow-x-auto font-mono text-[11px] text-[var(--text-2)]">
                    {status.decrypt.extractCommand}
                  </code>
                </div>
              )}
            </section>
          )}

          {status?.decrypt?.enabled && status.decrypt.keyExtraction && (
            <KeyExtractionStrategyCard state={status.decrypt.keyExtraction} />
          )}
        </div>

        {error && <div className="mt-4 text-[13px] text-[var(--danger)]">{error}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn" onClick={() => window.location.href = '/'}>稍后再说</button>
          <button className="btn btn-primary" disabled={busy || !privacyConfirmed} onClick={submit}>
            {busy ? '保存中…' : '完成配置'}
          </button>
        </div>
      </div>
    </main>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--text)]">{icon}{title}</div>;
}

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
      <span className="text-[var(--text-2)]">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-right text-[12px] text-[var(--text-3)]">
        <CheckCircle2 size={13} className={ok ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'} />
        <span className="truncate">{detail}</span>
      </span>
    </div>
  );
}

function sanitizeNicknames(names: string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || isPlaceholderNickname(name) || seen.has(name)) continue;
    seen.add(name);
    clean.push(name);
  }
  return clean;
}

function isPlaceholderNickname(name: string): boolean {
  const normalized = name
    .trim()
    .replace(/[\s[\]【】()（）<>《》"'“”‘’]/g, '')
    .toLowerCase();
  return ['你的微信名', '微信名', 'yourwechatname', 'yourname'].includes(normalized);
}

function keyFreshDetail(fresh: boolean | null | undefined): string {
  if (fresh === null || fresh === undefined) return '未配置';
  return fresh ? '新鲜' : '已过期';
}
