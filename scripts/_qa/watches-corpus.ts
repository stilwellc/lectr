/** watches-corpus.ts — corpus census for the watch vertical:
 *  which makers, formKey stamp coverage & drift vs live classifyForm,
 *  material/size token coverage in titles, reference coverage. */
import * as fs from 'fs';
import { classifyForm, watchKey } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
console.log('corpus:', all.length);

// watch-vertical lots: category object whose live form OR stamped formKey is a watch form
const WFORMS = new Set(['wristwatch', 'pocket-watch', 'clock']);
const objLots = all.filter(l => l.category === 'object');
const watchish = objLots.filter(l => WFORMS.has(classifyForm(l)) || WFORMS.has((l.formKey as string) || ''));
console.log('object lots:', objLots.length, ' watch-ish (live or stamped watch form):', watchish.length);

// makers
const byMaker = new Map<string, number>();
for (const l of watchish) byMaker.set(l.artist, (byMaker.get(l.artist) || 0) + 1);
console.log('makers:', [...byMaker.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15));

// ── formKey stamp coverage & drift ──
let stamped = 0, unstamped = 0, drift = 0;
const driftPairs = new Map<string, number>();
const driftExamples: any[] = [];
for (const l of watchish) {
  if (l.formKey === undefined || l.formKey === null) { unstamped++; continue; }
  stamped++;
  const live = classifyForm(l);
  if (l.formKey !== live) {
    drift++;
    const k = `${l.formKey} -> ${live}`;
    driftPairs.set(k, (driftPairs.get(k) || 0) + 1);
    if (driftExamples.length < 15) driftExamples.push({ id: l.id, artist: l.artist, stamped: l.formKey, live, title: (l.title || '').slice(0, 90) });
  }
}
console.log('\nformKey stamps: stamped', stamped, 'unstamped', unstamped, 'drift(stamped!=live)', drift,
  stamped ? `(${(100 * drift / stamped).toFixed(2)}% of stamped)` : '');
console.log('drift pairs:', [...driftPairs.entries()].sort((a, b) => b[1] - a[1]));
console.log('drift examples:', JSON.stringify(driftExamples, null, 1));

// also check drift across ALL object lots of watch makers (jewelry leakage matters)
const watchMakers = new Set(['rolex', 'patek-philippe', 'cartier', 'omega', 'audemars-piguet', 'vacheron-constantin', 'jaeger-lecoultre', 'breitling', 'tag-heuer', 'heuer', 'iwc', 'panerai', 'tudor', 'longines', 'zenith', 'blancpain', 'breguet', 'piaget', 'chopard', 'bulgari']);
const makerLots = objLots.filter(l => watchMakers.has(l.artist) || byMaker.has(l.artist));
let mStamped = 0, mDrift = 0; const mPairs = new Map<string, number>();
for (const l of makerLots) {
  if (l.formKey === undefined || l.formKey === null) continue;
  mStamped++;
  const live = classifyForm(l);
  if (l.formKey !== live) { mDrift++; const k = `${l.formKey} -> ${live}`; mPairs.set(k, (mPairs.get(k) || 0) + 1); }
}
console.log('\nALL object lots of watch makers:', makerLots.length, 'stamped', mStamped, 'drift', mDrift,
  mStamped ? `(${(100 * mDrift / mStamped).toFixed(2)}%)` : '');
console.log('maker drift pairs:', [...mPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));

// ── the wristwatch cohort for token coverage ──
const wrist = objLots.filter(l => {
  const f = (l.formKey as string) ?? classifyForm(l);
  return f === 'wristwatch' || f === 'pocket-watch';
});
console.log('\nwristwatch/pocket-watch cohort (formOf semantics):', wrist.length);
const sold = wrist.filter(l => l.status === 'sold' && l.priceUsd);
console.log('sold w/ price:', sold.length);

// reference / watchKey coverage
let refStamped = 0, keyLive = 0;
for (const l of wrist) {
  if (l.reference !== undefined && l.reference !== null) refStamped++;
  if ((l.reference !== undefined ? l.reference : watchKey(l)) !== null) keyLive++;
}
console.log('reference stamped non-null:', refStamped, ` watchKeyOf non-null: ${keyLive} (${(100 * keyLive / wrist.length).toFixed(1)}%)`);

