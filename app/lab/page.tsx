'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import GlobalSearch from '@/components/GlobalSearch';
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronRight,
  Database,
  ExternalLink,
  FlaskConical,
  Gauge,
  HeartHandshake,
  History,
  Loader2,
  Lock,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  Sparkles,
  X,
  UserRound,
} from 'lucide-react';
import {
  LAB_MODE_TEMPLATES,
  LAB_DEFAULT_MODE,
  type LabAnalysisResult,
  type LabAnalyzeResponse,
  type LabDimensionTemplate,
  type LabEvidence,
  type LabMemberCandidate,
  type LabMode,
  type LabProvider,
  type LabReadResponse,
  type LabRunDetailResponse,
  type LabRunListItem,
  type LabRunsListResponse,
} from '@/lib/lab-types';

type Session = {
  chatroom_id: string;
  name: string;
  summary: string;
  time: string;
  timestamp: number;
  unread: number;
  is_favorite: boolean;
  group_ids: number[];
};

type SessionsResponse = {
  ok: boolean;
  groups: Session[];
  error?: string;
};

type LabConfigResponse = {
  ok: boolean;
  provider: LabProvider;
  model: string;
  prompt_version: string;
  use_profile_context_default: boolean;
  profile_available?: boolean;
  profile_source?: string;
  profile_updated_at?: string;
};

type MembersResponse = {
  ok: boolean;
  members?: LabMemberCandidate[];
  error?: string;
};

const modes = Object.values(LAB_MODE_TEMPLATES);

