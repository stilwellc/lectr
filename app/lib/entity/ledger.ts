/**
 * entity/ledger.ts — THE LEDGER'S ROW MODEL (makers overhaul P2, Oct 10 2026).
 *
 * Pure: one entity bundle + its live join → one ledger Row (every kind the
 * same shape), the ledger's seven orders, and the one search that reads
 * names AND lots. app/makers/page.tsx wires these to state; the components
 * in app/components/entity/ print them.
 *
 *   - A row's numbers are the summary's (one stats function at build) and the
 *     live join's (the lots that pass the filters) — nothing is re-derived.
 *   - "thin" rows (sold12m under the floor) sort below supported rows: always
 *     under Median / Movers (a thin median or a thin yoy is not a read), as
 *     the tie-break everywhere else.
 *   - A search that matches a row by its NAME keeps the row whole; a search
 *     that only matches some of its live lots rescopes the row to exactly
 *     those lots (live count, flags, Matters) — "Mantle" under a set row
 *     never prints the set's whole book.
 */
import type { Market } from '../../constants';
import type { AuctionLot } from '../../types';
import type { VerifiedMover } from '../../preview/terminal/verified';
import { isFlagged } from '../flags';
import { searchTextOf } from '../lot-labels';
import { mattersOf, type LiveEntry } from './live';
import { completeQuarters, type EntityBundle } from '../../hooks/useEntities';
import type { EntityDetail, EntityRecord, EntitySummary, EntityYoy } from './model';
import { entityPageOf } from './key';
import { makerHref } from './retired';
import { bestLotImage, imageHostTier } from '../img-host';
import { makerLineOfWords } from '../watch-ref';
import { rowKindOf, rowPolicy, KIND, type RowKind } from './kinds';
import type { SortKey } from './view-state';

/** what a kind (or a subject's subKind) is called on its row's tag */
const KIND_TAG: Record<string, string> = {
  player: 'Player', pokemon: 'Pokémon', film: 'Film', franchise: 'Franchise', mission: 'Mission',
  person: 'Person', team: 'Team', band: 'Band', brand: 'Brand', set: 'Set', sub: 'Category',
};

/** a ledger row: the summary's figures + the live join, flattened for the
 *  memoized row component */
export interface Row {
  id: string; kind: RowKind; label: string; market: Market;
  /** the row's one tag: kind · discipline ("Player · Baseball", "Set",
   *  "Watchmaker") */
  tag: string | null;
  discipline: string | null;
  /** a real photo of the row's flagship lot */
  hero: string | null;
  /** complete quarters, null = a thin quarter (a gap, drawn as a gap) */
  spark: (number | null)[] | null;
  live: number;
  flags: number;
  sold: number | null;
  median: number | null;
  /** the median's n (trailing 12 months) */
  medianN: number | null;
  /** what the median is over ('Sports Cards · Singles', 'all') */
  medianScope: string | null;
  revenue: number;
  sold12: number;
  /** the tail's start year when sold12 is NOT a true 12-month count */
  sold12Since: string | null;
  record: EntityRecord | null;
  verified: VerifiedMover | null;
  /** year-over-year, only when both sides clear the n gate (the build's rule) */
  yoy: EntityYoy | null;
  thin: boolean;
  liveLots: AuctionLot[];
  /** "Matters": the summed priority of the row's three most important live lots */
  topScore: number;
  /** the entity's own page (maker page, player dossier, /entity?id=) */
  page: string | null;
  /** a feed list this row lands on (By-category rows, the remainder) — null
   *  when the row has a page */
  feed: string | null;
  follow: string | null;
  canCompare: boolean;
  /** sold history the source holds (quarters, houses) — null = none */
  detail: EntityDetail | null;
  bundle: EntityBundle;
  /** a search matched this row's lots, not its name: the row is rescoped */
  scoped?: boolean;
}

export const EMPTY_LOTS: AuctionLot[] = [];

