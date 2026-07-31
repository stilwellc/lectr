/** watches-keytype-err.ts — baseline engine error split by anchor key type:
 *  ref-number keys (e.g. '1675', '116500ln') vs model-name keys ('daytona',
 *  'tank'). Same seed/sample as the main backtest. */
import * as fs from 'fs';
import { appraiseLot, signalWithPool, classifyForm, watchKey } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const WMAKERS = new Set(['patek-philippe', 'rolex', 'cartier', 'audemars-piguet', 'omega']);
const byArtist = new Map<string, AuctionLot[]>();
for (const l of all) { if (!WMAKERS.has(l.artist)) continue; let a = byArtist.get(l.artist); if (!a) byArtist.set(l.artist, a = []); a.push(l); }
const wkOf = (l: AuctionLot) => (l.reference !== undefined ? l.reference : watchKey(l));
const anchors0 = all.filter(l =>
  WMAKERS.has(l.artist) && l.category === 'object' && l.status === 'sold' && l.priceUsd &&
  (l.estLowUsd ?? l.estimateLow) && (l.estHighUsd ?? l.estimateHigh) &&
  classifyForm(l) === 'wristwatch' && wkOf(l) !== null && (l as any).source !== 'sothebys-algolia'
);
function mulberry32(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(42);
const anchors = anchors0.slice().sort(() => rnd() - 0.5).slice(0, 2500);

const buckets: Record<string, { abs: number[]; bm: number; bmHold: number }> = {
  refnum: { abs: [], bm: 0, bmHold: 0 }, name: { abs: [], bm: 0, bmHold: 0 },
};
let done = 0;
for (const a of anchors) {
  const read = appraiseLot(a, byArtist.get(a.artist)!);
  if (!read) { done++; continue; }
  const key = wkOf(a)!;
  const b = /\d{3}/.test(key) ? buckets.refnum : buckets.name;
  const err = (a.priceUsd! - read.value) / read.value;
  b.abs.push(Math.abs(err));
  const sig = signalWithPool(a, byArtist.get(a.artist)!);
  if (sig && sig.signal.label === 'Below Market') { b.bm++; if (err >= -0.2) b.bmHold++; }
  if (++done % 500 === 0) console.error('...', done);
}
const med = (arr: number[]) => { const s = arr.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
for (const [k, b] of Object.entries(buckets)) {
  console.log(k.padEnd(7), 'reads', b.abs.length, 'medAbsErr', med(b.abs).toFixed(3),
    'meanAbsErr', (b.abs.reduce((s, x) => s + x, 0) / (b.abs.length || 1)).toFixed(3),
    'BM flags', b.bm, 'hold', b.bm ? (100 * b.bmHold / b.bm).toFixed(0) + '%' : '—');
}
