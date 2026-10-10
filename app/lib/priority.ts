/**
 * priority.ts — the "matters most" order for live lots (Oct 8).
 *
 *   S = 40·Size + 25·Edge + 20·Evidence + 15·Urgency      (0–100)
 *
 * Oct 9: Size is read on each MARKET's own scale (a $40K rookie is a big card,
 * a $40K painting is a minor one) — on one $2.5K–$1M scale 87% of sports cards
 * scored Size 0, the first 48 "Matters most" cards were 44 fine art, and the
 * top 15 paintings tied at the $1M ceiling. Bids count as evidence for
 * bid-anchored lots (a 14-bid card is a price the room agrees on), and a live
 * bid past the estimate becomes the anchor and voids the Below-Market edge.
 *
 * Weighted mostly on plain facts, because live the house estimate beats the
 * engine (Sep served record: engine medErr 71% vs house 32%):
 *  - Size: log scale of the hammer anchor, on the market's own scale. Anchor
 *    order (Oct 9 anchor study, graded against the hammer on lots that sold
 *    after sitting in the served book):
 *      · estimate houses (art, design, watches; RR): the house estimate
 *        midpoint (estimates on the served book are ALREADY USD — never
 *        re-convert by `currency`). Art 27% median error vs engine 104%.
 *      · bid rooms (Goldin, REA, Memory Lane, NFL, Hake's): the live bid
 *        PROJECTED to its close (CLOSE_K: bid × the room's measured multiple
 *        by days out × bid size), blended with a sound engine read. Cards
 *        40% median error vs 67% under the old est → engine → bid order,
 *        whose engine read ran 198% and whose raw bid ran 46% low.
 *      · then estimate, engine expected hammer, a validated bid projection,
 *        the live bid (a floor, not a value).
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
import { parseCard, cardLadderKey } from './cards';
import { trueSaleDay } from '../utils';
import { closeMs, closeIsTimed } from './house-tz';

/** per-market Size scale, hammer USD: [Size 0, Size 1] on a log axis */
const SCALE: Record<CatKey, [number, number]> = {
  'fine-art': [5_000, 20_000_000],
  design: [2_500, 2_000_000],
  watches: [2_500, 2_000_000],
  'sports-cards': [250, 1_000_000],
  tcg: [200, 500_000],
  'sports-memorabilia': [500, 2_000_000],
  entertainment: [500, 2_000_000],
  historical: [500, 2_000_000],
  'space-science': [500, 1_000_000],
};
/** the shortlist's entry bar on the anchor, per market */
const SEAT_FLOOR: Record<CatKey, number> = {
  'fine-art': 5_000, design: 2_500, watches: 2_500,
  'sports-cards': 1_000, tcg: 1_000, 'sports-memorabilia': 1_000,
  entertainment: 1_000, historical: 1_000, 'space-science': 1_000,
};
/** a seat must earn at least this score — fewer seats beat filler */
const SEAT_MIN = 22;
/** categories where Below-Market flags carried a measured edge in the backtest */
const EDGE_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['fine-art', 'design', 'entertainment', 'historical', 'space-science']);
/** categories where a house estimate is a sound evidence anchor */
const EST_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['fine-art', 'design', 'watches', 'entertainment', 'historical', 'space-science']);

export type AnchorSrc = 'est' | 'engine' | 'proj' | 'bid';

/** The static, time-independent parts of the score. */
export interface PrioStatic {
  a: number;          // hammer-basis USD anchor
  src: AnchorSrc;
  /** the live bid already passed the house estimate / engine value (and became the anchor) */
  over?: boolean;
  size: number;       // 0–1
  edge: number;       // -0.25 … 1
  ev: number;         // 0–1
}

type ScoreLot = {
  artist?: string | null; subCat?: string | null; drill?: string | null; title?: string | null;
  auctionHouse?: string | null; saleName?: string | null;
  estimateLow?: number | null; estimateHigh?: number | null;
  estLowUsd?: number | null; estHighUsd?: number | null;
  currentBid?: number | null; bidCount?: number | null; currency?: string | null;
  saleDate?: string | null; saleDateTime?: string | null;
  id?: string | null;
  value?: { expectedHammerUsd?: number | null; confidence?: string | null; abstain?: string | null; signal?: { beatRatePct?: number | null } | null } | null;
  signal?: { label?: string | null } | null;
  bidProj?: { ok?: boolean; allIn?: number } | null;
};

