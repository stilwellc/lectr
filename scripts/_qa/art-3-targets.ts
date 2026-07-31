/** art-3-targets — head-to-head on the specific failure subsets:
 *  (a) ALL print-cued 'original' sold anchors: V0 vs V4 print-sniff reclass
 *  (b) form-path print anchors WITH a series token: V0 vs V5 series-required
 *  (c) anchors whose baseline pool had maxAreaRatio>2.5: V0 vs V2 area<=2.5
 *  (d) flag-gate sim on 1500 anchors: suppress low-confidence flags — kept vs
 *      lost flag count + beat rate (realized >= estMid). */
import * as fs from 'fs';
import { classifyForm, parseDims, normalizeTitle, Form } from '../../app/lib/comps';
import { ARTIST_MARKET } from '../../app/constants';
import type { AuctionLot } from '../../app/types';

const dir = 'public/data/ray';
const all: AuctionLot[] = [];
for (const f of fs.readdirSync(dir)) {
  if (!/^lots-\d+\.json$/.test(f)) continue;
  const chunk = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  all.push(...(Array.isArray(chunk) ? chunk : (chunk as any).lots || []));
}
const upcoming: AuctionLot[] = (() => {
  try { const u = JSON.parse(fs.readFileSync(`${dir}/upcoming.json`, 'utf8')); return Array.isArray(u) ? u : u.lots || []; } catch { return []; }
})();

const PRINT_CUES = /\bpl\.?\s*\d+|\bplate\b|,\s*from\s+[A-Z]|\bfrom the (portfolio|suite|series)\b|\bedition of\b|\bnumbered\b|\blithograph|\betching|\bscreenprint|\bpochoir|\bwoodcut|\baquatint/i;
const ORIGINAL_FORMS = new Set<Form>(['painting', 'work-on-paper', 'original-2d']);
function median(sorted: number[]) { const m = Math.floor(sorted.length / 2); return sorted.length % 2 === 0 ? (sorted[m-1]+sorted[m])/2 : sorted[m]; }
const medAbs = (errs: number[]) => { const a = errs.map(Math.abs).sort((x,y)=>x-y); return a.length ? +a[Math.floor(a.length/2)].toFixed(3) : null; };
const seriesOf = (title: string | null | undefined): string | null => {
  const m = (title || '').match(/(?:,|\s)from\s+(?:the\s+)?(.{3,50}?)(?:\s*\(|,|\s*\d*\s*$)/i);
  if (!m) return null;
  const s = normalizeTitle(m[1]);
  return s.length >= 3 ? s : null;
};

interface Opts { areaRatioMax?: number; printSniff?: boolean; requireSeriesForPrints?: boolean; }
function formV(l: AuctionLot, opts: Opts): Form {
  const base = ((l as any).formKey as Form | undefined) ?? classifyForm(l);
  if (opts.printSniff && l.category === 'original' && ORIGINAL_FORMS.has(base) && PRINT_CUES.test(l.title || '')) return 'print';
  return base;
}
function readV(lot: AuctionLot, sold: AuctionLot[], opts: Opts) {
  const estLow = (lot as any).estLowUsd ?? lot.estimateLow, estHigh = (lot as any).estHighUsd ?? lot.estimateHigh;
  if (!estLow || !estHigh) return null;
  const form = formV(lot, opts);
  if (form === 'unknown') return null;
  const estMid = (estLow + estHigh) / 2;
  const nt = normalizeTitle(lot.title);
  let pool: AuctionLot[] = []; let kind: 'edition' | 'form' = 'form';
  const toks = nt.split(' ').filter(w => w.length >= 3).length;
  if (nt.length >= 8 && toks >= 2) {
    const sameTitle = sold.filter(l => normalizeTitle(l.title) === nt && formV(l, opts) === form);
    if (sameTitle.length >= 3) {
      const em = lot.estimateLow && lot.estimateHigh ? (lot.estimateLow + lot.estimateHigh) / 2 : 0;
      const m = median(sameTitle.map(l => l.priceUsd!).slice().sort((a,b)=>a-b));
      if (!em || (m <= em * 5 && m >= em / 5)) { pool = sameTitle; kind = 'edition'; }
    }
  }
  let maxAreaRatio: number | null = null;
  if (pool.length === 0) {
    const da = parseDims(lot.dimensions);
    const sa = seriesOf(lot.title);
    const areaMax = opts.areaRatioMax ?? 4;
    pool = sold.filter(c => {
      if (formV(c, opts) !== form) return false;
      if (da) {
        const db = parseDims(c.dimensions);
        if (db) {
          const A = da[0]*da[1], B = db[0]*db[1];
          if (A > 0 && B > 0 && (A/B > areaMax || B/A > areaMax)) return false;
        }
      }
      if (opts.requireSeriesForPrints && form === 'print' && sa && seriesOf(c.title) !== sa) return false;
      return true;
    });
    if (pool.length > 24) {
      const words = new Set(nt.split(' ').filter(w => w.length > 3));
      const overlap = (l: AuctionLot) => { let n = 0; for (const x of normalizeTitle(l.title).split(' ')) if (words.has(x)) n++; return n; };
      pool = pool.map(l => [overlap(l), new Date(l.saleDate).getTime(), l] as const).sort((a,b)=>(b[0]-a[0])||(b[1]-a[1])).slice(0,24).map(s=>s[2]);
    }
    if (da) {
      const ratios = pool.map(p => parseDims(p.dimensions)).filter((d): d is [number, number] => !!d)
        .map(db => { const A = da[0]*da[1], B = db[0]*db[1]; return Math.max(A/B, B/A); });
      if (ratios.length) maxAreaRatio = Math.max(...ratios);
    }
  }
  if (pool.length < 3) return null;
  const prices = pool.map(l => l.priceUsd!).sort((a,b)=>a-b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length*0.25)], q3 = prices[Math.floor(prices.length*0.75)];
  const spread = med > 0 ? (q3-q1)/med : 99;
  if (spread > 2.5) return null;
  if (kind === 'form' && med > 0 && (med > estMid*5 || med < estMid/5)) return null;
  const words = new Set(nt.split(' ').filter(w => w.length > 3));
  const titleKin = words.size === 0 ? 0 : pool.filter(l => { let h = 0; for (const w of normalizeTitle(l.title).split(' ')) if (words.has(w)) h++; return h >= 2; }).length;
  const conf = kind === 'edition' ? 'very-high' : (pool.length >= 12 && spread <= 1.0) || (titleKin >= 6 && spread <= 1.5) ? 'high' : pool.length >= 6 && spread <= 1.8 ? 'medium' : 'low';
  return { pool, med, kind, form, estMid, conf, spread, titleKin, maxAreaRatio, ratio: med/estMid };
}

