/** classification-normalize-spec — the REFINED normalizeCategory rules,
 *  measured: exact rows touched, per-rule attribution, never-touch guards,
 *  and hindsight-error impact (sold anchors, before vs after) on the affected
 *  artists via the real compPoolRead path (signalWithPool/appraiseLot). */
import { readGzRows } from '../corpus-io';
import { classifyForm, appraiseLot, signalWithPool } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const lots = readGzRows('data/corpus/lots.json.gz') as unknown as AuctionLot[];

// ── FINAL cue set (v2 — refined from classification-discriminator findings) ──
export const PRINT_PROCESS = /\b(lithograph(?:s|e|ie)?|silkscreen|screen\s?print(?:s|ing)?|s[ée]rigraph(?:s|y|ie)?|etching(?:s)?|aquatint|engraving(?:s)?|woodcut(?:s)?|wood engraving|linocut(?:s)?|drypoint|mezzotint|pochoirs?|photogravure|h[ée]liogravure|gicl[ée]e|offset (?:lithograph|print)|monotype|monoprint|intaglio|chine coll[ée]|linoleum cut)\b/i;
export const PLATE_FROM = /\b(?:pl\.?|plates?)\s*(?:[IVXLCDM]+\b|\d{1,3}\b)?[,]?\s*from\b|\b(?:one|two|three|four|five|six|seven|eight|\d{1,2})\s+plates?\b|\bplate\s+(?:[IVXLCDM]+|\d{1,3})\b/i;
export const FROM_SERIES = /,\s*from\s+(?!the\s+(?:collection|estate|property)|a\s+private|an?\s+important)(?:the\s+)?[A-Z'"«“]/;
// v2: bare "numbered" removed (estate inventory stamps: "numbered VF 115.034").
// "numbered" now only counts with an adjacent edition fraction.
export const EDITION_STRONG = /\bedition of \d+\b|\bfrom (?:an|the) edition\b|\bnumbered\b[^.;]{0,16}\d{1,3}\s*\/\s*\d{1,4}|\bartist'?s proof\b|\bprinter'?s proof\b|\btrial proof\b|\bbon [aà] tirer\b|\bhors commerce\b/i;
export function bareEditionFraction(s: string): boolean {
  const re = /(^|[^\d\s]|\s)(\d{1,3})\s*\/\s*(\d{1,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 4), m.index + m[1].length);
    if (/\d\s?$/.test(before)) continue; // "31 1/2" mixed-number size
    const num = parseInt(m[2], 10), den = parseInt(m[3], 10);
    if (den >= 8 && num <= den && den <= 3000) return true;
  }
  return false;
}
// v2 never-touch (original→print direction): + synthetic polymer (Warhol
// paintings), + sanguine/pastel-on-paper handled by ORIGINAL_WOP being absent
export const ORIGINAL_STRONG = /\b(?:oil|acrylic|tempera|alkyd|enamel|synthetic polymer)\b[^.;]{0,40}\bon\s+(?:canvas|linen|panel|board|masonite|cardboard|paper)\b|\bmixed media on (?:canvas|panel|board)\b|\bhand[- ]painted\b|\bunique\b/i;
// print→original trigger: strictly the oil/acrylic-on-canvas family
export const OIL_CANVAS = /\b(?:oil|acrylic|tempera|synthetic polymer)\b[^.;]{0,30}\bon\s+(?:canvas|panel|board|linen|masonite)\b/i;
export const EDITION_ANY = /\bedition of \d+|\bnumbered edition\b|\blimited edition\b/i;

const textOf = (l: AuctionLot) => `${l.title || ''}  ${l.medium || ''}`;

