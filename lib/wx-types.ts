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
  running: boolean;
  pid?: number;
  uptime_seconds?: number;
}
