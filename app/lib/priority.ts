/**
 * priority.ts — the "matters most" order for live lots (Oct 8).
 *
 *   S = 40·Size + 20·Evidence + d·(25·Edge⁺ + 15·Urgency) − 25·Edge⁻
 *   d = min(1, Size / 0.25)                                (0–100)
 *
 * W26 (Oct 11): the boosts scale with size (scoreOf) — a flag or a close
 * tonight lifts a lot only as far as it is big enough to matter.
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
 *        PROJECTED to its close (close-k.ts: bid × the room's measured multiple
 *        by days out × bid size), blended with a sound engine read. Cards
 *        40% median error vs 67% under the old est → engine → bid order,
 *        whose engine read ran 198% and whose raw bid ran 46% low.
 *      · then estimate, engine expected hammer, the live bid (a floor, not a
 *        value). (Oct 11) The old served growth-curve projection (bidProj,
 *        bid × close-day curve) is gone: it overshot the non-Goldin rooms by
 *        70–150% and the lot page printed it beside this one — ONE projected
 *        close now, projectedCloseOf below.
 *  - Edge: the certified "Below Market" flag, ONLY in the categories where the
 *    backtest measured a real edge (art, design, culture, science: ~+21pt
 *    all-in margin). Sports/watches flags are held by the engine and TCG/cards
 *    never flag, so Edge is 0 there. "Above Market" costs a little.
 *  - Evidence: engine confidence, or a house estimate where estimates are sound.
 *  - Urgency: closes ≤24h 1 · ≤72h 0.6 · ≤7d 0.25. Computed at VIEW time so it
 *    never goes stale intraday. Nothing is stamped on the payload: every input
 *    is already on the served lot (build-upcoming only logs the counts).
 */
import { taxonOf, CAT_LABEL, type CatKey } from './taxonomy';
import { parseCard, cardLadderKey } from './cards';
import { trueSaleDay } from '../utils';
import { closeMs, closeIsTimed } from './house-tz';
import { closeKOf, closeKRoomOf } from './close-k';
import { lotAllInFactor } from './premiums';
import { fmtUsd } from './fmt-usd';
import { signalMagnitude } from './comps';

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
  signal?: { label?: string | null; pct?: number | null; basis?: number | null; confidence?: string | null } | null;
  buyerPremiumPct?: number | null;
};

/**
 * THE BID ROOMS (Oct 9 anchor study; refit nightly — app/lib/close-k.ts). A
 * live bid days out is a floor, not a price: hammer ÷ live bid runs from
 * ~1.1× (NFL, close night) to 12× (Goldin Weekly, sub-$100 bid, 5 days out)
 * and falls as the bid grows ($100K+ Elite bids close at ~1.3–1.4×). The
 * multiple by room × days out × bid size is close-k.ts closeKOf: the compiled
 * Oct 9 table until the served close-k.json (refit every night from sold rows
 * + bid snapshots) is installed by setCloseK.
 */
/** bid rooms whose house estimate beat the bid projection, paired on the same
 *  lots (RR: estimate 21% median error vs 36%). Hake's estimates ran +42%
 *  high, so Hake's bids lead. */
const EST_ROOMS: ReadonlySet<string> = new Set(['rr']);

function roomOf(l: ScoreLot, cat: CatKey): string | null {
  return closeKRoomOf(l.auctionHouse, l.saleName, cat);
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
  return { a: bid * projectionK(closeKOf(room, days, bid)), room, days };
}

/** THE PROJECTION KNEE (W26, Oct 11 2026). close-k's measured multiple is a
 *  median over a wide spread, and past 3× it runs away: a $68 Goldin Weekly
 *  TCG bid a week out printed "~$1.8K projected close" (26.4×, no engine read
 *  behind it). Up to 3× the multiple stands; past it the projection grows as
 *  bid·√(3k) — continuous at the knee, 26.4× → 8.9×. Graded on the corpus'
 *  44,387 bid-history sightings (scripts' close-k eval obs, served
 *  close-k.json): every cell projecting ≥$1K — the lots a seat can see — goes
 *  from 84% → 80% median error, its bias from +22% → −2%, and projections
 *  landing 2× over the hammer from 30% → 20% of lots; 3–12× cells improve
 *  (79 → 77%, 120 → 110%). It costs the 12×+ cells (sub-$100 bids days out,
 *  145% → 217%): those hammers really do run 12–30× the bid, but no single
 *  number there is a projection a reader can act on. The close-k table and its
 *  nightly refit are untouched — the knee reads whatever multiple is installed. */
