/**
 * names.ts — NAMES CALENDAR & BLIND SPOTS (THE DESK v3 §7, Oct 11 2026).
 * Pure reads behind app/profile/names/index.tsx. No React, no I/O.
 *
 * THE NAMES. Every name the reader follows (makers, players, subjects via the
 * follow's entity id), owns (the collection's lots, keyed by the lot's `ek`),
 * or has saved (the watch list's lots, the same key) — once each, grouped by
 * the market the entity lives in. A house follow is not a name. A category
 * follow has no entity (its entities-file row is the UNNAMED remainder, not
 * the category), so it carries live facts only and says so.
 *
 * THE CALENDAR. A name's live lots (desk.book, on the block at desk.now, the
 * lot's entity key = the name — entity/live entityIdOf, the /makers join)
 * grouped into the SALES they sit in: house + sale + the day the sale closes
 * where it is held (house-tz). Each sale: lot count, the estimate band summed
 * over the lots (a native-currency estimate with no USD field on the row is
 * converted at the build's dated rate — normalize fxRateFor, the same table
 * the money layer stamps — and the band is marked approximate), bid-auction
 * lots' live bids, and how many the engine flags below market (isFlagged —
 * the ONE below-market predicate).
 *
 * THE PULSE. The nightly's summary (pages/entities-<market>.json): the
 * 12-month median WITH its n and scope (the build's n gate: med12m is null
 * under MIN_MED_N), sold in the trailing year (or "since YYYY" when the
 * count is not a true 365-day window), the complete-quarter spark, and the
 * year-over-year only where the build printed one (its own n gate + 90%
 * interval). Nothing here is computed in the browser.
 *
 * THE BLIND SPOT. A name with nothing live: its last seen sale (the newest
 * row of the detail bucket's recent ∪ top), where it usually sells (the
 * detail's houses, all-time, as shares), and Follow when not followed.
 *
 * ONE CLOCK: every read takes `now` (desk.now). Never Date.now() here.
 */
import { MARKETS, ARTIST_MARKET, type Market } from '../../constants';
import type { AuctionLot } from '../../types';
import type { EntityDetail, EntitySummary, EntityYoy } from '../../lib/entity/model';
import { parseEntityId, CAT_MARKET } from '../../lib/entity/key';
import { entityIdOf } from '../../lib/entity/live';
import { affinityOf, type Follow } from '../../lib/follows';
import { lotFollowOf } from '../../lib/lot-follow';
import { marketNamesOf, entityIdOfFollow, type MarketName } from '../../lib/your-market';
import { isFlagged } from '../../lib/flags';
import { closeMsOf } from '../../lib/priority';
import { closeIsTimed, houseCloseDayOf } from '../../lib/house-tz';
import { estUsdBand } from '../../lib/comps';
import { fxRateFor } from '../../lib/normalize';
import type { Currency } from '../../types';
import { isOnBlock } from '../../utils';
import type { CatKey } from '../../lib/taxonomy';

/** names whose sold side is read (each costs one entities file + one
 *  entity-<bb>.json bucket; the rest carry their calendar only) */
export const MAX_READ = 16;
const DAY = 86_400_000;
const HOUR = 3_600_000;

/* ── the names ── */

export interface DeskName extends MarketName {
  /** the market the name lives in ('all' when no market speaks for it) */
  market: Market;
  /** watched (saved, not owned) lots filed under this name */
  saved: number;
}

/** the reader-local ISO day of `ms` (the desk's `today`, from its one clock) */
export function isoDayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** the market a name lives in: its entity id's, else its follow's */
export function marketOfName(n: Pick<MarketName, 'id' | 'follow'>): Market {
  if (n.id) return parseEntityId(n.id)?.market ?? 'all';
  const f = n.follow;
  if (f.kind === 'cat') {
    const cat = f.key.split(':')[0] as CatKey;
    return CAT_MARKET[cat] ?? 'all';
  }
  if (f.kind === 'maker') return ARTIST_MARKET[f.key] ?? 'all';
  return 'all';
}

type NameLot = Parameters<typeof lotFollowOf>[0];

/** the reader's names: follows (houses are not a name), the owned pieces'
 *  names, then the saved lots' names — once each; a saved lot of a followed
 *  or owned name is counted on that row */