// the two normalize rules
function origToPrint(l: AuctionLot): boolean {
  if (l.category !== 'original') return false;
  const s = textOf(l);
  if (ORIGINAL_STRONG.test(s)) return false; // NEVER touch explicit unique mediums
  return PRINT_PROCESS.test(s) || PLATE_FROM.test(s) || FROM_SERIES.test(l.title || '')
    || EDITION_STRONG.test(s) || bareEditionFraction(s);
}
function printToOrig(l: AuctionLot): boolean {
  if (l.category !== 'print') return false;
  const s = textOf(l);
  if (PRINT_PROCESS.test(s) || PLATE_FROM.test(s)) return false; // NEVER touch real process words
  if (EDITION_ANY.test(s)) return false; // editioned ceramics/porcelain stay
  return OIL_CANVAS.test(s);
}

const o2p = lots.filter(origToPrint);
const p2o = lots.filter(printToOrig);
console.log(`RULE origToPrint touches ${o2p.length} rows; printToOrig touches ${p2o.length} rows (corpus ${lots.length})`);

const brk = (arr: AuctionLot[]) => {
  const st: Record<string, number> = {}, artists: Record<string, number> = {}, formBefore: Record<string, number> = {}, formAfter: Record<string, number> = {};
  for (const l of arr) {
    st[l.status] = (st[l.status] || 0) + 1;
    artists[l.artist] = (artists[l.artist] || 0) + 1;
    formBefore[classifyForm(l)] = (formBefore[classifyForm(l)] || 0) + 1;
    const flipped = { title: l.title, medium: l.medium, category: l.category === 'original' ? 'print' : 'original' } as AuctionLot;
    formAfter[classifyForm(flipped)] = (formAfter[classifyForm(flipped)] || 0) + 1;
  }
  return { st, artists: Object.fromEntries(Object.entries(artists).sort((a, b) => b[1] - a[1]).slice(0, 10)), formBefore, formAfter };
};
console.log('origToPrint:', JSON.stringify(brk(o2p)));
console.log('printToOrig:', JSON.stringify(brk(p2o)));
console.log('\nprintToOrig rows (all):');
for (const l of p2o) console.log(`  [${l.status}${l.priceUsd ? ' $' + Math.round(l.priceUsd) : ''}] ${l.artist} | ${(l.title || '').slice(0, 100)}`);

// ── engine impact: hindsight error before/after on affected artists ────────
const artists = new Set([...o2p, ...p2o].map(l => l.artist));
console.log('\naffected artists:', [...artists].join(', '));

const flipIds = new Set([...o2p, ...p2o].map(l => l.id));
function applyNormalize(arr: AuctionLot[]): AuctionLot[] {
  // fresh objects so classifyForm's WeakMap cache and stamped formKey can't leak
  return arr.map(l => {
    const copy = { ...l } as AuctionLot & { formKey?: string };
    if (flipIds.has(l.id)) copy.category = l.category === 'original' ? 'print' : 'original';
    copy.formKey = classifyForm({ title: copy.title, medium: copy.medium, category: copy.category } as AuctionLot);
    return copy;
  });
}

for (const artist of artists) {
  const before = lots.filter(l => l.artist === artist);
  if (before.length < 50) continue;
  const after = applyNormalize(before);
  // sold anchors with estimates in category print/original — hindsight err
  const evalSet = (arr: AuctionLot[], label: string) => {
    let reads = 0, flags = 0; const errs: number[] = [];
    for (const l of arr) {
      if (l.status !== 'sold' || !l.priceUsd) continue;
      if (l.category !== 'print' && l.category !== 'original') continue;
      if (!(l.estLowUsd ?? l.estimateLow) || !(l.estHighUsd ?? l.estimateHigh)) continue;
      const ap = appraiseLot(l, arr);
      if (!ap) continue;
      reads++;
      errs.push(Math.abs((l.priceUsd - ap.value) / ap.value));
      const sig = signalWithPool(l, arr);
      if (sig && sig.signal.label === 'Below Market') flags++;
    }
    errs.sort((a, b) => a - b);
    const med = errs.length ? errs[Math.floor(errs.length / 2)] : NaN;
    console.log(`  ${artist} ${label}: reads=${reads} belowMarketFlags=${flags} medianAbsErr=${(100 * med).toFixed(1)}%`);
  };
  evalSet(before, 'BEFORE');
  evalSet(after, 'AFTER ');
}
