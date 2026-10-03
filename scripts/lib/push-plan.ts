/**
 * push-plan — the PURE half of scripts/push-send.ts (no network, no env), so
 * the rules that decide who hears what are unit-tested
 * (scripts/__tests__/push-plan.test.ts).
 *
 * KINDS (one notification per user × lot × kind, EVER — the push_log PK):
 *   close24  a watched lot closes within 24h (timed close), or its date-only
 *            sale day is today/tomorrow (UTC)
 *   close1   a watched TIMED lot closes within CLOSE1_WINDOW_MS. A lot first
 *            seen already inside this window gets close1 only — never a
 *            "within 24 hours" after the fact.
 *   hammer   a watched lot settled SOLD with a price; the message carries the
 *            engine's forecast when push_lot_snap captured one while it was live
 *
 * Volume: at most MAX_PER_USER_KIND notifications per user per kind per run;
 * the overflow collapses into one summary pointing at /profile (every lot in
 * it is still logged, so it never re-fires).
 */
import { craftTitle, formatPrice } from '../../app/utils';

export type Kind = 'close24' | 'close1' | 'hammer';
export const KINDS: Kind[] = ['close24', 'close1', 'hammer'];

/** close-board runs every 4h; an hourly runner tightens this. 90 min keeps
 *  a lot that closes between two hourly runs from slipping past. */
export const CLOSE1_WINDOW_MS = 90 * 60 * 1000;
export const CLOSE24_WINDOW_MS = 24 * 3600 * 1000;
export const MAX_PER_USER_KIND = 3;
/** a hammer older than this is history, not news — never pushed */
export const HAMMER_FRESH_DAYS = 7;

export interface LiveLot {
  id: string;
  title?: string;
  auctionHouse?: string;
  saleDate?: string;
  saleDateTime?: string | null;
  currentBid?: number;
  value?: { compValueUsd?: number } | null;
}
export interface SettledLot {
  id: string;
  title?: string | null;
  house?: string | null;
  status?: string | null;
  price_usd?: number | null;
  sale_date?: string | null;
}
export interface Watch { user_id: string; lot_id: string; saved_title?: string | null }
export interface Payload { title: string; body: string; url: string; tag: string }
export interface Planned { userId: string; kind: Kind; lotIds: string[]; payload: Payload }

/** '~' alias: the corpus re-keys a re-listed lot with a trailing '~' */
export const baseId = (id: string) => id.replace(/~+$/, '');
export const dedupeKey = (userId: string, lotId: string, kind: Kind) => `${userId}|${baseId(lotId)}|${kind}`;

