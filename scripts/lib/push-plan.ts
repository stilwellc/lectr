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
 *   matches  (Oct 11 2026, migration 0009) the nightly matcher
 *            (scripts/match-alerts.ts) found new lots for the reader's follows
 *            or saved searches: ONE note per user per UTC day, counting the
 *            fresh unseen alert rows, pointing at Your signals on /profile.
 *            Logged under lot_id 'matches:YYYY-MM-DD' (planMatchSends).
 *
 * Volume: at most MAX_PER_USER_KIND notifications per user per kind per run;
 * the overflow collapses into one summary pointing at /profile (every lot in
 * it is still logged, so it never re-fires).
 */
import { craftTitle } from '../../app/utils';
// THE DESK'S WORDS (pass 18 parity): money through fmtFace, the live bid in USD
// through liveBidUsd, My max and vs-your-max through words.ts, the close's day
// and clock through the paper's whenText on the reader's clock — never a
// formatter of this file's own
import { fmtFace, liveBidUsd } from '../../app/lib/lot-face';
import { myMaxText, vsMaxText, READER_TZ } from '../../app/profile/desk/words';
import { whenText, dayKeyIn } from './daily-desk';

export type Kind = 'close24' | 'close1' | 'hammer' | 'matches';
export const KINDS: Kind[] = ['close24', 'close1', 'hammer', 'matches'];
/** an alert row older than this is not "tonight's" news */
export const MATCH_FRESH_MS = 30 * 3600 * 1000;

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
  bidCount?: number;
  /** the row's currency and dated rate — the bid prints in USD (liveBidUsd) */
  currency?: string | null;
  fxRate?: number | null;
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
export interface Watch {
  user_id: string; lot_id: string; saved_title?: string | null;
  /** the reader marked it won — they know the result (no hammer push) */
  owned?: boolean | null;
  /** "none of these were me" — the result is not news to them (no hammer push) */
  result_dismissed?: boolean | null;
  /** My max (migration 0010): the close push says where the bid stands against it */
  max_usd?: number | null;
}

/** the /profile anchors a push may open — each lands in the fold that owns it
 *  (docs/DESK.md §4): results (Today's inbox), watching, record, settled
 *  (History), signals (the matches note). tabs.test asserts resolution,
 *  push-parity.test the landing. */
export const PUSH_ANCHORS: readonly string[] = ['/profile#results', '/profile#watching', '/profile#record', '/profile#settled', '/profile#signals'];
export interface Payload { title: string; body: string; url: string; tag: string }
export interface Planned { userId: string; kind: Kind; lotIds: string[]; payload: Payload }

/** '~' alias: the corpus re-keys a re-listed lot with a trailing '~' */
export const baseId = (id: string) => id.replace(/~+$/, '');
export const dedupeKey = (userId: string, lotId: string, kind: Kind) => `${userId}|${baseId(lotId)}|${kind}`;

const DAY = 86_400_000;
/** the reader's calendar day (the desk's and the paper's clock), never UTC's:
 *  a Nov 5 date-only sale read at 02:00Z Nov 5 is still Nov 4 evening on the
 *  desk — "Sells tomorrow", not "Sells today" */
const readerDay = (ms: number) => dayKeyIn(ms, READER_TZ);
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
  return d === readerDay(now) || d === readerDay(now + DAY) ? 'close24' : null;
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

export interface PayloadCtx {
  id: string; title?: string | null; house?: string | null;
  /** the live bid IN USD (liveBidUsd) and its count */
  bid?: number | null; bids?: number | null;
  /** the engine's forecast — value.compValueUsd, an ALL-IN figure (said so) */
  forecast?: number | null;
  /** the realized price (hammer kind) */
  price?: number | null;
  /** the reader's max (My max): the close push says where the bid stands, the hammer push how the result landed */
  max?: number | null;
  /** the close in the reader's words ("today 7:00 PM", "tomorrow 2:00 PM", "Thu, Nov 5") */
  when?: string | null;
  dateOnly?: boolean; sameDay?: boolean;
  /** the lot's currency fields, for the My max words' bid read */
  currency?: string | null; fxRate?: number | null; currentBid?: number | null;
}

