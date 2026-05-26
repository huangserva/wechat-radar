import { NextRequest, NextResponse } from 'next/server';
import { todayStr } from '@/lib/range';
import { db } from '@/lib/db';
import { listMessagesForDate, getSyncState, listAllSyncedDates } from '@/lib/messages-store';
import { wxHistoryWithMeta, wxSessions } from '@/lib/wx';
import type { WxSource, WxEmptyReason } from '@/lib/wx-types';

export const dynamic = 'force-dynamic';

interface DailyHistoryRow {
  date: string;
  total: number;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const chatroomId = decodeURIComponent(id);
  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? todayStr();
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 5000);

  // 拉群名（从 wx sessions）
  let chatName = chatroomId;
  try {
    const sessions = await wxSessions(500);
    const found = sessions.find((s) => s.username === chatroomId);
    if (found) chatName = found.chat;
  } catch {}

  // 当日消息：先查本地 radar.db，空了再走 collector→raw fallback
  let messages = listMessagesForDate(chatroomId, date, limit);
  let source: WxSource = 'local';
  let emptyReason: WxEmptyReason = messages.length > 0 ? null : 'no_match';
  if (messages.length === 0) {
    try {
      const live = await wxHistoryWithMeta(chatroomId, date, date, limit);
      messages = live.data.map((m) => ({ ...m, chatroom_id: chatroomId, date }));
      source = live.source;
      emptyReason = live.empty_reason;
    } catch {}
  }

  // 当日聚合统计
  const total = messages.length;
  const senderMap = new Map<string, number>();
  const typeMap = new Map<string, number>();
  const hours = new Array(24).fill(0) as number[];
  for (const m of messages) {
    senderMap.set(m.sender, (senderMap.get(m.sender) ?? 0) + 1);
    typeMap.set(m.type, (typeMap.get(m.type) ?? 0) + 1);
    if (m.timestamp) {
      const h = new Date(m.timestamp * 1000).getHours();
      if (h >= 0 && h < 24) hours[h]++;
    }
  }
  const stats = {
    chat: chatName,
    total,
    by_hour: hours.map((count, hour) => ({ hour, count })),
    by_type: Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    top_senders: Array.from(senderMap.entries())
      .map(([sender, count]) => ({ sender, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
  };

  // 历史日柱图
  const dailyHistory = db()
    .prepare(
      'SELECT date, total FROM daily_stats WHERE chatroom_id = ? ORDER BY date ASC',
    )
    .all(chatroomId) as DailyHistoryRow[];

  // 同步状态
  const syncState = getSyncState(chatroomId);
  const syncedDates = listAllSyncedDates(chatroomId);

  return NextResponse.json({
    ok: true,
    chatroom_id: chatroomId,
    date,
    stats,
    recent: messages,
    daily_history: dailyHistory,
    sync_state: syncState ?? null,
    synced_dates: syncedDates,
    source,
    empty_reason: emptyReason,
  });
}
