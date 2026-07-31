/** watches-backtest.ts — hindsight backtest on sold wristwatch anchors.
 *  Baseline = the EXACT engine (appraiseLot / signalWithPool) on same-artist lots.
 *  Gated variants = the exact engine on a PRE-FILTERED candidate universe
 *  (material / size / year compatibility) — zero engine replication drift.
 *  Metrics: reads, medAbsErr, meanAbsErr, signals, Below-Market hold rate.
 */
import * as fs from 'fs';
import { appraiseLot, signalWithPool, classifyForm, watchKey } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}

const WMAKERS = new Set(['patek-philippe', 'rolex', 'cartier', 'audemars-piguet', 'omega']);
const byArtist = new Map<string, AuctionLot[]>();
for (const l of all) {
  if (!WMAKERS.has(l.artist)) continue;
  let a = byArtist.get(l.artist);
  if (!a) byArtist.set(l.artist, a = []);
  a.push(l);
}

// ── anchor universe: sold wristwatches with estimate + price + watchKey ──
const wkOf = (l: AuctionLot) => (l.reference !== undefined ? l.reference : watchKey(l));
const anchors0 = all.filter(l =>
  WMAKERS.has(l.artist) && l.category === 'object' && l.status === 'sold' && l.priceUsd &&
  (l.estLowUsd ?? l.estimateLow) && (l.estHighUsd ?? l.estimateHigh) &&
  classifyForm(l) === 'wristwatch' && wkOf(l) !== null &&
  (l as any).source !== 'sothebys-algolia'
);
console.log('eligible sold wristwatch anchors (est+price+key):', anchors0.length);