/** the row's one tag */
export function tagOf(kind: RowKind, s: EntitySummary): string | null {
  if (kind === 'maker' || kind === 'rest') return s.discipline;
  const k = KIND_TAG[kind === 'subject' ? (s.subKind ?? '') : kind] ?? null;
  // the discipline's own last word ("Sports Cards · Lots & Sets" → "Lots &
  // Sets") — the market already names the category
  const d = s.discipline ? s.discipline.split(' · ').pop()!.replace(/ \(.*\)$/, '') : null;
  if (!k) return d;
  if (kind === 'sub') return null;
  if (!d || d === k) return k;
  return `${k} · ${d}`;
}

/** one entity bundle + its live join → a ledger row */
export function buildRow(id: string, b: EntityBundle, live: LiveEntry | undefined, dossiers: ReadonlySet<string>): Row {
  const s = b.s;
  const kind: RowKind = rowKindOf(id) ?? s.kind;
  const lots = live?.lots ?? EMPTY_LOTS;
  const pol = rowPolicy(id, { playerDossier: kind === 'player' && dossiers.has(id.slice(3)) });
  // a trend needs four printed quarters (the build's MIN_SPARK_POINTS) —
  // three dots and a gap are not a line
  const sp = s.spark && s.spark.filter(v => v != null && v > 0).length >= 4 ? s.spark : null;
  // the page an entity id names (P2: every player has a dossier, a subject
  // or a set its /entity page); a By-category row and the remainder land on
  // their feed list
  // a maker's link goes through makerHref (a retired pseudo-maker's slug
  // resolves to its real home — app/lib/entity/retired)
  const page = kind === 'sub' || kind === 'rest' ? null
    : kind === 'maker' ? makerHref(id.slice(3))
    : (entityPageOf(id) ?? pol.page);
  return {
    id, kind, label: s.label, market: s.market,
    tag: tagOf(kind, s),
    discipline: s.discipline,
    // a maker's face is its flagship (page-stats / the build's face rule);
    // a subject or sub row shows its best live lot
    // (a flagship on a host some browsers refuse — christies — yields to a
    // live photo on a host that renders, when one exists: app/lib/img-host)
    hero: kind === 'maker'
      ? (s.face && imageHostTier(s.face) < 2 ? s.face : (pickRenderable(bestLotImage(lots), s.face) ?? null))
      : (b.liveFace ?? bestLotImage(lots) ?? s.face ?? null),
    spark: sp,
    live: lots.length,
    flags: live?.flags ?? 0,
    sold: s.sold,
    median: s.med12m || null,
    // a By-category row's median is over its trailing year's sales (cat-stats
    // carries no separate n): its n is that 12-month count
    medianN: s.med12m ? (s.med12mN || (kind === 'sub' && s.sold12m ? s.sold12m : null)) : null,
    medianScope: s.med12m ? s.medScope : null,
    revenue: s.revenue ?? 0,
    sold12: s.sold12m ?? 0,
    sold12Since: s.sold12mSince ?? null,
    record: s.record,
    verified: (s.verified as VerifiedMover | null) ?? null,
    yoy: s.yoy,
    thin: s.thin,
    liveLots: lots,
    topScore: live?.score ?? -1,
    page,
    feed: page ? null : pol.page,
    follow: s.caps?.follow ?? pol.follow,
    // P2: compare is open to every kind with something to compare — a
    // trend, a live book or a median (the remainder row is not an entity)
    canCompare: kind !== 'rest' && (KIND[kind].compare || !!sp || lots.length > 0 || !!s.med12m),
    detail: b.detail,
    bundle: b,
  };
}

/* ═════════ SEARCH — one needle for names and lots ═════════ */