export function deskNamesOf(follows: readonly Follow[], owned: readonly NameLot[], saved: readonly NameLot[]): DeskName[] {
  const base = marketNamesOf(follows, owned);
  const out: DeskName[] = base.map(n => ({ ...n, market: marketOfName(n), saved: 0 }));
  const byKey = new Map(out.map(n => [n.key, n]));
  for (const l of saved) {
    const f = lotFollowOf(l);
    if (!f) continue;
    const id = entityIdOfFollow(f);
    const key = id ?? `${f.kind}:${f.key}`;
    const hit = byKey.get(key);
    if (hit) { hit.saved++; continue; }
    const n: DeskName = { key, id, label: f.label, follow: f, followed: false, owned: 0, saved: 1, market: marketOfName({ id, follow: f }) };
    byKey.set(key, n); out.push(n);
  }
  return out;
}

/** names by market, in the site's market order; a market with no names is absent */
export function groupByMarket(names: readonly DeskName[]): { market: Market; label: string; names: DeskName[] }[] {
  const by = new Map<Market, DeskName[]>();
  for (const n of names) { const a = by.get(n.market); if (a) a.push(n); else by.set(n.market, [n]); }
  const out: { market: Market; label: string; names: DeskName[] }[] = [];
  for (const m of MARKETS) {
    const a = by.get(m.key);
    if (!a) continue;
    out.push({ market: m.key, label: m.key === 'all' ? 'Across markets' : m.label, names: a });
  }
  return out;
}

/* ── the calendar ── */

/** the name's live lots in the book: the lot's entity key for a name with
 *  an entity (the /makers join), the follow's matcher for one without */
export function liveLotsOf(name: Pick<MarketName, 'id' | 'follow'>, book: readonly AuctionLot[], now: number): AuctionLot[] {
  const today = isoDayOf(now);
  const out: AuctionLot[] = [];
  for (const l of book) {
    if (!isOnBlock(l, today, now)) continue;
    if (name.id ? entityIdOf(l) !== name.id : affinityOf(l, [name.follow]) <= 0) continue;
    out.push(l);
  }
  return out;
}

export interface SaleEst {
  /** the summed band over the lots that carry an estimate */
  lo: number; hi: number;
  /** lots summed */
  k: number;
  /** of those, lots converted from a native currency at the build's dated
   *  rate (the band prints as approximate when > 0) */
  approx: number;
  /** lots with no estimate at all (bid auctions, estimate on request) */
  none: number;
}

export interface Sale {
  key: string;
  house: string;
  saleName: string;
  /** the close day where the sale is held (house-tz) */
  day: string;
  /** the first lot's close (ms) — the sale's hammer clock; null: no usable date */
  closeMs: number | null;
  timed: boolean;
  lots: AuctionLot[];
  est: SaleEst;
  /** live bids on bid-auction lots (Goldin): count + sum */
  bids: { n: number; sum: number };
  /** the engine prices these below their comparables */
  flagged: number;
}

/** a lot's estimate band in USD (`approx`: converted here from its native
 *  currency at the build's dated rate — the row carried no USD field), or
 *  'none' when the house published no estimate */
export function estOf(l: AuctionLot): { lo: number; hi: number; approx: boolean } | 'none' {
  const b = estUsdBand(l);
  if (b.low == null && b.high == null) return 'none';
  const lo = b.low ?? b.high ?? 0, hi = b.high ?? b.low ?? 0;
  // the band is native when the money layer left no USD field and the
  // currency is not the dollar: convert at the dated rate, say so
  if (l.estLowUsd == null && l.estHighUsd == null && l.currency && l.currency !== 'USD') {
    const { rate } = fxRateFor(l.currency as Currency, l.saleDate || null);
    return { lo: lo * rate, hi: hi * rate, approx: true };
  }
  return { lo, hi, approx: false };
}