const soldByArtist: Record<string, AuctionLot[]> = {};
for (const l of all) if (l.status === 'sold' && l.priceUsd && (l as any).source !== 'sothebys-algolia') (soldByArtist[l.artist] ||= []).push(l);
const soldFor = (lot: AuctionLot) => (soldByArtist[lot.artist] || []).filter(l => l.id !== lot.id);
const artSold = all.filter(l => ARTIST_MARKET[l.artist] === 'art' && l.status === 'sold' && l.priceUsd && ((l as any).estLowUsd ?? l.estimateLow) && ((l as any).estHighUsd ?? l.estimateHigh));
const err = (lot: AuctionLot, r: { med: number }) => +((lot.priceUsd! - r.med) / r.med).toFixed(3);

// ── (a) ALL print-cued original sold anchors ──
const sniffAnchors = artSold.filter(l => l.category === 'original' && PRINT_CUES.test(l.title || '') && ORIGINAL_FORMS.has(((l as any).formKey as Form) ?? classifyForm(l)));
const aOut: any[] = [];
for (const lot of sniffAnchors) {
  const v0 = readV(lot, soldFor(lot), {});
  const v4 = readV(lot, soldFor(lot), { printSniff: true });
  aOut.push({ id: lot.id, t: (lot.title || '').slice(0, 50), v0: v0 ? { err: err(lot, v0), kind: v0.kind, n: v0.pool.length, flag: v0.ratio >= 1.3 } : null, v4: v4 ? { err: err(lot, v4), kind: v4.kind, n: v4.pool.length, flag: v4.ratio >= 1.3 } : null });
}
const both = aOut.filter(r => r.v0 && r.v4);
console.log(JSON.stringify({ sniffAnchorsTotal: sniffAnchors.length,
  v0reads: aOut.filter(r => r.v0).length, v4reads: aOut.filter(r => r.v4).length,
  bothRead: both.length,
  v0errOnBoth: medAbs(both.map(r => r.v0.err)), v4errOnBoth: medAbs(both.map(r => r.v4.err)),
  v0flags: aOut.filter(r => r.v0?.flag).length, v4flags: aOut.filter(r => r.v4?.flag).length,
  upcomingPrintCued: upcoming.filter(l => ARTIST_MARKET[l.artist] === 'art' && l.category === 'original' && PRINT_CUES.test(l.title || '')).length,
  sample: aOut.slice(0, 12) }, null, 1));

