/**
 * emit-value-book.ts — lectr's value book for Starling (the buy-side sibling).
 *
 * Emits ONE row per high-confidence identity key per vertical:
 *   { k, v, med, lo, hi, n, n12, lastSale, trend, conf }
 * gzipped → PRIVATE R2 (lectr-data/latest/value-book.json.gz). Starling reads it
 * with a scoped read token; the book is never published publicly (it's the moat).
 *
 * The identity keys MUST be byte-identical to what Starling's matchers produce
 * (Starling ported its parsers from these very functions), so we reuse lectr's
 * key machinery as the source of truth and map lectr's markets → Starling's
 * vertical slugs. Two segments Starling hyphenates (art-edition titles, autograph
 * signers) are slug()'d here to match.
 *
 * SINGLE LOAD (Oct 2026): the nightly builds the book INSIDE
 * `assemble.ts --single-load` (buildValueBook over the in-memory corpus — the
 * same rows this script would read back from the corpus gz) and writes it to
 * the local tmp file + a marker naming the corpus files it was built from.
 * The nightly's "Emit value book" step then only PUSHES it (it holds the R2
 * write token; the assemble step does not) — no second full-corpus load.
 * Standalone (no marker, or a marker for a different corpus): loads the
 * corpus itself (NODE_OPTIONS=--max-old-space-size≈8192) and builds it.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { readGzRows, CORPUS_DIR } from './corpus-io';
import { normalizeCorpus } from './lib/corpus-normalize';
import {
  numericWatchRef,
  editionIdentityKey,
  isEditionLot,
  autographFormatOf,
  WATCH_SLUGS,
  AUTOGRAPH_SLUGS,
} from '../app/lib/identity';
import { marketOf } from '../app/constants';
import { extractSignerSlug } from './lib/autograph-signer';
import { parseCard } from '../app/lib/cards';
import { hasConditionFlag } from '../app/lib/condition';
import {
  isCompExcluded, lotShapeOf, isDualWatchRef, watchSaleClass, purifyWatchSales, WATCH_MIN_N, type WatchSaleClass,
} from '../app/lib/comps';
import { mergeCardExtract, llmConditionFlag } from './lib/extract/apply';
import { ENGINE_VERSION } from '../app/lib/value';
import type { AuctionLot } from '../app/types';

/** The book's OWN logic version (what admits a sale / ships a row) — stamped
 *  in the header beside the engine version so Starling can tell a book-rule
 *  change from an engine change. Bump on any admission/aggregation change.
 *  2026.10.06: the Starling audit pass — comp exclusions + shape gate on every
 *  sale, card grade qualifiers / Authentic / unparsed slabs / multi-card lots /
 *  variant-mixed pools out, watch variant split (gem / special-dial / material)
 *  + dual-reference abstain + watch n≥5 and band-dispersion abstain, and the
 *  effective-sample guard on the recency-weighted median. */
export const BOOK_VERSION = '2026.10.06';

