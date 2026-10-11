/**
 * first-screen-select.ts — what each first screen PRINTS, as pure functions
 * of (the eager book, the clock, the reader's day). Perf wave W13, Oct 11 2026.
 *
 * A phone on Slow 4G spent ~14s downloading the whole eager book (~1.6MB
 * brotli) before any route painted. The first-screen payloads
 * (app/lib/first-screen, scripts/emit-first-screen.ts) ship a SLICE of the
 * same eager rows — never a recomputed or rounded number: every row is the
 * book's own row, run through the same code. These selectors are how the
 * slice is chosen and how it is proven:
 *
 *   build    the emitter runs each selector over the WHOLE book across a
 *            clock sweep (every 20 minutes for 48h, every reader day a time
 *            zone can be on) and ships the union of every lot any of them
 *            needs, closed under the row's own references (fold groups,
 *            cross-house twins);
 *   test     app/lib/__tests__/first-screen.test.ts asserts each selector
 *            over the slice equals the selector over the whole book;
 *   runtime  in development, the moment the whole book lands the client
 *            re-runs the selector over both and logs any mismatch
 *            (useRayData verifyFirstScreen) — and in every build the whole
 *            book REPLACES the slice, so a mismatch can only ever be a frame.
 *
 * What a slice cannot answer — a count over the whole live book ("9,667
 * lots", "96 flags of 4,373 live") — the first screen prints as loading
 * ('—'), never as the slice's own count.
 */
import type { AuctionLot } from '../types';
import { ARTISTS, ARTIST_MARKET, marketArtists, type Market } from '../constants';
import { isLiveUpcoming, isOnBlock, trueSaleDay } from '../utils';
import { feedPass } from './lot-browser';
import { shortlist } from './priority';
import { foldKeyOf } from './fold';
import { TRIAGE_DEFAULTS } from './feed-filters';
import type { FeedFilters } from '../components/FeedToolbar';
import { dealScore, lotFitsMarket } from './comps';
import { isFlagged } from './flags';
import { sleeperRead } from './lanes';

/** the default feed state (FeedToolbar FEED_DEFAULTS, restated so this
 *  module never imports a component) — the first screen renders ONLY the
 *  default view; a remembered or linked view waits for the whole book */
export const FS_FEED_DEFAULTS: FeedFilters = {
  query: '', vertical: null, maker: null, subj: null, sport: null, category: null,
  belowOnly: false, sort: 'priority', saleDay: null, ...TRIAGE_DEFAULTS, tab: 'top',
};

type Lot = AuctionLot & { ek?: string | null };

// ── home: "What matters" over the total market ─────────────────────────────
/** the ids the home feed's default "What matters" tab lists, in order —
 *  TerminalHome's `upcoming` → LotBrowser's feedPass → shortlist(20) */
export function homeFeedIds(allLots: readonly AuctionLot[], nowMs: number, today: string, crawlDay: string): string[] {
  const mkt = marketArtists('all');
  const upcoming = allLots
    .filter(l => mkt.has(l.artist) && isLiveUpcoming(l, today, 1, nowMs))
    .sort((a, b) => (trueSaleDay(a) < trueSaleDay(b) ? -1 : trueSaleDay(a) > trueSaleDay(b) ? 1 : 0));
  const feedAll = feedPass(upcoming, FS_FEED_DEFAULTS, {
    belowIds: new Set(), belowPct: new Map(), prevVisitDay: null,
    // (the default view runs no "new" lens — the baselines are never read)
    baselines: new Map(), crawlDay, pageSize: 12, scoped: false, nowMs,
  });
  return shortlist(feedAll, nowMs, 20).map(l => l.id);
}

/** a set of rows closed under what a printed row reads of OTHER lots: its
 *  fold group (same card / same title at one house — the "Also PSA 8" note)
 *  and its cross-house twins (crossLive — "Also live at REA · $220 bid"),
 *  transitively, exactly as foldVariants unions them */
export function closeOverRefs(allLots: readonly AuctionLot[], seed: Iterable<string>): Set<string> {
  const byKey = new Map<string, string[]>();
  const keyOf = new Map<string, string>();
  const crossTo = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let s = crossTo.get(a); if (!s) crossTo.set(a, (s = new Set())); s.add(b);
  };
  for (const l of allLots) {
    const fk = foldKeyOf(l);
    if (fk) {
      keyOf.set(l.id, fk.key);
      const a = byKey.get(fk.key); if (a) a.push(l.id); else byKey.set(fk.key, [l.id]);
    }
    for (const x of l.crossLive || []) if (x && x.id) { link(l.id, x.id); link(x.id, l.id); }
  }
  const out = new Set<string>();
  const stack = Array.from(seed);
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const k = keyOf.get(id);
    if (k) for (const m of byKey.get(k) || []) if (!out.has(m)) stack.push(m);
    crossTo.get(id)?.forEach(m => { if (!out.has(m)) stack.push(m); });
  }
  return out;
}

// ── /value: the flags, the call, the sleepers ───────────────────────────────
/** the lots /value's first screen can print a row or a count for: every
 *  Below-Market flag (the board, the call, the masthead sums, the triage
 *  chips), every dead-room appraised lot (the Sleepers and their queue), and
 *  every lot whose Gap cell validated (gapOk). Clock-free: the live window
 *  is applied on the client, to the book's own rows. */
