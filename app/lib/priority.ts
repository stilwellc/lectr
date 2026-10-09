/**
 * priority.ts — the "matters most" order for live lots (Oct 8).
 *
 *   S = 40·Size + 25·Edge + 20·Evidence + 15·Urgency      (0–100)
 *
 * Weighted mostly on plain facts, because live the house estimate beats the
 * engine (Sep served record: engine medErr 71% vs house 32%):
 *  - Size: log scale of the hammer anchor, $2.5K → 0 … $1M → 1. Anchor order:
 *    house estimate midpoint (estimates on the served book are ALREADY USD —
 *    never re-convert by `currency`), then engine expected hammer, then a
 *    validated bid projection, then the live bid (a floor, not a value).
 *  - Edge: the certified "Below Market" flag, ONLY in the categories where the
 *    backtest measured a real edge (art, design, culture, science: ~+21pt
 *    all-in margin). Sports/watches flags are held by the engine and TCG/cards
 *    never flag, so Edge is 0 there. "Above Market" costs a little.
 *  - Evidence: engine confidence, or a house estimate where estimates are sound.
 *  - Urgency: closes ≤24h 1 · ≤72h 0.6 · ≤7d 0.25. Computed at VIEW time so it
 *    never goes stale intraday. Nothing is stamped on the payload: every input
 *    is already on the served lot (build-upcoming only logs the counts).
 */
import { taxonOf, type CatKey } from './taxonomy';

const FLOOR = 2500;
const LOG_LO = Math.log10(FLOOR);
const LOG_HI = Math.log10(1_000_000);
/** categories where Below-Market flags carried a measured edge in the backtest */
const EDGE_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['fine-art', 'design', 'entertainment', 'historical', 'space-science']);
/** categories where a house estimate is a sound evidence anchor */
const EST_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['fine-art', 'design', 'watches', 'entertainment', 'historical', 'space-science']);

export type AnchorSrc = 'est' | 'engine' | 'proj' | 'bid';

/** The static, time-independent parts of the score. */
export interface PrioStatic {
  a: number;          // hammer-basis USD anchor
  src: AnchorSrc;
  size: number;       // 0–1
  edge: number;       // -0.25 … 1
  ev: number;         // 0–1
}

type ScoreLot = {
  artist?: string | null; subCat?: string | null; drill?: string | null;
  estimateLow?: number | null; estimateHigh?: number | null;
  estLowUsd?: number | null; estHighUsd?: number | null;
  currentBid?: number | null;
  saleDate?: string | null; saleDateTime?: string | null;
  value?: { expectedHammerUsd?: number | null; confidence?: string | null; signal?: { beatRatePct?: number | null } | null } | null;
  signal?: { label?: string | null } | null;
  bidProj?: { ok?: boolean; allIn?: number } | null;
};

function anchorOf(l: ScoreLot): { a: number; src: AnchorSrc } | null {
  let lo = (l.estLowUsd ?? l.estimateLow) || 0;
  let hi = (l.estHighUsd ?? l.estimateHigh) || 0;
  lo = lo || hi; hi = hi || lo;
  if (lo > 0) return { a: (lo + hi) / 2, src: 'est' };
  const eh = l.value?.expectedHammerUsd;
  if (eh && eh > 0) return { a: eh, src: 'engine' };
  // validated projection only; allIn carries the buyer's premium (~1.22×) — back it out to hammer
  if (l.bidProj?.ok === true && (l.bidProj.allIn || 0) > 0) return { a: (l.bidProj.allIn as number) / 1.22, src: 'proj' };
  if ((l.currentBid || 0) > 0) return { a: l.currentBid as number, src: 'bid' };
  return null;
}

/** Time-independent parts. null = no price anchor at all (can't be ranked by size). */
export function prioStatic(l: ScoreLot): PrioStatic | null {
  const an = anchorOf(l);
  if (!an) return null;
  const { cat } = taxonOf(l);
  const size = Math.min(1, Math.max(0, (Math.log10(Math.max(an.a, 1)) - LOG_LO) / (LOG_HI - LOG_LO)));
  let edge = 0;
  const label = l.signal?.label;
  if (label === 'Below Market' && EDGE_CATS.has(cat)) {
    const br = l.value?.signal?.beatRatePct ?? 0;
    edge = Math.min(1, Math.max(0, (br - 32) / 20)); // lift over the at-market bucket (~32%)
  } else if (label === 'Above Market') {
    edge = -0.25;
  }
  const conf = l.value?.confidence;
  let ev = conf === 'high' ? 1 : conf === 'medium' ? 0.7 : conf === 'low' ? 0.4 : 0;
  if (an.src === 'est' && EST_CATS.has(cat)) ev = Math.max(ev, 0.5);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { a: Math.round(an.a), src: an.src, size: r2(size), edge: r2(edge), ev: r2(ev) };
}

