/**
 * budget.ts — THE BUDGET DESK's figures (THE DESK v3 §5, Oct 11 2026).
 * Plain logic, no React: every number the section prints is computed here,
 * from the desk's data and its ONE clock (`now`), so the component formats
 * and the tests read the same functions.
 *
 * What each figure is, and where it comes from — nothing is re-derived:
 *
 *   the band        the reader's STATED price range (app/lib/interests
 *                   PricePref: minUsd / maxUsd, hammer-basis USD, one of
 *                   feed-filters VALUE_FLOORS / VALUE_CEILINGS). Never
 *                   learned, never inferred: no statement → no ceiling.
 *   plan figure     per watched live lot, ONE hammer-basis number:
 *                     · the engine's MAX BID (lot-face lotFace().maxBid —
 *                       verdict.lotMaxBid: value.maxBidUsd on a value the
 *                       floor rule certifies) when the engine has one;
 *                     · else the ranker's price anchor (priority.prioStatic
 *                       .a) LABELLED by its source: the estimate midpoint
 *                       (estimate houses), the projected close (bid rooms),
 *                       the lectr value, or the bare live bid.
 *                   A lot with neither is listed as unpriced, never summed.
 *   all-in          plan figure × the lot's buyer's-premium factor —
 *                   premiums.lotAllInFactor (the lot's own stamped premium,
 *                   else the house schedule in force on its sale date). A
 *                   max-bid row's all-in IS verdict.lotMaxBid's (same call).
 *   night           closeDayOf (app/utils) — the reader's TRUE close day.
 *   over budget     a night's hammer sum against the stated ceiling
 *                   (maxUsd). The drop suggestion is lowest-edge first
 *                   (priority.prioStatic.edge: a Below Market flag lifts a
 *                   lot, Above Market sinks it), then the rows the engine
 *                   did not price (no max bid), then the biggest first — a
 *                   SUGGESTION; nothing is removed from the desk.
 *   buys            live lots the engine flags Below Market (the build's
 *                   stamp, lot.signal ≡ comps.engineFlagOf; printed through
 *                   lotFace().call — the same figure every surface prints),
 *                   in the reader's markets, inside the band
 *                   (interests.inPriceRange: the ranker's anchor), closing
 *                   within 7 days, ranked by comps.dealScore — THE one
 *                   flagged ranking. No new signal label anywhere.
 */
import type { AuctionLot } from '../../types';
import type { PricePref } from '../../lib/interests';
import type { Taste } from '../../lib/recs';
import type { Follow } from '../../lib/follows';
import { inPriceRange } from '../../lib/interests';
import { lotFace, fmtFace, type LotFace, type FaceCall } from '../../lib/lot-face';
import { prioStatic, closeMsOf, type AnchorSrc, type PrioStatic } from '../../lib/priority';
import { lotAllInFactor } from '../../lib/premiums';
import { dealScore, engineFlagOf } from '../../lib/comps';
import { taxonOf, MARKET_CATS, type CatKey } from '../../lib/taxonomy';
import { MARKETS, marketOf, type Market } from '../../constants';
import { closeDayOf, isOnBlock } from '../../utils';

/* ── the clock's days ──────────────────────────────────────────────────── */