/** the sales a name's live lots sit in, soonest close first */
export function salesOf(lots: readonly AuctionLot[]): Sale[] {
  const by = new Map<string, Sale>();
  for (const l of lots) {
    const house = String(l.auctionHouse || '');
    const saleName = String(l.saleName || '');
    const day = houseCloseDayOf(l);
    const key = `${house}|${saleName}|${day}`;
    let s = by.get(key);
    if (!s) {
      s = { key, house, saleName, day, closeMs: null, timed: closeIsTimed(l), lots: [], est: { lo: 0, hi: 0, k: 0, approx: 0, none: 0 }, bids: { n: 0, sum: 0 }, flagged: 0 };
      by.set(key, s);
    }
    s.lots.push(l);
    const c = closeMsOf(l);
    if (c != null && (s.closeMs == null || c < s.closeMs)) s.closeMs = c;
    const e = estOf(l);
    if (e === 'none') s.est.none++;
    else { s.est.lo += e.lo; s.est.hi += e.hi; s.est.k++; if (e.approx) s.est.approx++; }
    if (l.currentBid && l.currentBid > 0) { s.bids.n++; s.bids.sum += l.currentBid; }
    if (isFlagged(l)) s.flagged++;
  }
  const out = Array.from(by.values());
  out.sort((a, b) => (a.closeMs ?? Infinity) - (b.closeMs ?? Infinity) || a.house.localeCompare(b.house));
  for (const s of out) s.lots.sort((a, b) => (closeMsOf(a) ?? Infinity) - (closeMsOf(b) ?? Infinity));
  return out;
}

export type SaleWhen =
  | { kind: 'closed' }
  | { kind: 'hours'; hours: number; minutes: number }
  | { kind: 'day'; days: number; ms: number }
  | { kind: 'unknown' };

/** when a sale closes, read against the desk's clock: inside 24h in hours
 *  and minutes, else as a day (the component prints the day label) */
export function saleWhen(closeMs: number | null, now: number): SaleWhen {
  if (closeMs == null) return { kind: 'unknown' };
  const left = closeMs - now;
  if (left <= 0) return { kind: 'closed' };
  if (left < 24 * HOUR) return { kind: 'hours', hours: Math.floor(left / HOUR), minutes: Math.floor((left % HOUR) / 60_000) };
  // whole reader-local days from today's midnight to the close's midnight
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(closeMs); d1.setHours(0, 0, 0, 0);
  return { kind: 'day', days: Math.round((d1.getTime() - d0.getTime()) / DAY), ms: closeMs };
}

/** the whole calendar's figures: lots, sales, the summed USD band */
export function calendarTotals(sales: readonly Sale[]): { lots: number; sales: number; lo: number; hi: number; k: number; approx: number; flagged: number } {
  let lots = 0, lo = 0, hi = 0, k = 0, approx = 0, flagged = 0;
  for (const s of sales) { lots += s.lots.length; lo += s.est.lo; hi += s.est.hi; k += s.est.k; approx += s.est.approx; flagged += s.flagged; }
  return { lots, sales: sales.length, lo, hi, k, approx, flagged };
}

/* ── the pulse ── */

export interface Pulse {
  /** the 12-month median, only with its n (null: under the build's n gate) */
  med12m: number | null;
  med12mN: number | null;
  /** what the median is over ('all', 'cards', 'unique works' …) */
  scope: string | null;
  sold12m: number | null;
  /** when sold12m is NOT a true 365-day count: the year its span starts */
  sold12mSince: string | null;
  spark: (number | null)[] | null;
  sparkBasis: 'median' | 'matched' | null;
  sparkYoyOff: number | null;
  /** the complete quarters the spark covers (oldest first) */
  sparkQ: string[] | null;
  /** the build's year-over-year — already n-gated and interval-checked there */
  yoy: EntityYoy | null;
  record: { p: number; d: string } | null;
  sold: number | null;
}

/** the sold side of one name from its published summary — nothing derived */
export function pulseOf(s: EntitySummary | null, sparkQ?: string[] | null): Pulse | null {
  if (!s) return null;
  const gated = s.med12m != null && s.med12m > 0 && s.med12mN != null && s.med12mN > 0;
  return {
    med12m: gated ? s.med12m : null,
    med12mN: gated ? s.med12mN : null,
    scope: s.medScope ?? null,
    sold12m: s.sold12m,
    sold12mSince: s.sold12mSince ?? null,
    spark: s.spark && s.spark.filter(v => v != null && v > 0).length >= 2 ? s.spark : null,
    sparkBasis: s.sparkBasis ?? null,
    sparkYoyOff: s.sparkYoyOff ?? null,
    sparkQ: sparkQ ?? null,
    yoy: s.yoy ?? null,
    record: s.record ? { p: s.record.p, d: s.record.d } : null,
    sold: s.sold,
  };
}