// ── material tokens in title+medium ──
export type Material = 'yellow-gold' | 'white-gold' | 'rose-gold' | 'gold' | 'platinum' | 'two-tone' | 'steel' | 'titanium' | 'ceramic' | 'silver' | 'bronze';
export function watchMaterial(l: Pick<AuctionLot, 'title' | 'medium'>): Material | null {
  const t = ` ${(l.title || '').toLowerCase()} ${(l.medium || '').toLowerCase()} `;
  const gold = /\b(gold|or jaune|or gris|or rose|or blanc)\b|\b18k\b|\b14k\b|\b9k\b|\b18ct\b|\b9ct\b/.test(t);
  const steel = /\b(steel|stainless|acier)\b/.test(t);
  if (gold && steel) return 'two-tone';
  if (/\btwo[- ]tone\b/.test(t)) return 'two-tone';
  if (/\bplatinum|platine\b/.test(t)) return 'platinum';
  if (gold) {
    if (/\b(pink gold|rose gold|everose|or rose)\b/.test(t)) return 'rose-gold';
    if (/\b(white gold|or gris|or blanc)\b/.test(t)) return 'white-gold';
    if (/\byellow gold|or jaune\b/.test(t)) return 'yellow-gold';
    return 'gold';
  }
  if (steel) return 'steel';
  if (/\btitanium\b/.test(t)) return 'titanium';
  if (/\bceramic\b/.test(t)) return 'ceramic';
  if (/\bsilver\b/.test(t)) return 'silver';
  if (/\bbronze\b/.test(t)) return 'bronze';
  return null;
}
const matCounts = new Map<string, number>();
for (const l of wrist) { const m = watchMaterial(l) ?? 'NONE'; matCounts.set(m, (matCounts.get(m) || 0) + 1); }
console.log('\nmaterial coverage:', [...matCounts.entries()].sort((a, b) => b[1] - a[1]),
  ` parsed: ${(100 * (wrist.length - (matCounts.get('NONE') || 0)) / wrist.length).toFixed(1)}%`);

// coarse material (gold-family vs steel vs platinum vs other) — is fine gold split needed?
export function coarseMaterial(l: Pick<AuctionLot, 'title' | 'medium'>): string | null {
  const m = watchMaterial(l);
  if (!m) return null;
  if (m === 'yellow-gold' || m === 'white-gold' || m === 'rose-gold' || m === 'gold') return 'gold';
  return m;
}

// ── size (mm) tokens ──
export function watchMm(l: Pick<AuctionLot, 'title' | 'dimensions'>): number | null {
  for (const src of [l.title, l.dimensions]) {
    if (!src) continue;
    const m = src.toLowerCase().match(/(\d{2}(?:[.,]\d+)?)\s*\s?mm\b/);
    if (m) {
      const v = parseFloat(m[1].replace(',', '.'));
      if (v >= 15 && v <= 70) return v; // plausible case sizes
    }
  }
  return null;
}
let mmT = 0, mmD = 0, mmAny = 0;
for (const l of wrist) {
  const t = (l.title || '').toLowerCase().match(/\d{2}(?:[.,]\d+)?\s?mm\b/);
  const d = (l.dimensions || '').toLowerCase().match(/\d{2}(?:[.,]\d+)?\s?mm\b/);
  if (t) mmT++;
  if (d) mmD++;
  if (watchMm(l) !== null) mmAny++;
}
console.log(`mm coverage: title ${mmT} (${(100 * mmT / wrist.length).toFixed(1)}%), dims field ${mmD} (${(100 * mmD / wrist.length).toFixed(1)}%), any ${mmAny} (${(100 * mmAny / wrist.length).toFixed(1)}%)`);

// box & papers tokens
let box = 0, papers = 0, both = 0;
for (const l of sold) {
  const t = ` ${(l.title || '').toLowerCase()} ${(l.medium || '').toLowerCase()} `;
  const b = /\bbox\b/.test(t), p = /\b(papers|certificate|guarantee|warranty)\b/.test(t);
  if (b) box++; if (p) papers++; if (b && p) both++;
}
console.log(`box/papers tokens on sold: box ${box} (${(100 * box / sold.length).toFixed(1)}%), papers ${papers} (${(100 * papers / sold.length).toFixed(1)}%), both ${both}`);

// year coverage
let withYear = 0;
for (const l of wrist) if (/\b(19[0-9]{2}|20[0-2][0-9])\b|\bcirca\b/.test((l.title || '').toLowerCase())) withYear++;
console.log(`year/circa token in title: ${withYear} (${(100 * withYear / wrist.length).toFixed(1)}%)`);
