// Repeat-sale grouping: complete-linkage over physical-match pairs among SOLD lots.
// Extracted from build-market.ts (Sep 10 2026) — see the profile note below.
//
// BLOCKING (measured Jul 2026): the old maker∪rare-token CandidateIndex made
// this loop 96% of the whole build (~19 min at 110k sold — the same-maker
// union alone is ~400M similarity calls once Picasso/Patek/Rolex pass 10k
// each). Physical matches must share evidence, so we block on exactly that:
// shared rare title token ∪ same maker+reference ∪ same maker+serialNo.
// Recall was validated against the full-blocking ground truth (244 pairs):
// rare tokens alone find 241; the ref/serial blocks recover the other 3
// (watch pairs whose titles are written in different catalog styles).
//
// ELIGIBILITY HOIST (Sep 10 2026, profiled on the Aug 25 nightly: 1,660s to
// find 230 pairs — 28 min, 40% of the whole assemble). The grouper unions ONLY
// on cls === 'physicalMatch', and canPhysicalMatch() below can return true
// only when BOTH lots carry a hard structured discriminator: a real serial, a
// real edition (marker + of + total), or photoMatched + entity. A lot without
// one can never be on either side of a union — yet the old loop indexed every
// one of ~1.1M sold lots into the token/ref/serial maps and built a candidate
// Set + array per lot. Restricting BOTH the index and the outer loop to
// eligible lots skips no pair that could ever union, so the groups are
// identical (scripts/oneoff/qa/repeat-sale-equiv.ts diffs old-vs-new on a local
// corpus and asserts exactly that), and the eligible set is a small fraction
// of the book — the 230 pairs speak to that.
//
// IDENTITY FIX (Oct 2026): pairs are judged by repeatSalePair() — hard
// structured vetoes first (same sale, catalogue numbers, serial/edition
// validity, price drift), then the title score — and groups are
// COMPLETE-LINKAGE (every pair inside a group passes), never chained.
import * as crypto from 'crypto';
import type { AuctionLot } from '../../app/types';
import { similarity, idf, sizeRatio, tokenVector, type IdfTable } from '../../app/lib/similarity';
import { sameShape, isCompExcluded } from '../../app/lib/comps';

const RARE_K = 6;
const SPORTS_SCIENCE_SLUGS = new Set([
  'game-used', 'trophies-awards', 'tickets-passes',
  'space-exploration', 'meteorites', 'fossils', 'scientific-instruments',
]);
const realSerial = (s?: string | null) => !!s && s.length >= 4 && /\d/.test(s) && /^[a-z0-9./-]+$/i.test(s);

// CHEAP PRE-CHECK — a pair can classify as 'physicalMatch' ONLY through one of
// similarity.ts::classify's physical branches, each gated on a hard STRUCTURED
// discriminator. Predicates are copied VERBATIM from classify() so the skip set
// is exactly the non-physical complement.
export function canPhysicalMatch(a: AuctionLot, b: AuctionLot): boolean {
  const isSportsSci = (SPORTS_SCIENCE_SLUGS.has(a.artist) || a.category === 'object') && a.entityClass !== 'maker';
  if (isSportsSci) {
    return !!(a.photoMatched && b.photoMatched && a.entity && a.entity === b.entity);
  }
  if (a.entityClass === 'maker') {
    if (realSerial(a.serialNo) && a.serialNo === b.serialNo) return true;
    const realEdition = a.editionMarker != null && a.editionOf && a.editionTotal
      && a.editionOf <= a.editionTotal && a.editionTotal <= 500
      && (a.category === 'print' || a.category === 'original');
    return !!(realEdition && a.editionMarker === b.editionMarker
      && a.editionOf === b.editionOf && a.editionTotal === b.editionTotal);
  }
  return false;
}

/**
 * Can this lot be on EITHER side of a physicalMatch pair? A SUPERSET of what
 * canPhysicalMatch demands of `a` and of `b` (b's side only needs the matching
 * field present — equality with a real serial / a real edition implies it), so
 * filtering the pool by this predicate cannot drop a pair that would union.
 */
export function repeatSaleEligible(l: AuctionLot): boolean {
  if (l.photoMatched && l.entity) return true;
  if (realSerial(l.serialNo)) return true;
  if (l.editionMarker != null && l.editionOf && l.editionTotal) return true;
  return false;
}

