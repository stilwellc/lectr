/**
 * similarity.ts — the scored matcher. Part 2's foundation.
 *
 * similarity(a, b) ∈ [0, 100]. NOT a hash equality test — wording never matches
 * exactly across houses ("Kuminga game-worn jersey" vs "Jonathan Kuminga
 * Game-Used, Photo-Matched"), so identity is a SCORED %.
 *
 * The score is an IDF-weighted cosine over `titleTokens` (rare tokens like a
 * model number or a player name carry identity; "the"/"print" do not) blended
 * with agreement on the structured v2 attributes (model/reference, dimensions,
 * year, medium, edition, sports tags). Bands calibrated by inspecting real
 * same-maker pairs on the corpus:
 *   ≥ 0.90 raw cosine  →  same model / unit   (ESU 270-N ↔ ESU 270-N)
 *   0.75–0.90          →  same series/variant (Nakashima 34-FSW-8 ↔ -6)
 *   0.60–0.75          →  same family, diff form
 *   0.45–0.60          →  loosely related
 *
 * MATCH CLASS — which claim the score is making:
 *   physicalMatch : the same physical object (unique work with strong title +
 *                   dims + year agreement; or matching edition/serial; or a
 *                   game-used lot with matching entity + event + year). Title
 *                   justifies it — never an image (different houses shoot their
 *                   own photos). This is what "this exact item sold before" reads.
 *   modelMatch    : the same model / edition UNIT (a production Eames chair, an
 *                   editioned print, a watch reference). Many physical copies;
 *                   the right comp unit for fungibles, but not "the same object".
 *   similar       : comp-worthy but distinct.
 *
 * The IDF table is corpus-derived and injected (built once in build-market.ts),
 * so scoring stays pure and deterministic given the same table.
 */
import type { AuctionLot } from '../types';

// ── IDF ────────────────────────────────────────────────────────────────────
export type IdfTable = { N: number; df: Record<string, number> };

/** Build the document-frequency table over a corpus's titleTokens. */
export function buildIdf(lots: Pick<AuctionLot, 'titleTokens'>[]): IdfTable {
  const df: Record<string, number> = {};
  let N = 0;
  for (const l of lots) {
    if (!l.titleTokens || !l.titleTokens.length) continue;
    N++;
    for (const t of Array.from(new Set(l.titleTokens))) df[t] = (df[t] || 0) + 1;
  }
  return { N, df };
}

export function idf(t: string, tbl: IdfTable): number {
  return Math.log((tbl.N + 1) / ((tbl.df[t] || 0) + 1));
}

/** An IDF-weighted sparse vector of a lot's title tokens (memoizable). */
export function tokenVector(tokens: string[] | undefined, tbl: IdfTable): Record<string, number> {
  const v: Record<string, number> = {};
  if (!tokens) return v;
  for (const t of tokens) v[t] = idf(t, tbl);
  return v;
}

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const t in a) { na += a[t] * a[t]; if (b[t]) dot += a[t] * b[t]; }
  for (const t in b) nb += b[t] * b[t];
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ── structured agreement ─────────────────────────────────────────────────────
const SPORTS_SCIENCE = new Set([
  'game-used', 'trophies-awards', 'tickets-passes',
  'space-exploration', 'meteorites', 'fossils', 'scientific-instruments',
]);

/** Same broad object class — a hard gate (a painting never comps a print). */
export function sameForm(a: AuctionLot, b: AuctionLot): boolean {
  if (a.category !== b.category) return false;
  if (a.formKey && b.formKey && a.formKey !== b.formKey) return false;
  return true;
}

/** Size ratio on the max linear dimension (1 = identical, ∞ = unknown/absent). */
export function sizeRatio(a: AuctionLot, b: AuctionLot): number | null {
  const am = Math.max(a.heightCm || 0, a.widthCm || 0);
  const bm = Math.max(b.heightCm || 0, b.widthCm || 0);
  if (!am || !bm) return null;
  return am >= bm ? am / bm : bm / am;
}

export type MatchClass = 'physicalMatch' | 'modelMatch' | 'similar' | 'none';

export interface Match {
  score: number;            // 0–100
  cosine: number;           // raw IDF-cosine, 0–1
  cls: MatchClass;
  reasons: string[];        // human-readable agreement notes (for the modal)
}

/**
 * Score b as a comparable/identity for a. Returns 0 (cls 'none') when the
 * structured gates rule it out. `a` and `b` should carry precomputed token
 * vectors on `_v` for speed (buildVectors), else they're built ad hoc.
 */