/** lowercase, accents folded ("Prouvé" ↔ "prouve") */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** the query's words (every one must appear, any order). A short number (a
 *  grade, a mission) right after a word stays with it — "mantle psa 8" is ['mantle', 'psa 8'],
 *  "apollo 11 flown" is ['apollo 11', 'flown']: a bare "8" would match every
 *  1958 in the book. */
export function needleOf(q: string): string[] {
  const out: string[] = [];
  for (const t of fold(q.trim()).split(/\s+/).filter(Boolean)) {
    const prev = out[out.length - 1];
    // a grade or a number ("psa 8", "bgs 9.5", "apollo 11", "psa 7+" = 7
    // and up) — never a year
    if (prev && /^\d{1,2}(\.\d)?\+?$/.test(t) && /[a-z]$/.test(prev)) out[out.length - 1] = `${prev} ${t}`;
    else out.push(t);
  }
  return out;
}

/** A grade search is EXACT ("psa 7" = PSA 7 only); its "and up" form is
 *  "psa 7+". For a query naming one grader grade, the words with that grade
 *  widened (`plus`) and the label to offer ("PSA 7+"); else null. */
const GRADER = /^(psa|bgs|sgc|cgc|beckett|hga|csg|tag|gma|ksa|isa|psa\/dna) (\d{1,2}(?:\.\d)?)$/;
export function gradePlusOf(words: readonly string[]): { plus: string[]; label: string; q: (q: string) => string } | null {
  const i = words.findIndex(w => GRADER.test(w));
  if (i < 0) return null;
  const m = GRADER.exec(words[i])!;
  if (parseFloat(m[2]) >= 10) return null; // nothing above a 10 to widen to
  const plus = words.slice();
  plus[i] = `${words[i]}+`;
  return { plus, label: `${m[1].toUpperCase()} ${m[2]}+`, q: (q: string) => widenGrade(q, words[i]) };
}
/** the reader's own text with that one grade widened ("Mantle PSA 7" →
 *  "Mantle PSA 7+"), their spelling and case kept */
