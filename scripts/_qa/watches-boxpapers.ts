/** watches-boxpapers.ts — within same ref + same coarse material pools, does
 *  box/papers presence or sale-year recency shift the realized median enough
 *  to matter as a gate/score signal? */
import * as fs from 'fs';
import { classifyForm, watchKey } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const WMAKERS = new Set(['patek-philippe', 'rolex', 'cartier', 'audemars-piguet', 'omega']);
const wkOf = (l: AuctionLot) => (l.reference !== undefined ? l.reference : watchKey(l));
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
const sold = all.filter(l => WMAKERS.has(l.artist) && l.category === 'object' && l.status === 'sold' && l.priceUsd && classifyForm(l) === 'wristwatch');

const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

// group by artist|ref|mat; within groups >=10 with >=3 in each bp bucket, compare medians
const groups = new Map<string, AuctionLot[]>();
for (const l of sold) {
  const k = wkOf(l); const m = coarseMat(l);
  if (!k || !m || !/\d{3}/.test(k)) continue;
  const g = `${l.artist}|${k}|${m}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g)!.push(l);
}
const bp = (l: AuctionLot) => /\bbox\b/.test((l.title || '').toLowerCase() + ' ' + (l.medium || '').toLowerCase()) && /\b(papers|certificate|guarantee|warranty)\b/.test((l.title || '').toLowerCase() + ' ' + (l.medium || '').toLowerCase());
const ratios: number[] = []; let usable = 0;
for (const [, ls] of groups) {
  if (ls.length < 10) continue;
  const withBp = ls.filter(bp), noBp = ls.filter(l => !bp(l));
  if (withBp.length < 3 || noBp.length < 3) continue;
  usable++;
  ratios.push(med(withBp.map(l => l.priceUsd!)) / med(noBp.map(l => l.priceUsd!)));
}
console.log('ref+material groups with >=3 box&papers and >=3 without:', usable,
  '| median (boxPapers med / bare med):', med(ratios).toFixed(2));

// sale-year drift inside groups: median price by sale year for the largest groups
const big = [...groups.entries()].filter(([, ls]) => ls.length >= 60).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
for (const [g, ls] of big) {
  const byYear = new Map<string, number[]>();
  for (const l of ls) { const y = (l.saleDate || '').slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y)!.push(l.priceUsd!); }
  const line = [...byYear.entries()].sort().filter(([, p]) => p.length >= 5).map(([y, p]) => `${y}:$${(med(p) / 1000).toFixed(0)}k(n${p.length})`).join(' ');
  console.log(g, 'n=' + ls.length, '|', line);
}