export function similarity(a: AuctionLot & { _v?: Record<string, number> }, b: AuctionLot & { _v?: Record<string, number> }, tbl: IdfTable): Match {
  if (a.id === b.id) return { score: 0, cosine: 0, cls: 'none', reasons: [] };

  // hard gate: same broad form/category
  if (!sameForm(a, b)) return { score: 0, cosine: 0, cls: 'none', reasons: [] };
  // hard gate: dimensions grossly different when both known
  const sr = sizeRatio(a, b);
  if (sr !== null && sr > 1.6) return { score: 0, cosine: 0, cls: 'none', reasons: [] };

  const va = a._v || tokenVector(a.titleTokens, tbl);
  const vb = b._v || tokenVector(b.titleTokens, tbl);
  const cos = cosine(va, vb);
  if (cos < 0.4) return { score: 0, cosine: cos, cls: 'none', reasons: [] };

  const reasons: string[] = [];
  let bonus = 0;             // structured agreement, added to the cosine base

  // model / reference exact agreement — the strongest structured signal
  if (a.modelKey && b.modelKey && a.modelKey === b.modelKey) { bonus += 0.06; reasons.push(`same model ${a.modelKey}`); }
  if (a.reference && b.reference && a.reference === b.reference) { bonus += 0.08; reasons.push(`same reference ${a.reference}`); }

  // dimension proximity (both known): tighter than 1.15× is a real signal
  if (sr !== null) {
    if (sr <= 1.08) { bonus += 0.04; reasons.push('dimensions match'); }
    else if (sr <= 1.25) { bonus += 0.02; }
  }

  // year proximity, discounted when the year came from the title not a field
  if (a.yearNum && b.yearNum) {
    const dy = Math.abs(a.yearNum - b.yearNum);
    const trusted = a.yearSource === 'field' && b.yearSource === 'field';
    if (dy === 0) { bonus += trusted ? 0.04 : 0.02; reasons.push(`same year ${a.yearNum}`); }
    else if (dy <= 2 && trusted) { bonus += 0.01; }
    else if (dy >= 8) { bonus -= 0.03; }   // very different years → likely different work
  }

  // medium agreement
  if (a.mediumCanon && b.mediumCanon && a.mediumCanon === b.mediumCanon) { bonus += 0.02; }

  // sports/science entity agreement — the identity of a game-used object
  if (a.entity && b.entity && a.entity === b.entity) { bonus += 0.05; reasons.push(`same ${a.entity}`); }
  if (a.eventKey && b.eventKey && a.eventKey === b.eventKey) { bonus += 0.04; reasons.push('same event'); }
  if (a.objectType && b.objectType && a.objectType === b.objectType) { bonus += 0.02; }

  const raw = Math.max(0, Math.min(1, cos + bonus));
  const score = Math.round(raw * 100);

  return { score, cosine: cos, cls: classify(a, b, cos, bonus, reasons), reasons };
}

