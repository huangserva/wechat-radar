/**
 * Gatekeeper for rendering untrusted external links (WeChat messages, hermes
 * trending/knowledge data, etc.). Only http(s) URLs are allowed through —
 * `javascript:`, `data:`, `vbscript:`, `file:` and friends return null so the
 * caller can degrade to plain (non-clickable) text. Bare domains without a
 * scheme (e.g. `mp.weixin.qq.com?...`, common in trending_urls) are upgraded to
 * https. Pure / browser-safe (uses the WHATWG `URL`), no Node deps — importable
 * from both server and client components.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  let candidate = s;
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return null; // reject javascript:/data:/vbscript:/file:/…
  } else {
    // No scheme → assume https (bare host/path from the data sources).
    candidate = `https://${s.replace(/^\/+/, '')}`;
  }

  try {
    const u = new URL(candidate);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function isSafeExternalUrl(raw: string | null | undefined): boolean {
  return safeExternalUrl(raw) !== null;
}