/**
 * THE BID ROOMS (Oct 9 anchor study). A live bid days out is a floor, not a
 * price: measured on 8,003 lots that sold after appearing in the served book
 * (Sep 20–Oct 8 snapshots) plus 75K Goldin bidHistory snapshots on sold corpus
 * lots, hammer ÷ live bid runs from ~1.1× (NFL, close night) to 12× (Goldin
 * Weekly, sub-$100 bid, 5 days out) — and falls as the bid grows ($100K+
 * Elite bids close at ~1.3–1.4×). Each room's median multiple, by days out
 * [<1, 1–3, 3–7, 7–14, 14+] × live bid [<$100, $100–1K, $1–10K, $10–100K,
 * $100K+], ≥25 sales per measured cell. Empty cells borrow Goldin Elite's
 * shape (the one room measured at every bid size and horizon): the nearest
 * measured bid band × Elite's ratio between the two bands, then the room's
 * last measured day × Elite's day ratio (REA is measured only on close night,
 * RR only inside 7 days, $100K+ bids almost only at Elite). Never below 1,
 * never shrinking with time to close.
 */
const CLOSE_K: Record<string, number[][]> = {
  'goldin-weekly': [[3.1, 2.05, 1.78, 1.29, 1.04], [5.2, 2.68, 2.02, 1.53, 1.24], [12.2, 4.17, 2.85, 2.02, 1.62], [37.5, 10.5, 4, 2.54, 1.88], [37.5, 10.5, 4, 2.54, 1.88]],
  'goldin-weekly-tcg': [[2.4, 1.54, 1.61, 1.78, 1.43], [3.2, 1.91, 2.07, 1.92, 1.55], [8.12, 3.34, 3.45, 2.46, 1.98], [23.84, 10.43, 6.39, 4.05, 3], [23.84, 10.43, 7.7, 4.54, 3]],
  'goldin-elite': [[1.89, 1.89, 2, 1.62, 1.3], [2.3, 2.3, 2.27, 1.73, 1.41], [2.57, 2.57, 2.61, 1.75, 1.41], [3.77, 3.77, 3.73, 2.36, 1.75], [3.77, 5.23, 5.09, 3, 1.75]],
  'goldin-thematic': [[2.33, 2.33, 2.24, 1.85, 1.49], [3.1, 2.86, 2.62, 1.96, 1.59], [4.11, 3, 2.62, 1.96, 1.59], [4.11, 3.13, 2.73, 1.96, 1.59], [4.11, 4.34, 3.73, 2.2, 1.59]],
  hakes: [[1.57, 1.62, 1.71, 1.38, 1.11], [1.83, 1.62, 1.71, 1.38, 1.11], [1.92, 1.69, 1.71, 1.38, 1.11], [3.25, 1.98, 1.96, 1.38, 1.11], [4, 1.98, 1.96, 1.38, 1.11]],
  'memory-lane': [[1.21, 1.21, 1.33, 1.28, 1.02], [1.33, 1.33, 1.46, 1.34, 1.08], [1.61, 1.61, 1.77, 1.47, 1.18], [2.36, 2.36, 2.53, 1.98, 1.47], [2.36, 3.28, 3.46, 2.52, 1.47]],
  nfl: [[1.08, 1.08, 1.14, 1, 1], [1.49, 1.19, 1.14, 1, 1], [2.13, 1.45, 1.14, 1, 1], [3.73, 1.64, 1.62, 1.03, 1], [3.73, 2.27, 2.21, 1.31, 1]],
  rea: [[1.39, 1.32, 1.26, 1.02, 1], [1.68, 1.61, 1.43, 1.09, 1], [1.88, 1.8, 1.64, 1.1, 1], [2.75, 2.63, 2.35, 1.49, 1.1], [2.75, 3.66, 3.21, 1.89, 1.1]],
  rr: [[1.27, 1.27, 1.34, 1.21, 1], [1.8, 1.8, 1.77, 1.21, 1], [2.21, 2.21, 2.25, 1.33, 1.07], [3.24, 3.24, 3.21, 1.8, 1.33], [3.24, 4.51, 4.38, 2.28, 1.33]],
};
/** bid rooms whose house estimate beat the bid projection, paired on the same
 *  lots (RR: estimate 21% median error vs 36%). Hake's estimates ran +42%
 *  high, so Hake's bids lead. */
