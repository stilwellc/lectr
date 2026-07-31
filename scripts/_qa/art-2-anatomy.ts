/** art-2-anatomy — where does the 0.43–0.46 hindsight error actually live?
 *  Noise floor of edition (repeat-sale) pools, error by confidence/spread/
 *  titleKin/pool-age, series-token stats for prints, dims coverage asymmetry
 *  (sold archive vs live book), and the area>2.5 subset under the tighter gate. */
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
function median(sorted: number[]) { const m = Math.floor(sorted.length / 2); return sorted.length % 2 === 0 ? (sorted[m-1]+sorted[m])/2 : sorted[m]; }
const medAbs = (errs: number[]) => { const a = errs.map(Math.abs).sort((x,y)=>x-y); return a.length ? +a[Math.floor(a.length/2)].toFixed(3) : null; };
const formOf = (l: AuctionLot): Form => ((l as any).formKey as Form | undefined) ?? classifyForm(l);
const seriesOf = (title: string | null | undefined): string | null => {
  const m = (title || '').match(/(?:,|\s)from\s+(?:the\s+)?(.{3,50}?)(?:\s*\(|,|\s*\d*\s*$)/i);
  if (!m) return null;
  const s = normalizeTitle(m[1]);
  return s.length >= 3 ? s : null;
};

const artSold = all.filter(l => ARTIST_MARKET[l.artist] === 'art' && l.status === 'sold' && l.priceUsd && ((l as any).estLowUsd ?? l.estimateLow) && ((l as any).estHighUsd ?? l.estimateHigh));
const artAllSold = all.filter(l => ARTIST_MARKET[l.artist] === 'art' && l.status === 'sold' && l.priceUsd);
const artUpcoming = upcoming.filter(l => ARTIST_MARKET[l.artist] === 'art');

// ── A · repeat-sale NOISE FLOOR: same normalized title, same form, >=4 sales ──
// leave-one-out error of each sale vs the median of the others = the error an
// ORACLE comp engine (perfect pooling) would still make.
const byTitle: Record<string, AuctionLot[]> = {};
for (const l of artAllSold) {
  const nt = normalizeTitle(l.title);
  const toks = nt.split(' ').filter(w => w.length >= 3).length;
  if (nt.length >= 8 && toks >= 2) (byTitle[`${l.artist}|${nt}|${formOf(l)}`] ||= []).push(l);
}
const looErrs: number[] = [];
let editionGroups = 0;
for (const g of Object.values(byTitle)) {
  if (g.length < 4) continue;
  editionGroups++;
  for (const l of g) {
    const others = g.filter(x => x.id !== l.id).map(x => x.priceUsd!).sort((a,b)=>a-b);
    const m = median(others);
    if (m > 0) looErrs.push((l.priceUsd! - m) / m);
  }
}
console.log(JSON.stringify({ noiseFloor: { editionGroups, sales: looErrs.length, medAbsLOOErr: medAbs(looErrs) } }));

// ── B · error anatomy on the 600 sample (reuse decompose baseline pools) ──
// re-run V0 read with extra pool stats
import { comparableTo } from '../../app/lib/comps';
const soldByArtist: Record<string, AuctionLot[]> = {};
for (const l of all) if (l.status === 'sold' && l.priceUsd && (l as any).source !== 'sothebys-algolia') (soldByArtist[l.artist] ||= []).push(l);
const step600 = Math.max(1, Math.floor(artSold.length / 600));
const sample600 = artSold.filter((_, i) => i % step600 === 0).slice(0, 600);

type Row = { err: number; flagged: boolean; kind: string; conf: string; spread: number; n: number; titleKin: number; medCompAgeYr: number | null; form: Form; seriesFrac: number | null; anchorSeries: boolean; realized: number; med: number; estMid: number };
const rows: Row[] = [];
for (const lot of sample600) {
  const sold = (soldByArtist[lot.artist] || []).filter(l => l.id !== lot.id);
  const estLow = (lot as any).estLowUsd ?? lot.estimateLow, estHigh = (lot as any).estHighUsd ?? lot.estimateHigh;
  const estMid = (estLow + estHigh) / 2;
  const form = formOf(lot);
  if (form === 'unknown') continue;
  const nt = normalizeTitle(lot.title);
  let pool: AuctionLot[] = []; let kind: 'edition' | 'form' = 'form';
  const toks = nt.split(' ').filter(w => w.length >= 3).length;
  if (nt.length >= 8 && toks >= 2) {
    const sameTitle = sold.filter(l => normalizeTitle(l.title) === nt && formOf(l) === form);
    if (sameTitle.length >= 3) {
      const em = lot.estimateLow && lot.estimateHigh ? (lot.estimateLow + lot.estimateHigh) / 2 : 0;
      const m = median(sameTitle.map(l => l.priceUsd!).slice().sort((a,b)=>a-b));
      if (!em || (m <= em * 5 && m >= em / 5)) { pool = sameTitle; kind = 'edition'; }
    }
  }
  if (pool.length === 0) {
    pool = sold.filter(comparableTo(lot));
    if (pool.length > 24) {
      const words = new Set(nt.split(' ').filter(w => w.length > 3));
      const overlap = (l: AuctionLot) => { let n = 0; for (const x of normalizeTitle(l.title).split(' ')) if (words.has(x)) n++; return n; };
      pool = pool.map(l => [overlap(l), new Date(l.saleDate).getTime(), l] as const).sort((a,b)=>(b[0]-a[0])||(b[1]-a[1])).slice(0,24).map(s=>s[2]);
    }
  }
  if (pool.length < 3) continue;
  const prices = pool.map(l => l.priceUsd!).sort((a,b)=>a-b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length*0.25)], q3 = prices[Math.floor(prices.length*0.75)];
  const spread = med > 0 ? (q3-q1)/med : 99;
  if (spread > 2.5) continue;
  if (kind === 'form' && med > 0 && (med > estMid*5 || med < estMid/5)) continue;
  const words = new Set(nt.split(' ').filter(w => w.length > 3));
  const titleKin = words.size === 0 ? 0 : pool.filter(l => { let h = 0; for (const w of normalizeTitle(l.title).split(' ')) if (words.has(w)) h++; return h >= 2; }).length;
  const conf = kind === 'edition' ? 'very-high' : (pool.length >= 12 && spread <= 1.0) || (titleKin >= 6 && spread <= 1.5) ? 'high' : pool.length >= 6 && spread <= 1.8 ? 'medium' : 'low';
  const anchorT = new Date(lot.saleDate).getTime();
  const ages = pool.map(l => (anchorT - new Date(l.saleDate).getTime()) / (365.25*24*3600e3)).sort((a,b)=>a-b);
  const sa = seriesOf(lot.title);
  const seriesFrac = form === 'print' && sa ? +(pool.filter(l => seriesOf(l.title) === sa).length / pool.length).toFixed(2) : null;
  rows.push({ err: (lot.priceUsd! - med) / med, flagged: med/estMid >= 1.3, kind, conf, spread, n: pool.length, titleKin, medCompAgeYr: ages.length ? +median(ages).toFixed(1) : null, form, seriesFrac, anchorSeries: !!sa, realized: lot.priceUsd!, med, estMid });
}
const grp = (name: string, f: (r: Row) => boolean) => {
  const g = rows.filter(f);
  const flags = g.filter(r => r.flagged);
  // flag honesty: among flagged, did realized actually beat estMid?
  const beat = flags.filter(r => r.realized >= r.estMid * 1.0).length;
  return { name, n: g.length, medAbsErr: medAbs(g.map(r => r.err)), flags: flags.length, flagBeatEstPct: flags.length ? +(beat / flags.length * 100).toFixed(0) : null };
};
console.log(JSON.stringify({ anatomy: {
  total: grp('all', () => true),
  byConf: ['very-high','high','medium','low'].map(c => grp(c, r => r.conf === c)),
  bySpread: [grp('spread<=0.6', r => r.spread <= 0.6), grp('0.6<spread<=1.2', r => r.spread > 0.6 && r.spread <= 1.2), grp('1.2<spread<=1.8', r => r.spread > 1.2 && r.spread <= 1.8), grp('spread>1.8', r => r.spread > 1.8)],
  byKin: [grp('form titleKin>=6', r => r.kind==='form' && r.titleKin >= 6), grp('form titleKin 1-5', r => r.kind==='form' && r.titleKin >= 1 && r.titleKin < 6), grp('form titleKin 0', r => r.kind==='form' && r.titleKin === 0)],
  byAge: [grp('poolAge<=1y', r => r.medCompAgeYr !== null && r.medCompAgeYr <= 1), grp('1-3y', r => r.medCompAgeYr !== null && r.medCompAgeYr > 1 && r.medCompAgeYr <= 3), grp('>3y', r => r.medCompAgeYr !== null && r.medCompAgeYr > 3)],
  printsSeries: [
    grp('print anchor has series token', r => r.form === 'print' && r.anchorSeries),
    grp('print form-pool seriesFrac>=0.5', r => r.kind === 'form' && r.seriesFrac !== null && r.seriesFrac >= 0.5),
    grp('print form-pool seriesFrac<0.5', r => r.kind === 'form' && r.seriesFrac !== null && r.seriesFrac < 0.5),
    grp('print form-pool no anchor series', r => r.kind === 'form' && r.form === 'print' && !r.anchorSeries),
  ],
} }, null, 1));

// ── C · dims + attribute coverage asymmetry ──
const cov = (lots: AuctionLot[]) => ({
  n: lots.length,
  dims: +(lots.filter(l => parseDims(l.dimensions)).length / Math.max(1, lots.length)).toFixed(3),
  year: +(lots.filter(l => (l as any).yearNum || (l.year || '').match(/\d{4}/)).length / Math.max(1, lots.length)).toFixed(3),
  printCuedOriginals: lots.filter(l => l.category === 'original' && PRINT_CUES.test(l.title || '')).length,
});
console.log(JSON.stringify({ coverage: {
  artSoldWithEst: cov(artSold),
  artSoldPrints: cov(artSold.filter(l => formOf(l) === 'print')),
  artUpcoming: cov(artUpcoming),
  artUpcomingByForm: Object.entries(artUpcoming.reduce((m, l) => { const f = formOf(l); (m[f] ||= []).push(l); return m; }, {} as Record<string, AuctionLot[]>)).map(([f, g]) => ({ form: f, ...cov(g) })).filter(x => x.n >= 5),
} }, null, 1));