/** the quarter span a spark covers, in words ('2023-Q4 to 2026-Q3') */
export function sparkSpan(sparkQ: readonly string[] | null | undefined, n: number): string | null {
  if (!sparkQ || !sparkQ.length || n <= 0) return null;
  const q = sparkQ.slice(-n);
  return q.length > 1 ? `${q[0]} to ${q[q.length - 1]}` : q[0];
}

/* ── the blind spot ── */

export interface LastSeen { p: number; d: string; h: string; t: string; id: string }
export interface HouseShare { h: string; n: number; share: number }

export interface BlindSpot {
  /** the newest sale on file (recent ∪ top) — null: the bucket lists none */
  lastSeen: LastSeen | null;
  /** days from the last seen sale to the desk's clock */
  daysSince: number | null;
  /** where it usually sells — the top houses, all-time, as shares of the listed total */
  houses: HouseShare[];
  /** sales across every house listed */
  housesN: number;
}

export function blindSpotOf(d: EntityDetail | null, now: number, topHouses = 3): BlindSpot | null {
  if (!d) return null;
  let best: LastSeen | null = null;
  for (const r of [...(d.recent || []), ...(d.top || [])]) {
    if (!r.d || !(r.p > 0)) continue;
    if (!best || r.d > best.d || (r.d === best.d && r.p > best.p)) best = { p: r.p, d: r.d, h: r.h, t: r.t, id: r.id };
  }
  const today = isoDayOf(now);
  const daysSince = best ? Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${best.d}T12:00:00Z`)) / DAY)) : null;
  const hs = (d.houses || []).filter(h => h.n > 0).slice().sort((a, b) => b.n - a.n);
  const total = hs.reduce((s, h) => s + h.n, 0);
  const houses = hs.slice(0, topHouses).map(h => ({ h: h.h, n: h.n, share: total ? h.n / total : 0 }));
  return { lastSeen: best, daysSince, houses, housesN: total };
}

/** "3 days ago" / "yesterday" / "today" / "2 years ago" */
export function agoText(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) { const m = Math.round(days / 30); return `${m} ${m === 1 ? 'month' : 'months'} ago`; }
  const y = Math.round(days / 365 * 10) / 10;
  return `${y % 1 === 0 ? y.toFixed(0) : y.toFixed(1)} ${y === 1 ? 'year' : 'years'} ago`;
}

/* ── the section's figures ── */

export interface NameRead {
  name: DeskName;
  sales: Sale[];
  live: number;
  flagged: number;
}

/** what the rail pill says and the sub-line's counts */
export function namesTotals(reads: readonly NameRead[]): { names: number; live: number; blind: number; sales: number; lots: number } {
  let live = 0, blind = 0, lots = 0;
  const sales = new Set<string>();
  for (const r of reads) {
    if (r.live > 0) live++; else blind++;
    lots += r.live;
    for (const s of r.sales) sales.add(s.key);
  }
  return { names: reads.length, live, blind, sales: sales.size, lots };
}

/** the names with something live first (soonest sale first), then the blind
 *  spots (most recently seen first — the component holds the detail) */
export function orderNames(reads: readonly NameRead[], lastSeenOf: (key: string) => string | null): NameRead[] {
  return reads.slice().sort((a, b) => {
    const al = a.live > 0 ? 1 : 0, bl = b.live > 0 ? 1 : 0;
    if (al !== bl) return bl - al;
    if (al) {
      const ac = a.sales[0]?.closeMs ?? Infinity, bc = b.sales[0]?.closeMs ?? Infinity;
      if (ac !== bc) return ac - bc;
      return b.live - a.live;
    }
    const ad = lastSeenOf(a.name.key) ?? '', bd = lastSeenOf(b.name.key) ?? '';
    if (ad !== bd) return ad > bd ? -1 : 1;
    return a.name.label.localeCompare(b.name.label);
  });
}