const EST_ROOMS: ReadonlySet<string> = new Set(['rr']);

function roomOf(l: ScoreLot, cat: CatKey): string | null {
  switch (l.auctionHouse) {
    case 'Goldin': {
      const s = l.saleName || '';
      if (/weekly/i.test(s)) return cat === 'tcg' ? 'goldin-weekly-tcg' : 'goldin-weekly';
      return /thematic/i.test(s) ? 'goldin-thematic' : 'goldin-elite';
    }
    case "Hake's": return 'hakes';
    case 'Memory Lane': return 'memory-lane';
    case 'NFL Auction': return 'nfl';
    case 'REA': return 'rea';
    case 'RR Auction': return 'rr';
    default: return null;
  }
}

/** The live bid projected to its close: bid × the room's measured multiple for
 *  this many days out at this bid size. null outside a measured room. */
function bidProjection(l: ScoreLot, cat: CatKey, nowMs: number): { a: number; room: string; days: number } | null {
  const bid = (!l.currency || l.currency === 'USD') ? (l.currentBid || 0) : 0;
  if (!(bid > 0)) return null;
  const room = roomOf(l, cat);
  const close = closeMsOf(l);
  if (!room || close == null || close <= nowMs) return null;
  const days = (close - nowMs) / 864e5;
  const row = CLOSE_K[room][days < 1 ? 0 : days < 3 ? 1 : days < 7 ? 2 : days < 14 ? 3 : 4];
  const k = row[bid < 100 ? 0 : bid < 1_000 ? 1 : bid < 10_000 ? 2 : bid < 100_000 ? 3 : 4];
  return { a: bid * Math.max(1, k), room, days };
}

function anchorOf(l: ScoreLot, nowMs: number): { a: number; src: AnchorSrc; over?: boolean } | null {
  const base = baseAnchor(l, nowMs);
  // bids are USD on every house that streams them; a bid past the anchor IS the price now
  const bid = (!l.currency || l.currency === 'USD') ? (l.currentBid || 0) : 0;
  if (base && base.src !== 'bid' && bid > base.a * 1.15) return { a: bid, src: base.src, over: true };
  return base;
}

function baseAnchor(l: ScoreLot, nowMs: number): { a: number; src: AnchorSrc } | null {
  let lo = (l.estLowUsd ?? l.estimateLow) || 0;
  let hi = (l.estHighUsd ?? l.estimateHigh) || 0;
  lo = lo || hi; hi = hi || lo;
  const cat = taxonOf(l).cat;
  const pj = bidProjection(l, cat, nowMs);
  if (lo > 0 && (!pj || EST_ROOMS.has(pj.room))) return { a: (lo + hi) / 2, src: 'est' };
  const eh = l.value?.expectedHammerUsd;
  if (pj) {
    // a sound engine read narrows the projection (geometric mean): a week+ out
    // the bid says little (cards 7–14d: 158% → 117% median error), and a
    // high-confidence comp helps even inside the week (3–7d: 51% → 39%)
    const sound = l.value?.confidence === 'high' && !l.value?.abstain;
    if (eh && eh > 0 && (pj.days >= 7 || sound)) return { a: Math.sqrt(pj.a * eh), src: 'proj' };
    return { a: pj.a, src: 'proj' };
  }
  if (lo > 0) return { a: (lo + hi) / 2, src: 'est' };
  if (eh && eh > 0) return { a: eh, src: 'engine' };
  // validated projection only; allIn carries the buyer's premium (~1.22×) — back it out to hammer
  if (l.bidProj?.ok === true && (l.bidProj.allIn || 0) > 0) return { a: (l.bidProj.allIn as number) / 1.22, src: 'proj' };
  if ((l.currentBid || 0) > 0) return { a: l.currentBid as number, src: 'bid' };
  return null;
}

/** The slow-moving parts (the anchor reads days-to-close for bid rooms).
 *  null = no price anchor at all (can't be ranked by size). */
