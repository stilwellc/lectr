/** art-1-decompose — reimplement compPoolRead with variant toggles, verify the
 *  reimplementation matches the shipped engine on the audit2 sample, then
 *  attribute the 0.46 medAbsErr to: size-unmatched comps, year-distant comps,
 *  edition-size differences, category mislabels (print-cued originals). */
import * as fs from 'fs';
import { signalWithPool, classifyForm, parseDims, normalizeTitle, comparableTo, Form } from '../../app/lib/comps';
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

const yearOf = (l: AuctionLot) => {
  if (typeof (l as any).yearNum === 'number') return (l as any).yearNum;
  const m = (l.year || '').match(/(\d{4})/); return m ? +m[1] : null;
};
const edSizeOf = (l: AuctionLot) => {
  const s = `${l.title || ''} ${(l as any).medium || ''}`;
  const m = s.match(/edition of (\d+)/i) || s.match(/\b\d{1,3}\s*\/\s*(\d{1,4})\b/);
  return m ? +m[1] : null;
};
function median(sorted: number[]) { const m = Math.floor(sorted.length / 2); return sorted.length % 2 === 0 ? (sorted[m-1]+sorted[m])/2 : sorted[m]; }
const medAbs = (errs: number[]) => { const a = errs.map(Math.abs).sort((x,y)=>x-y); return a.length ? +a[Math.floor(a.length/2)].toFixed(3) : null; };

interface Opts {
  requireDimsWhenAnchorHas?: boolean;  // V1
  areaRatioMax?: number;               // default 4; V2 = 2.5
  yearBandOriginals?: number | null;   // V3: ±N years, opportunistic (both sides have year)
  yearBandRequired?: boolean;          // V3b: anchor has year → comp must have year in band
  printSniff?: boolean;                // V4: reclass print-cued 'original' lots to form 'print'
  requireSeriesForPrints?: boolean;    // Q2: anchor print w/ series token → comps must share it
}

const seriesOf = (title: string | null | undefined): string | null => {
  const m = (title || '').match(/(?:,|\s)from\s+(?:the\s+)?(.{3,50}?)(?:\s*\(|,|\s*\d*\s*$)/i);
  if (!m) return null;
  const s = normalizeTitle(m[1]);
  return s.length >= 3 ? s : null;
};

function formV(l: AuctionLot, opts: Opts): Form {
  const base = ((l as any).formKey as Form | undefined) ?? classifyForm(l);
  if (opts.printSniff && l.category === 'original' && ORIGINAL_FORMS.has(base) && PRINT_CUES.test(l.title || '')) return 'print';
  return base;
}

/** Variant-aware compPoolRead clone (art path only: no watches/sports lots in sample). */
function readV(lot: AuctionLot, sold: AuctionLot[], opts: Opts) {
  const estLow = (lot as any).estLowUsd ?? lot.estimateLow;
  const estHigh = (lot as any).estHighUsd ?? lot.estimateHigh;
  if (!estLow || !estHigh) return null;
  const form = formV(lot, opts);
  if (form === 'unknown') return null;
  const estMid = (estLow + estHigh) / 2;

  const nt = normalizeTitle(lot.title);
  let pool: AuctionLot[] = [];
  let kind: 'edition' | 'form' = 'form';
  const distinctiveTokens = nt.split(' ').filter(w => w.length >= 3).length;
  if (nt.length >= 8 && distinctiveTokens >= 2) {
    const sameTitle = sold.filter(l => normalizeTitle(l.title) === nt && formV(l, opts) === form);
    if (sameTitle.length >= 3) {
      const em = lot.estimateLow && lot.estimateHigh ? (lot.estimateLow + lot.estimateHigh) / 2 : 0;
      const m = median(sameTitle.map(l => l.priceUsd!).slice().sort((a,b)=>a-b));
      if (!em || (m <= em * 5 && m >= em / 5)) { pool = sameTitle; kind = 'edition'; }
    }
  }

  if (pool.length === 0) {
    const da = parseDims(lot.dimensions);
    const ya = yearOf(lot);
    const sa = seriesOf(lot.title);
    const areaMax = opts.areaRatioMax ?? 4;
    pool = sold.filter(c => {
      if (formV(c, opts) !== form) return false;
      if (da) {
        const db = parseDims(c.dimensions);
        if (!db) { if (opts.requireDimsWhenAnchorHas) return false; }
        else {
          const areaA = da[0]*da[1], areaB = db[0]*db[1];
          if (areaA > 0 && areaB > 0 && (areaA/areaB > areaMax || areaB/areaA > areaMax)) return false;
        }
      }
      if (opts.yearBandOriginals && ORIGINAL_FORMS.has(form) && ya) {
        const yb = yearOf(c);
        if (!yb) { if (opts.yearBandRequired) return false; }
        else if (Math.abs(ya - yb) > opts.yearBandOriginals) return false;
      }
      if (opts.requireSeriesForPrints && form === 'print' && sa) {
        const sb = seriesOf(c.title);
        if (sb !== sa) return false;
      }
      return true;
    });
    if (pool.length > 24) {
      const words = new Set(nt.split(' ').filter(w => w.length > 3));
      const overlap = (l: AuctionLot) => { let n = 0; for (const x of normalizeTitle(l.title).split(' ')) if (words.has(x)) n++; return n; };
      pool = pool.map(l => [overlap(l), new Date(l.saleDate).getTime(), l] as const)
        .sort((a,b) => (b[0]-a[0]) || (b[1]-a[1])).slice(0, 24).map(s => s[2]);
    }
  }
  if (pool.length < 3) return null;
  const prices = pool.map(l => l.priceUsd!).sort((a,b)=>a-b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length*0.25)], q3 = prices[Math.floor(prices.length*0.75)];
  if (med > 0 && (q3-q1)/med > 2.5) return null;
  if (kind === 'form' && med > 0 && (med > estMid*5 || med < estMid/5)) return null;
  const ratio = med / estMid;
  return { pool, med, kind, form, estMid, ratio, flagged: ratio >= 1.3 };
}

