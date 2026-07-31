/** audit-pools.ts — per-vertical comp-pool purity audit over the live book.
 *  For every upcoming lot the client engine flags, rebuild its pool via
 *  signalWithPool and measure what's actually inside it. */
import * as fs from 'fs';
import { signalWithPool, classifyForm, parseDims } from '../../app/lib/comps';
import { ARTIST_MARKET } from '../../app/constants';
import type { AuctionLot } from '../../app/types';

const dir = 'public/data/ray';
const all: AuctionLot[] = [];
for (const f of fs.readdirSync(dir)) {
  if (!/^lots-\d+\.json$/.test(f)) continue;
  const chunk = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  all.push(...(Array.isArray(chunk) ? chunk : (chunk as any).lots || []));
}
const upRaw = JSON.parse(fs.readFileSync(`${dir}/upcoming.json`, 'utf8'));
const upcoming: AuctionLot[] = (upRaw.lots || upRaw.upcoming || upRaw).filter((l: any) => l.status === 'upcoming');
console.log(`corpus ${all.length} · upcoming ${upcoming.length}`);

const area = (l: AuctionLot) => { const d = parseDims(l.dimensions); return d ? d[0] * d[1] : null; };
const yearOf = (l: AuctionLot) => { const m = (l.year || '').match(/(\d{4})/); return m ? +m[1] : null; };

// print-cue sniff for art titles
const PRINT_CUES = /\bpl\.?\s*\d+|\bplate\b|,\s*from\s+[A-Z]|\bfrom the (portfolio|suite|series)\b|\bedition of\b|\bnumbered\b|\blithograph|\betching|\bscreenprint|\bpochoir|\bwoodcut|\baquatint/i;
const ORIG_CUES = /\boil on (canvas|linen|panel|board)|\bacrylic on canvas|\bunique\b/i;

type Row = Record<string, unknown>;
const perVert: Record<string, Row[]> = {};
let flagged = 0;

for (const lot of upcoming) {
  const res = signalWithPool(lot, all);
  if (!res || res.signal.label !== 'Below Market') continue;
  flagged++;
  const { signal, pool } = res;
  const vert = ARTIST_MARKET[lot.artist] || 'other';
  const aCat = lot.category;
  const aForm = classifyForm(lot);
  const aArea = area(lot);
  const aYear = yearOf(lot);
  const catMatch = pool.filter(p => p.category === aCat).length / pool.length;
  const formMatch = pool.filter(p => classifyForm(p) === aForm).length / pool.length;
  const areaRatios = aArea ? pool.map(p => { const b = area(p); return b ? Math.max(aArea / b, b / aArea) : null; }).filter((x): x is number => x != null) : [];
  const maxAreaRatio = areaRatios.length ? Math.max(...areaRatios) : null;
  const dimsCoverage = pool.filter(p => parseDims(p.dimensions)).length / pool.length;
  const yearGaps = aYear ? pool.map(p => { const y = yearOf(p); return y ? Math.abs(y - aYear) : null; }).filter((x): x is number => x != null) : [];
  const medYearGap = yearGaps.length ? yearGaps.sort((a, b) => a - b)[Math.floor(yearGaps.length / 2)] : null;
  const prices = pool.map(p => p.priceUsd!).sort((a, b) => a - b);
  const playerMatch = (lot as any).playerSlug ? pool.filter(p => (p as any).playerSlug === (lot as any).playerSlug).length / pool.length : null;
  const objTypeMatch = (lot as any).objectType ? pool.filter(p => (p as any).objectType === (lot as any).objectType).length / pool.length : null;
  (perVert[vert] ||= []).push({
    id: lot.id, artist: lot.artist, cat: aCat, form: aForm,
    title: lot.title.slice(0, 70),
    est: [lot.estimateLow, lot.estimateHigh], pct: signal.pct, conf: signal.confidence, kind: signal.kind,
    n: pool.length, med: signal.med,
    catMatch: +catMatch.toFixed(2), formMatch: +formMatch.toFixed(2),
    maxAreaRatio: maxAreaRatio && +maxAreaRatio.toFixed(1), dimsCoverage: +dimsCoverage.toFixed(2),
    medYearGap, playerMatch, objTypeMatch,
    priceMin: prices[0], priceMax: prices[prices.length - 1],
    poolSample: pool.slice(0, 8).map(p => ({ id: p.id, cat: p.category, t: p.title.slice(0, 55), usd: p.priceUsd, dims: p.dimensions?.slice(0, 30) || null, y: p.year })),
  });
}

// misclassification sniff across the whole corpus (art makers only)
const artMakers = new Set(Object.entries(ARTIST_MARKET).filter(([, m]) => m === 'art').map(([k]) => k));
let printCuedOriginals = 0, origCuedPrints = 0;
const sniffSamples: Row[] = [];
for (const l of all) {
  if (!artMakers.has(l.artist)) continue;
  if (l.category === 'original' && PRINT_CUES.test(l.title)) {
    printCuedOriginals++;
    if (sniffSamples.length < 25) sniffSamples.push({ id: l.id, cat: l.category, t: l.title.slice(0, 80) });
  } else if (l.category === 'print' && ORIG_CUES.test(l.title)) origCuedPrints++;
}

const summary: Row = { flagged, printCuedOriginals, origCuedPrints };
for (const [v, rows] of Object.entries(perVert)) {
  const avg = (k: string) => { const xs = rows.map(r => r[k]).filter((x): x is number => typeof x === 'number'); return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null; };
  summary[v] = {
    flags: rows.length,
    byConf: rows.reduce((m: Record<string, number>, r) => { m[r.conf as string] = (m[r.conf as string] || 0) + 1; return m; }, {}),
    avgCatMatch: avg('catMatch'), avgFormMatch: avg('formMatch'),
    avgDims: avg('dimsCoverage'), worstAreaRatio: Math.max(0, ...rows.map(r => (r.maxAreaRatio as number) || 0)),
    avgPlayerMatch: avg('playerMatch'), avgObjTypeMatch: avg('objTypeMatch'),
  };
  fs.writeFileSync(`scripts/_qa/audit-${v}.json`, JSON.stringify(rows, null, 1));
}
fs.writeFileSync('scripts/_qa/audit-summary.json', JSON.stringify({ summary, sniffSamples }, null, 1));
console.log(JSON.stringify(summary, null, 1));