export function payloadFor(kind: Kind, ctx: PayloadCtx): Payload {
  const name = short(ctx.title);
  const fc = ctx.forecast && ctx.forecast > 0 ? `lectr forecast ${fmtFace(ctx.forecast)} all-in` : null;
  const bid = ctx.bid && ctx.bid > 0 ? `bid ${fmtFace(ctx.bid)}${ctx.bids && ctx.bids > 0 ? ` · ${ctx.bids} ${ctx.bids === 1 ? 'bid' : 'bids'}` : ''}` : null;
  const mine = myMaxText({ currentBid: ctx.currentBid ?? ctx.bid ?? null, currency: ctx.currency ?? 'USD', fxRate: ctx.fxRate ?? null, priceUsd: null } as Parameters<typeof myMaxText>[0], ctx.max ?? null);
  const when = ctx.when ? `closes ${ctx.when}` : null;
  const tail = [when, bid, mine, fc].filter(Boolean).join(' · ');
  const at = ctx.house ? ` at ${ctx.house}` : '';
  if (kind === 'hammer') {
    // priceUsd is the REALIZED price (premium-inclusive where the house
    // publishes it) — "sold for", never a bare "hammer" figure it isn't
    const vs = vsMaxText(ctx.price || 0, ctx.max ?? null);
    return {
      title: `Sold: ${name}`,
      body: `Sold for ${fmtFace(ctx.price || 0)}${at}${vs ? ` · ${vs}` : ''}${fc ? ` (${fc})` : ''}.`,
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
        const closeMs = lv.saleDateTime ? Date.parse(lv.saleDateTime) : NaN;
        const timed = Number.isFinite(closeMs);
        const day = (lv.saleDate || '').slice(0, 10);
        item = {
          lotId: id,
          sortKey: timed ? closeMs : now,
          payload: payloadFor(kind, {
            id, title: lv.title || w.saved_title, house: lv.auctionHouse,
            bid: liveBidUsd(lv), bids: lv.bidCount ?? null, currentBid: lv.currentBid ?? null, currency: lv.currency ?? null, fxRate: lv.fxRate ?? null,
            max: w.max_usd ?? null,
            forecast: lv.value?.compValueUsd ?? forecasts.get(id) ?? null,
            // the close in the reader's words: the paper's whenText on the reader's clock; a date-only sale on its day
            when: timed ? whenText(closeMs, now, READER_TZ, true) : null,
            dateOnly: !timed, sameDay: !timed && day === readerDay(now),
          }),
        };
      }
    } else if (st && isFreshHammer(st, now)) {
      // a result the reader already booked ("I won it") or cleared ("none of
      // these were me") is not news to them — the desk does not count it either
      if (w.owned || w.result_dismissed) continue;
      kind = 'hammer';
      item = {
        lotId: id, sortKey: -Date.parse(String(st.sale_date)),
        payload: payloadFor('hammer', { id, title: st.title || w.saved_title, house: st.house, price: Number(st.price_usd), max: w.max_usd ?? null, forecast: forecasts.get(id) ?? null }),
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

export interface AlertLite { user_id: string; created_at: string; seen?: boolean | null }
/** the push_log lot_id a day's matches note is logged under */
export const matchesLogId = (now: number) => `matches:${utcDay(now)}`;

export function matchesPayload(n: number): Payload {
  return {
    title: n === 1 ? '1 new lot for what you follow' : `${n.toLocaleString('en-US')} new lots for what you follow`,
    body: 'Matched tonight against your follows and saved searches. See them in Your signals.',
    url: '/profile#signals', tag: 'matches',
  };
}

/**
 * Tonight's matches notes: one per subscribed user with at least one UNSEEN
 * alert created inside MATCH_FRESH_MS, unless today's note was already sent.
 * The count is the number the reader will find waiting — never a lot id.
 */
export function planMatchSends(input: { usersWithSubs: Set<string>; alerts: AlertLite[]; sent: Set<string>; now: number }): Planned[] {
  const { usersWithSubs, alerts, sent, now } = input;
  const logId = matchesLogId(now);
  const n = new Map<string, number>();
  for (const a of alerts) {
    if (!usersWithSubs.has(a.user_id) || a.seen) continue;
    const t = Date.parse(a.created_at);
    if (!Number.isFinite(t) || now - t > MATCH_FRESH_MS || t > now + 60_000) continue;
    n.set(a.user_id, (n.get(a.user_id) || 0) + 1);
  }
  const out: Planned[] = [];
  n.forEach((count, userId) => {
    if (sent.has(dedupeKey(userId, logId, 'matches'))) return;
    out.push({ userId, kind: 'matches', lotIds: [logId], payload: matchesPayload(count) });
  });
  return out.sort((a, b) => a.userId.localeCompare(b.userId));
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