function widenGrade(q: string, word: string): string {
  let done = false;
  return q.replace(/([a-z/]+)(\s+)(\d{1,2}(?:\.\d)?)(?![\d.+])/gi, (m, a: string, sp: string, n: string) => {
    if (done || `${fold(a)} ${n}` !== word) return m;
    done = true;
    return `${a}${sp}${n}+`;
  });
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const atLeast = new Map<string, { re: RegExp; min: number } | null>();
/** `w` in `h`, where a number never matches inside a longer number
 *  ("psa 8" is not "psa 8.5" or "psa 80"; "1986" is not "19860") */
function hasWord(h: string, w: string): boolean {
  // "psa 7+": the word, then a number at or above the floor
  if (w.endsWith('+')) {
    let a = atLeast.get(w);
    if (a === undefined) {
      const m = /^(.+) (\d{1,2}(?:\.\d)?)\+$/.exec(w);
      a = m ? { re: new RegExp(`${esc(m[1])} (\\d{1,2}(?:\\.\\d)?)(?![\\d.])`, 'g'), min: parseFloat(m[2]) } : null;
      atLeast.set(w, a);
    }
    if (!a) return h.includes(w);
    a.re.lastIndex = 0;
    for (let m = a.re.exec(h); m; m = a.re.exec(h)) if (parseFloat(m[1]) >= a.min) return true;
    return false;
  }
  const numEnd = /\d$/.test(w), numStart = /^\d/.test(w);
  if (!numEnd && !numStart) return h.includes(w);
  let i = h.indexOf(w);
  while (i >= 0) {
    const after = h.charAt(i + w.length), before = i > 0 ? h.charAt(i - 1) : '';
    const okAfter = !numEnd || !/[\d.]/.test(after) || (after === '.' && !/\d/.test(h.charAt(i + w.length + 1)));
    const okBefore = !numStart || !/\d/.test(before);
    if (okAfter && okBefore) return true;
    i = h.indexOf(w, i + 1);
  }
  return false;
}

const hay = new WeakMap<object, string>();
/** a live lot's folded search text (the home feed's label vocabulary) */
export function lotHay(l: AuctionLot): string {
  let h = hay.get(l);
  if (h == null) { h = fold(searchTextOf(l)); hay.set(l, h); }
  return h;
}
export function lotMatches(l: AuctionLot, words: readonly string[]): boolean {
  if (!words.length) return true;
  const h = lotHay(l);
  for (const w of words) if (!hasWord(h, w)) return false;
  return true;
}

/** does the row's name (label, tag) carry every word? */
const nameHay = new Map<string, string>();
export function nameMatches(r: Pick<Row, 'label' | 'tag'>, words: readonly string[]): boolean {
  if (!words.length) return true;
  const raw = `${r.label} ${r.tag ?? ''}`;
  let h = nameHay.get(raw);
  if (h == null) { h = fold(raw); nameHay.set(raw, h); }
  for (const w of words) if (!hasWord(h, w)) return false;
  return true;
}

/** the model line a maker-row search names after the maker's own words
 *  ("rolex daytona" → 'daytona'), or null */
export function lineSearchOf(r: Pick<Row, 'id' | 'label' | 'tag'>, words: readonly string[]): string | null {
  if (!r.id.startsWith('mk:') || words.length < 2) return null;
  const rest = words.filter(w => !nameMatches(r, [w]));
  if (!rest.length || rest.length === words.length) return null;
  return makerLineOfWords(r.id.slice(3), rest);
}

/**
 * The row as a search shows it: whole when its name matches; rescoped to the
 * matching lots when only some lots do; null when neither.
 */
export function searchRow(r: Row, words: readonly string[]): Row | null {
  if (!words.length || nameMatches(r, words)) return r;
  // "rolex daytona": the maker's name plus one of its own model lines keeps
  // the maker's row (its panel leads with that line's references), with only
  // the live lots that name the line — none is an honest 0, not all of Rolex
  const line = r.kind === 'maker' ? lineSearchOf(r, words) : null;
  if (!line && !r.liveLots.length) return null;
  const lots = r.liveLots.filter(l => lotMatches(l, words));
  if (!lots.length && !line) return null;
  let flags = 0;
  for (const l of lots) if (isFlagged(l)) flags++;
  return { ...r, liveLots: lots, live: lots.length, flags, topScore: mattersOf(lots), scoped: true };
}

/** the row narrowed to its flagged lots (the Flagged lens on the names
 *  body); null when none is flagged */
export function flaggedRow(r: Row): Row | null {
  if (!r.flags) return null;
  if (r.flags === r.live) return r;
  const lots = r.liveLots.filter(isFlagged);
  return { ...r, liveLots: lots, live: lots.length, topScore: mattersOf(lots), scoped: true };
}

/** the row under the Following lens: whole when the reader follows the name
 *  itself; else narrowed to its live lots in a followed category (the lens's
 *  lot count is then the sum of the rows); null when neither */
export function followedRow(r: Row, nameFollowed: boolean, lotFollowed: (l: AuctionLot) => boolean): Row | null {
  if (nameFollowed) return r;
  const lots = r.liveLots.filter(lotFollowed);
  if (!lots.length) return null;
  if (lots.length === r.liveLots.length) return r;
  let flags = 0;
  for (const l of lots) if (isFlagged(l)) flags++;
  return { ...r, liveLots: lots, live: lots.length, flags, topScore: mattersOf(lots), scoped: true };
}

/* ═════════ ORDER ═════════ */

const by = (a: number, b: number) => b - a;
/** Movers ranks a year-over-year read first only on this many sales across
 *  its two years (the build's gate is 10 a side; the column still prints
 *  every gated read) */
export const MOVERS_MIN_N = 60;
/** …or, for a like-for-like read (basis 'matched'), on this many identities
 *  sold in both years (its n counts pairs, not sales) */
export const MOVERS_MIN_PAIRS = 30;
/** (R7) the move a read's 90% interval GUARANTEES, signed percent: the
 *  bound nearest zero when the interval excludes no change, else 0. null = a
 *  read without an interval (an older payload, the index basis) */
export function guaranteedMove(y: EntityYoy | null): number | null {
  if (!y || y.lo == null || y.hi == null) return null;
  return y.lo > 0 ? y.lo : y.hi < 0 ? y.hi : 0;
}
/** the size of that guaranteed move, as a log ratio (a halving ranks with a
 *  doubling) */
const moveSize = (y: EntityYoy | null) => Math.abs(Math.log1p((guaranteedMove(y) ?? 0) / 100));
// a clear like-for-like move leads — its interval excludes no change —
// ranked by the size the interval guarantees, never by the point read (a
// noisy +200% on 6 pairs with an interval down to +5% ranks as +5%); then a
// clear pooled-median move (its interval sees sampling noise, never a change
// in what sold — a sealed set's packs one year and cases the next); then
// reads bounded around flat; then (older payloads, no interval) pooled
// medians on a well-supported sample and like-for-like reads by count; then
// thinner; then none
const moverTier = (r: Row) => {
  if (!r.yoy) return 4;
  const g = guaranteedMove(r.yoy);
  if (g != null) return g === 0 ? 2 : r.yoy.basis === 'median' ? 1 : 0;
  return r.yoy.basis === 'matched' ? (r.yoy.n >= MOVERS_MIN_PAIRS ? 2 : 3) : r.yoy.n >= MOVERS_MIN_N ? 2 : 3;
};

/** the ledger's comparator; `thin` sinks under supported rows (always for
 *  the sold-history reads, as the tie-break otherwise) */
export function compareRows(sort: SortKey): (a: Row, b: Row) => number {
  const thinLast = (a: Row, b: Row) => (a.thin ? 1 : 0) - (b.thin ? 1 : 0);
  const soldTie = (a: Row, b: Row) => by(a.sold12, b.sold12) || by(a.sold ?? 0, b.sold ?? 0) || a.label.localeCompare(b.label);
  switch (sort) {
    case 'matters': return (a, b) => by(a.topScore, b.topScore) || by(a.live, b.live) || thinLast(a, b) || soldTie(a, b);
    case 'live': return (a, b) => by(a.live, b.live) || by(a.flags, b.flags) || thinLast(a, b) || soldTie(a, b);
    case 'flags': return (a, b) => by(a.flags, b.flags) || by(a.live, b.live) || thinLast(a, b) || soldTie(a, b);
    case 'movers': return (a, b) => thinLast(a, b)
      // clear moves first, by the move their interval guarantees (either
      // way); bounded reads next; older interval-less reads by support (a
      // 16-sale +4,204% is a mix artefact, not a mover); none last
      || moverTier(a) - moverTier(b)
      || by(moveSize(a.yoy), moveSize(b.yoy))
      || by(Math.abs(a.yoy?.pct ?? 0), Math.abs(b.yoy?.pct ?? 0))
      || soldTie(a, b);
    case 'median': return (a, b) => thinLast(a, b) || by(a.median ?? -1, b.median ?? -1) || soldTie(a, b);
    case 'sold12': return (a, b) => by(a.sold12, b.sold12) || by(a.sold ?? 0, b.sold ?? 0) || thinLast(a, b) || a.label.localeCompare(b.label);
    case 'name': return (a, b) => a.label.localeCompare(b.label);
  }
}

/** (r8) the markets Movers does not rank. Their pieces are one of a kind —
 *  almost nothing sells twice to compare like for like (a signed photo is not
 *  the same object as last year's), so every year-over-year read there is a
 *  pooled median that moves with what sold, not with prices. Measured Oct 10
 *  on the full corpus: same-title repeats across both years reach 5 on 29 of
 *  3,543 Pop Culture and Science names, and those are generic titles, not one
 *  object resold. Rows there keep the Matters order under Movers, said so. */
export const NO_MOVERS: ReadonlySet<Market> = new Set<Market>(['culture', 'science']);

/** the remainder row always closes its group */
export function sortRows(rows: Row[], sort: SortKey): Row[] {
  if (sort === 'movers' && rows.some(r => NO_MOVERS.has(r.market))) {
    // grouped by market downstream: each part keeps its own order
    const ranked = sortRows(rows.filter(r => !NO_MOVERS.has(r.market)), sort);
    const kept = sortRows(rows.filter(r => NO_MOVERS.has(r.market)), 'matters');
    return ranked.concat(kept);
  }
  const cmp = compareRows(sort);
  return rows.sort((a, b) => (a.kind === 'rest' ? 1 : 0) - (b.kind === 'rest' ? 1 : 0) || cmp(a, b));
}

/* ═════════ small reads the row + panel print ═════════ */

/** the trend's last complete quarter (r8: the trailing year's median to it on a
 *  'median' spark; a quarterly median on a fail-soft one), for a compare
 *  column's caption — never the partial current quarter */
export function lastQuarterOf(r: Row, now = Date.now()): { q: string; v: number } | null {
  const sp = r.spark, q = r.bundle.sparkQ;
  if (!sp || !q || q.length !== sp.length) return null;
  const pts = completeQuarters(sp.map((v, i) => ({ date: q[i], v })), now);
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i].v != null && pts[i].v! > 0) return { q: String(pts[i].date), v: pts[i].v! };
  return null;
}

