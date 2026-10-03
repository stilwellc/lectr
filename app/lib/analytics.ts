/**
 * lectr's instrumentation — two honest layers, both identity-free.
 *
 * 1. PAGE VIEWS: Cloudflare Web Analytics (cookieless beacon). Rendered by
 *    <Analytics /> ONLY when NEXT_PUBLIC_CF_BEACON_TOKEN was set at build time;
 *    absent, the page carries no analytics script at all. Cloudflare's beacon
 *    does not take custom events, so it answers "how many visits / which
 *    pages", nothing else.
 *
 * 2. PRODUCT EVENTS: a fixed vocabulary of seven verbs, recorded as anonymous
 *    DAILY COUNTS in Supabase via the track_event() RPC (migration 0008). The
 *    request carries the event name and nothing else — no user id, no lot id,
 *    no session, no device signal, no cookie. The RPC rate-limits globally and
 *    drops unknown names. Inert without the Supabase env vars.
 *
 * Respecting the visitor: a browser sending Global Privacy Control or Do Not
 * Track records no product events (the counts undercount by that share —
 * documented in docs/RETENTION.md). Per page-session throttles keep a
 * double-click or a re-render from counting twice.
 */

export const EVENTS = [
  'save_lot',        // a lot added to the watchlist
  'unsave_lot',      // removed
  'maxbid_view',     // a lot page printed its Max bid row (once per lot per session)
  'outbound_house',  // a "View at <house>" click
  'push_optin',      // browser push turned on for a device
  'pro_interest',    // "I'd pay for this" on the Pro card
  'calendar_add',    // an .ics handed to the calendar
] as const;
export type EventName = (typeof EVENTS)[number];

export function isEventName(x: unknown): x is EventName {
  return typeof x === 'string' && (EVENTS as readonly string[]).includes(x);
}

/** Per page-session ceiling per event: the server caps globally, this keeps
 *  one enthusiastic tab from being most of a day's count. */
export const SESSION_CAP = 25;

/**
 * The throttle, pure so it is testable: given what this page-session already
 * sent, decide whether `event` (optionally keyed — e.g. one maxbid_view per
 * lot) may be counted, and record it if so.
 */
export function createThrottle(cap = SESSION_CAP) {
  const perEvent = new Map<EventName, number>();
  const seenKeys = new Set<string>();
  return function allow(event: EventName, onceKey?: string): boolean {
    if (!isEventName(event)) return false;
    if (onceKey != null) {
      const k = `${event}|${onceKey}`;
      if (seenKeys.has(k)) return false;
      seenKeys.add(k);
    }
    const n = perEvent.get(event) ?? 0;
    if (n >= cap) return false;
    perEvent.set(event, n + 1);
    return true;
  };
}

/** GPC / DNT → no product events. Reads only the two opt-out flags. */
export function optedOut(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean } | undefined): boolean {
  if (!nav) return true;
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes';
}

const SB_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const eventsEnabled = !!(SB_URL && SB_ANON);

const allow = createThrottle();

/**
 * Count one product event. Fire-and-forget: never throws, never blocks, never
 * retries. `keepalive` lets an outbound click's count survive the tab
 * navigating away. Anonymous by construction — the anon key, not the user's
 * session token, authorizes the call, so even the server cannot tie the count
 * to an account.
 */
export function track(event: EventName, onceKey?: string): void {
  if (!eventsEnabled || typeof window === 'undefined') return;
  if (optedOut(navigator as Navigator & { globalPrivacyControl?: boolean })) return;
  if (!allow(event, onceKey)) return;
  try {
    fetch(`${SB_URL}/rest/v1/rpc/track_event`, {
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event: event }),
    }).catch(() => { /* quiet: a lost count is not the user's problem */ });
  } catch { /* old browser without keepalive support — skip */ }
}
