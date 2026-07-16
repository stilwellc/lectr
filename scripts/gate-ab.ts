/**
 * gate-ab.ts — A/B the comp-pool inclusion gate on the REAL production engine
 * (resolveComps + estimateValue), in strict temporal holdout: for every SOLD lot
 * that carried an estimate, we value it using ONLY comps that sold strictly before
 * it, then compare the call to what actually happened. Runs twice — the historical
 * raw-cosine gate vs the broadened cos-floor+score gate — over the identical lot
 * set, so the deltas are apples-to-apples.
 *
 * Run: npx tsx scripts/gate-ab.ts
 */
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import type { AuctionLot } from '../app/types';
import { buildIdf, buildVectors } from '../app/lib/similarity';
import { resolveComps, estimateValue, COMP_GATE } from '../app/lib/value';

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const readGz = (f: string): AuctionLot[] =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));

type L = AuctionLot & { _v?: Record<string, number>; estLowUsd?: number; estHighUsd?: number; realizedUsd?: number };
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

const PRIOR_CAP = 500; // cap same-maker priors per target — keeps the replay tractable; identical for both gates

console.log('[gate-ab] reading corpus…');
const all = readGz('lots.json').concat(readGz('sold-archive.json')) as L[];
const sold = all.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate && l.titleTokens && l.titleTokens.length);
const tbl = buildIdf(sold);
buildVectors(all as AuctionLot[], tbl);

// same-maker sold, time-sorted, for O(1) prior slicing
const byArtist = new Map<string, L[]>();
for (const s of sold) (byArtist.get(s.artist) || byArtist.set(s.artist, []).get(s.artist)!).push(s);
byArtist.forEach(g => g.sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1)));

// the held-out targets: sold lots that carried a usable estimate
const targets = sold.filter(l => (l.estLowUsd || 0) > 0 && (l.estHighUsd || 0) > 0 && (l.estLowUsd! + l.estHighUsd!) / 2 > 0);
console.log(`[gate-ab] ${all.length} lots · ${sold.length} priced sold · ${targets.length} sold-with-estimate targets`);

type Bucket = { perfs: number[]; beat: number; n: number };
const mk = (): Bucket => ({ perfs: [], beat: 0, n: 0 });

function run(label: string, gate: { cosFloor: number; minScore: number }) {
  COMP_GATE.cosFloor = gate.cosFloor;
  COMP_GATE.minScore = gate.minScore;
  const below = mk(), none = mk(), above = mk();
  let valued = 0, poolShort = 0;

  for (const lot of targets) {
    const estMid = (lot.estLowUsd! + lot.estHighUsd!) / 2;
    const roster = byArtist.get(lot.artist) || [];
    // strictly-earlier same-maker sold (no same-day, no leak), most-recent PRIOR_CAP
    const priors: L[] = [];
    for (let i = roster.length - 1; i >= 0 && priors.length < PRIOR_CAP; i--) {
      const s = roster[i];
      if (s.id === lot.id) continue;
      if (!(s.saleDate < lot.saleDate)) continue;
      priors.push(s);
    }
    if (priors.length < 3) { poolShort++; continue; }

    const comps = resolveComps(lot, priors, tbl, lot.saleDate);
    const v = estimateValue(lot, comps, tbl);
    if (!v || !v.signal) continue;
    valued++;

    const realized = lot.realizedUsd!;
    const perf = realized / estMid - 1;
    const beatHigh = realized > lot.estHighUsd!;
    const call = v.signal.label.startsWith('below') ? below
      : v.signal.label.startsWith('above') ? above : none;
    call.perfs.push(perf); if (beatHigh) call.beat++; call.n++;
  }

  const stat = (b: Bucket) => ({ n: b.n, med: b.n ? Math.round(median(b.perfs) * 100) : 0, beat: b.n ? Math.round((b.beat / b.n) * 100) : 0 });
  const f = stat(below), u = stat(none), a = stat(above);
  console.log(`\n── ${label}  (cosFloor ${gate.cosFloor}, minScore ${gate.minScore}) ──`);
  console.log(`   coverage: valued ${valued}/${targets.length} (${Math.round((valued / targets.length) * 100)}%)   [pool<3 skipped: ${poolShort}]`);
  console.log(`   BELOW-market (flagged): n=${f.n}  median realized vs est +${f.med}%   beatHigh ${f.beat}%`);
  console.log(`   at-market   (unflagged): n=${u.n}  median +${u.med}%   beatHigh ${u.beat}%`);
  console.log(`   above-market            : n=${a.n}  median +${a.med}%   beatHigh ${a.beat}%`);
  console.log(`   EDGE (flagged median − unflagged median): ${f.med - u.med} pts   (flagged beatHigh − unflagged: ${f.beat - u.beat} pts)`);
  return { valued, f, u, a };
}

// COMP_GATE is a shared mutable singleton — snapshot and restore it so running
// this harness can never leave the engine's gate mutated for a later in-process
// caller (build-market/build-backtest import the same module).
const gate0 = { ...COMP_GATE };
const base = run('BASELINE raw-cosine', { cosFloor: 0.65, minScore: 0 });
const wide = run('BROADENED cos-floor+score', { cosFloor: 0.50, minScore: 65 });
COMP_GATE.cosFloor = gate0.cosFloor;
COMP_GATE.minScore = gate0.minScore;

console.log('\n══════════ VERDICT ══════════');
console.log(`coverage:        ${base.valued} → ${wide.valued}  (${wide.valued - base.valued >= 0 ? '+' : ''}${wide.valued - base.valued} lots valued)`);
console.log(`flagged n:       ${base.f.n} → ${wide.f.n}`);
console.log(`flagged median:  +${base.f.med}% → +${wide.f.med}%   (${wide.f.med - base.f.med >= 0 ? '+' : ''}${wide.f.med - base.f.med} pts)`);
console.log(`flagged beatHigh:${base.f.beat}% → ${wide.f.beat}%   (${wide.f.beat - base.f.beat >= 0 ? '+' : ''}${wide.f.beat - base.f.beat} pts)`);
console.log(`edge (flagged−unflagged median): ${base.f.med - base.u.med} → ${wide.f.med - wide.u.med} pts`);
console.log('\nShip the broadened gate only if coverage rises AND the flagged edge (median + beatHigh) holds or improves.');
