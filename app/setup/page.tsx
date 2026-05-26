'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Database, ShieldCheck, UserRound, Wrench } from 'lucide-react';

type SetupStatus = {
  ok: boolean;
  dataDir: string;
  configured: boolean;
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

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/setup', { cache: 'no-store' });
      const json = (await res.json()) as SetupStatus;
      setStatus(json);
      setNames(json.config.myNicknames.join(', '));
      setDemoMode(json.config.demoMode);
      setPrivacyConfirmed(json.config.privacyConfirmed);
      setDefaultSyncDays(json.config.defaultSyncDays ?? 7);
    })();
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          myNicknames: names.split(',').map((name) => name.trim()).filter(Boolean),
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
            <p className="mt-2 text-[11px] text-[var(--text-3)]">用于识别 @我的、自己相关讨论和提醒。</p>
          </section>

          <section className="card p-5">
            <SectionTitle icon={<Database size={15} />} title="数据模式" />
            <label className="mt-4 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} />
              使用示例数据体验
            </label>
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
