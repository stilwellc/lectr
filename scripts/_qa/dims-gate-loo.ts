/**
 * Leave-one-out validation for DIMS INTO COMPS (Engine Spec v2 deferred item 7):
 * parsed dimensions as a comp axis for art/design. similarity() already hard-
 * gates max-linear-dimension ratio > 1.6 (sizeRatio); what that gate cannot see
 * is ASPECT mismatch — a 100×100cm canvas vs a 65×10cm panel passes max-dim
 * 1.54× while their areas differ 15×. Policy under test, per vertical:
 *   BASE — the exact engine (resolveComps → estimateValue, temporal holdout;
 *          includes the existing 1.6× max-dim hard gate)
 *   ≤4×A / ≤9×A — additionally drop comps whose AREA ratio (heightCm·widthCm,
 *   stamped at normalize from the parsed dimensions field) exceeds the band
 *   when BOTH sides carry area; missing dims are never gated (honest reads).
 * Variant = post-filter on the resolveComps list — equivalent to a hard gate in
 * similarity() (gates only exclude; survivor scores unchanged). Run:
 *   NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/_qa/dims-gate-loo.ts
 *   (ANCHORS=4000 VERT=art for a confirm run)
 *
 * VERDICT (Aug 30 2026): ADOPTED for ART at ≤4× area — wired as a hard gate in
 * similarity.ts (ART_SLUGS scope). Receipt (n=4000 confirm): touched 95/2,185
 * reads err 49.4%→39.9% (−9.5pt), 3 reads lost, aggregate 45.4%→44.9%; n=1500
 * agreed in sign (touched 42 reads 46.3%→43.2%). ≤2.5× (the client engine's 2D
 * band) measured WORSE on touched (53.1%→53.6%) — it does not transfer to this
 * pool machinery. ≤9× same direction but fires 4× less. DESIGN declined: 12.1%
 * area coverage, 5 touched reads, no error change, 1 read lost. WATCHES never
 * tested here: 0.2% dims coverage, structurally dead (spec §2.3).
 * NOTE post-adoption, this harness's BASE includes the wired gate — ≤4×A must
 * read as a no-op (gate touched 0); that re-run IS the wiring verification.
 */
import * as path from 'path';
import type { AuctionLot } from '../../app/types';
import { buildIdf, buildVectors } from '../../app/lib/similarity';
import { resolveComps, estimateValue, type Comp } from '../../app/lib/value';
const { readGzRows } = require('../corpus-io');
const { normalizeCorpus } = require('../lib/corpus-normalize');
const { ARTISTS } = require('../../app/constants');

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const marketOf: Record<string, string> = {};
for (const a of ARTISTS as { slug: string; market: string }[]) marketOf[a.slug] = a.market;
const VERTICALS = ['art', 'design'] as const;   // watches: mm coverage ~0.2% — structurally dead (spec §2.3)

console.log('[dims-loo] reading corpus…');
const all = (readGzRows(path.join(CORPUS, 'lots.json.gz')) as AuctionLot[])
  .concat(readGzRows(path.join(CORPUS, 'sold-archive.json.gz')) as AuctionLot[]);
normalizeCorpus(all);

const engineSold = all.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0
  && l.saleDate && l.titleTokens && l.titleTokens.length
  && (l as { source?: string }).source !== 'sothebys-algolia'
  && !['sports-cards', 'pokemon', 'graded-cards'].includes(l.artist));
const tbl = buildIdf(engineSold);

const vertSold = engineSold.filter(l => VERTICALS.includes(marketOf[l.artist] as typeof VERTICALS[number]));
buildVectors(vertSold, tbl);
const byArtist = new Map<string, AuctionLot[]>();
for (const l of vertSold) (byArtist.get(l.artist) || byArtist.set(l.artist, []).get(l.artist)!).push(l);
const byId = new Map<string, AuctionLot>(vertSold.map(l => [String(l.id), l]));
console.log(`[dims-loo] engine sold ${engineSold.length} · vertical sold ${vertSold.length}`);

function mulberry32(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const med = (a: number[]) => { const x = [...a].sort((q, w) => q - w); return x.length ? (x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2) : NaN; };
const areaOf = (l: AuctionLot): number | null => (l.heightCm && l.widthCm) ? l.heightCm * l.widthCm : null;

const N_ANCHORS = Number(process.env.ANCHORS) || 1500;   // ANCHORS=4000 for a confirm run
const ONLY = process.env.VERT || null;                     // VERT=art to isolate one vertical
type Variant = { name: string; keep: (anchor: AuctionLot, comp: AuctionLot) => boolean };
const areaKeep = (band: number) => (a: AuctionLot, c: AuctionLot) => {
  const aa = areaOf(a), ca = areaOf(c);
  if (!aa || !ca) return true;                 // missing dims: never gated
  const r = aa >= ca ? aa / ca : ca / aa;
  return r <= band;
};
const VARIANTS: Variant[] = [
  { name: 'BASE', keep: () => true },
  { name: '≤2.5×A', keep: areaKeep(2.5) },   // the band the CLIENT engine adopted for 2D art (spec §2.1-C)
  { name: '≤4×A', keep: areaKeep(4) },
  { name: '≤9×A', keep: areaKeep(9) },
];

for (const vert of VERTICALS) {
  if (ONLY && vert !== ONLY) continue;
  const anchors0 = vertSold.filter(l => marketOf[l.artist] === vert);
  const rnd = mulberry32(42);
  const anchors = anchors0.slice().sort(() => rnd() - 0.5).slice(0, N_ANCHORS);
  const dimCov = anchors.filter(a => areaOf(a)).length;
  console.log(`\n── ${vert}: ${anchors0.length} sold · ${anchors.length} anchors · area ${(dimCov / anchors.length * 100).toFixed(1)}%`);

  const compsOf: Comp[][] = anchors.map(a =>
    resolveComps(a as AuctionLot & { _v?: Record<string, number> },
      (byArtist.get(a.artist) || []) as (AuctionLot & { _v?: Record<string, number> })[],
      tbl, a.saleDate));

  const base: (number | null)[] = [];
  for (const v of VARIANTS) {
    const errs: number[] = []; let reads = 0;
    const affErrB: number[] = [], affErrG: number[] = []; let affected = 0, lostReads = 0;
    anchors.forEach((a, i) => {
      const kept = v.name === 'BASE' ? compsOf[i]
        : compsOf[i].filter(c => v.keep(a, byId.get(String(c.id))!));
      const r = estimateValue(a as AuctionLot & { _v?: Record<string, number> }, kept, tbl);
      const e = r ? Math.abs(r.compValueUsd - a.realizedUsd!) / a.realizedUsd! : null;
      if (v.name === 'BASE') { base[i] = e; }
      if (r) { reads++; errs.push(e!); }
      if (v.name !== 'BASE') {
        const changed = kept.length !== compsOf[i].length;
        if (changed && base[i] != null) {
          if (e == null) lostReads++;
          else { affected++; affErrB.push(base[i]!); affErrG.push(e); }
        }
      }
    });
    const line = `${v.name.padEnd(5)} coverage ${reads}/${anchors.length} (${(reads / anchors.length * 100).toFixed(1)}%) · med|err| ${(med(errs) * 100).toFixed(1)}%`;
    console.log(v.name === 'BASE' ? line
      : `${line} · gate touched ${affected + lostReads} reads (kept ${affected}: err ${(med(affErrB) * 100).toFixed(1)}%→${(med(affErrG) * 100).toFixed(1)}% · lost ${lostReads})`);
  }
}
