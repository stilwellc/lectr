/** art-5-components — separate the FINAL package components:
 *  (i) sniff-only (no series abstain): sniff-cohort reads/err/flags/beat
 *  (ii) series-abstain-only on 1500: which reads are lost, their err and their
 *       flags' beat rate (were the abstained reads' flags honest?) */
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
interface Opts { sniff?: boolean; area25?: boolean; seriesAbstain?: boolean; }
function formV(l: AuctionLot, opts: Opts): Form {
  const base = ((l as any).formKey as Form | undefined) ?? classifyForm(l);
  if (opts.sniff && l.category === 'original' && ORIGINAL_FORMS.has(base) && PRINT_CUES.test(l.title || '')) return 'print';
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
  if (pool.length === 0) {
    const da = parseDims(lot.dimensions);
    const areaMax = opts.area25 ? 2.5 : 4;
    const sa = seriesOf(lot.title);
    pool = sold.filter(c => {
      if (formV(c, opts) !== form) return false;
      if (da) {
        const db = parseDims(c.dimensions);
        if (db) { const A = da[0]*da[1], B = db[0]*db[1]; if (A > 0 && B > 0 && (A/B > areaMax || B/A > areaMax)) return false; }
      }
      return true;
    });
    if (opts.seriesAbstain && form === 'print' && sa) {
      const sameSeries = pool.filter(c => seriesOf(c.title) === sa).length;
      if (sameSeries < 3) return null;
    }
    if (pool.length > 24) {
      const words = new Set(nt.split(' ').filter(w => w.length > 3));
      const overlap = (l: AuctionLot) => { let n = 0; for (const x of normalizeTitle(l.title).split(' ')) if (words.has(x)) n++; return n; };
      pool = pool.map(l => [overlap(l), new Date(l.saleDate).getTime(), l] as const).sort((a,b)=>(b[0]-a[0])||(b[1]-a[1])).slice(0,24).map(s=>s[2]);
    }
  }
  if (pool.length < 3) return null;
  const prices = pool.map(l => l.priceUsd!).sort((a,b)=>a-b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length*0.25)], q3 = prices[Math.floor(prices.length*0.75)];
  const spread = med > 0 ? (q3-q1)/med : 99;
  if (spread > 2.5) return null;
  if (kind === 'form' && med > 0 && (med > estMid*5 || med < estMid/5)) return null;
  return { pool, med, kind, form, estMid, ratio: med/estMid };
}
const soldByArtist: Record<string, AuctionLot[]> = {};
for (const l of all) if (l.status === 'sold' && l.priceUsd && (l as any).source !== 'sothebys-algolia') (soldByArtist[l.artist] ||= []).push(l);
const soldFor = (lot: AuctionLot) => (soldByArtist[lot.artist] || []).filter(l => l.id !== lot.id);
const artSold = all.filter(l => ARTIST_MARKET[l.artist] === 'art' && l.status === 'sold' && l.priceUsd && ((l as any).estLowUsd ?? l.estimateLow) && ((l as any).estHighUsd ?? l.estimateHigh));

// (i) sniff cohort under sniff-only and sniff+area25
const sniffAnchors = artSold.filter(l => l.category === 'original' && PRINT_CUES.test(l.title || '') && ORIGINAL_FORMS.has(((l as any).formKey as Form) ?? classifyForm(l)));
for (const [name, opts] of [['sniffOnly', { sniff: true }], ['sniff+area25', { sniff: true, area25: true }]] as [string, Opts][]) {
  let reads = 0, flags = 0, beat = 0; const errs: number[] = [];
  for (const lot of sniffAnchors) {
    const r = readV(lot, soldFor(lot), opts);
    if (!r) continue;
    reads++; errs.push((lot.priceUsd! - r.med) / r.med);
    if (r.ratio >= 1.3) { flags++; if (lot.priceUsd! >= r.estMid) beat++; }
  }
  console.log(JSON.stringify({ cohort: name, anchors: sniffAnchors.length, reads, medAbsErr: medAbs(errs), flags, flagBeatPct: flags ? +(beat/flags*100).toFixed(0) : null }));
}

// (ii) series-abstain-only on 1500: characterize the LOST reads
const step = Math.max(1, Math.floor(artSold.length / 1500));
const sample = artSold.filter((_, i) => i % step === 0).slice(0, 1500);
let lost = 0, lostFlags = 0, lostFlagBeat = 0, keptReads = 0;
const lostErrs: number[] = [];
for (const lot of sample) {
  const sold = soldFor(lot);
  const v0 = readV(lot, sold, {});
  if (!v0) continue;
  const vs = readV(lot, sold, { seriesAbstain: true });
  if (vs) { keptReads++; continue; }
  lost++;
  const e = (lot.priceUsd! - v0.med) / v0.med;
  lostErrs.push(e);
  if (v0.ratio >= 1.3) { lostFlags++; if (lot.priceUsd! >= v0.estMid) lostFlagBeat++; }
}
console.log(JSON.stringify({ seriesAbstainOnly: { baselineReads: keptReads + lost, lostReads: lost, lostMedAbsErr: medAbs(lostErrs), lostFlags, lostFlagBeatPct: lostFlags ? +(lostFlagBeat/lostFlags*100).toFixed(0) : null } }));