const DAY = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Which close kind (if any) a live lot is in right now. */
export function closeKindFor(lot: LiveLot, now: number): Kind | null {
  const t = lot.saleDateTime ? Date.parse(lot.saleDateTime) : NaN;
  if (Number.isFinite(t)) {
    const left = t - now;
    if (left <= 0) return null;
    if (left <= CLOSE1_WINDOW_MS) return 'close1';
    if (left <= CLOSE24_WINDOW_MS) return 'close24';
    return null;
  }
  // date-only sale: no hour to count down to — one heads-up on the day
  // before or the day of, never a fake "within the hour"
  const d = (lot.saleDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d === utcDay(now) || d === utcDay(now + DAY) ? 'close24' : null;
}

export function isFreshHammer(s: SettledLot, now: number): boolean {
  if (s.status !== 'sold' || !(Number(s.price_usd) > 0) || !s.sale_date) return false;
  const t = Date.parse(s.sale_date.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) && now - t <= HAMMER_FRESH_DAYS * DAY && t <= now + DAY;
}

const short = (raw: string | null | undefined, max = 70) => {
  const t = craftTitle(raw || '') || 'A lot you watch';
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};
const lotUrl = (id: string) => `/lot?id=${encodeURIComponent(baseId(id))}`; // the universal permalink

export function payloadFor(kind: Kind, ctx: { id: string; title?: string | null; house?: string | null; bid?: number | null; forecast?: number | null; price?: number | null; dateOnly?: boolean; sameDay?: boolean }): Payload {
  const name = short(ctx.title);
  const fc = ctx.forecast && ctx.forecast > 0 ? `lectr forecast ${formatPrice(ctx.forecast)}` : null;
  const bid = ctx.bid && ctx.bid > 0 ? `bid ${formatPrice(ctx.bid)}` : null;
  const tail = [bid, fc].filter(Boolean).join(' · ');
  const at = ctx.house ? ` at ${ctx.house}` : '';
  if (kind === 'hammer') {
    // priceUsd is the REALIZED price (premium-inclusive where the house
    // publishes it) — "sold for", never a bare "hammer" figure it isn't
    return {
      title: `Sold: ${name}`,
      body: `Sold for ${formatPrice(ctx.price || 0)}${at}${fc ? ` (${fc})` : ''}.`,
      url: lotUrl(ctx.id), tag: `hammer:${baseId(ctx.id)}`,
    };
  }
  if (kind === 'close1') {
    return {
      title: `Closes within the hour: ${name}`,
      body: `${ctx.house || 'The house'} closes it soon${tail ? ` · ${tail}` : ''}.`,
      url: lotUrl(ctx.id), tag: `close:${baseId(ctx.id)}`,
    };
  }
  return {
    title: ctx.dateOnly ? `${ctx.sameDay ? 'Sells today' : 'Sells tomorrow'}: ${name}` : `Closes within 24 hours: ${name}`,
    body: `On the block${at}${tail ? ` · ${tail}` : ''}.`,
    url: lotUrl(ctx.id), tag: `close:${baseId(ctx.id)}`,
  };
}

function summaryPayload(kind: Kind, n: number): Payload {
  const what = kind === 'hammer' ? `${n} more watched lots sold` : kind === 'close1' ? `${n} more watched lots close within the hour` : `${n} more watched lots close within 24 hours`;
  return { title: what, body: 'See them on your desk.', url: '/profile', tag: `summary:${kind}` };
}

/**
 * Plan this run's notifications. `sent` holds dedupeKey()s already in
 * push_log; `forecasts` maps baseId → forecast captured while live.
 */
export function planSends(input: {
  usersWithSubs: Set<string>;
  watches: Watch[];
  live: Map<string, LiveLot>;          // keyed by baseId
  settled: Map<string, SettledLot>;    // keyed by baseId
  sent: Set<string>;
  forecasts: Map<string, number>;
  now: number;
  maxPerUserKind?: number;
}): Planned[] {
  const { usersWithSubs, watches, live, settled, sent, forecasts, now } = input;
  const cap = Math.max(1, input.maxPerUserKind ?? MAX_PER_USER_KIND);
  type Item = { lotId: string; payload: Payload; sortKey: number };
  const buckets = new Map<string, Item[]>(); // userId|kind → items
  const seen = new Set<string>();

  for (const w of watches) {
    if (!usersWithSubs.has(w.user_id)) continue;
    const id = baseId(w.lot_id);
    const lv = live.get(id);
    const st = settled.get(id);
    let kind: Kind | null = null;
    let item: Item | null = null;
    if (lv) {
      kind = closeKindFor(lv, now);
      if (kind) {
        const timed = Number.isFinite(lv.saleDateTime ? Date.parse(lv.saleDateTime) : NaN);
        item = {
          lotId: id,
          sortKey: timed ? Date.parse(lv.saleDateTime!) : now,
          payload: payloadFor(kind, {
            id, title: lv.title || w.saved_title, house: lv.auctionHouse, bid: lv.currentBid ?? null,
            forecast: lv.value?.compValueUsd ?? forecasts.get(id) ?? null,
            dateOnly: !timed, sameDay: !timed && (lv.saleDate || '').slice(0, 10) === utcDay(now),
          }),
        };
      }
    } else if (st && isFreshHammer(st, now)) {
      kind = 'hammer';
      item = {
        lotId: id, sortKey: -Date.parse(String(st.sale_date)),
        payload: payloadFor('hammer', { id, title: st.title || w.saved_title, house: st.house, price: Number(st.price_usd), forecast: forecasts.get(id) ?? null }),
      };
    }
    if (!kind || !item) continue;
    const k = dedupeKey(w.user_id, id, kind);
    if (sent.has(k) || seen.has(k)) continue; // ledger dedupe + duplicate saves ('x' and 'x~')
    seen.add(k);
    const b = `${w.user_id}|${kind}`;
    const arr = buckets.get(b) || [];
    arr.push(item);
    buckets.set(b, arr);
  }

  const out: Planned[] = [];
  buckets.forEach((items, b) => {
    const [userId, kind] = b.split('|') as [string, Kind];
    items.sort((a, c) => a.sortKey - c.sortKey || a.lotId.localeCompare(c.lotId));
    if (items.length <= cap) {
      for (const it of items) out.push({ userId, kind, lotIds: [it.lotId], payload: it.payload });
    } else {
      for (const it of items.slice(0, cap - 1)) out.push({ userId, kind, lotIds: [it.lotId], payload: it.payload });
      const rest = items.slice(cap - 1);
      out.push({ userId, kind, lotIds: rest.map(r => r.lotId), payload: summaryPayload(kind, rest.length) });
    }
  });
  return out;
}

/** What to do with a failed send. 404/410 = the subscription is gone (the
 *  user revoked it, reinstalled, cleared data): delete the row. 429/5xx and
 *  network errors are transient: keep the row, try next run. Anything else
 *  (400/401/403/413 — a bad key or payload) is OUR bug: keep the row, warn. */
export function classifyPushError(statusCode: number | undefined): 'prune' | 'retry' | 'error' {
  if (statusCode === 404 || statusCode === 410) return 'prune';
  if (statusCode == null || statusCode === 429 || statusCode >= 500) return 'retry';
  return 'error';
}

/** Should this subscription be dropped after repeated non-prune failures?
 *  (A browser that 5xx's for ~2 weeks of 4h runs is dead weight.) */
export const MAX_FAILS = 80;
export const shouldRetire = (failCount: number) => failCount >= MAX_FAILS;