/** Decide which identity claim the score justifies. */
function classify(a: AuctionLot, b: AuctionLot, cos: number, bonus: number, reasons: string[]): MatchClass {
  const strong = cos + bonus;
  if (strong < 0.75) return 'similar';       // comp-worthy at best; caller may still drop it

  // Watches/instruments are category 'object' too, but they carry entityClass
  // 'maker' and a real serial — they must take the serial branch below, NOT the
  // sports photo-match branch (else two listings of the same physical watch can
  // never be a physicalMatch). Only NON-maker objects are the sports/science kind.
  const isSportsSci = (SPORTS_SCIENCE.has(a.artist) || a.category === 'object') && a.entityClass !== 'maker';

  // PHYSICAL MATCH — the same physical object. Deliberately STRICT: on this data
  // the same-model and the same-object read identically in text (22 Eames 670/671
  // chairs, 10 different Messi WC-Final tickets), so a physicalMatch is asserted
  // ONLY with a hard, unique discriminator. Everything else is modelMatch (a comp
  // cohort), never a "this exact item sold before" claim.
  if (isSportsSci) {
    // a game-used object is genuinely trackable to one piece only when it is
    // PHOTO-MATCHED on both sides (Goldin ties the specific object to game
    // footage) AND the entity + event/year agree. Signed/inscribed alone is not
    // enough — many signed tickets of the same game exist.
    // photo-matched ties the object to specific game footage; entity + the
    // specific game YEAR pin it (separating 1992 from 1996 Olympic items). The
    // price-sanity guard in the grouper then rejects same-year-different-object
    // (a jersey vs shorts). eventKey agreement, when present, only strengthens.
    const entityAgree = a.photoMatched && b.photoMatched && a.entity && a.entity === b.entity;
    const yearConflict = a.sportYear && b.sportYear && a.sportYear !== b.sportYear;
    const eventConflict = a.eventKey && b.eventKey && a.eventKey !== b.eventKey;
    const temporalPin = (a.sportYear && a.sportYear === b.sportYear) || (a.eventKey && a.eventKey === b.eventKey);
    if (entityAgree && temporalPin && !yearConflict && !eventConflict && strong >= 0.9) return 'physicalMatch';
  } else if (a.entityClass === 'maker') {
    // a matching serial number is the physical piece — but only a REAL serial
    // (≥4 chars with a digit), not a stray word the extractor caught ("with").
    const realSerial = (s?: string | null) => !!s && s.length >= 4 && /\d/.test(s) && /^[a-z0-9./-]+$/i.test(s);
    if (realSerial(a.serialNo) && a.serialNo === b.serialNo) return 'physicalMatch';
    // a matching print edition — ONLY when a real edition MARKER is present
    // (an "ed. of N" / numbered context), never a bare fraction (which is almost
    // always a fractional-inch dimension "5 3/4in" or a title word "1/2 Way").
    const realEdition = a.editionMarker != null && a.editionOf && a.editionTotal
      && a.editionOf <= a.editionTotal && a.editionTotal <= 500
      && (a.category === 'print' || a.category === 'original');
    if (realEdition && a.editionMarker === b.editionMarker
      && a.editionOf === b.editionOf && a.editionTotal === b.editionTotal) return 'physicalMatch';
  }

  // MODEL MATCH — the same model/edition unit (fungible): the right COMP class
  // (feeds indices + "the same model sold $X–$Y"), but many physical copies
  // exist — NOT a repeat sale.
  if (strong >= 0.9) return 'modelMatch';
  if ((a.modelKey && a.modelKey === b.modelKey) || (a.reference && a.reference === b.reference)) return 'modelMatch';

  return 'similar';
}

// ── candidate generation (blocking) ──────────────────────────────────────────
/**
 * An inverted index over the rarest tokens of each lot, for candidate
 * generation. Scoring 36k lots against 36k is 1.3B pairs; blocking on shared
 * rare tokens (+ same maker slug) cuts it to a few hundred candidates per lot.
 */
export class CandidateIndex {
  private byToken = new Map<string, number[]>();   // token → lot indices
  private byMaker = new Map<string, number[]>();
  private rareTokens: string[][] = [];             // per-lot top-IDF tokens, computed ONCE
  constructor(private lots: AuctionLot[], private tbl: IdfTable, private topRare = 6) {
    lots.forEach((l, i) => {
      (this.byMaker.get(l.artist) || this.byMaker.set(l.artist, []).get(l.artist)!).push(i);
      if (!l.titleTokens) { this.rareTokens[i] = []; return; }
      // the `topRare` highest-IDF tokens of this lot — cached so candidates()
      // doesn't re-derive (O(T log T) per call) the same list on the hot path
      const rare = Array.from(new Set(l.titleTokens))
        .map(t => [t, idf(t, tbl)] as [string, number])
        .sort((x, y) => y[1] - x[1])
        .slice(0, topRare)
        .map(x => x[0]);
      this.rareTokens[i] = rare;
      for (const t of rare) (this.byToken.get(t) || this.byToken.set(t, []).get(t)!).push(i);
    });
  }
  /** Candidate lot indices for lot `i`: same maker ∪ shares a rare token. */
  candidates(i: number): number[] {
    const l = this.lots[i];
    const set = new Set<number>(this.byMaker.get(l.artist) || []);
    // reuse the SAME rare-token set the constructor indexed with (topRare), so
    // retrieval recall matches indexing — the old hardcoded slice(0,6) silently
    // diverged from a non-default topRare.
    for (const t of this.rareTokens[i] || []) for (const j of this.byToken.get(t) || []) set.add(j);
    set.delete(i);
    return Array.from(set);
  }
}

/** Attach precomputed token vectors for a batch scoring pass. */
export function buildVectors<T extends AuctionLot>(lots: T[], tbl: IdfTable): (T & { _v: Record<string, number> })[] {
  return lots.map(l => Object.assign(l, { _v: tokenVector(l.titleTokens, tbl) }));
}