// ── Starling's slug (replicated verbatim so keys match) ──────────────────────
function slug(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── order statistics — the ONE definitions (app/lib/stats.ts via value.ts) ──
// THE quantile (P2): the engine's lerp convention, imported — no local copies
import { quantile } from '../app/lib/value';
// THE lower weighted median (stats.ts) — formerly a local copy here
import { weightedMedian } from '../app/lib/stats';
const lerpQuantile = quantile;

/* ═══════════════════════════════════════════════════════════════════════════
   SALE ADMISSION (Oct 6 2026 — the Starling audit). The book used to pool
   every sold lot that produced a key; it bypassed the engine's own comp
   exclusions. A book row is a price for ONE whole object of an exact
   identity, so a sale enters only when the engine would admit it as a comp:
     · never a compExclude-stamped lot (price < $10, > 50× est / < 2% est,
       unconverted FX, last-tracked bid, seed/search urls, stale rows)
     · never an unknown-precision date
     · the form/part gate: a single, whole object (no pairs/sets/lots/
       collections, no parts/fragments/accessories)
   ═══════════════════════════════════════════════════════════════════════════ */
export type SkipReason =
  | 'comp-exclude' | 'date-unknown' | 'multi-lot' | 'part'
  | 'condition' | 'grade-qualifier' | 'grade-authentic' | 'grade-unparsed' | 'slab-unkeyed'
  | 'multi-card' | 'serial' | 'watch-dual-ref';

export function saleAdmission(l: AuctionLot): SkipReason | null {
  if (isCompExcluded(l)) return 'comp-exclude';
  if ((l as { datePrecision?: string | null }).datePrecision === 'unknown') return 'date-unknown';
  const shape = lotShapeOf(l.title);
  if (shape.part) return 'part';
  if (shape.count !== 1) return 'multi-lot';
  return null;
}

// ── cards ────────────────────────────────────────────────────────────────────
/** The card slugs the engine's card paths run on (build-market CARD_SLUGS). */
const CARD_SLUGS = new Set(['sports-cards', 'graded-cards']);
/** Any grading / authentication house or slab word. A title that names one
 *  but whose card grade did not parse is NEVER a raw sale (TGA/GMA/KSA/ISA…
 *  are not in the engine parser's grader set; SGC 100-scale, "PSA/DNA" auto
 *  authentication and bare "slabbed"/"graded" all land here). */
const SLAB_HINT_RE = /\b(?:PSA|BGS|BVG|SGC|CGC|CSG|HGA|TGA|GMA|KSA|ISA|AGS|MNT|PGI|GAI|CGA|Beckett|slab(?:bed)?|encapsulated|graded|authentic(?:ated)?)\b/i;
/** two or more card numbers outside parentheses ("#4 Babe Ruth and #46 Joe
 *  Sewell") — a multi-card lot, never one card */
function cardNoCount(title: string): number {
  return (title.replace(/\([^)]*\)/g, ' ').match(/#\s?[A-Za-z]{0,4}\d/g) || []).length;
}

export interface CardBookId {
  key: string;
  /** the parallel / autograph signature ('' = the base card) — the axis the
   *  Starling key does not carry, so a pool is held to ONE signature */
  variant: string;
}

/** A sold card lot → its book identity, or the reason it never enters one.
 *  Key format is Starling's (`player|year|set|cardNo|GRADE`, GRADE = PSA9 …
 *  or 'raw'); identity is the ENGINE's card parser (+ the advisory LLM fill),
 *  so qualifiers / Authentic / unparsed graders are seen the same way the
 *  engine sees them. */
export function cardBookId(l: AuctionLot): CardBookId | SkipReason | null {
  if (!CARD_SLUGS.has(l.artist)) return null;
  const title = l.title || '';
  if (hasConditionFlag(title) || llmConditionFlag(l)) return 'condition';
  const c = mergeCardExtract(parseCard(title), l);
  if (!c.playerSlug || !c.year || !c.cardNo) return null;
  // Serial-numbered parallels (/25, 1/1) are a DIFFERENT market than the base
  // card — Starling's key carries no serial, so they never enter a base pool.
  if (c.serialOf != null) return 'serial';
  if (cardNoCount(title) >= 2) return 'multi-card';
  // grade qualifiers (OC/MC/ST/PD/MK/OF) trade far below the clean grade and
  // Starling abstains on them — they never pool into a clean key
  if (c.gradeQual) return 'grade-qualifier';
  // slabbed Authentic / Altered: no numeric card grade — never 'raw'
  if (c.gradeTag) return 'grade-authentic';
  if (c.gradeUnparsed) return 'grade-unparsed';
  // the trailing "- SGC 96" form is not range-checked by the parser: an SGC
  // 100-point grade is not a 10-point grade (Starling abstains on those too)
  if (c.gradeNum != null && !(c.gradeNum >= 1 && c.gradeNum <= 10)) return 'grade-unparsed';
  const graded = c.gradeCo && c.gradeNum != null;
  if (!graded && SLAB_HINT_RE.test(title)) return 'slab-unkeyed';
  const grade = graded ? `${c.gradeCo}${c.gradeNum}` : 'raw';
  const set = (c.setName || '').toLowerCase().replace(/\s+/g, ' ').trim();
  // 'sp' (short print) is a descriptor houses add or omit for the SAME card
  // ("1957 Topps #77 Bill Russell Rookie [SP]") — never a purity axis
  const parallel = (c.variant || '').split('+').filter(t => t && t !== 'sp').join('+');
  const variant = [parallel, c.autoGrade ? `ag:${c.autoGrade}` : ''].filter(Boolean).join('|');
  return { key: `${c.playerSlug}|${c.year}|${set}|${c.cardNo}|${grade}`, variant };
}

const PKMN_GRADE = /\b(PSA|BGS|CGC|SGC)\s*(?:GEM\s*MT|GEM\s*MINT|MINT|NM-?MT\+?|NM|EX-?MT|EX|VG)?\s*(10|[1-9](?:\.5)?)\b/i;
const PKMN_QUAL_AFTER = /^\s*\(?\s*(?:OC|MK|ST|PD|MC|OF)\s*\)?(?![a-z])/i;
const PKMN_TAG = /\b(?:PSA|BGS|CGC|SGC)\s*[-:]?\s*(?:authentic|auth\b|altered)/i;
export function pokemonKey(l: AuctionLot): string | SkipReason | null {
  if (l.artist !== 'pokemon') return null;
  const t = l.title || '';
  if (hasConditionFlag(t)) return 'condition';
  if (PKMN_TAG.test(t)) return 'grade-authentic';
  const yr = (t.match(/\b(19|20)\d{2}\b/) || [])[0];
  const no = (t.match(/#([A-Za-z0-9]+)\b/) || [])[1];
  const g = t.match(PKMN_GRADE);
  if (!yr || !no || !g) return null;
  if (PKMN_QUAL_AFTER.test(t.slice((g.index || 0) + g[0].length))) return 'grade-qualifier';
  if (cardNoCount(t) >= 2) return 'multi-card';
  const setPart = t
    .slice(t.indexOf(yr) + 4)
    .split('#')[0]
    .replace(/\b(pok[eé]mon|holo(?:foil)?|1st edition|shadowless|unlimited|reverse|japanese|english)\b/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-');
  if (!setPart) return null;
  const ed = /1st edition/i.test(t) ? '1st' : /shadowless/i.test(t) ? 'shadowless' : 'unl';
  return `${yr}|${setPart}|${no}|${ed}|${g[1].toUpperCase()}${g[2]}`;
}

// ── watches ──────────────────────────────────────────────────────────────────
// The variant classes (isDualWatchRef, watchSaleClass, the material split) live
// in app/lib/comps.ts — ONE source shared with the engine's watch comp pools.
export { isDualWatchRef, watchSaleClass, type WatchSaleClass };

type Vertical = 'sports-cards' | 'autographs' | 'pokemon' | 'art-editions' | 'watches' | 'design';

interface KeyHit { key: string; v: Vertical; variant?: string; watch?: WatchSaleClass }

/** Route a lot to its identity key + Starling vertical, a skip reason, or
 *  null when it has no book identity. Autographs first (signer+format), then
 *  pokémon, then market-dispatched. */
export function keyForLot(l: AuctionLot): KeyHit | SkipReason | null {
  // Autographs: science/culture (excl. pokémon) + the autographs slug.
  if (AUTOGRAPH_SLUGS.has(l.artist)) {
    const fmt = autographFormatOf(l.title);
    if (!fmt) return null;
    const signer = extractSignerSlug(l); // structured field OR parsed from RR/Christie's title/medium
    if (!signer) return null;
    return { key: `${signer}|${fmt}`, v: 'autographs' };
  }
  if (l.artist === 'pokemon') {
    const k = pokemonKey(l);
    return k && k.includes('|') ? { key: k, v: 'pokemon' } : (k as SkipReason | null);
  }
  const m = marketOf(l.artist);
  if (m === 'sports') {
    const c = cardBookId(l);
    return c && typeof c === 'object' ? { key: c.key, v: 'sports-cards', variant: c.variant } : c;
  }
  if (WATCH_SLUGS.has(l.artist)) {
    const k = numericWatchRef(l);
    if (!k) return null;
    if (isDualWatchRef(k)) return 'watch-dual-ref';
    return { key: k, v: 'watches', watch: watchSaleClass(l) };
  }
  if (m === 'art') {
    if (!isEditionLot(l)) return null;
    const k = editionIdentityKey(l);
    if (!k) return null;
    const bar = k.indexOf('|');
    // Starling hyphenates the normalized title segment; match it.
    return { key: `${k.slice(0, bar)}|${slug(k.slice(bar + 1))}`, v: 'art-editions' };
  }
  if (m === 'design') {
    const mk = l.modelKey ?? null; // persisted; no comps.ts import needed
    return mk ? { key: `${l.artist}|${mk}`, v: 'design' } : null;
  }
  return null;
}

// ── CONTEXT TIER (schema-additive, Aug 19) ───────────────────────────────────
// The hunt lane's fix: a hit with no exact book row shouldn't read "no book
// value" when lectr HAS nearby evidence. Context rows are honest rollups one
// level up the identity ladder — signer across formats, player × object slug,
// curated natural-history/early-tech classes, artist edition rollups. Looser
// bar (n≥3, no dispersion gate — the band carries the spread), same staleness
// gate, and every row is labeled by kind so Starling can caption it honestly
// ("Charles Schulz signed material — 41 sales, $150–$2.4K").
// CLASS_CANON is a cross-repo contract: Starling's context matcher implements
// the same regexes — keep ids stable.
const CLASS_CANON: [string, RegExp][] = [
  ['trex-tooth', /\b(?:t[- ]?rex|tyrannosaur\w*)\b.*\btooth|\btooth\b.*\b(?:t[- ]?rex|tyrannosaur\w*)\b/i],
  ['megalodon-tooth', /\bmegalodon\b/i],
  ['mosasaur-tooth', /\bmosasaur\w*\b/i],
  ['raptor-claw', /\braptor\b.*\bclaw|\bclaw\b.*\braptor\b/i],
  ['ammonite', /\bammonite\b/i],
  ['trilobite', /\btrilobite\b/i],
  ['dinosaur-egg', /\bdinosaur\b.*\begg|\begg\b.*\bdinosaur\b/i],
  ['meteorite', /\bmeteorite\b/i],
  ['apple-1', /\bapple[- ]?(?:1|one)\b/i],
  ['apple-ii', /\bapple[- ]?(?:2|ii)\b/i],
  ['macintosh-vintage', /\bmacintosh\b|\bmac\b.*\b(?:128k|512k|plus|se)\b/i],
];
interface ContextRow {
  k: string; v: Vertical | 'sports' | 'science';
  kind: 'signer' | 'player-object' | 'class' | 'artist';
  med: number; lo: number; hi: number; n: number; n12: number; lastSale: string;
}
function contextKeysForLot(l: AuctionLot): { key: string; v: ContextRow['v']; kind: ContextRow['kind'] }[] {
  const out: { key: string; v: ContextRow['v']; kind: ContextRow['kind'] }[] = [];
  const t = l.title || '';
  if (AUTOGRAPH_SLUGS.has(l.artist) && /signed|autograph/i.test(t)) {
    const signer = extractSignerSlug(l);
    if (signer) out.push({ key: signer, v: 'autographs', kind: 'signer' });
  }
  const m = marketOf(l.artist);
  if (m === 'sports' && !/card/.test(l.artist)) {
    const ps = (l as { playerSlug?: string | null }).playerSlug;
    if (ps) out.push({ key: `${ps}|${l.artist}`, v: 'sports', kind: 'player-object' });
  }
  if (m === 'science' || l.artist === 'science-tech' || l.artist === 'scientific-instruments') {
    for (const [id, re] of CLASS_CANON) {
      if (re.test(t)) { out.push({ key: id, v: 'science', kind: 'class' }); break; }
    }
  }
  if (m === 'art' && isEditionLot(l)) out.push({ key: l.artist, v: 'art-editions', kind: 'artist' });
  return out;
}

interface ValueBookRow {
  k: string;
  v: Vertical;
  med: number;
  lo: number;
  hi: number;
  n: number;
  /** sales in the trailing 12 months — the LIVING-evidence count. Starling
   *  gates and ranks on this (Aug 20 2026: all-time n let pools whose whole
   *  history is years old read as high-confidence and price dead markets). */
  n12: number;
  lastSale: string;
  trend: number | null;
  conf: 'high' | 'medium' | 'thin';
  /** (additive, Oct 6) cards: the parallel/autograph signature every sale in
   *  the row shares ('auto', 'color+refractor', 'auto|ag:10' …); absent =
   *  the base card. Starling's key has no variant axis — a listing whose
   *  variant differs from the row's is not this row's object. */
  variant?: string;
  /** (additive, Oct 6) watches: the case material the row's sales share
   *  ('steel' | 'gold' | 'two-tone' | 'platinum' | 'titanium'); absent =
   *  not stated in the sales. A listing in another material is not this row. */
  mat?: string;
}

const YEAR_MS = 365.25 * 864e5;

export interface ValueBook {
  schema: 1;
  builtAt: string;
  /** (additive, Oct 6) the served engine version (ENGINE_FLAGS_CURRENT) */
  engineVersion: string;
  /** (additive, Oct 6) the book's own rule version (BOOK_VERSION) */
  bookVersion: string;
  rows: ValueBookRow[];
  context: ContextRow[];
  gradeLadder: unknown;
  indexes: Record<string, unknown>;
  /** (additive, Oct 6) what the build kept out and why — sale skips by
   *  reason, pools abstained by reason, watch pools split (variant sales
   *  dropped) — so a reader can audit the book without the corpus */
  audit: { skipped: Record<string, number>; abstained: Record<string, number>; watchSplit: number };
}

type Sale = [usd: number, ms: number];
interface Pool { v: Vertical; sales: { p: Sale; date: string; variant?: string; watch?: WatchSaleClass }[] }

/** Vertical-aware dispersion tolerance (IQR ratio) for the MEDIUM tier. Graded
 *  cards are fungible (same card+grade → same price) so stay strict;
 *  autographs and editions legitimately spread wide (content/state-driven),
 *  and the honest lo–hi band already carries that uncertainty. High tier
 *  stays strict for all — a high call means a genuinely clustered pool. */
const MEDIUM_DISP: Record<Vertical, number> = {
  'sports-cards': 2.5,
  pokemon: 2.5,
  design: 3.0,
  watches: 3.5,
  'art-editions': 3.5,
  autographs: 5.0,
};
/** Watches: a reference row needs n ≥ 5 single-variant sales (no thin tier)
 *  and its 15–85 band within 2.5× — a wider band on ONE reference means the
 *  pool still mixes variants the titles don't name (dial colours,
 *  provenance), and the median is not a price for the listing Starling will
 *  see. The band is read on the trailing WATCH_BAND_YEARS when that window
 *  alone carries WATCH_MIN_N sales, so twenty years of price drift on a
 *  vintage reference is not mistaken for a variant mix. */
export { WATCH_MIN_N };
export const WATCH_MAX_BAND = 2.5;
const WATCH_BAND_YEARS = 5;
/** Variant purity: the dominant signature must hold ≥ 75% of a pool's sales
 *  (the rest are dropped); below that the pool abstains. */
const VARIANT_DOMINANCE = 0.75;

/** Kish effective sample size of the recency weights. */
function effectiveN(ws: number[]): number {
  let s = 0, s2 = 0;
  for (const w of ws) { s += w; s2 += w * w; }
  return s2 > 0 ? (s * s) / s2 : 0;
}

/** Narrow a pool to one variant (cards) / one plain material variant
 *  (watches). Returns the kept sales + any pool-level abstain reason. */
export function purifyPool(pool: Pool): { sales: Pool['sales']; abstain: string | null; split: boolean; variant?: string; mat?: string } {
  if (pool.v === 'sports-cards') {
    const by = new Map<string, number>();
    for (const s of pool.sales) by.set(s.variant || '', (by.get(s.variant || '') || 0) + 1);
    let top = '', topN = -1;
    by.forEach((n, k) => { if (n > topN || (n === topN && k < top)) { top = k; topN = n; } });
    if (topN / pool.sales.length < VARIANT_DOMINANCE) return { sales: [], abstain: 'card-variant-mixed', split: false };
    const kept = pool.sales.filter(s => (s.variant || '') === top);
    return { sales: kept, abstain: null, split: kept.length < pool.sales.length, variant: top || undefined };
  }
  if (pool.v === 'watches') {
    // the shared rule (comps.purifyWatchSales): minority-marker variants
    // leave; a mixed-material pool prices its cheapest documented material
    return purifyWatchSales(pool.sales, s => s.watch, s => s.p[0], WATCH_MIN_N);
  }
  return { sales: pool.sales, abstain: null, split: false };
}

/** Aggregate one purified pool into a row (or the reason it abstains). */
export function aggregatePool(
  k: string, v: Vertical, sales: Sale[], last: string, REF_MS: number,
): { row: ValueBookRow } | { abstain: string } {
  const n = sales.length;
  const minN = v === 'watches' ? WATCH_MIN_N : 3;
  if (n < minN) return { abstain: n < 3 ? 'n<3' : 'watch-n' }; // n=3 ships as the labeled 'thin' tier (not watches)
  const vals = sales.map(x => x[0]).sort((a, b) => a - b);
  const disp = quantile(vals, 0.75) / Math.max(quantile(vals, 0.25), 1);
  let conf: 'high' | 'medium' | 'thin' | null = null;
  if (n >= 6 && disp <= 1.5) conf = 'high';
  else if (n >= 4 && disp <= (MEDIUM_DISP[v] ?? 2.5)) conf = 'medium';
  else if (n === 3 && disp <= (MEDIUM_DISP[v] ?? 2.5) * 1.4) conf = 'thin';
  if (!conf) return { abstain: 'dispersion' }; // wide-dispersion pools still never ship
  const q15 = lerpQuantile(vals, 0.15), q85 = lerpQuantile(vals, 0.85);
  if (v === 'watches') {
    const recent = sales.filter(([, ms]) => REF_MS - ms <= WATCH_BAND_YEARS * YEAR_MS).map(x => x[0]).sort((a, b) => a - b);
    const bv = recent.length >= WATCH_MIN_N ? recent : vals;
    if (lerpQuantile(bv, 0.85) / Math.max(lerpQuantile(bv, 0.15), 1) > WATCH_MAX_BAND) return { abstain: 'watch-band' };
  }

  // Staleness gate: a pool whose LATEST sale is >4y old is not a tradable
  // book — "60% under" a 2015 median is not a live call. (2–4y rows ship and
  // Starling badges them "aging"; older is dropped.)
  if (REF_MS - Date.parse(last) > 4 * YEAR_MS) return { abstain: 'stale' };

  const ws = sales.map(([, ms]) => Math.pow(0.5, (REF_MS - ms) / YEAR_MS / 2));
  // Recency-weighted median — UNLESS the weights put the whole call on one
  // sale (Kish effective n < 2: one recent sale against a decade-old pool).
  // That made a single $151,652 signed W517 Ruth the "raw" price over five
  // $230–$1,410 sales. Then the plain median speaks for the pool.
  const med = Math.round(effectiveN(ws) < 2 ? quantile(vals, 0.5) : weightedMedian(sales.map(([usd], i) => [usd, ws[i]] as [number, number])));
  // Band from unweighted quantiles, CLAMPED to contain the recency-weighted
  // median — a med outside its own band (11% of rows otherwise, when recent
  // sales run hot/cold vs the all-time distribution) breaks the display
  // semantics and the honesty of "the band".
  const lo = Math.min(Math.round(q15), med);
  const hi = Math.max(Math.round(q85), med);

  // 1Y trend: trailing-12mo median vs prior-12mo median (fraction), else null.
  const t12 = sales.filter(([, ms]) => REF_MS - ms <= YEAR_MS).map(x => x[0]).sort((a, b) => a - b);
  const p12 = sales.filter(([, ms]) => REF_MS - ms > YEAR_MS && REF_MS - ms <= 2 * YEAR_MS).map(x => x[0]).sort((a, b) => a - b);
  const trend = t12.length && p12.length ? Number((quantile(t12, 0.5) / quantile(p12, 0.5) - 1).toFixed(3)) : null;
  return { row: { k, v, med, lo, hi, n, n12: t12.length, lastSale: last, trend, conf } };
}

/** Build the book from the full corpus (main tier + archive, readCorpus order).
 *  Normalizes `all` IN PLACE first, exactly as the standalone read did — the
 *  caller must not need the rows unmodified afterwards. Reads market.json
 *  (grade ladder + vertical indexes) from the served dir. */
export function buildValueBook(all: AuctionLot[]): ValueBook {
  const REF_MS = Date.now();
  console.log(`[value-book] ${all.length.toLocaleString()} lots; normalizing…`);
  normalizeCorpus(all);

  // Pool settled sales by identity key.
  const pools = new Map<string, Pool>();
  const ctxPools = new Map<string, { v: ContextRow['v']; kind: ContextRow['kind']; prices: Sale[]; last: string }>();
  const skipped: Record<string, number> = {};
  const abstained: Record<string, number> = {};
  const bump = (o: Record<string, number>, r: string) => { o[r] = (o[r] || 0) + 1; };
  let sold = 0;
  for (const l of all) {
    if (l.status !== 'sold') continue;
    const price = (l.realizedUsd ?? l.priceUsd) as number | null | undefined;
    if (!price || price <= 0 || !l.saleDate) continue;
    const ms = Date.parse(l.saleDate);
    if (!Number.isFinite(ms)) continue;
    const adm = saleAdmission(l);
    if (adm) {
      // counted only for lots that would otherwise have keyed (the audit's
      // question is "what did the book stop pooling")
      const kv0 = keyForLot(l);
      if (kv0 && typeof kv0 === 'object') bump(skipped, adm);
      continue;
    }
    for (const c of contextKeysForLot(l)) {
      const ck = `${c.kind}:${c.key}`;
      let cp = ctxPools.get(ck);
      if (!cp) { cp = { v: c.v, kind: c.kind, prices: [], last: l.saleDate }; ctxPools.set(ck, cp); }
      cp.prices.push([price, ms]);
      if (l.saleDate > cp.last) cp.last = l.saleDate;
    }
    const kv = keyForLot(l);
    if (!kv) continue;
    if (typeof kv === 'string') { bump(skipped, kv); continue; }
    sold++;
    let p = pools.get(kv.key);
    if (!p) { p = { v: kv.v, sales: [] }; pools.set(kv.key, p); }
    p.sales.push({ p: [price, ms], date: l.saleDate, variant: kv.variant, watch: kv.watch });
  }
  console.log(`[value-book] ${sold.toLocaleString()} keyed sales → ${pools.size.toLocaleString()} keys; skipped ${JSON.stringify(skipped)}`);

  // Aggregate each key: purify (one variant) → recency-weighted median + band
  // + confidence tier + trend.
  const rows: ValueBookRow[] = [];
  let watchSplit = 0;
  for (const [k, pool] of Array.from(pools.entries())) {
    if (pool.sales.length < 3) continue; // never a row; not an abstain worth counting
    const pur = purifyPool(pool);
    if (pur.abstain) { bump(abstained, pur.abstain); continue; }
    if (!pur.sales.length) { bump(abstained, pool.v === 'watches' ? 'watch-all-special' : 'empty'); continue; }
    const last = pur.sales.reduce((m, s) => (s.date > m ? s.date : m), pur.sales[0].date);
    const agg = aggregatePool(k, pool.v, pur.sales.map(s => s.p), last, REF_MS);
    if ('abstain' in agg) {
      // a pool that only fell under the bar BECAUSE its variants were split
      // off is the honest outcome of the split — count it as such
      bump(abstained, pur.split && pur.sales.length < pool.sales.length && (agg.abstain === 'n<3' || agg.abstain === 'watch-n') ? `${agg.abstain}-after-split` : agg.abstain);
      continue;
    }
    if (pur.variant) agg.row.variant = pur.variant;
    if (pur.mat) agg.row.mat = pur.mat;
    if (pool.v === 'watches' && pur.split) watchSplit++;
    rows.push(agg.row);
  }

  rows.sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : b.med - a.med));
  console.log(`[value-book] abstained ${JSON.stringify(abstained)} · watch rows built from a split pool: ${watchSplit}`);

  // context tier: n≥3, staleness-gated, no dispersion bar (labeled rollups)
  const context: ContextRow[] = [];
  for (const [ck, p] of Array.from(ctxPools.entries())) {
    const n = p.prices.length;
    if (n < 3) continue;
    if (REF_MS - Date.parse(p.last) > 4 * YEAR_MS) continue;
    const vals = p.prices.map(x => x[0]).sort((a, b) => a - b);
    const ws = p.prices.map(([, ms]) => Math.pow(0.5, (REF_MS - ms) / YEAR_MS / 2));
    const med = Math.round(effectiveN(ws) < 2 ? quantile(vals, 0.5) : weightedMedian(p.prices.map(([usd], i) => [usd, ws[i]] as [number, number])));
    context.push({
      k: ck.slice(ck.indexOf(':') + 1), v: p.v, kind: p.kind,
      med,
      lo: Math.min(Math.round(lerpQuantile(vals, 0.15)), med),
      hi: Math.max(Math.round(lerpQuantile(vals, 0.85)), med),
      n, n12: p.prices.filter(([, ms]) => REF_MS - ms <= YEAR_MS).length, lastSale: p.last,
    });
  }
  context.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : b.n - a.n));
  const byKind: Record<string, number> = {};
  for (const c of context) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  console.log(`[value-book] context tier: ${context.length.toLocaleString()} rollups ${JSON.stringify(byKind)}`);

  // schema stays 1 — `context`, `engineVersion`, `bookVersion`, `audit` and
  // the row `variant`/`mat` fields are ADDITIVE (Starling ignores unknown
  // fields). Bumping would break the live board overnight for zero gain.
  // grade ladder + certified vertical indexes ride along from market.json —
  // Starling prices grade-adjacent cards (basis 'ladder') and shows trend.
  let gradeLadder: unknown = null;
  const indexes: Record<string, unknown> = {};
  try {
    const mj = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'ray', 'market.json'), 'utf8'));
    if (mj.gradeLadder) gradeLadder = mj.gradeLadder;
    for (const [v, r] of Object.entries((mj.repeatSale || {}) as Record<string, { nPairs?: number; horizons?: Record<string, { publishable?: boolean; changePct?: number | null }> }>)) {
      const hs = Object.entries(r.horizons || {}).filter(([, h]) => h.publishable && h.changePct != null);
      if (hs.length) indexes[v] = Object.fromEntries(hs.map(([k, h]) => [k, h.changePct]));
    }
  } catch { console.warn('[value-book] market.json not readable — no ladder/indexes this emit'); }
  const book: ValueBook = {
    schema: 1 as const,
    builtAt: new Date(REF_MS).toISOString(),
    engineVersion: ENGINE_VERSION,
    bookVersion: BOOK_VERSION,
    rows, context, gradeLadder, indexes,
    audit: { skipped, abstained, watchSplit },
  };

  // Per-vertical tally for the log.
  const byV: Record<string, number> = {};
  for (const r of rows) byV[r.v] = (byV[r.v] ?? 0) + 1;
  console.log(`[value-book] ${rows.length.toLocaleString()} rows: ${JSON.stringify(byV)}`);
  return book;
}

