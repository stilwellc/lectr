// Offline equivalence check for the repeat-sale eligibility hoist.
//
//   RAY_SKIP_MAIN=1 NODE_OPTIONS=--max-old-space-size=10240 \
//     npx tsx scripts/_qa/repeat-sale-equiv.ts
//
// Builds the engine pool exactly the way build-market does (same filters, same
// idf table, same vectors) from the LOCAL segments, then runs the grouper twice
// — legacy (every sold lot indexed) and hoisted (eligible lots only) — and
// asserts the two group assignments are IDENTICAL. Prints both timings.
import { readAllSegments } from '../corpus-io';
import { normalizeCorpus } from '../lib/corpus-normalize';
import { buildIdf, buildVectors } from '../../app/lib/similarity';
import { groupRepeatSales } from '../lib/repeat-sale';
import type { AuctionLot } from '../../app/types';

const all = readAllSegments() as unknown as AuctionLot[];
normalizeCorpus(all);
const engineAll = all.filter(l =>
  l.artist !== 'sports-cards' && l.artist !== 'pokemon' && l.artist !== 'graded-cards' &&
  (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
const sold = engineAll.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate && l.titleTokens && l.titleTokens.length);
const tbl = buildIdf(sold);
buildVectors(engineAll, tbl);
const soldSorted = sold.slice().sort((a, b) => a.saleDate! < b.saleDate! ? -1 : 1);
console.log(`[equiv] ${all.length} lots · engine ${engineAll.length} · sold ${soldSorted.length}`);

const clear = () => { for (const l of engineAll) delete (l as AuctionLot & { repeatSaleGroupId?: string }).repeatSaleGroupId; };

clear();
const hoisted = groupRepeatSales(soldSorted, engineAll, tbl, { eligibleOnly: true });
console.log(`[equiv] HOISTED: ${hoisted.physPairs} pairs → ${hoisted.physGroups} groups · ${hoisted.seconds}s · eligible ${hoisted.eligible}/${soldSorted.length} · ${hoisted.candidatePairs} candidate pairs, ${hoisted.scored} scored`);

clear();
const legacy = groupRepeatSales(soldSorted, engineAll, tbl, { eligibleOnly: false });
console.log(`[equiv] LEGACY:  ${legacy.physPairs} pairs → ${legacy.physGroups} groups · ${legacy.seconds}s · ${legacy.candidatePairs} candidate pairs, ${legacy.scored} scored`);

// group ids are derived from the union-find root (an arbitrary member id), so
// compare the PARTITION, not the labels: same set of member-sets.
const partition = (m: Map<string, string>) => {
  const byG = new Map<string, string[]>();
  for (const [id, g] of m) (byG.get(g) || byG.set(g, []).get(g)!).push(id);
  return new Set(Array.from(byG.values()).map(ids => ids.sort().join('|')));
};
const A = partition(hoisted.groupOf), B = partition(legacy.groupOf);
const onlyA = Array.from(A).filter(x => !B.has(x)), onlyB = Array.from(B).filter(x => !A.has(x));
console.log(`[equiv] partitions: hoisted ${A.size} groups, legacy ${B.size} groups · only-hoisted ${onlyA.length} · only-legacy ${onlyB.length}`);
if (onlyA.length || onlyB.length) {
  console.error('[equiv] MISMATCH'); console.error(' only-hoisted:', onlyA.slice(0, 5)); console.error(' only-legacy:', onlyB.slice(0, 5));
  process.exit(1);
}
console.log(`[equiv] IDENTICAL partitions · speedup ${(Number(legacy.seconds) / Math.max(1, Number(hoisted.seconds))).toFixed(1)}×`);