// ── PAIR VERDICT (Oct 2026 identity fix wave) ───────────────────────────────
// Audit of the served groups (195 judged: 146 TP / 39 FP / 10 unverifiable)
// found every FP in one of these shapes, each now a hard veto applied BEFORE
// the similarity class is consulted:
//   · SAME SALE — two lots of one sale are two objects (Warhol "$(1)" ×3 at
//     Christie's 2018-04-20, Picasso "Visage" ×3 on 2011-06-21): 27 of 39.
//   · CATALOGUE NUMBERS DISAGREE — F.&S. 85 vs 88, A.R. 130 vs 131, B. 1099
//     vs 1100 are different sheets of one series.
//   · NOT A SERIAL — "40mm"/"22mm" case diameters, 4-digit Cartier model
//     numbers ("CASE NO. 2323 DM10978" → 2323), a serial equal to the ref.
//   · NOT AN EDITION — 'unique' + a power-of-two fraction is an inch size
//     ("7/8"), not edition 7 of 8.
//   · CHAINING — union-find let A~B and B~C group A with C.
// Recall side (sampled same-serial pairs left ungrouped): a STRONG serial
// match no longer needs the title cosine to clear the physical bar — Christie's
// re-catalogues the same watch in a new house style years later ("Cartier. A
// Lady's 18ct Gold…" → "CARTIER. A LADY'S 18K GOLD…"), which read 'similar' or
// 'none' on wording alone. The structured gates (maker, category, form, shape,
// size, reference) still apply. Price tolerance widens with time (|ln ratio|
// ≤ ln 3 + 0.25/yr) instead of a flat 3×.
//
// similarity.ts::classify is deliberately NOT changed: its physicalMatch also
// drives value.ts's "this exact item" read, which belongs to the engine.

/** A serial that identifies ONE physical object: ≥4 chars with a digit, not
 *  a case diameter ("40mm"), not a dotted reference ("166.077"), not equal
 *  to the lot's reference, and a digits-only serial needs ≥5 digits (a bare
 *  4-digit number is a model/reference code on these catalogues). Returns the
 *  canonical form (lowercase alphanumerics) or null. */
export function strongSerial(l: Pick<AuctionLot, 'serialNo'> & { reference?: string | null }): string | null {
  const s = l.serialNo;
  if (!realSerial(s)) return null;
  // the normalize reader kind-qualifies serials ("sn-2685891" case/serial,
  // "mvt-1165730" movement): the checks read the number, the kind stays in
  // the canonical form so a case number never matches a movement number
  const kind = /^(sn|mvt)-/i.exec(String(s));
  const n = String(s).toLowerCase().slice(kind ? kind[0].length : 0);
  if (/^\d+(?:\.\d+)?\s*mm$/.test(n)) return null;
  if (/^\d{2,4}\.\d{2,4}$/.test(n)) return null;
  const c = n.replace(/[^a-z0-9]/g, '');
  if (l.reference && c === String(l.reference).toLowerCase().replace(/[^a-z0-9]/g, '')) return null;
  if (/^\d+$/.test(c) && c.length < 5) return null;
  // ≥4 digits: "NO.7" / "NO.4" are lot-label leftovers, not case numbers
  if ((c.match(/\d/g) || []).length < 4) return null;
  return kind ? `${kind[1].toLowerCase()}:${c}` : c;
}

/** Catalogue-raisonné numbers in a title, as scheme → numbers. "F. & S.
 *  IIB.378" and "F. & S. 378" both read fs:378 (the volume prefix is
 *  dropped); "B. 1099; Ba. 1315" reads b:1099 + ba:1315. */
