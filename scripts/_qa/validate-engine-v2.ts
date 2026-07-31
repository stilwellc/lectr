import * as fs from 'fs';
import { signalWithPool, soldCompBand, appraiseLot, scienceReferenceBand, cultureReferenceBand, classifyForm } from '../../app/lib/comps';
import { normalizeCorpus } from '../../scripts/lib/corpus-normalize';
import { ARTIST_MARKET } from '../../app/constants';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
normalizeCorpus(all); // the healed corpus the nightly will ship
const med = (xs: number[]) => { const s = xs.slice().sort((a,b)=>a-b); const m = Math.floor(s.length/2); return s.length ? (s.length%2 ? s[m] : (s[m-1]+s[m])/2) : NaN; };

// ── game-used bands (spec: 190±10 of 300, err.med ≤ 0.37) ──
const gu = all.filter(l => l.artist === 'game-used' && l.category === 'object' && l.status === 'sold' && l.priceUsd);
const guStep = Math.max(1, Math.floor(gu.length / 300));
const guSample = gu.filter((_, i) => i % guStep === 0).slice(0, 300);
let guBands = 0; const guErrs: number[] = [];
for (const lot of guSample) {
  const b: any = soldCompBand(lot, all);
  if (b && (b.med ?? b.median)) { guBands++; const m0 = b.med ?? b.median; guErrs.push(Math.abs((lot.priceUsd! - m0) / m0)); }
}
console.log(`GAME-USED: bands ${guBands}/300 · err.med ${med(guErrs).toFixed(3)}`);

// ── estimate verticals (150 sold anchors each): reads + hindsight err ──
for (const vert of ['art', 'watches', 'design']) {
  const lots = all.filter(l => ARTIST_MARKET[l.artist] === vert && l.status === 'sold' && l.priceUsd && (l.estLowUsd ?? l.estimateLow) && (l.estHighUsd ?? l.estimateHigh));
  const st = Math.max(1, Math.floor(lots.length / 150));
  const sample = lots.filter((_, i) => i % st === 0).slice(0, 150);
  let reads = 0, flags = 0; const errs: number[] = [];
  for (const lot of sample) {
    const r = signalWithPool(lot, all);
    const ap = appraiseLot(lot, all);
    if (ap) { reads++; errs.push(Math.abs((lot.priceUsd! - ap.value) / ap.value)); }
    if (r && r.signal.label === 'Below Market') flags++;
  }
  console.log(`${vert.toUpperCase()}: reads ${reads}/150 · flags ${flags} · medAbsErr ${med(errs).toFixed(3)}`);
}

// ── science reference coverage (spec: ~38.5% of eligible sold) ──
const sciSlugs = ['meteorites', 'fossils', 'scientific-instruments', 'space-exploration'];
let sciElig = 0, sciBands = 0; const sciErrs: number[] = [];
for (const lot of all) {
  if (!sciSlugs.includes(lot.artist) || lot.category !== 'object' || lot.status !== 'sold' || !lot.priceUsd) continue;
  sciElig++;
  const b = scienceReferenceBand(lot, all);
  if (b) { sciBands++; sciErrs.push(Math.abs((lot.priceUsd! - b.med) / b.med)); }
}
console.log(`SCIENCE ref: ${sciBands}/${sciElig} (${(100*sciBands/sciElig).toFixed(1)}%) · med|err| ${med(sciErrs).toFixed(2)} · within±100% ${(100*sciErrs.filter(e=>e<=1).length/sciErrs.length).toFixed(0)}%`);

// ── culture: engine reads must be 0; reference bands present ──
const cultSlugs = ['movie-tv', 'music-memorabilia', 'entertainment-memorabilia'];
const cult = all.filter(l => cultSlugs.includes(l.artist) && l.status === 'sold' && l.priceUsd);
const cuStep = Math.max(1, Math.floor(cult.length / 400));
const cuSample = cult.filter((_, i) => i % cuStep === 0).slice(0, 400);
let cuEngine = 0, cuBands = 0; const cuErrs: number[] = [];
for (const lot of cuSample) {
  if (appraiseLot(lot, all)) cuEngine++;
  const b = cultureReferenceBand(lot, all);
  if (b) { cuBands++; cuErrs.push(Math.abs((lot.priceUsd! - b.med) / b.med)); }
}
console.log(`CULTURE: engine reads ${cuEngine}/400 (must be 0) · ref bands ${cuBands}/400 · med|err| ${med(cuErrs).toFixed(2)}`);

// ── the Matisse Jazz plate: healed + never flags ──
const mat = all.find(l => l.id === 'bonhams-32662-178')!;
const mr = signalWithPool(mat, all);
const ma = appraiseLot(mat, all);
console.log(`MATISSE: cat=${mat.category} reclass=${(mat as any).catReclass} · flag=${mr ? mr.signal.label : 'none'} · appraise=${ma ? Math.round(ma.value) + ' (' + ma.confidence + ')' : 'none'}`);

// ── live-book flags before/after basis ──
const up = JSON.parse(fs.readFileSync('public/data/ray/upcoming.json', 'utf8'));
const upl: AuctionLot[] = (up.lots || up).filter((l: AuctionLot) => l.status === 'upcoming');
normalizeCorpus(upl as AuctionLot[]);
let liveFlags = 0;
for (const lot of upl) { const r = signalWithPool(lot, all); if (r && r.signal.label === 'Below Market') liveFlags++; }
console.log(`LIVE BOOK: Below Market flags now ${liveFlags} (was 20 pre-spec)`);