export default function LabPage() {
  const today = useMemo(() => localToday(), []);
  const [mode, setMode] = useState<LabMode>(LAB_DEFAULT_MODE);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState('');
  const [selectedChatroomId, setSelectedChatroomId] = useState('');
  const [members, setMembers] = useState<LabMemberCandidate[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<LabMemberCandidate | null>(null);
  const [targetDisplayName, setTargetDisplayName] = useState('');
  const [customDimensionInput, setCustomDimensionInput] = useState('');
  const [customDimensions, setCustomDimensions] = useState<string[]>([]);
  const [since, setSince] = useState(() => daysAgo(7));
  const [until, setUntil] = useState(today);
  const [readResult, setReadResult] = useState<LabReadResponse | null>(null);
  const [result, setResult] = useState<LabAnalysisResult | null>(null);
  const [config, setConfig] = useState<LabConfigResponse | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [reading, setReading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [useProfileContext, setUseProfileContext] = useState(false);
  const [pendingForce, setPendingForce] = useState(false);
  const [lastAnalyzeElapsedMs, setLastAnalyzeElapsedMs] = useState<number | null>(null);
  const [lastAnalyzeCached, setLastAnalyzeCached] = useState<boolean | null>(null);
  const [historyRuns, setHistoryRuns] = useState<LabRunListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<LabEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.chatroom_id === selectedChatroomId) ?? null,
    [selectedChatroomId, sessions],
  );

  const filteredSessions = useMemo(() => {
    const key = query.trim().toLowerCase();
    if (!key) return sessions.slice(0, 16);
    return sessions
      .filter(
        (session) =>
          session.name.toLowerCase().includes(key) ||
          session.summary.toLowerCase().includes(key) ||
          session.chatroom_id.toLowerCase().includes(key),
      )
      .slice(0, 16);
  }, [query, sessions]);

  const filteredMembers = useMemo(() => {
    const key = memberQuery.trim().toLowerCase();
    if (!key) return members.slice(0, 10);
    return members
      .filter((member) =>
        [member.username, member.nickname, member.remark, member.alias, member.display_name]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(key)),
      )
      .slice(0, 10);
  }, [memberQuery, members]);

  const rangeDays = useMemo(() => daysBetween(since, until), [since, until]);
  const currentTemplate = LAB_MODE_TEMPLATES[mode];
  const customDimensionLimit = Math.max(0, 8 - currentTemplate.dimensions.length);
  const activeCustomDimensions = useMemo(
    () => customDimensions.slice(0, customDimensionLimit),
    [customDimensions, customDimensionLimit],
  );
  const activeDimensions = useMemo<LabDimensionTemplate[]>(
    () => [
      ...currentTemplate.dimensions,
      ...activeCustomDimensions.map((name) => ({
        name,
        icon: 'Sparkles',
        description: '用户自定义检测维度',
        scoring_hint: '按对话证据给 0-100 定性分',
      })),
    ],
    [activeCustomDimensions, currentTemplate.dimensions],
  );
  const canRead = Boolean(selectedSession && targetDisplayName.trim() && since && until && rangeDays >= 0 && rangeDays <= 31);
  const blockedReasons = readResult?.blocked_reasons ?? [];
  const canAnalyze =
    Boolean(readResult?.analysis_allowed && readResult.messages?.length && config && !analyzing) &&
    blockedReasons.length === 0;
  const consentSampleCount = readResult?.compression_estimate?.sampled_count ?? Math.min(readResult?.filtered_count ?? readResult?.messages?.length ?? 0, 80);
  const consentTotalCount = readResult?.compression_estimate?.total_count ?? readResult?.filtered_count ?? readResult?.messages?.length ?? 0;

  const loadHistory = async () => {
    if (!selectedSession) {
      setHistoryRuns([]);
      setHistoryError(null);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const params = new URLSearchParams({
        chatroom_id: selectedSession.chatroom_id,
        mode,
        limit: '8',
      });
      const targetWxid = readResult?.target_resolution?.target_wxid ?? selectedMember?.username;
      if (targetWxid) params.set('target_wxid', targetWxid);
      if (targetDisplayName.trim()) params.set('target_display_name', targetDisplayName.trim());
      if (since) params.set('since', since);
      if (until) params.set('until', until);
      const resp = await fetch(`/api/lab/runs?${params.toString()}`, { cache: 'no-store' });
      const json = (await resp.json().catch(() => null)) as LabRunsListResponse | null;
      if (!resp.ok || !json?.ok) {
        throw new Error(json && !json.ok ? json.error : `/api/lab/runs 未就绪 (${resp.status})`);
      }
      setHistoryRuns(json.runs);
    } catch (e) {
      setHistoryRuns([]);
      setHistoryError(e instanceof Error ? e.message : '历史接口未就绪');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingSessions(true);
      try {
        const [sessionResp, configResp] = await Promise.all([
          fetch('/api/sessions', { cache: 'no-store' }),
          fetch('/api/lab/analyze', { cache: 'no-store' }),
        ]);
        const sessionJson = (await sessionResp.json()) as SessionsResponse;
        const configJson = (await configResp.json()) as LabConfigResponse;
        if (cancelled) return;
        if (sessionJson.ok) setSessions(sessionJson.groups ?? []);
        if (configJson.ok) {
          setConfig(configJson);
          setUseProfileContext(Boolean(configJson.use_profile_context_default));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSession) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/lab/members?chatroom_id=${encodeURIComponent(selectedSession.chatroom_id)}`, { cache: 'no-store' });
        if (!resp.ok) {
          if (!cancelled) setMembers([]);
          return;
        }
        const json = (await resp.json()) as MembersResponse;
        if (!cancelled) setMembers(json.members ?? []);
      } catch {
        if (!cancelled) setMembers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSession]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedSession) {
        if (!cancelled) setHistoryRuns([]);
        return;
      }
      await loadHistory();
    })();
    return () => {
      cancelled = true;
    };
    // History is a convenience panel; it should follow the current filter state.
  }, [selectedSession, selectedMember, targetDisplayName, mode, since, until]);

  const selectSession = (session: Session) => {
    setSelectedChatroomId(session.chatroom_id);
    setReadResult(null);
    setResult(null);
    setLastAnalyzeElapsedMs(null);
    setLastAnalyzeCached(null);
    setError(null);
  };

  const selectMember = (member: LabMemberCandidate) => {
    setSelectedMember(member);
    setMemberQuery(member.display_name);
    setTargetDisplayName(member.display_name);
    setReadResult(null);
    setResult(null);
    setLastAnalyzeElapsedMs(null);
    setLastAnalyzeCached(null);
  };

  const selectMode = (nextMode: LabMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setResult(null);
    setLastAnalyzeElapsedMs(null);
    setLastAnalyzeCached(null);
    setError(null);
  };

  const addCustomDimension = () => {
    const name = normalizeDimensionName(customDimensionInput);
    if (!name) return;
    const existing = new Set([
      ...currentTemplate.dimensions.map((dimension) => normalizeDimensionName(dimension.name)),
      ...customDimensions.map(normalizeDimensionName),
    ]);
    if (existing.has(name) || activeCustomDimensions.length >= customDimensionLimit) {
      setCustomDimensionInput('');
      return;
    }
    setCustomDimensions((items) => [...items, name]);
    setCustomDimensionInput('');
    setResult(null);
    setLastAnalyzeElapsedMs(null);
    setLastAnalyzeCached(null);
  };

  const removeCustomDimension = (name: string) => {
    setCustomDimensions((items) => items.filter((item) => item !== name));
    setResult(null);
    setLastAnalyzeElapsedMs(null);
    setLastAnalyzeCached(null);
  };

  const toggleProfileContext = (enabled: boolean) => {
    setUseProfileContext(enabled);
    setResult(null);
    setLastAnalyzeElapsedMs(null);
    setLastAnalyzeCached(null);
  };

  const readMessages = async () => {
    if (!selectedSession || !canRead) return;
    setReading(true);
    setReadResult(null);
    setResult(null);
    setError(null);
    try {
      const resp = await fetch('/api/lab/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          chatroom_id: selectedSession.chatroom_id,
          chat_name: selectedSession.name,
          target_wxid: selectedMember?.username,
          target_display_name: targetDisplayName.trim(),
          since,
          until,
        }),
      });
      const json = (await resp.json().catch(() => null)) as LabReadResponse | null;
      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error ?? `/api/lab/read 未就绪 (${resp.status})`);
      }
      setReadResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      setReading(false);
    }
  };

  const openConsent = (force = false) => {
    setPendingForce(force);
    setConsentAccepted(false);
    setShowConsent(true);
  };

  const runAnalyze = async (force = pendingForce) => {
    if (!selectedSession || !readResult?.messages?.length || !readResult.role_counts || !readResult.target_resolution || !readResult.source || !config) return;
    const startedAt = performance.now();
    setAnalyzing(true);
    setShowConsent(false);
    setLastAnalyzeElapsedMs(null);
    setLastAnalyzeCached(null);
    setError(null);
    try {
      const resp = await fetch('/api/lab/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          chatroom_id: selectedSession.chatroom_id,
          chat_name: selectedSession.name,
          target_wxid: readResult.target_resolution.target_wxid ?? selectedMember?.username,
          target_display_name: readResult.target_resolution.target_display_name || targetDisplayName.trim(),
          since,
          until,
          messages: readResult.messages,
          role_counts: readResult.role_counts,
          target_resolution: readResult.target_resolution,
          source: readResult.source,
          empty_reason: readResult.empty_reason ?? null,
          custom_dimensions: activeCustomDimensions,
          force,
          use_profile_context: useProfileContext,
          consent: {
            accepted: true,
            provider: config.provider,
            model: config.model,
            sampled_count: consentSampleCount,
            profile_context_used: useProfileContext,
            accepted_at: Date.now(),
          },
        }),
      });
      const json = (await resp.json().catch(() => null)) as LabAnalyzeResponse | null;
      if (!json) {
        throw new Error(`/api/lab/analyze 失败 (${resp.status})`);
      }
      if (!resp.ok || !json.ok) {
        throw new Error(json.ok ? `/api/lab/analyze 失败 (${resp.status})` : json.error);
      }
      setResult(json.result);
      setLastAnalyzeElapsedMs(Math.round(performance.now() - startedAt));
      setLastAnalyzeCached(json.cached);
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败');
    } finally {
      setAnalyzing(false);
      setPendingForce(false);
    }
  };

  const loadRunDetail = async (run: LabRunListItem) => {
    setHistoryLoading(true);
    setHistoryError(null);
    setError(null);
    try {
      const resp = await fetch(`/api/lab/runs?id=${run.id}`, { cache: 'no-store' });
      const json = (await resp.json().catch(() => null)) as LabRunDetailResponse | null;
      if (!resp.ok || !json?.ok) {
        throw new Error(json && !json.ok ? json.error : `/api/lab/runs?id=${run.id} 未就绪 (${resp.status})`);
      }
      setResult(json.result);
      setLastAnalyzeElapsedMs(null);
      setLastAnalyzeCached(true);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : '加载历史结果失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--border-soft)] bg-[var(--chrome-bg)] px-6 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="report-kicker">Conversation Lab</div>
            <div className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
              <FlaskConical size={16} className="text-[var(--accent)]" />
              <span>对话实验室 · 多模式 AI 沟通分析 · 微信读取</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]">
              {config ? `${config.provider} / ${config.model} · profile 可选` : '加载模型配置…'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <div className="control-surface hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-[var(--text-2)] xl:flex">
              <Database size={13} className="text-[var(--accent)]" />
              <span>解密 DB · 本地读取</span>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(420px,0.92fr)_minmax(560px,1.08fr)]">
          <section className="min-h-0 overflow-y-auto border-r border-[var(--border-soft)] px-5 py-4">
            <PanelTitle icon={<Brain size={15} />} title="分析输入" sub={`P1c · ${currentTemplate.label}`} />

            <div className="mt-4 grid grid-cols-1 gap-2 2xl:grid-cols-5">
              {modes.map((item) => {
                const active = item.mode === mode;
                return (
                  <button
                    key={item.mode}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                        : 'border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'
                    }`}
                    onClick={() => selectMode(item.mode)}
                    title={item.description}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold">{item.label}</span>
                      {active && <Check size={13} className="text-[var(--accent)]" />}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--text-3)]">{item.subtitle}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between">
                <Label icon={<MessageCircle size={13} />} text="聊天对象" />
                <span className="text-[10px] text-[var(--text-3)]">{loadingSessions ? '加载中' : `${sessions.length} 个群`}</span>
              </div>
              <div className="control-surface mt-2 flex items-center gap-2 rounded-md px-2.5 py-1.5">
                <Search size={13} className="text-[var(--text-3)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜群名 / 最近消息 / chatroom_id"
                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
                />
              </div>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {filteredSessions.map((session) => (
                  <button
                    key={session.chatroom_id}
                    className={`grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors ${
                      selectedChatroomId === session.chatroom_id
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-transparent hover:border-[var(--border-soft)] hover:bg-[var(--surface-2)]'
                    }`}
                    onClick={() => selectSession(session)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--text)]">{session.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--text-3)]">{session.summary || session.chatroom_id}</span>
                    </span>
                    <ChevronRight size={14} className="text-[var(--text-3)]" />
                  </button>
                ))}
                {!loadingSessions && filteredSessions.length === 0 && (
                  <div className="py-6 text-center text-[12px] text-[var(--text-3)]">没有匹配对象</div>
                )}
              </div>
            </div>

            <div className="mt-3 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-3">
              <Label icon={<UserRound size={13} />} text="角色 B" />
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr]">
                <input
                  value={memberQuery}
                  onChange={(e) => {
                    setMemberQuery(e.target.value);
                    setTargetDisplayName(e.target.value);
                    setSelectedMember(null);
                  }}
                  placeholder="昵称 / 备注 / wxid"
                  className="control-surface rounded-md px-2.5 py-2 text-[12px] outline-none"
                />
                <input
                  value={targetDisplayName}
                  onChange={(e) => setTargetDisplayName(e.target.value)}
                  placeholder="显示名"
                  className="control-surface rounded-md px-2.5 py-2 text-[12px] outline-none"
                />
              </div>
              <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
                {filteredMembers.map((member) => (
                  <button
                    key={member.username}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] ${
                      selectedMember?.username === member.username
                        ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                        : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                    }`}
                    onClick={() => selectMember(member)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{member.display_name}</span>
                      <span className="block truncate text-[10px] text-[var(--text-3)]">{member.username}</span>
                    </span>
                    {selectedMember?.username === member.username && <Check size={13} className="text-[var(--accent)]" />}
                  </button>
                ))}
                {selectedSession && members.length === 0 && (
                  <div className="rounded-md bg-[var(--surface-2)] px-2.5 py-2 text-[11px] text-[var(--text-3)]">
                    成员接口未返回候选时，可先填写 wxid 或唯一显示名。
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-3">
              <Label icon={<Gauge size={13} />} text="时间范围" />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                  className="theme-date-input control-surface rounded-md px-2.5 py-2 text-[12px] outline-none"
                />
                <input
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  className="theme-date-input control-surface rounded-md px-2.5 py-2 text-[12px] outline-none"
                />
              </div>
              <div className={`mt-2 text-[11px] ${rangeDays > 7 ? 'text-[var(--warn)]' : 'text-[var(--text-3)]'}`}>
                {rangeDays < 0
                  ? '结束日期不能早于开始日期'
                  : rangeDays > 31
                    ? '最多读取 31 天'
                    : rangeDays > 7
                      ? `${rangeDays} 天窗口会启用更强压缩，置信度会保守`
                      : `默认 7 天窗口 · 当前 ${rangeDays} 天`}
              </div>
            </div>

            <div className="mt-3 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between gap-2">
                <Label icon={<Sparkles size={13} />} text="检测维度" />
                <span className="text-[10px] text-[var(--text-3)]">
                  默认 {currentTemplate.dimensions.length} · 自定义 {activeCustomDimensions.length}/{customDimensionLimit}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {currentTemplate.dimensions.map((dimension) => (
                  <span key={dimension.name} className="signal-chip rounded px-2 py-1 text-[11px]">
                    {dimension.name}
                  </span>
                ))}
              </div>
              <div className="mt-3">
                <Label icon={<Plus size={13} />} text="自定义检测维度" />
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={customDimensionInput}
                    onChange={(e) => setCustomDimensionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomDimension();
                      }
                    }}
                    placeholder="边界尊重 / 回避承诺 / 情绪压迫"
                    className="control-surface min-w-0 flex-1 rounded-md px-2.5 py-2 text-[12px] outline-none"
                    maxLength={18}
                  />
                  <button
                    className="btn"
                    onClick={addCustomDimension}
                    disabled={!customDimensionInput.trim() || activeCustomDimensions.length >= customDimensionLimit}
                  >
                    <Plus size={13} />
                    <span>添加</span>
                  </button>
                </div>
                {activeCustomDimensions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeCustomDimensions.map((dimension) => (
                      <button
                        key={dimension}
                        className="signal-chip flex items-center gap-1 rounded px-2 py-1 text-[11px] hover:border-[var(--danger)] hover:text-[var(--danger)]"
                        onClick={() => removeCustomDimension(dimension)}
                        title="删除自定义维度"
                      >
                        <span>{dimension}</span>
                        <X size={11} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label icon={<UserRound size={13} />} text="Profile 背景" />
                  <div className="mt-1 text-[11px] leading-5 text-[var(--text-3)]">
                    仅用于理解 A 的表达风格，不作为 B 的事实或证据。
                    {config?.profile_available
                      ? ` 来源 ${config.profile_source}${config.profile_updated_at ? ` · ${config.profile_updated_at}` : ''}`
                      : ' 未找到画像时自动降级为空。'}
                  </div>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px] text-[var(--text-2)]">
                  <input
                    type="checkbox"
                    checked={useProfileContext}
                    onChange={(e) => toggleProfileContext(e.target.checked)}
                  />
                  <span>{useProfileContext ? '包含' : '不包含'}</span>
                </label>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                className="btn"
                onClick={readMessages}
                disabled={!canRead || reading}
                title="读取并预览 A/B 消息"
              >
                {reading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                <span>{reading ? '读取中…' : '读取记录'}</span>
              </button>
              <button
                className="btn btn-primary"
                onClick={() => openConsent(false)}
                disabled={!canAnalyze}
                title="开始 AI 分析"
              >
                {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                <span>{analyzing ? '分析中…' : '开始分析'}</span>
              </button>
            </div>

            <ReadStatus readResult={readResult} error={error} />
            <HistoryPanel
              runs={historyRuns}
              loading={historyLoading}
              error={historyError}
              onReload={loadHistory}
              onSelect={loadRunDetail}
            />
          </section>

          <section className="min-h-0 overflow-y-auto px-5 py-4">
            <ResultPanel
              result={result}
              dimensions={activeDimensions}
              provider={config?.provider}
              model={config?.model}
              analyzing={analyzing}
              canReanalyze={canAnalyze}
              lastElapsedMs={lastAnalyzeElapsedMs}
              lastCached={lastAnalyzeCached}
              onReanalyze={() => openConsent(true)}
              onEvidenceClick={setSelectedEvidence}
            />
          </section>
        </div>
      </main>

      {showConsent && config && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="w-full max-w-lg rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-[var(--accent-soft)] p-2 text-[var(--accent)]">
                <Lock size={18} />
              </div>
              <div>
                <div className="text-[15px] font-semibold">分析前确认</div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--text-2)]">
                  模式：{pendingForce ? '强制刷新，绕过缓存重新分析' : '可命中本地缓存'}
                  <br />
                  将发送：{consentSampleCount}/{consentTotalCount} 条消息片段
                  <br />
                  Provider / Model：{config.provider} / {config.model}
                  <br />
                  Profile：{useProfileContext ? `包含 Profile${config.profile_available ? '' : '（未找到画像时降级为空）'}` : '不包含'}
                  <br />
                  维度：{activeDimensions.map((dimension) => dimension.name).join('、')}
                  <br />
                  存储：结果写入本机 radar.db；原始解密数据不复制到外部存储
                </div>
              </div>
            </div>
            <label className="mt-4 flex items-start gap-2 rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2 text-[12px] leading-5">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-1"
              />
              <span>
                我理解点击分析会把上述消息片段发送给当前配置的 AI provider/model，并同意开始本次分析。
              </span>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" onClick={() => setShowConsent(false)}>
                取消
              </button>
              <button className="btn btn-primary" disabled={!consentAccepted || analyzing} onClick={() => runAnalyze(pendingForce)}>
                <Send size={14} />
                <span>{pendingForce ? '同意并重新分析' : '同意并分析'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {selectedEvidence && (
        <EvidenceModal evidence={selectedEvidence} onClose={() => setSelectedEvidence(null)} />
      )}
    </div>
  );
}

function ResultPanel({
  result,
  dimensions: expectedDimensions,
  provider,
  model,
  analyzing,
  canReanalyze,
  lastElapsedMs,
  lastCached,
  onReanalyze,
  onEvidenceClick,
}: {
  result: LabAnalysisResult | null;
  dimensions: LabDimensionTemplate[];
  provider?: LabProvider;
  model?: string;
  analyzing: boolean;
  canReanalyze: boolean;
  lastElapsedMs: number | null;
  lastCached: boolean | null;
  onReanalyze: () => void;
  onEvidenceClick: (evidence: LabEvidence) => void;
}) {
  const dimensions = result?.dimensions ?? expectedDimensions.map((d) => ({
    name: d.name,
    score: 0,
    level: '低' as const,
    basis: d.description,
    evidence_msg_ids: [],
    evidence: [],
  }));
  const highlights = result?.highlights ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <PanelTitle icon={<Sparkles size={15} />} title="分析结果" sub={result ? `${result.provider} / ${result.model}` : `${provider ?? 'provider'} / ${model ?? 'model'}`} />
        <button
          className="btn"
          onClick={onReanalyze}
          disabled={!canReanalyze || analyzing}
          title="绕过缓存，重新调用模型分析"
        >
          {analyzing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          <span>{analyzing ? '分析中…' : '重新分析'}</span>
        </button>
      </div>

      <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-2">
          <Label icon={<Brain size={13} />} text="模型读感" />
          {analyzing && <Loader2 size={14} className="animate-spin text-[var(--accent)]" />}
        </div>
        <div className="mt-3 text-[15px] leading-7 text-[var(--text)]">
          {result?.summary ?? '选择群聊、角色 B 和日期范围后开始分析。'}
        </div>
        <div className="mt-2 text-[12px] leading-5 text-[var(--text-3)]">
          {result?.model_reading ?? '结果会按定性评分展示，不作为客观判断。'}
        </div>
        {(lastElapsedMs !== null || lastCached !== null) && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--text-3)]">
            {lastElapsedMs !== null && <span>耗时 {formatDuration(lastElapsedMs)}</span>}
            {lastCached !== null && <span>{lastCached ? '历史/缓存复现' : '新分析结果'}</span>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="平均维度分" value={result?.avg_score ?? '--'} sub={result ? result.confidence : '等待分析'} icon={<Gauge size={14} />} />
        <MetricCard label="挖掘细节数" value={result?.detail_count ?? '--'} sub="details" icon={<Search size={14} />} />
        <MetricCard label="风险/提醒数" value={result?.risk_count ?? '--'} sub="backend recompute" icon={<AlertTriangle size={14} />} accent />
        <MetricCard label="最高信号" value={highlights[0]?.score ?? '--'} sub={highlights[0]?.label ?? 'Top signal'} icon={<Sparkles size={14} />} />
      </div>

      <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-4">
        <PanelTitle icon={<HeartHandshake size={15} />} title="维度评估" sub={`${dimensions.length} 个维度`} compact />
        <div className="mt-3 space-y-3">
          {dimensions.map((dimension) => (
            <div key={dimension.name} className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{dimension.name}</div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-3)]">{dimension.basis}</div>
                  <EvidenceList evidence={dimension.evidence} onClick={onEvidenceClick} />
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[20px] font-semibold tabular-nums">{result ? dimension.score : '--'}</div>
                  <div className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] ${levelClass(dimension.level)}`}>
                    {result ? dimension.level : '待评估'}
                  </div>
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-[var(--surface-3)]">
                <div
                  className="h-full rounded bg-[var(--accent)] transition-all"
                  style={{ width: `${result ? dimension.score : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-4">
        <PanelTitle icon={<Shield size={15} />} title="容易忽略的细节" sub={result ? `${result.details.length} 条` : '等待分析'} compact />
        {result?.details.length ? (
          <div className="mt-3 grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {result.details.map((detail, index) => (
              <div key={`${detail.title}-${index}`} className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-[13px] font-semibold">{detail.title}</div>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${severityClass(detail.severity)}`}>{detail.severity}</span>
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-3)]">{detail.category}</div>
                <div className="mt-2 text-[12px] leading-5 text-[var(--text-2)]">{detail.content}</div>
                <EvidenceList evidence={detail.evidence} onClick={onEvidenceClick} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-md bg-[var(--surface-2)] px-3 py-8 text-center text-[12px] text-[var(--text-3)]">
            读取并分析后显示细节卡。
          </div>
        )}
      </div>

      <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-3 text-[11px] leading-5 text-[var(--text-3)]">
        <div>本地读取/本地存储：消息从解密 DB 读取，分析结果写入本机 radar.db。</div>
        <div>点击分析会把所选消息片段发送给当前配置的 AI provider/model。分级是定性提示，不是客观评分。</div>
      </div>
    </div>
  );
}