// ── (b)+(c)+(d) on a 1500-anchor sample ──
const step = Math.max(1, Math.floor(artSold.length / 1500));
const sample = artSold.filter((_, i) => i % step === 0).slice(0, 1500);
const bPairs: any[] = []; const cPairs: any[] = [];
let flags = { total: 0, low: 0, lowBeat: 0, nonLow: 0, nonLowBeat: 0, kin0: 0, kin0Beat: 0 };
const allErrs: number[] = [];
for (const lot of sample) {
  const sold = soldFor(lot);
  const v0 = readV(lot, sold, {});
  if (!v0) continue;
  const e0 = err(lot, v0);
  allErrs.push(e0);
  // (b) form-path print with series token
  if (v0.kind === 'form' && v0.form === 'print' && seriesOf(lot.title)) {
    const v5 = readV(lot, sold, { requireSeriesForPrints: true });
    bPairs.push({ e0, e5: v5 ? err(lot, v5) : null, n0: v0.pool.length, n5: v5 ? v5.pool.length : 0 });
  }
  // (c) baseline pool contains an area-ratio>2.5 comp
  if (v0.maxAreaRatio !== null && v0.maxAreaRatio > 2.5) {
    const v2 = readV(lot, sold, { areaRatioMax: 2.5 });
    cPairs.push({ e0, e2: v2 ? err(lot, v2) : null });
  }
  // (d) flag-gate sim
  if (v0.ratio >= 1.3) {
    flags.total++;
    const beat = lot.priceUsd! >= v0.estMid;
    if (v0.conf === 'low') { flags.low++; if (beat) flags.lowBeat++; }
    else { flags.nonLow++; if (beat) flags.nonLowBeat++; }
    if (v0.kind === 'form' && v0.titleKin === 0) { flags.kin0++; if (beat) flags.kin0Beat++; }
  }
}
console.log(JSON.stringify({
  sample1500: { reads: allErrs.length, medAbsErr: medAbs(allErrs) },
  seriesHeadToHead: {
    anchors: bPairs.length,
    stillRead: bPairs.filter(p => p.e5 !== null).length,
    e0OnStillRead: medAbs(bPairs.filter(p => p.e5 !== null).map(p => p.e0)),
    e5OnStillRead: medAbs(bPairs.filter(p => p.e5 !== null).map(p => p.e5)),
    e0OnLost: medAbs(bPairs.filter(p => p.e5 === null).map(p => p.e0)),
    medPoolShrink: bPairs.filter(p => p.e5 !== null).length ? median(bPairs.filter(p => p.e5 !== null).map(p => p.n0 - p.n5).sort((a: number, b: number) => a-b)) : null,
  },
  areaHeadToHead: {
    anchors: cPairs.length,
    stillRead: cPairs.filter(p => p.e2 !== null).length,
    e0OnStillRead: medAbs(cPairs.filter(p => p.e2 !== null).map(p => p.e0)),
    e2OnStillRead: medAbs(cPairs.filter(p => p.e2 !== null).map(p => p.e2)),
    e0OnLost: medAbs(cPairs.filter(p => p.e2 === null).map(p => p.e0)),
  },
  flagGateSim: { ...flags,
    lowBeatPct: flags.low ? +(flags.lowBeat / flags.low * 100).toFixed(0) : null,
    nonLowBeatPct: flags.nonLow ? +(flags.nonLowBeat / flags.nonLow * 100).toFixed(0) : null,
    kin0BeatPct: flags.kin0 ? +(flags.kin0Beat / flags.kin0 * 100).toFixed(0) : null,
  },
}, null, 1));
