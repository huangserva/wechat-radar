// Normalizes raw WeChat collector message content into clean display text.
//
// Group collector content is stored as "<sender_wxid>:\n<payload>" where the
// payload is either plain text or a media/appmsg XML blob. Without normalization
// the frontend dumps the raw XML (and the wxid prefix). This runs at sync write
// time (bulkInsertMessages) and on session summaries.
//
// IMPORTANT: link URLs live in the raw <appmsg><url> — callers that extract
// links must do so from the RAW content BEFORE calling this.

// Leading "<wxid>:\n" prefix the collector prepends to group messages. The
// `sender` column we have is a display name (not the wxid), so the wxid in the
// prefix is matched generically.
const SENDER_PREFIX_RE = /^[A-Za-z][A-Za-z0-9_.\-]{1,}:[ \t]*\r?\n/;

export function stripSenderPrefix(content: string, wxid?: string): string {
  if (wxid) {
    const exact = `${wxid}:`;
    if (content.startsWith(exact)) return content.slice(exact.length).replace(/^[ \t]*\r?\n?/, '');
  }
  const m = content.match(SENDER_PREFIX_RE);
  return m ? content.slice(m[0].length) : content;
}

function decodeXmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? decodeXmlText(m[1]) : '';
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function placeholderForType(type: string): string {
  switch (type) {
    case '图片': return '[图片]';
    case '语音': return '[语音]';
    case '视频': return '[视频]';
    case '表情': return '[表情]';
    case '系统': return '[系统消息]';
    case '链接/文件': return '[链接/文件]';
    default: return '';
  }
}

export function normalizeMessageContent(raw: unknown, type: string): string {
  if (raw === null || raw === undefined) return placeholderForType(type);
  if (Buffer.isBuffer(raw)) return placeholderForType(type) || '[非文本消息]';
  let text = String(raw).replace(/\u0000/g, '');
  text = stripSenderPrefix(text).trim();
  if (!text) return placeholderForType(type);

  // System messages may start with <img src="SystemMessages_..."> — handle first
  // so they don't get mistaken for an image, then flatten to readable text.
  if (type === '系统' || /<sysmsg\b|_wc_custom_link_|SystemMessages_/i.test(text)) {
    const clean = decodeXmlText(text.replace(/<[^>]+>/g, ' '));
    return clean || '[系统消息]';
  }

  const looksXml =
    /^<(\?xml|msg\b|msgsource|appmsg)/i.test(text) ||
    /<appmsg[\s>]/i.test(text) ||
    /<(img|emoji|voicemsg|videomsg|location)\b/i.test(text);
  if (!looksXml) return text; // plain text (prefix already stripped)

  if (/<emoji\b/i.test(text)) return '[表情]';
  if (/<img\b/i.test(text)) return '[图片]';
  if (/<videomsg\b/i.test(text)) return '[视频]';
  if (/<voicemsg\b/i.test(text)) return '[语音]';
  if (/<location\b/i.test(text)) return '[位置]';

  const appmsgIdx = text.search(/<appmsg[\s>]/i);
  if (appmsgIdx >= 0) {
    // The closing </appmsg> is often missing (collector truncates very long
    // quoted content), so don't require it. appmsg-level <title>/<type> always
    // appear before any <refermsg>, so slice there to avoid reading the quoted
    // message's fields.
    let region = text.slice(appmsgIdx);
    const referIdx = region.search(/<refermsg[\s>]/i);
    if (referIdx > 0) region = region.slice(0, referIdx);
    const title = clip(xmlTag(region, 'title'), 120);
    const appType = Number(xmlTag(region, 'type'));
    const src = clip(xmlTag(text, 'sourcedisplayname') || xmlTag(region, 'appname'), 60);
    switch (appType) {
      case 3: return title ? `[音乐] ${title}` : '[音乐]';
      case 4:
      case 5: return title ? `[链接] ${title}` : '[链接]';
      case 6: return title ? `[文件] ${title}` : '[文件]';
      case 8: return '[表情]';
      case 19: return title ? `[聊天记录] ${title}` : '[聊天记录]';
      case 33:
      case 36: { const n = src || title; return n ? `[小程序] ${n}` : '[小程序]'; }
      case 51: return '[视频号]';
      case 57: return title || '[引用]';
      case 62: return title || '[拍一拍]'; // pat / 木鱼 — title is already readable
      case 2000:
      case 2001: return '[转账]';
      default: {
        // Only call it a link if there's a real http(s) <url>; otherwise the
        // appmsg is an interactive/system card whose title is the message text.
        const hasHttpUrl = /<url>\s*(?:<!\[CDATA\[\s*)?https?:\/\//i.test(text);
        if (hasHttpUrl) return title ? `[链接] ${title}` : '[链接]';
        return title || '[非文本消息]';
      }
    }
  }

  // <msg> wrapper without a recognized child / unknown XML — never dump raw XML.
  return placeholderForType(type) || '[非文本消息]';
}