function HistoryPanel({
  runs,
  loading,
  error,
  onReload,
  onSelect,
}: {
  runs: LabRunListItem[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onSelect: (run: LabRunListItem) => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between gap-2">
        <Label icon={<History size={13} />} text="历史分析" />
        <button className="btn px-2 py-1 text-[11px]" onClick={onReload} disabled={loading}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          <span>刷新</span>
        </button>
      </div>
      {error ? (
        <div className="mt-2 rounded-md bg-[var(--surface-2)] px-2.5 py-2 text-[11px] leading-5 text-[var(--text-3)]">
          {error}
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-2 rounded-md bg-[var(--surface-2)] px-2.5 py-4 text-center text-[11px] text-[var(--text-3)]">
          {loading ? '加载历史分析…' : '暂无历史 run'}
        </div>
      ) : (
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {runs.map((run) => (
            <button
              key={run.id}
              className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              onClick={() => onSelect(run)}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-[var(--text)]">
                  {run.target_display_name} · {run.avg_score} 分
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--text-3)]">
                  {run.since} ~ {run.until} · {run.model} · {formatTime(run.created_at)}
                </span>
              </span>
              <span className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">
                {run.confidence}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceList({
  evidence,
  onClick,
}: {
  evidence: LabEvidence[];
  onClick: (evidence: LabEvidence) => void;
}) {
  if (!evidence?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {evidence.slice(0, 5).map((item) => (
        <button
          key={`${item.chatroom_id}-${item.local_id}`}
          className="rounded border border-[var(--border-soft)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          onClick={() => onClick(item)}
          title={item.snippet}
        >
          #{item.local_id}
        </button>
      ))}
    </div>
  );
}

function EvidenceModal({ evidence, onClose }: { evidence: LabEvidence; onClose: () => void }) {
  const date = evidence.time.slice(0, 10);
  const href = `/groups/${encodeURIComponent(evidence.chatroom_id)}?date=${encodeURIComponent(date)}&local_id=${evidence.local_id}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
      <div className="w-full max-w-lg rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold">证据消息 #{evidence.local_id}</div>
            <div className="mt-1 text-[11px] text-[var(--text-3)]">
              {evidence.sender} · {evidence.time}
            </div>
          </div>
          <button className="rounded p-1 text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="mt-3 rounded-md bg-[var(--surface-2)] px-3 py-3 text-[13px] leading-6 text-[var(--text)]">
          {evidence.snippet || '无可展示片段'}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>关闭</button>
          <Link className="btn btn-primary" href={href}>
            <ExternalLink size={14} />
            <span>打开群详情</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function ReadStatus({ readResult, error }: { readResult: LabReadResponse | null; error: string | null }) {
  if (error) {
    return (
      <div className="mt-3 rounded-md border border-[var(--danger-soft)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)]">
        {error}
      </div>
    );
  }
  if (!readResult) return null;
  return (
    <div className="mt-3 rounded-md border border-[var(--border-soft)] bg-[var(--surface)] p-3">
      <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
        <MiniStat label="A" value={readResult.role_counts?.A ?? 0} />
        <MiniStat label="B" value={readResult.role_counts?.B ?? 0} />
        <MiniStat label="unknown" value={readResult.role_counts?.unknown ?? 0} />
        <MiniStat label="source" value={readResult.source ?? 'none'} />
      </div>
      {readResult.blocked_reasons?.length ? (
        <div className="mt-2 rounded bg-[var(--warn-soft)] px-2.5 py-2 text-[11px] leading-5 text-[var(--warn)]">
          {readResult.blocked_reasons.join('；')}
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-[var(--text-3)]">
          已读 {readResult.filtered_count ?? readResult.messages?.length ?? 0} 条 A/B 消息
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-2)]">
        <span className="flex items-center gap-1.5">
          <span className={accent ? 'text-[var(--warn)]' : 'text-[var(--accent)]'}>{icon}</span>
          {label}
        </span>
      </div>
      <div className={`mt-3 text-[26px] font-semibold tabular-nums ${accent ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}>{value}</div>
      <div className="mt-1 truncate text-[11px] text-[var(--text-3)]">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-[var(--surface-2)] px-2 py-2">
      <div className="truncate text-[10px] text-[var(--text-3)]">{label}</div>
      <div className="mt-1 truncate text-[12px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PanelTitle({
  icon,
  title,
  sub,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[var(--accent)]">{icon}</span>
        <span className={compact ? 'text-[13px] font-semibold' : 'text-[15px] font-semibold'}>{title}</span>
      </div>
      {sub && <span className="text-[11px] text-[var(--text-3)]">{sub}</span>}
    </div>
  );
}

function Label({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text)]">
      <span className="text-[var(--accent)]">{icon}</span>
      {text}
    </div>
  );
}

function levelClass(level: string) {
  if (level === '高') return 'bg-[var(--accent-soft)] text-[var(--accent)]';
  if (level === '中') return 'bg-[var(--warn-soft)] text-[var(--warn)]';
  return 'bg-[var(--surface-3)] text-[var(--text-3)]';
}

function severityClass(severity: string) {
  if (severity === '风险') return 'bg-[var(--danger-soft)] text-[var(--danger)]';
  if (severity === '提醒') return 'bg-[var(--warn-soft)] text-[var(--warn)]';
  return 'bg-[var(--accent-soft)] text-[var(--accent)]';
}

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(since: string, until: string): number {
  const start = new Date(`${since}T00:00:00`).getTime();
  const end = new Date(`${until}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

function normalizeDimensionName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 18);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds - minutes * 60).toFixed(0)}s`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}-${day} ${hh}:${mm}`;
}