export const PROJ_KNEE = 3;
export function projectionK(k: number): number {
  return k <= PROJ_KNEE ? k : Math.sqrt(PROJ_KNEE * k);
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

/** THE PROJECTED CLOSE (Oct 11 2026) — the ONE projection every surface
 *  prints: the decision line, the lot page's "Projected close" row, the
 *  ranker's reason line, the Gap lane and the calls ledger. It IS the
 *  ranker's anchor (src 'proj': the live bid × the room's measured close
 *  multiple, close-k.ts, narrowed by a sound engine read), hammer basis; the
 *  all-in is the same figure × the lot's buyer's-premium factor
 *  (premiums.lotAllInFactor) and prints only labelled "all-in". null when
 *  the anchor is not a projection (estimate house, engine-only, bare bid) or
 *  the live bid already passed it. */
export interface ProjectedClose {
  /** hammer USD (the anchor) */
  hammer: number;
  /** hammer × factor, rounded */
  allIn: number;
  /** the lot's buyer's-premium factor at that hammer */
  factor: number;
}
export function projectedCloseOf(l: ScoreLot, nowMs: number = Date.now(), st: PrioStatic | null = prioStatic(l, nowMs)): ProjectedClose | null {
  if (!st || st.over || st.src !== 'proj' || !(st.a > 0)) return null;
  const hammer = st.a;
  const factor = lotAllInFactor(l, hammer);
  return { hammer, allIn: Math.round(hammer * factor), factor };
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
  return { ...st, urg, score: scoreOf(st, urg) };
}

/** Size gates the boosts (W26, Oct 11 2026): a Below-Market flag and a close
 *  tonight lift a lot only as far as it is big enough to matter — full lift
 *  from Size 0.25 up (fine art ≈ $33K, cards ≈ $1.5K, memorabilia ≈ $4K),
 *  scaled down below it, none at Size 0. A $2K flagged print closing in 3
 *  days took 25 + 15·0.25 points and sat above a $3M canvas closing beside
 *  it (Art "All lots" #10–11: two $2K Rago prints; "What matters" #5: a $5K
 *  Picasso poster). An Above-Market flag still costs its full 6¼ points. */
export const BOOST_SIZE = 0.25;
export function scoreOf(st: Pick<PrioStatic, 'size' | 'edge' | 'ev'>, urg: number): number {
  const d = Math.min(1, st.size / BOOST_SIZE);
  const score = 40 * st.size + 20 * st.ev + d * (25 * Math.max(st.edge, 0) + 15 * urg) - 25 * Math.max(-st.edge, 0);
  return Math.round(score * 10) / 10;
}

/** Sort comparator: score desc, then sooner close, then bigger anchor. Unanchored lots sink. */
export function byPriority(nowMs: number = Date.now()) {
  // Each lot's score is computed ONCE per comparator (perf wave W1, Oct 11):
  // a sort calls the comparator ~2·n·log n times, and priorityOf (anchor,
  // taxonomy, close clock) recomputed for both sides of every comparison was
  // ~2 s of main thread on a 4×-throttled phone sorting the 10K-lot book.
  // priorityOf is a pure function of (lot, nowMs) and nowMs is fixed for the
  // comparator, so the order is identical.
  const memo = new WeakMap<ScoreLot, { p: Priority | null; c: number }>();
  const read = (l: ScoreLot) => {
    let m = memo.get(l);
    if (!m) { m = { p: priorityOf(l, nowMs), c: closeMsOf(l) ?? Infinity }; memo.set(l, m); }
    return m;
  };
  return (x: ScoreLot, y: ScoreLot): number => {
    const mx = read(x), my = read(y);
    const px = mx.p, py = my.p;
    if (!px || !py) return px ? -1 : py ? 1 : 0;
    if (py.score !== px.score) return py.score - px.score;
    const cx = mx.c, cy = my.c;
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
  crossLive?: { id: string; house: string; bid: number }[] | null; resultsPending?: boolean | null };

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

/** " - PSA NM-MT 8 (OC)", " BGS 9.5", " - CGC PRISTINE 10" … to the end */
const GRADE_TAIL = /\s*[-–—]?\s*\b(?:PSA|BGS|SGC|CGC|BVG|HGA|TAG|ISA|GMA)\b.*$/i;
/** a card number in a title: "#3", "#H9", "#104", "#SV107" */
const CARD_NO = /#\s?[A-Za-z]{0,4}\d+[A-Za-z]?\b/;

/** A card with no ladder key (most Pokémon titles name no "player"): its
 *  title with the grade tail cut IS the card — when that title names a card
 *  number. The number is what makes a raw copy and its slabs one card (W26:
 *  a raw "#3 Charizard" and its PSA 10 took two What-matters seats); without
 *  it a gradeless title is too loose to call the same card. Shared with
 *  fold.ts, so the fold and the shortlist agree on what one card is. */
export function gradelessCardKey(title: string, id: { multi?: boolean; notCard?: boolean }): string | null {
  if (id.multi || id.notCard) return null;
  const cut = title.replace(GRADE_TAIL, '');
  const bare = normTitle(cut);
  return CARD_NO.test(cut) && bare.length >= 16 && bare.split(' ').length >= 3 ? bare : null;
}

/** The thing being bought, grade aside: a card's ladder key (year·set·#·player),
 *  else its gradeless numbered title, else the real maker per lot. Seven PSA
 *  grades of one Fleer Jordan are one pick, not seven. */
function identityOf(l: ShortlistLot): { thing: string; who: string } {
  const cat = taxonOf(l).cat;
  if (CARD_CATS.has(cat) && l.title) {
    const id = parseCard(l.title);
    const k = cardLadderKey(id);
    if (k) return { thing: `card:${k}`, who: id.playerSlug ? `p:${id.playerSlug}` : `id:${l.id}` };
    const g = gradelessCardKey(l.title, id);
    if (id.playerSlug) return { thing: g ? `g:${l.auctionHouse}|${g}` : `id:${l.id}`, who: `p:${id.playerSlug}` };
    if (g) return { thing: `g:${l.auctionHouse}|${g}`, who: `id:${l.id}` };
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
 * floor, closes within 7 days (a thin week reaches through the 14th day),
 * is not results-pending, has evidence, earns SEAT_MIN; top `n` with caps
 * (≤5 per category, ≤3 per sale, ≤2 per maker or player, one per object or
 * card identity) so one mass close or one house can't fill the board. Seats
 * the caps leave empty go to the next-best lots under looser caps — never to
 * filler below SEAT_MIN (only the category cap loosens; one sale never gets a 4th seat).
 */
export function shortlist<T extends ShortlistLot>(lots: T[], nowMs: number = Date.now(), n = 20, opts: { who?: number } = {}): T[] {
  // a pool that IS one maker (a maker page's live book) can't diversify
  // across makers — the caller lifts the per-maker cap there (opts.who)
  const who = opts.who ?? 2;
  const week: { l: T; s: number; close: number; a: number }[] = [];
  const next: typeof week = [];
  for (const l of lots) {
    // (W26) a lot the crawler marks results-pending has hammered — the house
    // just hasn't posted. It is not "Sells today" (a Christie's Ruth bat and
    // a Patek sat in the seats after their sale closed).
    if (l.resultsPending) continue;
    const p = priorityOf(l, nowMs);
    const close = closeMsOf(l);
    if (!p || close == null) continue;
    const h = (close - nowMs) / 3_600_000;
    if (h <= 0 || h > SECOND_WEEK_H) continue;
    if (p.a < SEAT_FLOOR[taxonOf(l).cat]) continue;
    if (p.ev <= 0 && p.src !== 'est') continue;
    if (p.score < SEAT_MIN) continue;
    (h <= 168 ? week : next).push({ l, s: p.score, close, a: p.a });
  }
  const order = (x: typeof week[number], y: typeof week[number]) => (y.s - x.s) || (x.close - y.close) || (y.a - x.a);
  week.sort(order);
  const passes = (rows: typeof week, out: T[]) => {
    fill(rows, n, { cat: 5, sale: 3, who }, out, nowMs);
    if (out.length < n) fill(rows, n, { cat: 8, sale: 3, who }, out, nowMs);
    // a reader narrowed to one market (PSA cards: ~all Goldin) asked for that
    // room — once every other sale is spent, its best lots may take more seats
    if (out.length < n) fill(rows, n, { cat: Infinity, sale: 8, who }, out, nowMs);
    return out;
  };
  const out = passes(week, []);
  // (W26) a thin week (TCG: one Goldin night filled 8 seats) reaches into the
  // second week rather than leave seats empty — the $3.47M Trophy Pikachu
  // closing in 9 days is the market's biggest lot and never showed. The
  // week's seats stand; the second week only fills what is left.
  if (out.length < n && next.length) passes(week.concat(next).sort(order), out);
  stampBoard(out, lots, nowMs);
  return out;
}

/** (W26) What the reason line may say about a seated lot's SIZE — the term
 *  that seats most estimate-house lots, which the reason line used to leave
 *  unsaid (18 of 20 Art lines read only "Sells in 3 days"): its rank by value
 *  among the lots of its category the board ranked, closing inside the same
 *  week. Stamped per seated lot by the shortlist that seated it. */
const BOARD = new WeakMap<object, { rank: number; field: number; cat: CatKey; weeks: 1 | 2 }>();
function stampBoard<T extends ShortlistLot>(out: T[], pool: T[], nowMs: number): void {
  if (!out.length) return;
  const cats = new Set<CatKey>(out.map(l => taxonOf(l).cat));
  const by = new Map<CatKey, { a: number; h: number }[]>();
  for (const l of pool) {
    if (l.resultsPending) continue;
    const cat = taxonOf(l).cat;
    if (!cats.has(cat)) continue;
    const close = closeMsOf(l);
    if (close == null || close <= nowMs) continue;
    const h = (close - nowMs) / 3_600_000;
    if (h > SECOND_WEEK_H) continue;
    const a = prioStatic(l, nowMs)?.a;
    if (!a) continue;
    const arr = by.get(cat) ?? []; arr.push({ a, h }); by.set(cat, arr);
  }
  for (const l of out) {
    const cat = taxonOf(l).cat;
    const a = prioStatic(l, nowMs)?.a ?? 0;
    const close = closeMsOf(l) ?? nowMs;
    const weeks: 1 | 2 = (close - nowMs) / 3_600_000 <= 168 ? 1 : 2;
    const lim = weeks === 1 ? 168 : SECOND_WEEK_H;
    let rank = 1, field = 0;
    for (const r of by.get(cat) ?? []) if (r.h <= lim) { field++; if (r.a > a) rank++; }
    BOARD.set(l, { rank, field, cat, weeks });
  }
}
/** how far a thin week may reach: through the 14th day out (hours) */
const SECOND_WEEK_H = 15 * 24;
/** a "Top N" rank claim needs a field this many times N (rank 1: 10 lots) */
const RANK_FIELD = 5;

/** the score share the lot taking a capped lot's place must hold (spread) */
const SPREAD_PEER = 0.75;

/**
 * Break up runs in an already-ranked list: within any `win` consecutive lots,
 * at most `max` share a sale and at most `max` share a card/maker identity —
 * the overflow slides down to the next window, order otherwise kept. A
 * 3,489-lot sale can't wall the first screens of "Matters most".
 */
export function spread<T extends ShortlistLot>(list: T[], win = 12, max = 3, head = 600, nowMs: number = Date.now()): T[] {
  if (list.length <= max) return list;
  // only the screens a reader actually scrolls are re-dealt; keys computed once
  const pool0 = list.slice(0, head).map(l => ({ l, sk: saleKeyOf(l), wk: identityOf(l).who, self: `id:${l.id}`, cross: crossIds(l), s: priorityOf(l, nowMs)?.score ?? 0 }));
  const out: T[] = [];
  let pool = pool0;
  while (pool.length) {
    const sale = new Map<string, number>(), who = new Map<string, number>();
    const rest: typeof pool = [];
    // the same card live at two houses is ONE thing: once one copy is dealt
    // into this window, its cross-house twin follows without spending a cap
    const twins = new Set<string>();
    let taken = 0, i = 0;
    const capped = (r: typeof pool[number]) => (sale.get(r.sk) ?? 0) >= max || (who.get(r.wk) ?? 0) >= max;
    const deal = (r: typeof pool[number]) => {
      out.push(r.l); taken++;
      for (const c of r.cross) twins.add(c);
      // a twin already pushed down this window comes back up beside it
      for (let k = rest.length - 1; k >= 0; k--) if (twins.has(rest[k].self)) out.push(rest.splice(k, 1)[0].l);
      sale.set(r.sk, (sale.get(r.sk) ?? 0) + 1); who.set(r.wk, (who.get(r.wk) ?? 0) + 1);
    };
    for (; i < pool.length && taken < win; i++) {
      const r = pool[i];
      if (twins.has(r.self)) { out.push(r.l); for (const c of r.cross) twins.add(c); continue; }
      if (capped(r)) { rest.push(r); continue; }
      // (W26) a capped lot yields its place only to a near peer: once the
      // lot about to be dealt scores under SPREAD_PEER × the best one held
      // back, the held-back lot is dealt first, past its cap. A run of one
      // 3,489-lot REA night still breaks up (its lots are peers), but a
      // $500K Goldin card no longer gives page 1 to a $2.8K NFL jersey
      // scoring 0.7× as high.
      while (rest.length && taken < win && r.s < SPREAD_PEER * rest[0].s) deal(rest.shift()!);
      if (taken >= win) { i--; continue; }
      deal(r);
    }
    if (!taken) { for (const r of pool) out.push(r.l); break; }
    pool = rest.concat(pool.slice(i));
  }
  return list.length > head ? out.concat(list.slice(head)) : out;
}


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
  const when0 = parts.length;
  if (close != null && !closeIsTimed(l) && l.saleDate) {
    // date-only sale (RR, Phillips, Wright…): the hour is unknown — say the day, never invent "in 8h"
    const t = new Date(nowMs);
    const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
    const d = Math.round((Date.parse(`${l.saleDate.slice(0, 10)}T00:00:00Z`) - today) / 864e5);
    if (d === 0) parts.push('Sells today');
    else if (d === 1) parts.push('Sells tomorrow');
    else if (d > 1 && d <= 14) parts.push(`Sells in ${d} days`);
  } else if (close != null) {
    const h = (close - nowMs) / 3_600_000;
    if (h > 0 && h < 1) parts.push('Closes within the hour');
    else if (h > 0 && h < 24) parts.push(`Closes in ${Math.round(h)}h`);
    else if (h > 0 && h < 48) parts.push('Closes tomorrow');
    else if (h > 0 && h < SECOND_WEEK_H) parts.push(`Closes in ${Math.round(h / 24)} days`);
  }
  const timing = parts.splice(when0).join('') || null;
  // (W26) then what drives the rank. The card already prints the house
  // estimate — only name the value when it came from somewhere else (engine
  // comps, a projection, the live bid); an estimate lot names its standing.
  if (p.edge > 0) {
    // the certified flag (THE FLAGS — the chip's own label and magnitude,
    // comps/signalMagnitude) with its pool and the engine's confidence
    const sig = l.signal;
    const mag = sig?.pct != null && sig.pct > 0 ? ` ${signalMagnitude('Below Market', sig.pct)}` : '';
    const n = sig?.basis && sig.basis > 0 ? `${sig.basis} comps` : null;
    const conf = sig?.confidence ?? l.value?.confidence;
    parts.push([`Below market${mag}`, n && conf ? `${n}, ${conf} confidence` : n ?? (conf ? `${conf} confidence` : null)].filter(Boolean).join(' · '));
  }
  if (p.over) {
    parts.push(p.src === 'est' ? 'Bid past the estimate' : 'Bid past its value');
  } else if (p.src === 'proj') {
    // the one projected close (projectedCloseOf), printed as the decision line prints it
    const pc = projectedCloseOf(l, nowMs, p);
    if (pc) parts.push(`~${fmtUsd(pc.hammer)} projected close`);
  } else if (p.src !== 'est') {
    parts.push(`${fmtUsd(p.a)} ${p.src === 'engine' ? 'engine value' : 'current bid'}`);
  } else if (p.edge <= 0) {
    const b = l.id != null ? BOARD.get(l) : undefined;
    // a rank means something only in a real field: Top 5 of 12 is not news
    const when = b?.weeks === 2 ? 'in the next two weeks' : 'this week';
    const top = !b ? 0 : [1, 5, 10, 20].find(k => b.rank <= k && b.field >= k * RANK_FIELD * (k === 1 ? 2 : 1)) ?? 0;
    if (b && top === 1) parts.push(`Largest ${CAT_LABEL[b.cat]} estimate ${when}`);
    else if (b && top) parts.push(`Top ${top} ${CAT_LABEL[b.cat]} estimate ${when}`);
  }
  // competition, when it is part of the evidence (bids on an estimate lot)
  if (!p.over && p.src === 'est' && (l.bidCount || 0) >= 2) parts.push(`${l.bidCount} bids`);
  // what drives the rank leads; the close (the row's date column prints it
  // too) trails, so a phone's clamped line keeps the reason, not the timing
  // (an urgent close — under 48h — still leads: then timing IS the reason)
  const urgent = close != null && close - nowMs < 48 * 3_600_000;
  if (timing && parts.length) { if (urgent) parts.unshift(timing); else parts.push(timing); }
  return parts.length ? parts.join(' · ') : timing;
}

/**
 * RETIRED from the feed Oct 10 2026: home's For-you tab now reads the one
 * recommender (app/lib/recs — saves, owned, follows and searches), the same
 * list the profile's "Lots you may like" room shows. Kept as the offline
 * evaluation's baseline (scripts/recs-eval.ts).
 *
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