export function prioStatic(l: ScoreLot, nowMs: number = Date.now()): PrioStatic | null {
  const an = anchorOf(l, nowMs);
  if (!an) return null;
  const { cat } = taxonOf(l);
  const [lo, hi] = SCALE[cat];
  const size = Math.min(1, Math.max(0, (Math.log10(Math.max(an.a, 1)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))));
  let edge = 0;
  const label = l.signal?.label;
  if (label === 'Below Market' && EDGE_CATS.has(cat) && !an.over) {
    const br = l.value?.signal?.beatRatePct ?? 0;
    edge = Math.min(1, Math.max(0, (br - 32) / 20)); // lift over the at-market bucket (~32%)
  } else if (label === 'Above Market') {
    edge = -0.25;
  }
  const conf = l.value?.confidence;
  let ev = conf === 'high' ? 1 : conf === 'medium' ? 0.7 : conf === 'low' ? 0.4 : 0;
  if (an.src === 'est' && EST_CATS.has(cat)) ev = Math.max(ev, 0.5);
  // competition: 1 bid .15 · 2 .3 · 4 .45 · 8+ .6 — never outranks a sound estimate or engine read
  const bids = l.bidCount || 0;
  if (bids > 0) ev = Math.max(ev, Math.min(0.6, 0.15 + 0.15 * Math.log2(bids)));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out: PrioStatic = { a: Math.round(an.a), src: an.src, size: r2(size), edge: r2(edge), ev: r2(ev) };
  if (an.over) out.over = true;
  return out;
}

/** Close time in ms. A date-only sale closes at the end of that day, in the house's zone. */
export function closeMsOf(l: ScoreLot): number | null {
  // the ONE close clock (house-tz): a date-only sale closes when its day ends
  // where it is sold — never an invented reader-local 23:59
  return closeMs(l);
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
  const st = prioStatic(l, nowMs);
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

type ShortlistLot = ScoreLot & { id?: string; auctionHouse?: string | null; saleName?: string | null; title?: string | null;
  crossLive?: { id: string; house: string; bid: number }[] | null };

/** `id:<sibling>` for the same card live at ANOTHER house (the build's
 *  crossLive match; same-house entries are copies the card identity covers) */
function crossIds(l: ShortlistLot): string[] {
  const out: string[] = [];
  for (const x of l.crossLive || []) if (x && x.id && x.house !== l.auctionHouse) out.push(`id:${x.id}`);
  return out;
}

/** One sale = house + close day. Sale NAMES split one evening (Christie's
 *  "20th/21st Century London Evening Sale" vs "London Sale 25228") and are
 *  missing on a third of the book, so caps key on the day, not the name. */
export function saleKeyOf(l: { auctionHouse?: string | null; saleDate?: string | null; saleDateTime?: string | null }): string {
  return `${l.auctionHouse ?? ''}|${trueSaleDay(l) || l.saleDate || ''}`;
}

const CARD_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['sports-cards', 'tcg']);
const normTitle = (t: string | null | undefined) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The thing being bought, grade aside: a card's ladder key (year·set·#·player),
 *  else the real maker per lot. Seven PSA grades of one Fleer Jordan are one
 *  pick, not seven. */
function identityOf(l: ShortlistLot): { thing: string; who: string } {
  const cat = taxonOf(l).cat;
  if (CARD_CATS.has(cat) && l.title) {
    const id = parseCard(l.title);
    const k = cardLadderKey(id);
    if (k) return { thing: `card:${k}`, who: id.playerSlug ? `p:${id.playerSlug}` : `id:${l.id}` };
    if (id.playerSlug) return { thing: `id:${l.id}`, who: `p:${id.playerSlug}` };
  }
  const maker = l.artist && !GENERIC_MAKERS.has(l.artist) ? l.artist : `id:${l.id}`;
  return { thing: `id:${l.id}`, who: maker };
}

interface Caps { cat: number; sale: number; who: number }

/** greedy seat fill under caps; one seat per object (relists, crawl doubles)
 *  and per card identity. Rows arrive best-first. */
