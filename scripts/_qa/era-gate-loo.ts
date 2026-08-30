/**
 * Leave-one-out validation for THE ERA GATE (Engine Spec v2 deferred item 6):
 * a comp should not cross eras within a maker — a 1955 Submariner comping a
 * 2020 Submariner pollutes pools (5–10× price moves inside ref+material pools
 * across 25 years, per the watches audit). Policy under test, per vertical
 * (watches / design / art):
 *   BASE — the exact engine (resolveComps → estimateValue, temporal holdout)
 *   ±10y / ±15y — drop comps whose |yearNum − anchor.yearNum| > N when BOTH
 *   sides carry a year; a lot without a year is never gated (honest reads:
 *   missing data is never penalized).
 * The variant is a post-filter on the resolveComps list — equivalent to a hard
 * gate in similarity() (gates only exclude; survivor scores are unchanged).
 * Pool-median metric = estimateValue's own compValueUsd (the real engine path,
 * per the roster-tier-loo model). Run:
 *   NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/_qa/era-gate-loo.ts
 *   (ANCHORS=4000 VERT=watches for a confirm run)
 *
 * VERDICT (Aug 30 2026): DECLINED in all three verticals — the soft year bonus
 * in similarity.ts stays the only era signal.
 *   watches n=1500: ±15y touched 215 reads err 35.5%→33.0% — a PHANTOM win;
 *   watches n=4000: ±15y touched 703 reads 35.8%→36.2% (worse), ±10y touched
 *     889 reads 35.5%→34.2% (−1.3pt) at the cost of 73 lost reads and −0.2pt
 *     aggregate — under the ≥2pt adoption bar.
 *   design  n=1500: ±10y touched 41.7%→42.9%, 41 reads lost. Worse.
 *   art     n=1500: ±10y touched 55.7%→58.4%, ±15y 57.4%→63.0%. Worse (title
 *     years are often subject dates; matches the spec's client-side rejection).
 * Sample-size law: the n=1500 watches run showed −2.5pt where n=4000 showed
 * +0.4pt — do not re-litigate an era gate below n≈4,000 anchors.
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
const VERTICALS = ['watches', 'design', 'art'] as const;

console.log('[era-loo] reading corpus…');
const all = (readGzRows(path.join(CORPUS, 'lots.json.gz')) as AuctionLot[])
  .concat(readGzRows(path.join(CORPUS, 'sold-archive.json.gz')) as AuctionLot[]);
normalizeCorpus(all);

// engine eligibility — mirrors build-market's engineAll + sold filters
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
console.log(`[era-loo] engine sold ${engineSold.length} · vertical sold ${vertSold.length}`);

function mulberry32(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const med = (a: number[]) => { const x = [...a].sort((q, w) => q - w); return x.length ? (x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2) : NaN; };

const N_ANCHORS = Number(process.env.ANCHORS) || 1500;   // ANCHORS=4000 for a confirm run
const ONLY = process.env.VERT || null;                     // VERT=watches to isolate one vertical
type Variant = { name: string; keep: (anchor: AuctionLot, comp: AuctionLot) => boolean };
const eraKeep = (n: number) => (a: AuctionLot, c: AuctionLot) =>
  !(a.yearNum && c.yearNum && Math.abs(a.yearNum - c.yearNum) > n);
const VARIANTS: Variant[] = [
  { name: 'BASE', keep: () => true },
  { name: '±10y', keep: eraKeep(10) },
  { name: '±15y', keep: eraKeep(15) },
];

for (const vert of VERTICALS) {
  if (ONLY && vert !== ONLY) continue;
  const anchors0 = vertSold.filter(l => marketOf[l.artist] === vert);
  const rnd = mulberry32(42);
  const anchors = anchors0.slice().sort(() => rnd() - 0.5).slice(0, N_ANCHORS);
  const yrCov = anchors.filter(a => a.yearNum).length;
  console.log(`\n── ${vert}: ${anchors0.length} sold · ${anchors.length} anchors · yearNum ${(yrCov / anchors.length * 100).toFixed(1)}%`);

  // score comps ONCE per anchor; variants are pool post-filters
  const compsOf: Comp[][] = anchors.map(a =>
    resolveComps(a as AuctionLot & { _v?: Record<string, number> },
      (byArtist.get(a.artist) || []) as (AuctionLot & { _v?: Record<string, number> })[],
      tbl, a.saleDate));

  const base: (number | null)[] = [];       // baseline abs err per anchor (null = no read)
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