export function valueCandidate(l: AuctionLot): boolean {
  if (l.signal && l.signal.label === 'Below Market') return true;
  if (isFlagged(l)) return true;
  if (typeof l.bidCount === 'number' && l.bidCount === 0 && (l.value?.compValueUsd ?? 0) > 0) return true;
  return l.gapOk === true;
}

/** what /value prints from the book, as ids (the dev check and the test) */
export function valueRead(allLots: readonly AuctionLot[], market: Market, nowMs: number, today: string) {
  const set = marketArtists(market);
  const marketLots = allLots.filter(l => set.has(l.artist));
  const deals = marketLots
    .filter(l => isOnBlock(l, today, nowMs) && l.signal && l.signal.label === 'Below Market')
    .sort((a, b) => dealScore(b, b.signal!.pct) - dealScore(a, a.signal!.pct));
  const call = deals.filter(l => isLiveUpcoming(l, today, 1, nowMs) && !l.resultsPending
    && (!l.saleDateTime || Date.parse(l.saleDateTime) > nowMs)
    && (market === 'all' || lotFitsMarket(l, market))
    && ['very-high', 'high', 'medium'].includes(l.signal!.confidence || 'low'));
  const callLot = call.slice(0, 8).find(l => l.imageUrl) || call[0] || null;
  const sleepers = marketLots.filter(l => isOnBlock(l, today, nowMs) && sleeperRead(l, nowMs)).map(l => l.id);
  return { deals: deals.map(l => l.id), call: callLot?.id ?? null, sleepers };
}

// ── /makers: the maker rows (art · design · watches) ───────────────────────
/** the maker markets — rows keyed by the lot's own maker slug */
export const MAKER_ROW_MARKETS: ReadonlySet<Market> = new Set<Market>(['art', 'design', 'watches']);
const MAKER_SLUGS: ReadonlySet<string> = new Set<string>(ARTISTS.filter(a => MAKER_ROW_MARKETS.has(a.market)).map(a => a.slug));
/** every eager lot a maker row (or its group head) counts */
export function makersCandidate(l: AuctionLot): boolean {
  return MAKER_SLUGS.has(l.artist);
}
/** each maker row's live + flagged counts (the dev check and the test) */
export function makersRead(allLots: readonly AuctionLot[], nowMs: number, today: string): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const l of allLots) {
    if (!MAKER_SLUGS.has(l.artist) || !isOnBlock(l, today, nowMs)) continue;
    const r = out[l.artist] || (out[l.artist] = [0, 0]);
    r[0]++;
    if (isFlagged(l)) r[1]++;
  }
  return out;
}

// ── entity pages: one entity's live book ───────────────────────────────────
/** an entity's live book, in the page's hammer order (EntityPage `live`) */
export function entityLiveIds(allLots: readonly Lot[], id: string, nowMs: number, today: string): string[] {
  return allLots
    .filter(l => isOnBlock(l, today, nowMs) && l.ek === id)
    .sort((a, b) => (trueSaleDay(a) < trueSaleDay(b) ? -1 : trueSaleDay(a) > trueSaleDay(b) ? 1 : 0))
    .map(l => l.id);
}

/** a market a maker slug belongs to (the makers payload's scope check) */
export function makerMarketOf(slug: string): Market | undefined {
  return ARTIST_MARKET[slug];
}

/**
 * DEVELOPMENT CROSS-CHECK — the moment the whole book lands, re-run the
 * first screen's selector over the slice the page painted and over the book,
 * on the same clock, and say so out loud if they differ. (The book replaces
 * the slice in every build; this is how a selector that drifted from its page
 * is caught before it ships.)
 */
export function verifyFirstScreen(key: string, slice: readonly AuctionLot[], book: readonly AuctionLot[]): boolean {
  const now = Date.now();
  const today = localDay(now);
  const crawlDay = today;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true;
  let detail: unknown = null;
  if (key === 'home') {
    const a = homeFeedIds(slice, now, today, crawlDay), b = homeFeedIds(book, now, today, crawlDay);
    ok = same(a, b); detail = { slice: a, book: b };
  } else if (key === 'value') {
    const a = valueRead(slice, 'all', now, today), b = valueRead(book, 'all', now, today);
    ok = same(a, b); detail = { slice: a, book: b };
  } else if (key === 'makers') {
    const a = makersRead(slice, now, today), b = makersRead(book, now, today);
    ok = same(a, b); detail = { slice: a, book: b };
  } else if (key.startsWith('ent-')) {
    const eks = new Set<string>();
    for (const l of slice as Lot[]) if (l.ek) eks.add(l.ek);
    eks.forEach(ek => {
      const a = entityLiveIds(slice as Lot[], ek, now, today), b = entityLiveIds(book as Lot[], ek, now, today);
      if (!same(a, b)) { ok = false; detail = { ek, slice: a, book: b }; }
    });
  }
  if (!ok) console.error(`[first-screen] ${key}: the slice painted something the book does not say`, detail);
  else console.info(`[first-screen] ${key}: slice = book ✓`);
  return ok;
}

/** the reader's calendar day at `ms` (utils localToday, on an explicit clock) */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