const CAT_RE = /(?:^|[^a-z])(f\.?\s*(?:&|and)\s*s\.?|feldman\s*(?:&|and)\s*schellmann|a\.\s?r\.|ba\.|bloch|b\.|cramer|mourlot|kornfeld|littlefield|duthuit|geiser)\s*(?:no\.?\s*)?(?:[ivx]+[a-c]?\s*\.?\s*)?(\d{1,4}[a-z]?(?:-\d{1,3})?)/gi;
export function catalogueNumbers(text: string | null | undefined): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!text) return out;
  const re = new RegExp(CAT_RE.source, CAT_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1].toLowerCase().replace(/[^a-z&]/g, '');
    const scheme = raw.startsWith('f') ? 'fs' : raw;
    (out.get(scheme) || out.set(scheme, new Set()).get(scheme)!).add(m[2].toLowerCase());
  }
  return out;
}
/** Two lots' catalogue numbers CONFLICT when a scheme both cite shares no number. */
export function catalogueConflict(a: Pick<AuctionLot, 'title'>, b: Pick<AuctionLot, 'title'>): boolean {
  const ca = catalogueNumbers(a.title), cb = catalogueNumbers(b.title);
  for (const [k, sa] of Array.from(ca.entries())) {
    const sb = cb.get(k);
    if (sb && !Array.from(sa).some(x => sb.has(x))) return true;
  }
  return false;
}

/** An edition triple that is really an inch fraction: 'unique' + N/2^k. */
const fractionalEdition = (l: AuctionLot) => l.editionMarker === 'unique' && !!l.editionTotal && [2, 4, 8, 16].includes(l.editionTotal);

const dayOf = (l: Pick<AuctionLot, 'saleDate'>) => String(l.saleDate || '').slice(0, 10);
/** Two lots of ONE sale (same day, or same house + sale name within a week —
 *  a multi-day sale; houses reuse sale names like "Important Watches" every
 *  season, so the name alone is no sale identity) are never the same object
 *  sold twice. */
export function sameSale(a: Pick<AuctionLot, 'saleDate' | 'saleName' | 'auctionHouse'>, b: Pick<AuctionLot, 'saleDate' | 'saleName' | 'auctionHouse'>): boolean {
  if (dayOf(a) && dayOf(a) === dayOf(b)) return true;
  if (!a.saleName || a.auctionHouse !== b.auctionHouse || a.saleName !== b.saleName) return false;
  return Math.abs(Date.parse(dayOf(a)) - Date.parse(dayOf(b))) <= 7 * 864e5;
}

/** The same object's price may drift with time: |ln ratio| ≤ ln 3 + 0.25/yr. */
export function priceCompatible(a: Pick<AuctionLot, 'saleDate' | 'realizedUsd'>, b: Pick<AuctionLot, 'saleDate' | 'realizedUsd'>): boolean {
  const pa = a.realizedUsd || 0, pb = b.realizedUsd || 0;
  if (!(pa > 0 && pb > 0)) return false;
  const years = Math.abs(Date.parse(dayOf(a)) - Date.parse(dayOf(b))) / (365.25 * 864e5);
  return Math.abs(Math.log(pa / pb)) <= Math.log(3) + 0.25 * (Number.isFinite(years) ? years : 0);
}

const canon = (r?: string | null) => (r ? String(r).toLowerCase().replace(/[^a-z0-9]/g, '') : '');
/** References agree when either is absent, or some '/'-separated part of one
 *  equals or prefixes a part of the other ("3338" ~ "3338/1", "69298/69000a" ~ "69298"). */
export function refsCompatible(a: AuctionLot, b: AuctionLot): boolean {
  const parts = (l: AuctionLot) => String((l as { reference?: string | null }).reference || '')
    // "/1" bracelet suffixes and model NAMES ("oysterperpetual") are no ref
    .split('/').map(canon).filter(p => p.length >= 3 && /\d/.test(p));
  const pa = parts(a), pb = parts(b);
  if (!pa.length || !pb.length) return true;
  return pa.some(x => pb.some(y => x === y || x.startsWith(y) || y.startsWith(x)));
}

/** Is the pair the same physical object sold twice? Symmetric; every hard
 *  structured check runs before (and independent of) the title score. */
