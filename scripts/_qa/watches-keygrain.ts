/** watches-keygrain.ts — how are watchKeys minted (ref number vs model-line name),
 *  and how much price dispersion lives inside model-name keys vs ref keys?
 *  Also: how many corpus lots sit in the 'plural-jewelry rescue' class whose
 *  classifyForm verdict flipped when the set/plural gate was added (stale-stamp
 *  exposure — a write-once formKey stamped before that gate says 'wristwatch'). */
import * as fs from 'fs';
import { classifyForm, watchKey } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const WMAKERS = new Set(['patek-philippe', 'rolex', 'cartier', 'audemars-piguet', 'omega']);
const wkOf = (l: AuctionLot) => (l.reference !== undefined ? l.reference : watchKey(l));

const wrist = all.filter(l => WMAKERS.has(l.artist) && l.category === 'object' && classifyForm(l) === 'wristwatch');
const sold = wrist.filter(l => l.status === 'sold' && l.priceUsd);

let refNum = 0, modelName = 0, none = 0;
for (const l of sold) {
  const k = wkOf(l);
  if (k === null) { none++; continue; }
  if (/\d{3}/.test(k)) refNum++; else modelName++;
}
console.log('sold wristwatches:', sold.length, '| key = ref-number:', refNum, `(${(100 * refNum / sold.length).toFixed(1)}%)`, 'model-name:', modelName, `(${(100 * modelName / sold.length).toFixed(1)}%)`, 'none:', none, `(${(100 * none / sold.length).toFixed(1)}%)`);