/** the reader-local calendar day of an instant (YYYY-MM-DD) */
export function isoDayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tonight" / "Tomorrow" / "Tue Oct 14" — the night's word on the desk's clock */
export function nightLabel(day: string, now: number): string {
  const today = isoDayOf(now);
  if (day === today) return 'Tonight';
  if (day === isoDayOf(now + 864e5)) return 'Tomorrow';
  const d = new Date(`${day}T12:00:00`);
  if (isNaN(d.getTime())) return day || 'No close date';
  return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`;
}

/* ── the plan ──────────────────────────────────────────────────────────── */

export type PlanBasis = 'max' | AnchorSrc;

/** the one word a row's figure wears (the row tag) */
export const BASIS_TAG: Record<PlanBasis, string> = {
  max: 'Max bid', est: 'Est mid', proj: 'Proj close', engine: 'Value', bid: 'Live bid',
};
/** the figure, in full (the row's title / the help strip) */
export const BASIS_TEXT: Record<PlanBasis, string> = {
  max: 'the engine’s max bid — its walk-away hammer',
  est: 'the house estimate midpoint — hammer, before premium',
  proj: 'the live bid projected to its close by this room’s measured multiple — hammer',
  engine: 'the lectr value — the engine’s expected hammer (no estimate on the lot)',
  bid: 'the live bid on the lot — a floor, not a value',
};

export interface PlanRow {
  lot: AuctionLot;
  /** the reader-local close day (closeDayOf) */
  day: string;
  closeMs: number | null;
  /** the plan figure, hammer basis */
  hammer: number;
  basis: PlanBasis;
  /** an estimate with one published side: the midpoint IS that side */
  oneSided: boolean;
  /** hammer × the lot's premium factor (premiums.lotAllInFactor) */
  allIn: number;
  /** the premium that all-in carries, whole % */
  premiumPct: number;
  /** priority.prioStatic.edge: -0.25 (Above Market) … 1 (deep Below Market) */
  edge: number;
  /** the engine's flag % when the lot is Below Market (lotFace().call) */
  belowPct: number | null;
  face: LotFace;
  /** the ranker's anchor (for the tests and the help strip) */
  anchor: PrioStatic | null;
}

export interface PlanNight {
  day: string;
  rows: PlanRow[];
  /** the night's hammer sum */
  total: number;
  /** the night's all-in sum */
  totalAllIn: number;
  nMax: number;
  /** rows priced off something other than a max bid */
  nOther: number;
  /** hammer over the stated ceiling, null when under it or no ceiling */
  over: number | null;
  /** the suggested drops (smallestDropSet), in dropOrder, that bring the
   *  night under the ceiling */
  drops: PlanRow[];
  /** the night's hammer sum after the suggested drops */
  afterDrops: number;
  /** the lots that stay after the suggested drops */
  kept: number;
}

export interface BidPlan {
  nights: PlanNight[];
  rows: PlanRow[];
  /** live watched lots with no figure at all (no max bid, no anchor) */
  unpriced: AuctionLot[];
  total: number;
  totalAllIn: number;
  nMax: number;
  nOther: number;
  ceiling: number | null;
  overNights: number;
}

function estSides(lot: AuctionLot): { lo: number; hi: number } {
  const lo = (lot.estLowUsd ?? lot.estimateLow) || 0;
  const hi = (lot.estHighUsd ?? lot.estimateHigh) || 0;
  return { lo, hi };
}

/** ONE live watched lot's plan row — null when nothing prices it */
export function planRowOf(lot: AuctionLot, now: number): PlanRow | null {
  const face = lotFace(lot);
  const anchor = prioStatic(lot, now);
  let hammer = 0;
  let basis: PlanBasis;
  if (face.maxBid && face.maxBid.hammer > 0) {
    hammer = face.maxBid.hammer;
    basis = 'max';
  } else if (anchor && anchor.a > 0) {
    hammer = anchor.a;
    // a bid already past the estimate / value IS the price on the lot now
    basis = anchor.over ? 'bid' : anchor.src;
  } else return null;
  const factor = lotAllInFactor(lot, hammer);
  // a max-bid row's all-in is verdict.lotMaxBid's own (the same factor)
  const allIn = basis === 'max' && face.maxBid ? face.maxBid.allIn : Math.round(hammer * factor);
  const { lo, hi } = estSides(lot);
  const call: FaceCall | null = face.call;
  return {
    lot, day: closeDayOf(lot), closeMs: closeMsOf(lot), hammer, basis,
    oneSided: basis === 'est' && !(lo > 0 && hi > 0),
    allIn, premiumPct: Math.round((factor - 1) * 100),
    edge: anchor?.edge ?? 0,
    belowPct: call && call.label === 'Below Market' ? call.pct : null,
    face, anchor,
  };
}

/** the drop order on an over-budget night: lowest edge first (Above Market,
 *  then unflagged, then the shallowest flag), the engine-priced rows last,
 *  the biggest figure first within a tie — the order a suggestion is read
 *  in, and the greedy fallback past the exact search's cap */
export function dropOrder(rows: readonly PlanRow[]): PlanRow[] {
  return [...rows].sort((a, b) => {
    if (a.edge !== b.edge) return a.edge - b.edge;
    const am = a.basis === 'max' ? 1 : 0, bm = b.basis === 'max' ? 1 : 0;
    if (am !== bm) return am - bm;
    return b.hammer - a.hammer;
  });
}

/** what dropping a row costs the desk: its edge, and the engine's own
 *  pricing on it — a flagged or max-bid lot is the last to go */
const dropCost = (r: PlanRow) => r.edge + (r.basis === 'max' ? 1 : 0);

/** the exact search runs up to this many rows a night (2^20 subsets at
 *  most; a night rarely has 20 watched lots) — past it, greedy */
export const DROP_SEARCH_CAP = 20;

/** THE SMALLEST set of rows whose removal brings the night under the
 *  ceiling — as many lots stay as possible; among sets of that size the
 *  one that drops the least edge / engine pricing, then the one that keeps
 *  the most money in play. Rows come back in dropOrder (the sentence's
 *  "drop first X, then Y"). Nothing is removed from the desk. */
export function smallestDropSet(rows: readonly PlanRow[], ceiling: number): PlanRow[] {
  const total = rows.reduce((s, r) => s + r.hammer, 0);
  if (total <= ceiling) return [];
  const n = rows.length;
  if (n > DROP_SEARCH_CAP) {
    const out: PlanRow[] = [];
    let left = total;
    for (const r of dropOrder(rows)) { if (left <= ceiling) break; out.push(r); left -= r.hammer; }
    return out;
  }
  const need = total - ceiling;
  let best: { idx: number[]; cost: number; dropped: number } | null = null;
  // combinations of size k, smallest k first; the first k with a fit wins
  for (let k = 1; k <= n && !best; k++) {
    const idx: number[] = [];
    const walk = (start: number) => {
      if (idx.length === k) {
        let dropped = 0, cost = 0;
        for (const i of idx) { dropped += rows[i].hammer; cost += dropCost(rows[i]); }
        if (dropped + 1e-9 < need) return;
        if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && dropped < best.dropped)) best = { idx: [...idx], cost, dropped };
        return;
      }
      for (let i = start; i <= n - (k - idx.length); i++) { idx.push(i); walk(i + 1); idx.pop(); }
    };
    walk(0);
  }
  const chosen = best as { idx: number[] } | null;
  if (!chosen) return [...rows];
  const set = new Set(chosen.idx.map(i => rows[i]));
  return dropOrder(rows).filter(r => set.has(r));
}

/** the bid plan: every live watched lot, by close night, against the ceiling */
export function bidPlan(saved: readonly AuctionLot[], now: number, price: PricePref | null): BidPlan {
  const today = isoDayOf(now);
  const ceiling = price?.maxUsd ?? null;
  const rows: PlanRow[] = [];
  const unpriced: AuctionLot[] = [];
  for (const l of saved) {
    if (!isOnBlock(l, today, now)) continue;
    const r = planRowOf(l, now);
    if (r) rows.push(r); else unpriced.push(l);
  }
  const byDay = new Map<string, PlanRow[]>();
  for (const r of rows) {
    const k = r.day || '';
    const a = byDay.get(k);
    if (a) a.push(r); else byDay.set(k, [r]);
  }
  const nights: PlanNight[] = Array.from(byDay.entries())
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([day, rs]: [string, PlanRow[]]) => {
      rs.sort((a, b) => (a.closeMs ?? Infinity) - (b.closeMs ?? Infinity) || b.hammer - a.hammer);
      const total = rs.reduce((s, r) => s + r.hammer, 0);
      const totalAllIn = rs.reduce((s, r) => s + r.allIn, 0);
      const nMax = rs.filter(r => r.basis === 'max').length;
      const over = ceiling != null && total > ceiling ? total - ceiling : null;
      const drops = over != null ? smallestDropSet(rs, ceiling!) : [];
      const after = total - drops.reduce((s, r) => s + r.hammer, 0);
      return { day, rows: rs, total, totalAllIn, nMax, nOther: rs.length - nMax, over, drops, afterDrops: after, kept: rs.length - drops.length };
    });
  const total = rows.reduce((s, r) => s + r.hammer, 0);
  const totalAllIn = rows.reduce((s, r) => s + r.allIn, 0);
  const nMax = rows.filter(r => r.basis === 'max').length;
  return {
    nights, rows, unpriced, total, totalAllIn, nMax, nOther: rows.length - nMax, ceiling,
    overNights: nights.filter(n => n.over != null).length,
  };
}

/** "2 at max bid · 5 at estimate midpoint" — what a sum is made of */
export function basisMix(rows: readonly PlanRow[]): string {
  const n = new Map<PlanBasis, number>();
  for (const r of rows) n.set(r.basis, (n.get(r.basis) ?? 0) + 1);
  const order: PlanBasis[] = ['max', 'est', 'proj', 'engine', 'bid'];
  const word: Record<PlanBasis, string> = { max: 'at max bid', est: 'at estimate midpoint', proj: 'at projected close', engine: 'at lectr value', bid: 'at the live bid' };
  return order.filter(b => n.get(b)).map(b => `${n.get(b)} ${word[b]}`).join(' · ');
}

/* ── the reader's markets ──────────────────────────────────────────────── */

const MARKET_OF_CAT: Record<string, Market> = {};
for (const [m, cats] of Object.entries(MARKET_CATS)) for (const c of cats) MARKET_OF_CAT[c] = m as Market;

export function marketOfCat(cat: CatKey): Market {
  return MARKET_OF_CAT[cat] ?? 'all';
}

export function marketOfLot(l: AuctionLot): Market {
  return marketOfCat(taxonOf(l).cat);
}

const MARKET_KEYS = new Set<string>(MARKETS.map(m => m.key));

/** a follow's market: a maker by its lots on the book (else the artist
 *  table), a category by its key, an entity by its sj:/st: category */
export function followMarket(f: Follow, book: readonly AuctionLot[]): Market | null {
  if (f.kind === 'cat') {
    const cat = f.key.split(':')[0];
    if (MARKET_KEYS.has(cat)) return cat as Market;
    return MARKET_OF_CAT[cat] ?? null;
  }
  if (f.kind === 'entity') {
    const m = /^s[jt]:([a-z-]+)/.exec(f.key);
    return m ? (MARKET_OF_CAT[m[1]] ?? (MARKET_KEYS.has(m[1]) ? (m[1] as Market) : null)) : null;
  }
  if (f.kind === 'maker') {
    const hit = book.find(l => l.artist === f.key);
    return hit ? marketOfLot(hit) : marketOf(f.key);
  }
  return null;
}

/** the markets the desk reads — taste seeds (saves, owned, follows, the
 *  quick start's markets) and the follows; empty = every market */
export function readerMarkets(taste: Taste | null, follows: readonly Follow[], book: readonly AuctionLot[]): Set<Market> {
  const out = new Set<Market>();
  const add = (m: Market | null | undefined) => { if (m && m !== 'all') out.add(m); };
  for (const s of taste?.seeds ?? []) {
    if (s.f?.cat) add(marketOfCat(s.f.cat));
    if (s.market) {
      const w = s.market.toLowerCase();
      add(MARKETS.find(m => m.key === w || m.label.toLowerCase() === w || m.short.toLowerCase() === w)?.key);
    }
    if (s.follow) add(followMarket(s.follow, book));
  }
  for (const f of follows) add(followMarket(f, book));
  return out;
}

/* ── what your budget buys this week ───────────────────────────────────── */

export const BUYS_WINDOW_DAYS = 7;
export const BUYS_N = 6;

export interface BuyRow {
  lot: AuctionLot;
  face: LotFace;
  /** the engine's Below Market call (lotFace().call) */
  call: FaceCall;
  anchor: PrioStatic;
  closeMs: number;
  day: string;
  market: Market;
  /** comps.dealScore — THE flagged ranking */
  score: number;
}

export interface BudgetBuys {
  rows: BuyRow[];
  /** flagged lots that passed every gate (before the cut to BUYS_N) */
  candidates: number;
  markets: Market[];
  /** the band gated the list (false: no band stated — every price) */
  banded: boolean;
}

export function budgetBuys(book: readonly AuctionLot[], now: number, price: PricePref | null, markets: ReadonlySet<Market>,
  exclude: ReadonlySet<string>, n = BUYS_N): BudgetBuys {
  const today = isoDayOf(now);
  const end = now + BUYS_WINDOW_DAYS * 864e5;
  const banded = !!price && (price.minUsd != null || price.maxUsd != null);
  const out: BuyRow[] = [];
  for (const l of book) {
    if (l.status !== 'upcoming') continue;
    // the build's flag first (cheap): the same stamp lotFace prints
    const sig = l.signal !== undefined ? l.signal : engineFlagOf(l);
    if (!sig || sig.label !== 'Below Market') continue;
    if (exclude.has(l.id)) continue;
    const closeMs = closeMsOf(l);
    if (closeMs == null || closeMs <= now || closeMs > end) continue;
    if (!isOnBlock(l, today, now)) continue;
    const market = marketOfLot(l);
    if (markets.size && !markets.has(market)) continue;
    if (banded && !inPriceRange(l, price, now)) continue;
    const anchor = prioStatic(l, now);
    // a bid already past the estimate has no edge left (priority voids it)
    if (!anchor || anchor.over) continue;
    const face = lotFace(l);
    if (!face.call || face.call.label !== 'Below Market') continue;
    out.push({ lot: l, face, call: face.call, anchor, closeMs, day: closeDayOf(l), market, score: dealScore(l, face.call.pct) });
  }
  out.sort((a, b) => b.score - a.score || a.closeMs - b.closeMs);
  return { rows: out.slice(0, n), candidates: out.length, markets: Array.from(markets).sort(), banded };
}

/* ── if you win ─────────────────────────────────────────────────────────── */

export interface WinTotals {
  rows: PlanRow[];
  hammer: number;
  allIn: number;
  /** the premiums alone */
  premiums: number;
  /** the premium as a share of the hammer sum, whole % */
  premiumPct: number | null;
}

/** every plan row's all-in, summed — hammer figures and premiums kept apart */
export function winTotals(plan: BidPlan): WinTotals {
  const rows = [...plan.rows].sort((a, b) => b.allIn - a.allIn);
  const hammer = rows.reduce((s, r) => s + r.hammer, 0);
  const allIn = rows.reduce((s, r) => s + r.allIn, 0);
  return { rows, hammer, allIn, premiums: allIn - hammer, premiumPct: hammer > 0 ? Math.round(((allIn - hammer) / hammer) * 100) : null };
}

/** "$12K → $15K all-in" */
export function allInText(r: Pick<PlanRow, 'hammer' | 'allIn'>): string {
  return `${fmtFace(r.hammer)} → ${fmtFace(r.allIn)} all-in`;
}