function fill<T extends ShortlistLot>(rows: { l: T; s: number }[], n: number, caps: Caps, out: T[] = [], nowMs: number = Date.now()): T[] {
  const perCat = new Map<string, number>(), perSale = new Map<string, number>(), perWho = new Map<string, number>();
  const seen = new Set<string>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const keysOf = (l: T) => {
    const { thing, who } = identityOf(l);
    return { cat: taxonOf(l).cat as string, sale: saleKeyOf(l), who, thing,
      dup: `${l.auctionHouse}|${normTitle(l.title)}|${prioStatic(l, nowMs)?.a ?? 0}`,
      // the same card live at another house is the same pick (one seat)
      self: `id:${l.id}`, cross: crossIds(l) };
  };
  const mark = (k: ReturnType<typeof keysOf>) => { seen.add(k.dup); seen.add(k.thing); seen.add(k.self); for (const c of k.cross) seen.add(c); };
  for (const l of out) {
    const k = keysOf(l);
    bump(perCat, k.cat); bump(perSale, k.sale); bump(perWho, k.who); mark(k);
  }
  for (const { l } of rows) {
    if (out.length >= n) break;
    if (out.includes(l)) continue;
    const k = keysOf(l);
    if (seen.has(k.dup) || seen.has(k.thing) || seen.has(k.self)) continue;
    if ((perCat.get(k.cat) ?? 0) >= caps.cat || (perSale.get(k.sale) ?? 0) >= caps.sale || (perWho.get(k.who) ?? 0) >= caps.who) continue;
    out.push(l);
    mark(k);
    bump(perCat, k.cat); bump(perSale, k.sale); bump(perWho, k.who);
  }
  return out;
}

/**
 * The anonymous "What matters today" shortlist: clears its market's anchor
 * floor, closes within 7 days, has evidence, earns SEAT_MIN; top `n` with caps
 * (≤5 per category, ≤3 per sale, ≤2 per maker or player, one per object or
 * card identity) so one mass close or one house can't fill the board. Seats
 * the caps leave empty go to the next-best lots under looser caps — never to
 * filler below SEAT_MIN (only the category cap loosens; one sale never gets a 4th seat).
 */
export function shortlist<T extends ShortlistLot>(lots: T[], nowMs: number = Date.now(), n = 20): T[] {
  const rows: { l: T; s: number; close: number; a: number }[] = [];
  for (const l of lots) {
    const p = priorityOf(l, nowMs);
    const close = closeMsOf(l);
    if (!p || close == null) continue;
    const h = (close - nowMs) / 3_600_000;
    if (h <= 0 || h > 168) continue;
    if (p.a < SEAT_FLOOR[taxonOf(l).cat]) continue;
    if (p.ev <= 0 && p.src !== 'est') continue;
    if (p.score < SEAT_MIN) continue;
    rows.push({ l, s: p.score, close, a: p.a });
  }
  rows.sort((x, y) => (y.s - x.s) || (x.close - y.close) || (y.a - x.a));
  const out = fill(rows, n, { cat: 5, sale: 3, who: 2 }, [], nowMs);
  if (out.length < n) fill(rows, n, { cat: 8, sale: 3, who: 2 }, out, nowMs);
  // a reader narrowed to one market (PSA cards: ~all Goldin) asked for that
  // room — once every other sale is spent, its best lots may take more seats
  if (out.length < n) fill(rows, n, { cat: Infinity, sale: 8, who: 2 }, out, nowMs);
  return out;
}

/**
 * Break up runs in an already-ranked list: within any `win` consecutive lots,
 * at most `max` share a sale and at most `max` share a card/maker identity —
 * the overflow slides down to the next window, order otherwise kept. A
 * 3,489-lot sale can't wall the first screens of "Matters most".
 */
export function spread<T extends ShortlistLot>(list: T[], win = 12, max = 3, head = 600): T[] {
  if (list.length <= max) return list;
  // only the screens a reader actually scrolls are re-dealt; keys computed once
  const pool0 = list.slice(0, head).map(l => ({ l, sk: saleKeyOf(l), wk: identityOf(l).who, self: `id:${l.id}`, cross: crossIds(l) }));
  const out: T[] = [];
  let pool = pool0;
  while (pool.length) {
    const sale = new Map<string, number>(), who = new Map<string, number>();
    const rest: typeof pool = [];
    // the same card live at two houses is ONE thing: once one copy is dealt
    // into this window, its cross-house twin follows without spending a cap
    const twins = new Set<string>();
    let taken = 0, i = 0;
    for (; i < pool.length && taken < win; i++) {
      const r = pool[i];
      if (twins.has(r.self)) { out.push(r.l); for (const c of r.cross) twins.add(c); continue; }
      if ((sale.get(r.sk) ?? 0) >= max || (who.get(r.wk) ?? 0) >= max) { rest.push(r); continue; }
      out.push(r.l); taken++;
      for (const c of r.cross) twins.add(c);
      // a twin already pushed down this window comes back up beside it
      for (let k = rest.length - 1; k >= 0; k--) if (twins.has(rest[k].self)) out.push(rest.splice(k, 1)[0].l);
      sale.set(r.sk, (sale.get(r.sk) ?? 0) + 1); who.set(r.wk, (who.get(r.wk) ?? 0) + 1);
    }
    if (!taken) { for (const r of pool) out.push(r.l); break; }
    pool = rest.concat(pool.slice(i));
  }
  return list.length > head ? out.concat(list.slice(head)) : out;
}