// deterministic sample
function mulberry32(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(42);
const anchors = anchors0.slice().sort(() => rnd() - 0.5).slice(0, 2500);
console.log('sampled anchors:', anchors.length);

// ── token extractors (probe-local; candidates for the engine) ──
type Mat = 'gold' | 'white-gold' | 'yellow-gold' | 'rose-gold' | 'platinum' | 'two-tone' | 'steel' | 'titanium' | 'ceramic' | 'silver' | 'bronze';
function fineMat(l: AuctionLot): Mat | null {
  const t = ` ${(l.title || '').toLowerCase()} ${(l.medium || '').toLowerCase()} `;
  const gold = /\b(gold|or jaune|or gris|or rose|or blanc)\b|\b18k\b|\b14k\b|\b9k\b|\b18ct\b|\b9ct\b/.test(t);
  const steel = /\b(steel|stainless|acier)\b/.test(t);
  if ((gold && steel) || /\btwo[- ]tone\b/.test(t)) return 'two-tone';
  if (/\b(platinum|platine)\b/.test(t)) return 'platinum';
  if (gold) {
    if (/\b(pink gold|rose gold|everose|or rose)\b/.test(t)) return 'rose-gold';
    if (/\b(white gold|or gris|or blanc)\b/.test(t)) return 'white-gold';
    if (/\b(yellow gold|or jaune)\b/.test(t)) return 'yellow-gold';
    return 'gold';
  }
  if (steel) return 'steel';
  if (/\btitanium\b/.test(t)) return 'titanium';
  if (/\bceramic\b/.test(t)) return 'ceramic';
  if (/\bsilver\b/.test(t)) return 'silver';
  if (/\bbronze\b/.test(t)) return 'bronze';
  return null;
}
const MAT_CACHE = new WeakMap<object, Mat | null>();
function matOf(l: AuctionLot): Mat | null {
  if (MAT_CACHE.has(l)) return MAT_CACHE.get(l)!;
  const m = fineMat(l); MAT_CACHE.set(l, m); return m;
}
// coarse class: all gold shades collapse; bare 'gold' compatible with any shade
function coarse(m: Mat | null): string | null {
  if (!m) return null;
  if (m === 'yellow-gold' || m === 'white-gold' || m === 'rose-gold' || m === 'gold') return 'gold';
  return m;
}
// fine compat: bare 'gold' (unknown shade) matches any gold shade; shades must agree
function fineCompat(a: Mat, b: Mat): boolean {
  const G = new Set(['gold', 'yellow-gold', 'white-gold', 'rose-gold']);
  if (G.has(a) && G.has(b)) return a === 'gold' || b === 'gold' || a === b;
  return a === b;
}
function mmOf(l: AuctionLot): number | null {
  for (const src of [l.title, l.dimensions]) {
    if (!src) continue;
    const m = src.toLowerCase().match(/(\d{2}(?:[.,]\d+)?)\s?mm\b/);
    if (m) { const v = parseFloat(m[1].replace(',', '.')); if (v >= 15 && v <= 70) return v; }
  }
  return null;
}
function yearOf(l: AuctionLot): number | null {
  if ((l as any).yearNum) return (l as any).yearNum;
  const m = (l.title || '').match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
  return m ? parseInt(m[1], 10) : null;
}

// ── variants: pre-filter candidate universe relative to the anchor ──
type Gate = (anchor: AuctionLot) => (c: AuctionLot) => boolean;
const GATES: Record<string, Gate> = {
  baseline: () => () => true,
  coarseMat: (a) => { const ma = coarse(matOf(a)); return (c) => { if (!ma) return true; const mc = coarse(matOf(c)); return !mc || mc === ma; }; },
  fineMat: (a) => { const ma = matOf(a); return (c) => { if (!ma) return true; const mc = matOf(c); return !mc || fineCompat(ma, mc); }; },
  coarseMatStrict: (a) => { const ma = coarse(matOf(a)); return (c) => { if (!ma) return true; const mc = coarse(matOf(c)); return mc === ma; }; }, // unparsed candidate EXCLUDED
  size3mm: (a) => { const sa = mmOf(a); return (c) => { if (!sa) return true; const sc = mmOf(c); return !sc || Math.abs(sa - sc) <= 3; }; },
  year10: (a) => { const ya = yearOf(a); return (c) => { if (!ya) return true; const yc = yearOf(c); return !yc || Math.abs(ya - yc) <= 10; }; },
  coarseMat_size: (a) => { const g1 = GATES.coarseMat(a), g2 = GATES.size3mm(a); return (c) => g1(c) && g2(c); },
  fineMat_size_year: (a) => { const g1 = GATES.fineMat(a), g2 = GATES.size3mm(a), g3 = GATES.year10(a); return (c) => g1(c) && g2(c) && g3(c); },
};

interface Res { id: string; realized: number; med: number | null; n: number; conf: string | null; label: string | null; pct: number }
const results = new Map<string, Res[]>();
for (const name of Object.keys(GATES)) results.set(name, []);

let done = 0;
for (const a of anchors) {
  const pool0 = byArtist.get(a.artist)!;
  for (const [name, gate] of Object.entries(GATES)) {
    const g = gate(a);
    const universe = name === 'baseline' ? pool0 : pool0.filter(l => l.id === a.id || g(l));
    const read = appraiseLot(a, universe);
    const sig = read ? signalWithPool(a, universe) : null;
    results.get(name)!.push({
      id: a.id, realized: a.priceUsd!,
      med: read ? read.value : null, n: read ? read.n : 0, conf: read ? read.confidence : null,
      label: sig ? sig.signal.label : null, pct: sig ? sig.signal.pct : 0,
    });
  }
  if (++done % 250 === 0) console.error('...', done);
}

function summarize(name: string, rs: Res[]) {
  const reads = rs.filter(r => r.med !== null);
  const errs = reads.map(r => (r.realized - r.med!) / r.med!);
  const abs = errs.map(Math.abs).sort((x, y) => x - y);
  const med = (arr: number[]) => arr.length ? arr[Math.floor(arr.length / 2)] : NaN;
  const bm = rs.filter(r => r.label === 'Below Market');
  const bmErrs = bm.map(r => (r.realized - r.med!) / r.med!);
  const bmHold = bmErrs.filter(e => e >= -0.2).length; // realized within -20% of med = flag held
  const hi = reads.filter(r => r.conf === 'high' || r.conf === 'very-high');
  const hiAbs = hi.map(r => Math.abs((r.realized - r.med!) / r.med!)).sort((x, y) => x - y);
  console.log(name.padEnd(18),
    'reads', String(reads.length).padStart(4), `(${(100 * reads.length / rs.length).toFixed(1)}%)`,
    'medAbsErr', med(abs).toFixed(3),
    'meanAbsErr', (abs.reduce((s, x) => s + x, 0) / abs.length).toFixed(3),
    'hiConf reads', String(hi.length).padStart(4), 'hiConf medAbsErr', med(hiAbs).toFixed(3),
    'BM flags', String(bm.length).padStart(3), 'BM hold', bm.length ? (100 * bmHold / bm.length).toFixed(0) + '%' : '—');
}
console.log('\n=== variant results (n=' + anchors.length + ' anchors) ===');
for (const [name, rs] of results) summarize(name, rs);

// ── error-driver diagnosis on the BASELINE pools: material purity vs error ──
// re-run baseline capturing pool material mix
let mixed = 0, pure = 0, unk = 0;
const errByPurity: Record<string, number[]> = { pure: [], mixed: [], unparsed: [] };
for (const a of anchors) {
  const universe = byArtist.get(a.artist)!;
  const sig = signalWithPool(a, universe); // need pool: use signalWithPool? only when signal. use compPoolRead via appraise…
  // appraiseLot doesn't expose the pool; recompute purity via a cheap proxy:
  // candidates = same-artist sold same-key same-form (approximation of the form path)
  const read = appraiseLot(a, universe);
  if (!read) continue;
  const ma = coarse(matOf(a));
  if (!ma) { unk++; errByPurity.unparsed.push(Math.abs((a.priceUsd! - read.value) / read.value)); continue; }
  const k = wkOf(a);
  const sibs = universe.filter(l => l.id !== a.id && l.status === 'sold' && l.priceUsd && classifyForm(l) === 'wristwatch' && wkOf(l) === k);
  const mats = sibs.map(l => coarse(matOf(l))).filter(Boolean);
  const share = mats.length ? mats.filter(m => m === ma).length / mats.length : 1;
  const e = Math.abs((a.priceUsd! - read.value) / read.value);
  if (share >= 0.8) { pure++; errByPurity.pure.push(e); } else { mixed++; errByPurity.mixed.push(e); }
}
const med = (arr: number[]) => { const s = arr.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
console.log('\n=== baseline error by same-key sibling material purity (anchor material share of parsed siblings) ===');
console.log('pure (>=80% same coarse material):', pure, 'medAbsErr', med(errByPurity.pure).toFixed(3));
console.log('mixed (<80%):                     ', mixed, 'medAbsErr', med(errByPurity.mixed).toFixed(3));
console.log('anchor material unparsed:          ', unk, 'medAbsErr', med(errByPurity.unparsed).toFixed(3));
