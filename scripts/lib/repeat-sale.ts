// Repeat-sale grouping: union-find over physicalMatch pairs among SOLD lots.
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
// identical (scripts/_qa/repeat-sale-equiv.ts diffs old-vs-new on a local
// corpus and asserts exactly that), and the eligible set is a small fraction
// of the book — the 230 pairs speak to that.
import type { AuctionLot } from '../../app/types';
import { similarity, idf, type IdfTable } from '../../app/lib/similarity';

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

  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  let physPairs = 0, candidatePairs = 0, scored = 0;
  for (const i of universe) {
    const lot = soldSorted[i];
    if (!parent.has(lot.id)) parent.set(lot.id, lot.id);
    for (const j of Array.from(candidatesOf(i))) {
      const c = soldSorted[j];
      if (c.id <= lot.id) continue;   // dedup pair direction
      candidatePairs++;
      // fast structured pre-check: skip the full score for any pair that can't
      // reach 'physicalMatch' (the only class the grouper unions on)
      if (!canPhysicalMatch(lot, c)) continue;
      scored++;
      const m = similarity(lot, c, tbl);
      if (m.cls === 'physicalMatch') {
        // price-sanity: the same physical object shouldn't swing >3x between two
        // sales close in the corpus — a wild gap means different objects that
        // share the identifier (e.g. a player's jersey vs shorts from one game).
        const r = (lot.realizedUsd || 0) / (c.realizedUsd || 1);
        if (r > 3 || r < 1 / 3) continue;
        if (!parent.has(c.id)) parent.set(c.id, c.id);
        union(lot.id, c.id); physPairs++;
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const l of soldSorted) { const r = find(l.id); (groups.get(r) || groups.set(r, []).get(r)!).push(l.id); }
  let physGroups = 0;
  const idToLot = new Map(engineAll.map(l => [l.id, l]));
  const groupOf = new Map<string, string>();
  for (const [root, ids] of Array.from(groups.entries())) {
    if (ids.length < 2) continue;
    physGroups++;
    const gid = 'rs_' + root.slice(-10);
    for (const id of ids) {
      groupOf.set(id, gid);
      const t = idToLot.get(id) as (AuctionLot & { repeatSaleGroupId?: string }) | undefined;
      if (t) t.repeatSaleGroupId = gid;
    }
  }
  return { physPairs, physGroups, seconds: ((Date.now() - tRs) / 1000).toFixed(0), eligible: universe.length, candidatePairs, scored, groupOf };
}