/** the money format the ledger prints (compact) */
export const fmtUsd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B`
  : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
  : n >= 1e4 ? `$${Math.round(n / 1e3)}K`
  : `$${Math.round(n).toLocaleString()}`;

/** a signed percent (true minus) */
export const fmtPct = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(Math.round(p))}%`;

/* ── the yoy read, said one way everywhere (row, panel, compare, page) ── */

/** the read's basis in words, with its n */
export function yoyBasisText(y: EntityYoy): string {
  return y.basis === 'index' ? `repeat-sales index · n ${y.n.toLocaleString()}`
    : y.basis === 'matched' ? `same items, both years · ${y.n.toLocaleString()} matched`
      : `median sale · n ${y.n.toLocaleString()}`;
}
/** its 90% interval in words ('' when the read carries none) */
export const yoyIntervalText = (y: EntityYoy): string => (y.lo != null && y.hi != null ? `90% interval ${fmtPct(y.lo)} to ${fmtPct(y.hi)}` : '');
/** a direction only for a clear move: an interval that straddles no change
 *  prints neutral (the read is "flat within its band", not a rise or fall) */
export function yoyDir(y: EntityYoy | null): 'up' | 'down' | undefined {
  if (!y) return undefined;
  if (y.lo != null && y.hi != null && y.lo <= 0 && y.hi >= 0) return undefined;
  return y.pct >= 0 ? 'up' : 'down';
}
/** the row cell's title: basis, n, interval, and what the interval says */
export function yoyTitle(y: EntityYoy | null): string {
  if (!y) return 'No year-over-year read: too few of the same items sold in both years, or the read is too uncertain to call (its 90% interval wide and either side of no change)';
  const ci = yoyIntervalText(y);
  const verdict = !ci ? '' : yoyDir(y) ? ` — a clear ${y.pct >= 0 ? 'rise' : 'fall'}` : ' — no clear move';
  return `Year over year · ${yoyBasisText(y)}${ci ? ` · ${ci}` : ''}${verdict}`;
}

/** the live photo when it sits on a better host than the flagship, else the flagship */
function pickRenderable(live: string | null, face: string | null): string | null {
  if (!live) return face;
  if (!face) return live;
  return imageHostTier(live) < imageHostTier(face) ? live : face;
}