export function repeatSalePair(a: AuctionLot, b: AuctionLot, tbl: IdfTable): boolean {
  if (a.id === b.id || sameSale(a, b)) return false;
  if (!canPhysicalMatch(a, b) || !canPhysicalMatch(b, a)) return false;
  if (isCompExcluded(a) || isCompExcluded(b) || !sameShape(a, b)) return false;
  if (catalogueConflict(a, b) || !priceCompatible(a, b)) return false;
  const sa = strongSerial(a);
  const sameSerialText = !!a.serialNo && canon(a.serialNo) === canon(b.serialNo);
  const numberedAgree = !!a.editionOf && !!a.editionTotal && a.editionOf === b.editionOf && a.editionTotal === b.editionTotal;
  // a 4-digit numeric serial is a model code UNLESS the limited-edition
  // number agrees too ("CASE NO. 1726 … NO. 68/97" on both)
  const serialAgree = (!!sa && sa === strongSerial(b))
    || (sameSerialText && /^\d{4}$/.test(canon(String(a.serialNo).replace(/^(sn|mvt)-/i, ''))) && numberedAgree);
  const editionAgree = a.editionMarker != null && numberedAgree
    && a.editionMarker === b.editionMarker && !fractionalEdition(a);
  const photoAgree = !!(a.photoMatched && b.photoMatched && a.entity && a.entity === b.entity);
  if (!serialAgree && !editionAgree && !photoAgree) return false;
  // references must not conflict (Rolex case 42449 on a ref 3372 and on a ref
  // 3159 = two watches; Z699333 on a GMT 16710 and a Daytona 116520 = two)
  if (!refsCompatible(a, b)) return false;
  if (serialAgree && a.entityClass === 'maker' && b.entityClass === 'maker') {
    // STRUCTURAL serial match: same maker, same object class, compatible size —
    // title wording is not consulted (house style changes across years)
    if (a.artist !== b.artist || a.category !== b.category) return false;
    const fa = a.formKey === 'unknown' ? null : a.formKey, fb = b.formKey === 'unknown' ? null : b.formKey;
    if (fa && fb && fa !== fb) return false;
    const sr = sizeRatio(a, b);
    return !(sr !== null && sr > 1.6);
  }
  return similarity(a, b, tbl).cls === 'physicalMatch';
}

/** A copy of the lot carrying its token vector for this IDF table, WITHOUT
 *  mutating the corpus row (the Sotheby's Algolia rows join the repeat-sale
 *  pool only; their persisted fields must not change). */
export function withVectors<T extends AuctionLot>(l: T, tbl: IdfTable): T & { _v: Record<string, number>; _vn: number } {
  const v = tokenVector(l.titleTokens, tbl);
  let n = 0; for (const t in v) n += v[t] * v[t];
  return Object.assign({}, l, { _v: v, _vn: Math.sqrt(n) });
}

/** Stable, full-hash group id: sha1 of the group's EARLIEST sale's lot id (a
 *  growing group keeps its id; no truncation collisions — the old
 *  'rs_' + root.slice(-10) could fold two roots sharing a 10-char tail). */
export function repeatSaleGroupId(members: Pick<AuctionLot, 'id' | 'saleDate'>[]): string {
  const first = members.slice().sort((x, y) => {
    const dx = dayOf(x), dy = dayOf(y);
    if (dx !== dy) return dx < dy ? -1 : 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  })[0];
  return 'rs_' + crypto.createHash('sha1').update(first.id).digest('hex');
}

export type RepeatSaleStats = {
  physPairs: number; physGroups: number; seconds: string;
  eligible: number; candidatePairs: number; scored: number;
  /** groupId per lot id — for the offline equivalence check */
  groupOf: Map<string, string>;
};

