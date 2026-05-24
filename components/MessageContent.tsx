'use client';

const IMG_RE = /\[图片\]\s*local_id=(\d+)/g;

export default function MessageContent({
  content,
  chatroomId,
}: {
  content: string;
  chatroomId: string;
}) {
  if (!content) return null;

  // 没有图片占位符直接返回文本
  if (!content.includes('[图片]')) {
    return <span className="whitespace-pre-wrap break-words">{content}</span>;
  }

  // 切片：文本 + 图片 + 文本 + ...
  const parts: Array<{ type: 'text'; v: string } | { type: 'img'; localId: number }> = [];
  let last = 0;
  for (const m of content.matchAll(IMG_RE)) {
    if (m.index === undefined) continue;
    if (m.index > last) {
      parts.push({ type: 'text', v: content.slice(last, m.index) });
    }
    parts.push({ type: 'img', localId: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    parts.push({ type: 'text', v: content.slice(last) });
  }

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (p.type === 'text') return <span key={i}>{p.v}</span>;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={`/api/wx-image?chatroom=${encodeURIComponent(chatroomId)}&local_id=${p.localId}`}
            alt={`图片 ${p.localId}`}
            loading="lazy"
            className="my-1 inline-block max-h-[280px] max-w-full rounded border border-[var(--border)] align-middle"
            onError={(e) => {
              const el = e.currentTarget;
              el.replaceWith(
                Object.assign(document.createElement('span'), {
                  className: 'text-[var(--text-3)]',
                  textContent: `[图片缺失 local_id=${p.localId}]`,
                }) as HTMLElement,
              );
            }}
          />
        );
      })}
    </span>
  );
}
