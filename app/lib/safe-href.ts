/**
 * safe-href — the one scheme allowlist for crawler-derived URLs (C1 §3).
 *
 * `lot.url` / `comp.url` are arbitrary crawler text and React does NOT
 * sanitize `href`, so a `javascript:`/`data:` URL would execute on click.
 * Every `href={lot.url}` sink routes through here: the URL renders only when
 * it parses as absolute http(s); anything else returns undefined and the
 * caller omits/disables the anchor gracefully.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const protocol = new URL(url).protocol;
    if (protocol === 'http:' || protocol === 'https:') return url;
  } catch {
    /* relative or malformed — never a house lot URL, never rendered */
  }
  return undefined;
}