export function groupRepeatSales(
  soldSorted: AuctionLot[],
  engineAll: AuctionLot[],
  tbl: IdfTable,
  opts: { eligibleOnly?: boolean } = {},
): RepeatSaleStats {
  const tRs = Date.now();
  const eligibleOnly = opts.eligibleOnly !== false;
  // the index universe: every sold lot (legacy) or only lots that can ever union
  const universe: number[] = [];
  for (let i = 0; i < soldSorted.length; i++) if (!eligibleOnly || repeatSaleEligible(soldSorted[i])) universe.push(i);

  const byToken = new Map<string, number[]>();
  const byMakerRef = new Map<string, number[]>();
  const bySerial = new Map<string, number[]>();
  const rareTokens = new Map<number, string[]>();
  for (const i of universe) {
    const l = soldSorted[i];
    const rare = Array.from(new Set(l.titleTokens || []))
      .map(t => [t, idf(t, tbl)] as [string, number])
      .sort((x, y) => y[1] - x[1]).slice(0, RARE_K).map(x => x[0]);
    rareTokens.set(i, rare);
    for (const t of rare) (byToken.get(t) || byToken.set(t, []).get(t)!).push(i);
    const ref = (l as AuctionLot & { reference?: string | null }).reference;
    if (ref) { const k = `${l.artist}|${ref}`; (byMakerRef.get(k) || byMakerRef.set(k, []).get(k)!).push(i); }
    const ser = (l as AuctionLot & { serialNo?: string | null }).serialNo;
    if (ser) { const k = `${l.artist}|${ser}`; (bySerial.get(k) || bySerial.set(k, []).get(k)!).push(i); }
  }
  const candidatesOf = (i: number): Set<number> => {
    const l = soldSorted[i];
    const set = new Set<number>();
    for (const t of rareTokens.get(i) || []) for (const j of byToken.get(t) || []) set.add(j);
    const ref = (l as AuctionLot & { reference?: string | null }).reference;
    if (ref) for (const j of byMakerRef.get(`${l.artist}|${ref}`) || []) set.add(j);
    const ser = (l as AuctionLot & { serialNo?: string | null }).serialNo;
    if (ser) for (const j of bySerial.get(`${l.artist}|${ser}`) || []) set.add(j);
    set.delete(i);
    return set;
  };

  // 1 · every accepted pair (symmetric verdict, memoized for the linkage pass)
  const verdict = new Map<string, boolean>();
  const pairKey = (x: AuctionLot, y: AuctionLot) => x.id < y.id ? `${x.id}\u0000${y.id}` : `${y.id}\u0000${x.id}`;
  const judge = (x: AuctionLot, y: AuctionLot): boolean => {
    const k = pairKey(x, y);
    let v = verdict.get(k);
    if (v === undefined) { v = repeatSalePair(x, y, tbl); verdict.set(k, v); }
    return v;
  };
  const accepted: [number, number][] = [];
  let candidatePairs = 0, scored = 0;
  for (const i of universe) {
    const lot = soldSorted[i];
    for (const j of Array.from(candidatesOf(i))) {
      const c = soldSorted[j];
      if (c.id <= lot.id) continue;   // dedup pair direction
      candidatePairs++;
      // fast structured pre-check (both directions — canPhysicalMatch reads a's side)
      if (!canPhysicalMatch(lot, c) || !canPhysicalMatch(c, lot)) continue;
      scored++;
      if (judge(lot, c)) accepted.push([i, j]);
    }
  }

  // 2 · COMPLETE LINKAGE: two clusters merge only if EVERY cross pair is
  // itself a repeat-sale pair (A~B and B~C never put A with C on their own).
  // Pairs are taken closest-in-time first, ties by id — deterministic.
  const ts = (l: AuctionLot) => Date.parse(dayOf(l)) || 0;
  const gap = (p: [number, number]) => Math.abs(ts(soldSorted[p[0]]) - ts(soldSorted[p[1]]));
  accepted.sort((p, q) => {
    const d = gap(p) - gap(q);
    if (d) return d;
    const kp = pairKey(soldSorted[p[0]], soldSorted[p[1]]), kq = pairKey(soldSorted[q[0]], soldSorted[q[1]]);
    return kp < kq ? -1 : kp > kq ? 1 : 0;
  });
  const clusterOf = new Map<number, number[]>();
  for (const [i, j] of accepted) {
    const ci = clusterOf.get(i) || [i], cj = clusterOf.get(j) || [j];
    if (ci === cj) continue;
    const ok = ci.every(x => cj.every(y => judge(soldSorted[x], soldSorted[y])));
    if (!ok) continue;
    const merged = ci.concat(cj);
    for (const x of merged) clusterOf.set(x, merged);
  }

  const idToLot = new Map(engineAll.map(l => [l.id, l]));
  const groupOf = new Map<string, string>();
  const seen = new Set<number[]>();
  let physGroups = 0;
  for (const members of Array.from(clusterOf.values())) {
    if (seen.has(members)) continue;
    seen.add(members);
    physGroups++;
    const lots = members.map(x => soldSorted[x]);
    const gid = repeatSaleGroupId(lots);
    for (const l of lots) {
      groupOf.set(l.id, gid);
      const t = idToLot.get(l.id) as (AuctionLot & { repeatSaleGroupId?: string }) | undefined;
      if (t) t.repeatSaleGroupId = gid;
    }
  }
  return { physPairs: accepted.length, physGroups, seconds: ((Date.now() - tRs) / 1000).toFixed(0), eligible: universe.length, candidatePairs, scored, groupOf };
}