/** The local book file (gz) and the marker naming the corpus it was built from. */
export const VALUE_BOOK_FILE = () => process.env.RAY_VALUE_BOOK_FILE || path.join(os.tmpdir(), 'value-book.json.gz');
const markerFile = () => VALUE_BOOK_FILE() + '.built.json';

/** Identity of the corpus files on disk (size + mtime of both tiers) — a book
 *  built from these exact files may be pushed without rebuilding. */
export function corpusSignature(dir: string = CORPUS_DIR): string {
  return ['lots.json.gz', 'sold-archive.json.gz'].map(f => {
    try { const st = fs.statSync(path.join(dir, f)); return `${f}:${st.size}:${Math.round(st.mtimeMs)}`; }
    catch { return `${f}:absent`; }
  }).join('|');
}

/** Write the book gz locally (+ the marker when the corpus signature is known). */
export function writeValueBook(book: ValueBook, corpusSig?: string): string {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(book)));
  const tmp = VALUE_BOOK_FILE();
  fs.writeFileSync(tmp, gz);
  if (corpusSig) fs.writeFileSync(markerFile(), JSON.stringify({ builtAt: book.builtAt, corpus: corpusSig }));
  else if (fs.existsSync(markerFile())) fs.unlinkSync(markerFile());
  console.log(`[value-book] wrote ${(gz.length / 1024).toFixed(0)}KB gz → ${tmp}`);
  return tmp;
}

