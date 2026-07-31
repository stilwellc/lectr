/** audit2 — sold-anchor sampling: measure gate quality per vertical where the
 *  live book has no flags. Estimate verticals → signalWithPool; sports/science
 *  objects → soldCompBand pool purity. Deterministic sampling (every k-th). */
import * as fs from 'fs';
import { signalWithPool, soldCompBand, classifyForm, parseDims } from '../../app/lib/comps';
import { ARTIST_MARKET } from '../../app/constants';
import type { AuctionLot } from '../../app/types';

const dir = 'public/data/ray';
const all: AuctionLot[] = [];
for (const f of fs.readdirSync(dir)) {
  if (!/^lots-\d+\.json$/.test(f)) continue;
  const chunk = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  all.push(...(Array.isArray(chunk) ? chunk : (chunk as any).lots || []));
}
const area = (l: AuctionLot) => { const d = parseDims(l.dimensions); return d ? d[0] * d[1] : null; };

// ── A: estimate verticals via signalWithPool on sold anchors ──
const estVerts: Record<string, Row[]> = {};
type Row = Record<string, unknown>;
const soldWithEst = all.filter(l => l.status === 'sold' && l.priceUsd && (l.estLowUsd ?? l.estimateLow) && (l.estHighUsd ?? l.estimateHigh));
const byVert: Record<string, AuctionLot[]> = {};
for (const l of soldWithEst) {
  const v = ARTIST_MARKET[l.artist];
  if (!v || v === 'sports') continue;
  (byVert[v] ||= []).push(l);
}
for (const [v, lots] of Object.entries(byVert)) {
  const step = Math.max(1, Math.floor(lots.length / 150));
  const sample = lots.filter((_, i) => i % step === 0).slice(0, 150);
  const rows: Row[] = [];
  let flags = 0;
  for (const lot of sample) {
    const res = signalWithPool(lot, all);
    if (!res) continue;
    const { signal, pool } = res;
    if (signal.label === 'Below Market') flags++;
    const aArea = area(lot);
    const ratios = aArea ? pool.map(p => { const b = area(p); return b ? Math.max(aArea/b, b/aArea) : null; }).filter((x): x is number => x != null) : [];
    rows.push({
      id: lot.id, conf: signal.confidence, label: signal.label, pct: signal.pct, n: pool.length,
      catMatch: +(pool.filter(p => p.category === lot.category).length / pool.length).toFixed(2),
      dimsCov: +(pool.filter(p => parseDims(p.dimensions)).length / pool.length).toFixed(2),
      maxAreaRatio: ratios.length ? +Math.max(...ratios).toFixed(1) : null,
      // hindsight: did the lot actually SELL near the pool median?
      realized: lot.priceUsd, med: signal.med,
      err: signal.med ? +((lot.priceUsd! - signal.med) / signal.med).toFixed(2) : null,
    });
  }
  const errs = rows.map(r => r.err).filter((x): x is number => typeof x === 'number').map(Math.abs).sort((a,b)=>a-b);
  estVerts[v] = [{ sampled: sample.length, reads: rows.length, belowFlags: flags,
    medAbsErr: errs.length ? errs[Math.floor(errs.length/2)] : null } as Row, ...rows.slice(0, 40)];
  fs.writeFileSync(`scripts/_qa/audit2-${v}.json`, JSON.stringify(rows, null, 1));
}

// ── B: sports/science objects via soldCompBand ──
const objSlugs = ['game-used', 'trophies-awards', 'tickets-passes', 'space-exploration', 'meteorites', 'fossils', 'scientific-instruments'];
const objOut: Record<string, Row> = {};
for (const slug of objSlugs) {
  const lots = all.filter(l => l.artist === slug && l.status === 'sold' && l.priceUsd);
  const step = Math.max(1, Math.floor(lots.length / 120));
  const sample = lots.filter((_, i) => i % step === 0).slice(0, 120);
  let bands = 0; const rows: Row[] = [];
  for (const lot of sample) {
    const band: any = soldCompBand(lot, all);
    if (!band || !band.pool) { continue; }
    bands++;
    const pool: AuctionLot[] = band.pool;
    const objType = (lot as any).objectType;
    rows.push({
      id: lot.id, t: lot.title.slice(0, 60), objType,
      n: pool.length,
      typeMatch: objType ? +(pool.filter(p => (p as any).objectType === objType).length / pool.length).toFixed(2) : null,
      yearMatch: (lot as any).sportYear ? +(pool.filter(p => (p as any).sportYear === (lot as any).sportYear).length / pool.length).toFixed(2) : null,
      realized: lot.priceUsd,
      bandLo: band.lo ?? band.low ?? null, bandHi: band.hi ?? band.high ?? null, bandMed: band.med ?? null,
      poolSample: pool.slice(0, 6).map(p => ({ t: p.title.slice(0, 50), type: (p as any).objectType, usd: p.priceUsd })),
    });
  }
  const tm = rows.map(r => r.typeMatch).filter((x): x is number => typeof x === 'number');
  objOut[slug] = { sampled: sample.length, bands, avgTypeMatch: tm.length ? +(tm.reduce((a,b)=>a+b,0)/tm.length).toFixed(2) : null };
  fs.writeFileSync(`scripts/_qa/audit2-obj-${slug}.json`, JSON.stringify(rows, null, 1));
}
console.log(JSON.stringify({ est: Object.fromEntries(Object.entries(estVerts).map(([k, v]) => [k, v[0]])), obj: objOut }, null, 1));
