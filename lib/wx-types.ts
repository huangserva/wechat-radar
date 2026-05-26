export interface WxSession {
  chat: string;
  chat_type: 'private' | 'group';
  is_group: boolean;
  last_msg_type: string;
  last_sender: string;
  summary: string;
  time: string;
  timestamp: number;
  unread: number;
  username: string;
}

export interface WxStatsBucket {
  hour: number;
  count: number;
}

export interface WxStatsSender {
  sender: string;
  count: number;
}

export interface WxStatsType {
  type: string;
  count: number;
}

export interface WxStats {
  chat: string;
  chat_type: 'private' | 'group';
  is_group: boolean;
  username: string;
  total: number;
  by_hour: WxStatsBucket[];
  by_type: WxStatsType[];
  top_senders: WxStatsSender[];
}

export interface WxMessage {
  local_id: number;
  sender: string;
  content: string;
  time: string;
  timestamp: number;
  type: string;
}

export interface WxNewMessage extends WxMessage {
  username: string;
  chat?: string;
}

export interface WxMember {
  username: string;
  nickname?: string;
  display_name?: string;
}

export interface WxDaemonStatus {
  /**
   * In `db` source mode this reflects whether the decrypted DB data source is
   * readable (NOT a resident daemon); in legacy `wx` mode it is the real
   * wx-daemon running state. Read `source` to disambiguate.
   */
  running: boolean;
  pid?: number;
  uptime_seconds?: number;
  /** Which data source answered: decrypted local DB vs legacy wx CLI/daemon. */
  source?: 'db' | 'wx';
  /** db mode only: whether collector/session/contact DB is readable. */
  db_readable?: boolean;
}

/**
 * Which data source actually answered a query.
 * - `local`  : served from the app's own radar.db (decided by API routes)
 * - `collector` : collector.db (the normal happy path)
 * - `raw`    : decrypted message_*.db, reached only when collector was empty/absent
 * - `live`   : the legacy `wx` CLI / wx-daemon path
 * - `none`   : no data source was available at all
 */
export type WxSource = 'local' | 'collector' | 'raw' | 'mixed' | 'live' | 'none';

/**
 * Why a result is empty, so callers can tell "this chat genuinely has no
 * messages" from "no data source covered this target".
 * `null` means data was found.
 */
export type WxEmptyReason = 'no_data_source' | 'no_match' | null;

export interface WxResult<T> {
  data: T;
  source: WxSource;
  empty_reason: WxEmptyReason;
}