// ── build art sold-anchor samples ──
const soldWithEst = all.filter(l => l.status === 'sold' && l.priceUsd && ((l as any).estLowUsd ?? l.estimateLow) && ((l as any).estHighUsd ?? l.estimateHigh));
const artSold = soldWithEst.filter(l => ARTIST_MARKET[l.artist] === 'art');
const step150 = Math.max(1, Math.floor(artSold.length / 150));
const sample150 = artSold.filter((_, i) => i % step150 === 0).slice(0, 150);
const step600 = Math.max(1, Math.floor(artSold.length / 600));
const sample600 = artSold.filter((_, i) => i % step600 === 0).slice(0, 600);

// per-artist sold index (excluding algolia) for speed
const soldByArtist: Record<string, AuctionLot[]> = {};
for (const l of all) {
  if (l.status === 'sold' && l.priceUsd && (l as any).source !== 'sothebys-algolia') (soldByArtist[l.artist] ||= []).push(l);
}
const soldFor = (lot: AuctionLot) => (soldByArtist[lot.artist] || []).filter(l => l.id !== lot.id);

// ── 0 · verify clone matches shipped engine on the 150 sample ──
let matches = 0, mismatches = 0, shippedReads = 0, cloneReads = 0;
const shippedErrs: number[] = [];
for (const lot of sample150) {
  const s = signalWithPool(lot, all);
  const c = readV(lot, soldFor(lot), {});
  const cSignal = c && (c.ratio >= 1.3 || c.ratio <= 0.75) ? c : null;
  if (s) { shippedReads++; shippedErrs.push((lot.priceUsd! - s.signal.med!) / s.signal.med!); }
  if (cSignal) cloneReads++;
  if (!!s === !!cSignal && (!s || Math.abs(s.signal.med! - cSignal!.med) < 1)) matches++; else mismatches++;
}
console.log(JSON.stringify({ verify: { sample: sample150.length, shippedReads, cloneReads, matches, mismatches, shippedMedAbsErr: medAbs(shippedErrs) } }));