/** Close time in ms. A date-only sale closes at the end of that day. */
export function closeMsOf(l: ScoreLot): number | null {
  const iso = l.saleDateTime || (l.saleDate ? `${l.saleDate}T23:59:00Z` : null);
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}

export function urgencyOf(closeMs: number | null, nowMs: number): number {
  if (closeMs == null) return 0;
  const h = (closeMs - nowMs) / 3_600_000;
  if (h <= 0) return 0;
  return h <= 24 ? 1 : h <= 72 ? 0.6 : h <= 168 ? 0.25 : 0;
}

export interface Priority extends PrioStatic { urg: number; score: number }

/** Full score at a given moment. */
export function priorityOf(l: ScoreLot, nowMs: number = Date.now()): Priority | null {
  const st = prioStatic(l);
  if (!st) return null;
  const urg = urgencyOf(closeMsOf(l), nowMs);
  const score = 40 * st.size + 25 * st.edge + 20 * st.ev + 15 * urg;
  return { ...st, urg, score: Math.round(score * 10) / 10 };
}

/** Sort comparator: score desc, then sooner close, then bigger anchor. Unanchored lots sink. */
export function byPriority(nowMs: number = Date.now()) {
  return (x: ScoreLot, y: ScoreLot): number => {
    const px = priorityOf(x, nowMs), py = priorityOf(y, nowMs);
    if (!px || !py) return px ? -1 : py ? 1 : 0;
    if (py.score !== px.score) return py.score - px.score;
    const cx = closeMsOf(x) ?? Infinity, cy = closeMsOf(y) ?? Infinity;
    if (cx !== cy) return cx - cy;
    return py.a - px.a;
  };
}

/** Pseudo-artist slugs — never a real "maker", so the per-maker cap must not bundle them. */
const GENERIC_MAKERS = new Set([
  'sports-cards', 'graded-cards', 'unopened-wax', 'pokemon', 'autographs', 'game-used', 'sports-memorabilia',
  'memorabilia', 'equipment-artifacts', 'trophies-awards', 'tickets-passes', 'programs-publications', 'type-1-photos',
  'entertainment-memorabilia', 'movie-tv', 'music-memorabilia', 'pop-memorabilia', 'space-exploration',
  'science-tech', 'meteorites', 'fossils', 'scientific-instruments',
]);

type ShortlistLot = ScoreLot & { id?: string; auctionHouse?: string; saleName?: string | null };

/**
 * The anonymous "What matters today" shortlist: ≥$2.5K anchor, closes within 7
 * days, has evidence; top `n` with caps (≤5 per category, ≤3 per sale, ≤2 per
 * real maker) so one mass close or one house can't fill the board.
 */
export function shortlist<T extends ShortlistLot>(lots: T[], nowMs: number = Date.now(), n = 20): T[] {
  const rows: { l: T; p: Priority; close: number }[] = [];
  for (const l of lots) {
    const p = priorityOf(l, nowMs);
    const close = closeMsOf(l);
    if (!p || close == null) continue;
    const h = (close - nowMs) / 3_600_000;
    if (h <= 0 || h > 168) continue;
    if (p.a < FLOOR) continue;
    if (p.ev <= 0 && p.src !== 'est') continue;
    rows.push({ l, p, close });
  }
  rows.sort((x, y) => (y.p.score - x.p.score) || (x.close - y.close) || (y.p.a - x.p.a));
  const perCat = new Map<string, number>(), perSale = new Map<string, number>(), perMaker = new Map<string, number>();
  const out: T[] = [];
  for (const { l } of rows) {
    const cat = taxonOf(l).cat;
    const sale = `${l.auctionHouse}|${l.saleDate}|${l.saleName ?? ''}`;
    const maker = l.artist && !GENERIC_MAKERS.has(l.artist) ? l.artist : `id:${l.id}`;
    if ((perCat.get(cat) ?? 0) >= 5 || (perSale.get(sale) ?? 0) >= 3 || (perMaker.get(maker) ?? 0) >= 2) continue;
    out.push(l);
    perCat.set(cat, (perCat.get(cat) ?? 0) + 1);
    perSale.set(sale, (perSale.get(sale) ?? 0) + 1);
    perMaker.set(maker, (perMaker.get(maker) ?? 0) + 1);
    if (out.length >= n) break;
  }
  return out;
}
