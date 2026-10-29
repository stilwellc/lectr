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
 *   counted         (R1#7, review fix wave) a night's SUM carries only the
 *                   rows priced by the engine or by the room — a max bid,
 *                   a projected close, a lectr value, a live bid. A row at
 *                   the house ESTIMATE MIDPOINT is a bid the reader never
 *                   chose: it is listed ("no max bid yet — the estimate
 *                   midpoint would be $X"), kept apart in `estTotal`, and
 *                   joins the sum only when the reader asks (`estInPlan`).
 *                   A ONE-SIDED estimate (priced.ts: one bound published)
 *                   prints "from $X" and is never summed, toggle or not.
 *   all-in          plan figure × the lot's buyer's-premium factor —
 *                   premiums.lotAllInFactor (the lot's own stamped premium,
 *                   else the house schedule in force on its sale date). A
 *                   max-bid row's all-in IS verdict.lotMaxBid's (same call).
 *   night           closeDayOf (app/utils) — the reader's TRUE close day.
 *   over budget     a night's COUNTED hammer sum against the stated ceiling
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
 *   tease           (R3#7) before the reader has stated a market, the buys
 *                   list is ONE ROW PER MARKET — "Art · 11 below market this
 *                   week" — counting the same candidates, floored at comps
 *                   n ≥ TEASE_MIN_N so a market is never teased on thin pools.
 */
import type { AuctionLot } from '../../types';
import { onBlockOf } from '../../lib/live-pool';
import type { PricePref } from '../../lib/interests';
import type { Taste } from '../../lib/recs';
import type { Follow } from '../../lib/follows';
import { inPriceRange } from '../../lib/interests';
import { lotFace, fmtFace, type LotFace, type FaceCall } from '../../lib/lot-face';
import { prioStatic, closeMsOf, type AnchorSrc, type PrioStatic } from '../../lib/priority';
import { lotAllInFactor, premiumScheduleKnown } from '../../lib/premiums';
import { dealScore, engineFlagOf } from '../../lib/comps';
import { taxonOf, MARKET_CATS, type CatKey } from '../../lib/taxonomy';
import { MARKETS, marketOf, type Market } from '../../constants';
import { closeDayOf, isOnBlock } from '../../utils';
import { estBandOf } from './priced';

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
  if (day && day < today) return 'Result pending';
  if (day === today) return 'Tonight';
  if (day === isoDayOf(now + 864e5)) return 'Tomorrow';
  const d = new Date(`${day}T12:00:00`);
  if (isNaN(d.getTime())) return day || 'No close date';
  return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`;
}

/* ── the plan ──────────────────────────────────────────────────────────── */

export type PlanBasis = 'mine' | 'max' | AnchorSrc;

/** the one word a row's figure wears (the row tag) */
export const BASIS_TAG: Record<PlanBasis, string> = {
  mine: 'My max', max: 'Max bid', est: 'Est mid', proj: 'Proj close', engine: 'Value', bid: 'Live bid',
};
/** the figure, in full (the row's title / the help strip) */
export const BASIS_TEXT: Record<PlanBasis, string> = {
  mine: 'your own max — the most you said you would pay (hammer, before premium)',
  max: 'the engine’s max bid — its walk-away hammer',
  est: 'the house estimate midpoint — hammer, before premium; not a bid you chose, so it is listed and not summed unless you ask',
  proj: 'the live bid projected to its close by this room’s measured multiple — hammer',
  engine: 'the lectr value — the engine’s expected hammer (no estimate on the lot)',
  bid: 'the live bid on the lot — a floor, not a value',
};

/** the tag a row prints: a one-sided estimate names its one side */
export function rowTag(r: Pick<PlanRow, 'basis' | 'side'>): string {
  if (r.basis === 'est' && r.side) return r.side === 'low' ? 'Est low' : 'Est high';
  return BASIS_TAG[r.basis];
}

export interface PlanRow {
  lot: AuctionLot;
  /** the reader-local close day (closeDayOf) */
  day: string;
  closeMs: number | null;
  /** the plan figure, hammer basis */
  hammer: number;
  basis: PlanBasis;
  /** an estimate with one published side: the figure IS that side */
  oneSided: boolean;
  /** which side, when one-sided */
  side: 'low' | 'high' | null;
  /** priced by the engine or the room (max / proj / engine / bid) — the rows
   *  a night's sum carries by default; an estimate-midpoint row is not */
  counted: boolean;
  /** hammer × the lot's premium factor (premiums.lotAllInFactor) */
  allIn: number;
  /** the premium that all-in carries, whole % */
  premiumPct: number;
  /** where that premium comes from: the lot's own stamped rate, the house's
   *  schedule on the sale date, or the 1.25 ASSUMPTION for a house with no
   *  schedule on file (the row says "assumed") */
  premiumSource: 'stamped' | 'schedule' | 'assumed';
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
  /** the night's hammer sum — the counted rows (+ the two-sided estimate
   *  rows when `estInPlan`) */
  total: number;
  /** the night's all-in sum, same rows */
  totalAllIn: number;
  nMax: number;
  /** rows priced off something other than a max bid */
  nOther: number;
  /** the rows in the sum */
  nCounted: number;
  /** two-sided estimate-midpoint rows (listed; summed only when estInPlan) */
  nEst: number;
  estTotal: number;
  estAllIn: number;
  /** one-sided estimate rows ("from $X"; never summed) */
  nFrom: number;
  fromSum: number;
  /** hammer over the stated ceiling, null when under it or no ceiling */
  over: number | null;
  /** the suggested drops (smallestDropSet over the summed rows), in
   *  dropOrder, that bring the night under the ceiling */
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
  /** the summed rows' hammer / all-in (see PlanNight.total) */
  total: number;
  totalAllIn: number;
  nMax: number;
  nOther: number;
  nCounted: number;
  nEst: number;
  estTotal: number;
  estAllIn: number;
  nFrom: number;
  fromSum: number;
  ceiling: number | null;
  overNights: number;
  /** the estimate-midpoint rows were summed (the reader's toggle) */
  estInPlan: boolean;
}

export interface PlanOptions {
  /** sum the two-sided estimate-midpoint rows too (default false — R1#7) */
  estInPlan?: boolean;
}

/** ONE live watched lot's plan row — null when nothing prices it */
export function planRowOf(lot: AuctionLot, now: number, myMax: number | null = null): PlanRow | null {
  const face = lotFace(lot);
  const anchor = prioStatic(lot, now);
  let hammer = 0;
  let basis: PlanBasis;
  // (Oct 20 audit) YOUR max leads: the plan is your money, the engine's figure is context
  if (myMax != null && myMax > 0) {
    hammer = myMax;
    basis = 'mine';
  } else if (face.maxBid && face.maxBid.hammer > 0) {
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
  const est = estBandOf(lot);
  const oneSided = basis === 'est' && !!est && !est.priced;
  const call: FaceCall | null = face.call;
  return {
    lot, day: closeDayOf(lot), closeMs: closeMsOf(lot), hammer, basis,
    oneSided, side: oneSided ? est!.side : null,
    counted: basis !== 'est',
    allIn, premiumPct: Math.round((factor - 1) * 100), premiumSource: premiumSourceOf(lot),
    edge: anchor?.edge ?? 0,
    belowPct: call && call.label === 'Below Market' ? call.pct : null,
    face, anchor,
  };
}

/** where a lot's premium factor comes from (see PlanRow.premiumSource) */
export function premiumSourceOf(lot: Pick<AuctionLot, 'auctionHouse' | 'buyerPremiumPct'>): PlanRow['premiumSource'] {
  const bp = lot.buyerPremiumPct;
  if (typeof bp === 'number' && bp > 0 && bp < 60) return 'stamped';
  return premiumScheduleKnown(lot.auctionHouse) ? 'schedule' : 'assumed';
}

/** "27% premium" / "25% premium, assumed" — the all-in's qualifier */
export function premiumText(r: Pick<PlanRow, 'premiumPct' | 'premiumSource'>): string {
  return `${r.premiumPct}% premium${r.premiumSource === 'assumed' ? ', assumed (no schedule on file for this house)' : ''}`;
}

/** the rows a night's sum carries under the plan's option */
export function summedRows(rows: readonly PlanRow[], estInPlan: boolean): PlanRow[] {
  return rows.filter(r => r.counted || (estInPlan && r.basis === 'est' && !r.oneSided));
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

const sum = (rows: readonly PlanRow[], k: 'hammer' | 'allIn') => rows.reduce((s, r) => s + r[k], 0);

/** the bid plan: every live watched lot, by close night, against the ceiling */
export function bidPlan(saved: readonly AuctionLot[], now: number, price: PricePref | null, opts: PlanOptions = {}, maxOf: (id: string) => number | null = () => null): BidPlan {
  const estInPlan = !!opts.estInPlan;
  const today = isoDayOf(now);
  const ceiling = price?.maxUsd ?? null;
  const rows: PlanRow[] = [];
  const unpriced: AuctionLot[] = [];
  for (const l of saved) {
    if (!isOnBlock(l, today, now)) continue;
    const r = planRowOf(l, now, maxOf(l.id));
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
      const summed = summedRows(rs, estInPlan);
      const estRows = rs.filter(r => r.basis === 'est' && !r.oneSided);
      const fromRows = rs.filter(r => r.oneSided);
      const total = sum(summed, 'hammer');
      const totalAllIn = sum(summed, 'allIn');
      const nMax = rs.filter(r => r.basis === 'max').length;
      const over = ceiling != null && total > ceiling ? total - ceiling : null;
      const drops = over != null ? smallestDropSet(summed, ceiling!) : [];
      const after = total - sum(drops, 'hammer');
      return {
        day, rows: rs, total, totalAllIn, nMax, nOther: rs.length - nMax, nCounted: summed.length,
        nEst: estRows.length, estTotal: sum(estRows, 'hammer'), estAllIn: sum(estRows, 'allIn'),
        nFrom: fromRows.length, fromSum: sum(fromRows, 'hammer'),
        over, drops, afterDrops: after, kept: summed.length - drops.length,
      };
    });
  const summed = summedRows(rows, estInPlan);
  const estRows = rows.filter(r => r.basis === 'est' && !r.oneSided);
  const fromRows = rows.filter(r => r.oneSided);
  const nMax = rows.filter(r => r.basis === 'max').length;
  return {
    nights, rows, unpriced,
    total: sum(summed, 'hammer'), totalAllIn: sum(summed, 'allIn'),
    nMax, nOther: rows.length - nMax, nCounted: summed.length,
    nEst: estRows.length, estTotal: sum(estRows, 'hammer'), estAllIn: sum(estRows, 'allIn'),
    nFrom: fromRows.length, fromSum: sum(fromRows, 'hammer'),
    ceiling, overNights: nights.filter(n => n.over != null).length, estInPlan,
  };
}

/** "2 at max bid · 5 at estimate midpoint" — what a set of rows is made of */
export function basisMix(rows: readonly PlanRow[]): string {
  const n = new Map<PlanBasis, number>();
  for (const r of rows) n.set(r.basis, (n.get(r.basis) ?? 0) + 1);
  const order: PlanBasis[] = ['mine', 'max', 'est', 'proj', 'engine', 'bid'];
  const word: Record<PlanBasis, string> = { mine: 'at your max', max: 'at max bid', est: 'at estimate midpoint', proj: 'at projected close', engine: 'at lectr value', bid: 'at the live bid' };
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

/** the markets the desk reads. STATED first (R4#8): the follows and the
 *  quick start's market seeds; the saved / owned lots' categories are
 *  folded in only when nothing was stated — a collector who follows three
 *  names in art and watches is not "7 markets you watch" because of what
 *  they once saved. Empty = every market. */
export function readerMarkets(taste: Taste | null, follows: readonly Follow[], book: readonly AuctionLot[]): Set<Market> {
  const stated = new Set<Market>();
  const implied = new Set<Market>();
  const add = (set: Set<Market>, m: Market | null | undefined) => { if (m && m !== 'all') set.add(m); };
  for (const s of taste?.seeds ?? []) {
    if (s.market) {
      const w = s.market.toLowerCase();
      add(stated, MARKETS.find(m => m.key === w || m.label.toLowerCase() === w || m.short.toLowerCase() === w)?.key);
    } else if (s.follow) add(stated, followMarket(s.follow, book));
    else if (s.f?.cat) add(implied, marketOfCat(s.f.cat));
  }
  for (const f of follows) add(stated, followMarket(f, book));
  return stated.size ? stated : implied;
}

/* ── what your budget buys this week ───────────────────────────────────── */

export const BUYS_WINDOW_DAYS = 7;
export const BUYS_N = 6;
/** a market is teased only on lots whose comps pool has at least this many sales */
export const TEASE_MIN_N = 5;

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

/** every Below Market candidate: flagged, not on the desk, closing inside
 *  the window, in the markets (none = all), inside the band, edge left */
function buyCandidates(book: readonly AuctionLot[], now: number, price: PricePref | null, markets: ReadonlySet<Market>, exclude: ReadonlySet<string>): BuyRow[] {
  const today = isoDayOf(now);
  const end = now + BUYS_WINDOW_DAYS * 864e5;
  const banded = !!price && (price.minUsd != null || price.maxUsd != null);
  const out: BuyRow[] = [];
  // (pass 6) the shared on-block index (lib/live-pool): the lots on the block, read once per book
  for (const l of onBlockOf(book, today, now)) {
    // the build's flag first (cheap): the same stamp lotFace prints
    const sig = l.signal !== undefined ? l.signal : engineFlagOf(l);
    if (!sig || sig.label !== 'Below Market') continue;
    if (exclude.has(l.id)) continue;
    const closeMs = closeMsOf(l);
    if (closeMs == null || closeMs <= now || closeMs > end) continue;
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
  return out;
}

export function budgetBuys(book: readonly AuctionLot[], now: number, price: PricePref | null, markets: ReadonlySet<Market>,
  exclude: ReadonlySet<string>, n = BUYS_N): BudgetBuys {
  const banded = !!price && (price.minUsd != null || price.maxUsd != null);
  const out = buyCandidates(book, now, price, markets, exclude);
  return { rows: out.slice(0, n), candidates: out.length, markets: Array.from(markets).sort(), banded };
}

export interface MarketTease {
  market: Market;
  label: string;
  /** Below Market candidates this week with comps n ≥ TEASE_MIN_N */
  n: number;
  /** the soonest of them closes */
  soonestMs: number;
}

/** THE COLD TEASE (R3#7): no market stated → one row per market, the count
 *  of this week's Below Market candidates whose comps pool clears the n
 *  floor, in the site's market order with the busiest first; a market with
 *  none is absent */
export function marketTease(book: readonly AuctionLot[], now: number, price: PricePref | null, exclude: ReadonlySet<string>, minN = TEASE_MIN_N): MarketTease[] {
  const by = new Map<Market, MarketTease>();
  for (const c of buyCandidates(book, now, price, new Set(), exclude)) {
    const n = c.face.comps?.n ?? 0;
    if (n < minN) continue;
    const m = MARKETS.find(x => x.key === c.market);
    if (!m || m.key === 'all') continue;
    const t = by.get(c.market);
    if (t) { t.n++; if (c.closeMs < t.soonestMs) t.soonestMs = c.closeMs; }
    else by.set(c.market, { market: c.market, label: m.label, n: 1, soonestMs: c.closeMs });
  }
  return Array.from(by.values()).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
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

/** the summed plan rows' all-in — hammer figures and premiums kept apart
 *  (the plan's own rule: counted rows, + estimate rows when estInPlan) */
export function winTotals(plan: BidPlan): WinTotals {
  const rows = summedRows(plan.rows, plan.estInPlan).sort((a, b) => b.allIn - a.allIn);
  const hammer = rows.reduce((s, r) => s + r.hammer, 0);
  const allIn = rows.reduce((s, r) => s + r.allIn, 0);
  return { rows, hammer, allIn, premiums: allIn - hammer, premiumPct: hammer > 0 ? Math.round(((allIn - hammer) / hammer) * 100) : null };
}

/** "$12K → $15K all-in" */
export function allInText(r: Pick<PlanRow, 'hammer' | 'allIn'>): string {
  return `${fmtFace(r.hammer)} → ${fmtFace(r.allIn)} all-in`;
}