// dispersion inside keys (IQR/med of sold prices per artist+key, pools >=6)
function iqrMed(prices: number[]): number {
  const p = prices.slice().sort((a, b) => a - b);
  const med = p.length % 2 ? p[(p.length - 1) / 2] : (p[p.length / 2 - 1] + p[p.length / 2]) / 2;
  const q1 = p[Math.floor(p.length * 0.25)], q3 = p[Math.floor(p.length * 0.75)];
  return med > 0 ? (q3 - q1) / med : 99;
}
const groups = new Map<string, number[]>();
for (const l of sold) {
  const k = wkOf(l); if (!k) continue;
  const g = `${l.artist}|${k}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g)!.push(l.priceUsd!);
}
const refSpreads: number[] = [], nameSpreads: number[] = [];
const nameSizes: [string, number, number][] = [];
for (const [g, prices] of groups) {
  if (prices.length < 6) continue;
  const s = iqrMed(prices);
  if (/\d{3}/.test(g.split('|')[1])) refSpreads.push(s);
  else { nameSpreads.push(s); nameSizes.push([g, prices.length, s]); }
}
const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
console.log('key pools >=6: ref-number', refSpreads.length, 'median IQR/med', med(refSpreads).toFixed(2), '| model-name', nameSpreads.length, 'median IQR/med', med(nameSpreads).toFixed(2));
console.log('largest model-name pools:', nameSizes.sort((a, b) => b[1] - a[1]).slice(0, 12).map(([g, n, s]) => `${g} n=${n} spread=${s.toFixed(2)}`));

// material split inside big model-name keys: e.g. rolex|daytona gold vs steel medians
function coarseMat(l: AuctionLot): string | null {
  const t = ` ${(l.title || '').toLowerCase()} ${(l.medium || '').toLowerCase()} `;
  const gold = /\b(gold|or jaune|or gris|or rose|or blanc)\b|\b18k\b|\b14k\b|\b18ct\b/.test(t);
  const steel = /\b(steel|stainless|acier)\b/.test(t);
  if (gold && steel) return 'two-tone';
  if (/\b(platinum|platine)\b/.test(t)) return 'platinum';
  if (gold) return 'gold';
  if (steel) return 'steel';
  return null;
}
for (const key of ['rolex|daytona', 'rolex|submariner', 'patek-philippe|nautilus', 'rolex|datejust', 'audemars-piguet|royaloak']) {
  const [artist, k] = key.split('|');
  const pool = sold.filter(l => l.artist === artist && wkOf(l) === k);
  if (!pool.length) { console.log(key, 'EMPTY'); continue; }
  const byMat = new Map<string, number[]>();
  for (const l of pool) { const m = coarseMat(l) ?? 'unparsed'; if (!byMat.has(m)) byMat.set(m, []); byMat.get(m)!.push(l.priceUsd!); }
  console.log('\n' + key, 'n=' + pool.length, 'overall med $' + med(pool.map(l => l.priceUsd!)).toFixed(0), 'IQR/med', iqrMed(pool.map(l => l.priceUsd!)).toFixed(2));
  for (const [m, ps] of [...byMat.entries()].sort((a, b) => b[1].length - a[1].length))
    console.log('  ', m.padEnd(9), 'n=' + String(ps.length).padStart(4), 'med $' + med(ps).toFixed(0), 'IQR/med', iqrMed(ps).toFixed(2));
}

// same split by ref-number for a couple of big refs (does material still split within a ref?)
const bigRefs = [...groups.entries()].filter(([g, p]) => /\d{3}/.test(g.split('|')[1]) && p.length >= 30).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
console.log('\nbiggest ref-number pools:');
for (const [g] of bigRefs) {
  const [artist, k] = g.split('|');
  const pool = sold.filter(l => l.artist === artist && wkOf(l) === k);
  const byMat = new Map<string, number[]>();
  for (const l of pool) { const m = coarseMat(l) ?? 'unparsed'; if (!byMat.has(m)) byMat.set(m, []); byMat.get(m)!.push(l.priceUsd!); }
  console.log(g, 'n=' + pool.length, 'med $' + med(pool.map(l => l.priceUsd!)).toFixed(0), 'IQR/med', iqrMed(pool.map(l => l.priceUsd!)).toFixed(2),
    ' mats:', [...byMat.entries()].map(([m, ps]) => `${m}:${ps.length}@$${med(ps).toFixed(0)}`).join(' '));
}

// ── stale-stamp exposure: lots the plural/set jewelry gate flips ──
// Simulate the PRE-gate classifier: same code path but without the watchWord/
// plural-set jewelry branch — i.e., lots that today classify 'jewelry' ONLY
// because of the plural gate (title has plural jewelry nouns, no singular noun,
// and a watch-model cue that the old classifier would have caught as wristwatch).
const objAll = all.filter(l => WMAKERS.has(l.artist) && l.category === 'object');
let flips = 0; const flipEx: string[] = [];
for (const l of objAll) {
  const t = ` ${(l.title || '').toLowerCase()} `;
  const m = ` ${((l as any).medium || '').toLowerCase()} `;
  const tm = t + m;
  if (classifyForm(l) !== 'jewelry') continue;
  // singular jewelry nouns → old classifier ALSO said jewelry (no flip)
  if (/\b(ring|necklace|brooch|earrings?|pendant|bangle|choker|cufflinks)\b/.test(t)) continue;
  // would the old classifier have called it a wristwatch?
  const WATCH_MODELS = /(submariner|daytona|datejust|day[- ]date|gmt[- ]master(?:\s*ii)?|explorer(?:\s*ii)?|sea[- ]dweller|yacht[- ]master|milgauss|air[- ]king|oyster perpetual|cellini|nautilus|aquanaut|calatrava|ellipse|gondolo|twenty[~-]?4|world time|royal oak(?: offshore)?|millenary|jules audemars|speedmaster|seamaster|constellation|de ville|railmaster|tank|santos|panth[eè]re|ballon bleu|pasha|crash|baignoire|tortue|reverso|memovox|polaris|navitimer|superocean|chronomat|monaco|carrera|autavia|el primero|defy|portugieser|portofino|ingenieur|aquatimer|luminor|radiomir|overseas|patrimony|fifty ?fathoms|villeret)/;
  const oldWrist = /\b(wristwatch|wrist ?watch|montre)\b/.test(tm)
    || (/\bwatch\b/.test(tm) && /\b(chronograph|chronometer|automatic|quartz|manual wind|movement|dial|bezel|calibre|caliber|tourbillon|perpetual calendar|bracelet|gold|steel|lady'?s|gentleman)\b/.test(tm))
    || /\bref[:.]?\s*[a-z]?\d{3,6}/.test(t)
    || /\b(chronograph|chronometer|chronometre|oyster|cosmograph|cellini)\b/.test(t)
    || WATCH_MODELS.test(t);
  if (oldWrist) { flips++; if (flipEx.length < 10) flipEx.push(`${l.id} :: ${(l.title || '').slice(0, 90)}`); }
}
console.log('\nplural-gate flip class (today jewelry, pre-gate classifier would say wristwatch):', flips, 'of', objAll.length, 'watch-maker object lots');
console.log(flipEx);