/** A book already built (by assemble --single-load) from the corpus on disk. */
function prebuiltBook(): { file: string; builtAt: string } | null {
  try {
    const m = JSON.parse(fs.readFileSync(markerFile(), 'utf8')) as { builtAt?: string; corpus?: string };
    if (!m.builtAt || m.corpus !== corpusSignature() || !fs.existsSync(VALUE_BOOK_FILE())) return null;
    return { file: VALUE_BOOK_FILE(), builtAt: m.builtAt };
  } catch { return null; }
}

function main() {
  let tmp: string, builtAt: string;
  const pre = process.env.RAY_VALUE_BOOK_REBUILD === '1' ? null : prebuiltBook();
  if (pre) {
    ({ file: tmp, builtAt } = pre);
    console.log(`[value-book] using the book assemble --single-load built from this corpus (${builtAt}) → ${tmp}`);
  } else {
    console.log('[value-book] reading corpus…');
    const lots = readGzRows(path.join(CORPUS_DIR, 'lots.json.gz')) as unknown as AuctionLot[];
    const archive = readGzRows(path.join(CORPUS_DIR, 'sold-archive.json.gz')) as unknown as AuctionLot[];
    const book = buildValueBook(lots.concat(archive));
    tmp = writeValueBook(book);
    builtAt = book.builtAt;
  }

  // Push to PRIVATE R2 the house way (data-store.sh pattern): the payload goes
  // to a WRITE-ONCE versioned key — a fresh key can never be stale-cached, its
  // first read is authoritative — and only a tiny pointer is overwritten.
  // (Measured: an overwritten 220KB `latest/` object served 79-minutes-stale
  // reads; a few-byte pointer flips fast. Never overwrite payloads.)
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || '5bcc5f43136c9ba6b6cb7f949813f473';
  if (!token) {
    console.warn('[value-book] no CLOUDFLARE_API_TOKEN — wrote local file only, skipping R2 push.');
    return;
  }
  const objUrl = (key: string) =>
    `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/lectr-data/objects/${encodeURIComponent(key)}`;
  const put = (key: string, file: string, type = 'application/octet-stream') =>
    execFileSync(
      'curl',
      ['-sf', '-X', 'PUT', '-H', `Authorization: Bearer ${token}`, '-H', `Content-Type: ${type}`, '--data-binary', `@${file}`, objUrl(key)],
      { stdio: 'inherit' },
    );

  const stamp = builtAt.replace(/[-:]/g, '').replace(/\..+/, '');
  const versionKey = `value-book/versions/${stamp}.json.gz`;
  put(versionKey, tmp);
  const ptr = path.join(os.tmpdir(), 'value-book-pointer.txt');
  fs.writeFileSync(ptr, versionKey);
  put('value-book/latest.txt', ptr, 'text/plain');
  // legacy key for one transition cycle (older Starling readers)
  put('latest/value-book.json.gz', tmp);
  console.log(`[value-book] pushed → lectr-data/${versionKey} (+ pointer value-book/latest.txt)`);
}

// importable (assemble --single-load builds the book in-process)
if (require.main === module) main();