const fmtUsd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);

/**
 * The one-line "why it's here" for a shortlisted lot — the same inputs the
 * score used, in words: when it closes, what it's worth and on what basis,
 * and the measured edge when there is one — never repeating the house estimate
 * the card already prints. e.g. "Closes in 4h · Below market",
 * "Closes tomorrow · $220K engine value".
 */
export function reasonOf(l: ScoreLot, nowMs: number = Date.now()): string | null {
  const p = priorityOf(l, nowMs);
  if (!p) return null;
  const parts: string[] = [];
  const close = closeMsOf(l);
  if (close != null && !closeIsTimed(l) && l.saleDate) {
    // date-only sale (RR, Phillips, Wright…): the hour is unknown — say the day, never invent "in 8h"
    const t = new Date(nowMs);
    const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
    const d = Math.round((Date.parse(`${l.saleDate.slice(0, 10)}T00:00:00Z`) - today) / 864e5);
    if (d === 0) parts.push('Sells today');
    else if (d === 1) parts.push('Sells tomorrow');
    else if (d > 1 && d < 7) parts.push(`Sells in ${d} days`);
  } else if (close != null) {
    const h = (close - nowMs) / 3_600_000;
    if (h > 0 && h < 1) parts.push('Closes within the hour');
    else if (h > 0 && h < 24) parts.push(`Closes in ${Math.round(h)}h`);
    else if (h > 0 && h < 48) parts.push('Closes tomorrow');
    else if (h > 0 && h < 168) parts.push(`Closes in ${Math.round(h / 24)} days`);
  }
  // the card already prints the house estimate — only name the value when
  // it came from somewhere else (engine comps, a projection, the live bid)
  if (p.over) {
    parts.push(p.src === 'est' ? 'Bid past the estimate' : 'Bid past its value');
  } else if (p.src !== 'est') {
    const basis = p.src === 'engine' ? 'engine value' : p.src === 'proj' ? 'projected close' : 'current bid';
    parts.push(`${fmtUsd(p.a)} ${basis}`);
  }
  if (p.edge > 0) parts.push('Below market');
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The signed-in / following reader's shortlist ("For you"): only lots touching
 * something they follow, closing within 7 days, ranked
 *   35·Affinity + 20·Size + 20·Edge⁺ − 10·Edge⁻ + 15·Evidence + 10·Urgency
 * with caps (≤3 per maker or player, ≤4 per sale, one per object or card
 * identity). `affinity` is follows.affinityOf.
 */
export function forYou<T extends ShortlistLot>(lots: T[], affinity: (l: T) => number, nowMs: number = Date.now(), n = 20): T[] {
  const rows: { l: T; s: number; close: number; a: number }[] = [];
  for (const l of lots) {
    const aff = affinity(l);
    if (aff <= 0) continue;
    const p = priorityOf(l, nowMs);
    const close = closeMsOf(l);
    if (!p || close == null) continue;
    const h = (close - nowMs) / 3_600_000;
    if (h <= 0 || h > 168) continue;
    const s = 35 * aff + 20 * p.size + 20 * Math.max(p.edge, 0) - 10 * Math.max(-p.edge, 0) + 15 * p.ev + 10 * p.urg;
    rows.push({ l, s, close, a: p.a });
  }
  rows.sort((x, y) => (y.s - x.s) || (x.close - y.close) || (y.a - x.a));
  return fill(rows, n, { cat: Infinity, sale: 4, who: 3 }, [], nowMs);
}
