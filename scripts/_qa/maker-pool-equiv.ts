// Offline equivalence + timing check for the maker-index worker pool.
//
//   RAY_SKIP_MAIN=1 NODE_OPTIONS=--max-old-space-size=10240 \
//     npx tsx scripts/_qa/maker-pool-equiv.ts [topN=12]
//
// Groups the local corpus by artist, takes the top-N makers by lot count,
// builds every index sequentially AND through the pool, and asserts the
// results are deep-equal. Prints both wall clocks.
import * as assert from 'assert';
import { readAllSegments } from '../corpus-io';
import { normalizeCorpus } from '../lib/corpus-normalize';
import { buildMakerIndex } from '../hedonic-index';
import { buildMakerIndicesParallel } from '../lib/maker-pool';
import type { AuctionLot } from '../../app/types';

async function main() {
  const topN = Number(process.argv[2] || 12);
  const all = readAllSegments() as unknown as AuctionLot[];
  normalizeCorpus(all);
  const by = new Map<string, AuctionLot[]>();
  for (const l of all) {
    if (!l.artist || l.artist === 'sports-cards' || (l as AuctionLot & { source?: string }).source === 'sothebys-algolia') continue;
    (by.get(l.artist) || by.set(l.artist, []).get(l.artist)!).push(l);
  }
  const slugs = Array.from(by.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, topN).map(e => e[0]);
  const lots = new Map(slugs.map(s => [s, by.get(s)!]));
  console.log(`[pool-equiv] ${all.length} lots · ${slugs.length} makers: ${slugs.map(s => `${s}(${lots.get(s)!.length})`).join(' ')}`);
  const now = new Date();

  const t0 = Date.now();
  const seq: Record<string, unknown> = {};
  for (const s of slugs) seq[s] = buildMakerIndex(lots.get(s)!, now);
  const seqS = (Date.now() - t0) / 1000;
  console.log(`[pool-equiv] sequential ${seqS.toFixed(0)}s`);

  const pool = await buildMakerIndicesParallel(lots, now);
  console.log(`[pool-equiv] pool       ${pool.seconds}s on ${pool.workers} workers`);

  for (const s of slugs) assert.deepStrictEqual(JSON.parse(JSON.stringify(pool.makerIndex[s])), JSON.parse(JSON.stringify(seq[s])), `maker ${s} differs`);
  assert.deepStrictEqual(Object.keys(pool.makerIndex), slugs, 'key order differs');
  console.log(`[pool-equiv] IDENTICAL for all ${slugs.length} makers · speedup ${(seqS / Math.max(1, Number(pool.seconds))).toFixed(1)}×`);
}
main().catch(e => { console.error(e); process.exit(1); });