// ── 1 · baseline decomposition on the 600 sample ──
type Attr = { err: number; flagged: boolean; kind: string; form: Form; anchorPrintCued: boolean; dimsCov: number | null; maxAreaRatio: number | null; fracYearFar: number | null; edMismatch: boolean | null; n: number };
const rows: Attr[] = [];
for (const lot of sample600) {
  const r = readV(lot, soldFor(lot), {});
  if (!r) continue;
  const err = (lot.priceUsd! - r.med) / r.med;
  const da = parseDims(lot.dimensions);
  let dimsCov: number | null = null, maxAreaRatio: number | null = null;
  if (da) {
    const withDims = r.pool.map(p => parseDims(p.dimensions)).filter((d): d is [number, number] => !!d);
    dimsCov = +(withDims.length / r.pool.length).toFixed(2);
    const ratios = withDims.map(db => { const A = da[0]*da[1], B = db[0]*db[1]; return Math.max(A/B, B/A); });
    if (ratios.length) maxAreaRatio = +Math.max(...ratios).toFixed(1);
  }
  let fracYearFar: number | null = null;
  const ya = yearOf(lot);
  if (ya && ORIGINAL_FORMS.has(r.form)) {
    const withYear = r.pool.map(yearOf).filter((y): y is number => !!y);
    fracYearFar = withYear.length ? +(withYear.filter(y => Math.abs(y - ya) > 15).length / withYear.length).toFixed(2) : null;
  }
  let edMismatch: boolean | null = null;
  const ea = edSizeOf(lot);
  if (ea && r.form === 'print') {
    const comps = r.pool.map(edSizeOf).filter((e): e is number => !!e);
    edMismatch = comps.length ? comps.filter(e => Math.max(e/ea, ea/e) > 2).length / comps.length > 0.5 : null;
  }
  rows.push({ err, flagged: r.flagged, kind: r.kind, form: r.form, anchorPrintCued: lot.category === 'original' && PRINT_CUES.test(lot.title || ''), dimsCov, maxAreaRatio, fracYearFar, edMismatch, n: r.pool.length });
}
const grp = (name: string, f: (a: Attr) => boolean) => {
  const g = rows.filter(f);
  return { name, n: g.length, medAbsErr: medAbs(g.map(a => a.err)), flags: g.filter(a => a.flagged).length };
};
console.log(JSON.stringify({ baseline600: {
  reads: rows.length, sampled: sample600.length, medAbsErr: medAbs(rows.map(a => a.err)), flags: rows.filter(a => a.flagged).length,
  byKind: [grp('edition', a => a.kind === 'edition'), grp('formPool', a => a.kind === 'form')],
  byForm: Object.entries(rows.reduce((m, a) => { (m[a.form] ||= []).push(a); return m; }, {} as Record<string, Attr[]>)).map(([f, g]) => ({ form: f, n: g.length, medAbsErr: medAbs(g.map(a => a.err)) })),
  slices: [
    grp('anchorHasDims+poolDimsCov<0.5', a => a.dimsCov !== null && a.dimsCov < 0.5),
    grp('anchorHasDims+poolDimsCov>=0.5', a => a.dimsCov !== null && a.dimsCov >= 0.5),
    grp('anchorNoDims', a => a.dimsCov === null),
    grp('maxAreaRatio>2.5', a => a.maxAreaRatio !== null && a.maxAreaRatio > 2.5),
    grp('maxAreaRatio<=2.5', a => a.maxAreaRatio !== null && a.maxAreaRatio <= 2.5),
    grp('originals fracYearFar>0.3', a => a.fracYearFar !== null && a.fracYearFar > 0.3),
    grp('originals fracYearFar<=0.3', a => a.fracYearFar !== null && a.fracYearFar <= 0.3),
    grp('anchorPrintCuedOriginal', a => a.anchorPrintCued),
    grp('prints edMismatch', a => a.edMismatch === true),
    grp('prints edMatched', a => a.edMismatch === false),
  ],
} }, null, 1));

// ── 2 · variants on the 600 sample ──
const variants: [string, Opts][] = [
  ['V0 baseline', {}],
  ['V1 requireDims', { requireDimsWhenAnchorHas: true }],
  ['V2 area<=2.5', { areaRatioMax: 2.5 }],
  ['V3 year±15 opportunistic', { yearBandOriginals: 15 }],
  ['V3b year±15 required', { yearBandOriginals: 15, yearBandRequired: true }],
  ['V4 printSniff', { printSniff: true }],
  ['V5 seriesForPrints', { requireSeriesForPrints: true }],
  ['V1+V2', { requireDimsWhenAnchorHas: true, areaRatioMax: 2.5 }],
  ['V2+V3+V4', { areaRatioMax: 2.5, yearBandOriginals: 15, printSniff: true }],
  ['ALL (V1+V2+V3+V4+V5)', { requireDimsWhenAnchorHas: true, areaRatioMax: 2.5, yearBandOriginals: 15, printSniff: true, requireSeriesForPrints: true }],
];
const varOut: any[] = [];
for (const [name, opts] of variants) {
  const errs: number[] = []; const flagErrs: number[] = [];
  let reads = 0, flags = 0, editions = 0;
  for (const lot of sample600) {
    const r = readV(lot, soldFor(lot), opts);
    if (!r) continue;
    reads++;
    if (r.kind === 'edition') editions++;
    const err = (lot.priceUsd! - r.med) / r.med;
    errs.push(err);
    if (r.flagged) { flags++; flagErrs.push(err); }
  }
  varOut.push({ name, reads, coverage: +(reads/sample600.length).toFixed(3), editions, medAbsErr: medAbs(errs), flags, flagMedAbsErr: medAbs(flagErrs) });
}
console.log(JSON.stringify({ variants600: varOut }, null, 1));
