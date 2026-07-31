/** watches-backtest2.ts — second gate round: sale-date recency (comps within N
 *  years of the anchor's sale) alone and combined with the strict coarse
 *  material gate. Same seed/sample as watches-backtest.ts. */
import * as fs from 'fs';
import { appraiseLot, signalWithPool, classifyForm, watchKey } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const WMAKERS = new Set(['patek-philippe', 'rolex', 'cartier', 'audemars-piguet', 'omega']);
const byArtist = new Map<string, AuctionLot[]>();
for (const l of all) { if (!WMAKERS.has(l.artist)) continue; (byArtist.get(l.artist) ?? byArtist.set(l.artist, []).get(l.artist)!).push(l); }

const wkOf = (l: AuctionLot) => (l.reference !== undefined ? l.reference : watchKey(l));
const anchors0 = all.filter(l =>
  WMAKERS.has(l.artist) && l.category === 'object' && l.status === 'sold' && l.priceUsd &&
  (l.estLowUsd ?? l.estimateLow) && (l.estHighUsd ?? l.estimateHigh) &&
  classifyForm(l) === 'wristwatch' && wkOf(l) !== null && (l as any).source !== 'sothebys-algolia'
);
function mulberry32(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(42);
const anchors = anchors0.slice().sort(() => rnd() - 0.5).slice(0, 2500);
console.log('anchors:', anchors.length);

const MAT = new WeakMap<object, string | null>();
function coarseMat(l: AuctionLot): string | null {
  if (MAT.has(l)) return MAT.get(l)!;
  const t = ` ${(l.title || '').toLowerCase()} ${(l.medium || '').toLowerCase()} `;
  const gold = /\b(gold|or jaune|or gris|or rose|or blanc)\b|\b18k\b|\b14k\b|\b18ct\b|\b9ct\b/.test(t);
  const steel = /\b(steel|stainless|acier)\b/.test(t);
  let m: string | null = null;
  if ((gold && steel) || /\btwo[- ]tone\b/.test(t)) m = 'two-tone';
  else if (/\b(platinum|platine)\b/.test(t)) m = 'platinum';
  else if (gold) m = 'gold';
  else if (steel) m = 'steel';
  else if (/\btitanium\b/.test(t)) m = 'titanium';
  MAT.set(l, m); return m;
}
const YEAR = new WeakMap<object, number>();
function saleYear(l: AuctionLot): number {
  if (YEAR.has(l)) return YEAR.get(l)!;
  const y = parseInt((l.saleDate || '').slice(0, 4), 10) || 0;
  YEAR.set(l, y); return y;
}

type Gate = (a: AuctionLot) => (c: AuctionLot) => boolean;
const GATES: Record<string, Gate> = {
  baseline: () => () => true,
  recency5: (a) => { const ya = saleYear(a); return (c) => !ya || !saleYear(c) || Math.abs(saleYear(c) - ya) <= 5; },
  recency8: (a) => { const ya = saleYear(a); return (c) => !ya || !saleYear(c) || Math.abs(saleYear(c) - ya) <= 8; },
  matStrict: (a) => { const ma = coarseMat(a); return (c) => !ma || coarseMat(c) === ma; },
  matStrict_rec5: (a) => { const g1 = GATES.matStrict(a), g2 = GATES.recency5(a); return (c) => g1(c) && g2(c); },
  matStrict_rec8: (a) => { const g1 = GATES.matStrict(a), g2 = GATES.recency8(a); return (c) => g1(c) && g2(c); },
};

interface Res { realized: number; med: number | null; conf: string | null; label: string | null }
const results = new Map<string, Res[]>(Object.keys(GATES).map(k => [k, []]));
let done = 0;
for (const a of anchors) {
  const pool0 = byArtist.get(a.artist)!;
  for (const [name, gate] of Object.entries(GATES)) {
    const g = gate(a);
    const universe = name === 'baseline' ? pool0 : pool0.filter(l => l.id === a.id || g(l));
    const read = appraiseLot(a, universe);
    const sig = read ? signalWithPool(a, universe) : null;
    results.get(name)!.push({ realized: a.priceUsd!, med: read ? read.value : null, conf: read ? read.confidence : null, label: sig ? sig.signal.label : null });
  }
  if (++done % 500 === 0) console.error('...', done);
}
const med = (arr: number[]) => { const s = arr.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
for (const [name, rs] of results) {
  const reads = rs.filter(r => r.med !== null);
  const abs = reads.map(r => Math.abs((r.realized - r.med!) / r.med!));
  const hi = reads.filter(r => r.conf === 'high' || r.conf === 'very-high');
  const hiAbs = hi.map(r => Math.abs((r.realized - r.med!) / r.med!));
  const bm = rs.filter(r => r.label === 'Below Market');
  const bmHold = bm.filter(r => (r.realized - r.med!) / r.med! >= -0.2).length;
  console.log(name.padEnd(15), 'reads', String(reads.length).padStart(4), `(${(100 * reads.length / rs.length).toFixed(1)}%)`,
    'medAbsErr', med(abs).toFixed(3), 'meanAbsErr', (abs.reduce((s, x) => s + x, 0) / abs.length).toFixed(3),
    'hiConf', String(hi.length).padStart(4), '@', med(hiAbs).toFixed(3),
    'BM', String(bm.length).padStart(3), 'hold', bm.length ? (100 * bmHold / bm.length).toFixed(0) + '%' : '—');
}
