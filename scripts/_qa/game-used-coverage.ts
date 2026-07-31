/* game-used-coverage.ts — field coverage + gate-stage funnel for game-used sold rows */
import * as fs from 'fs';
import { soldCompBand, sportsForm, classifyForm } from '../../app/lib/comps';
import { playerOf } from '../../app/lib/cards';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const upcoming: AuctionLot[] = JSON.parse(fs.readFileSync('public/data/ray/upcoming.json', 'utf8')).lots;

const gu = all.filter(l => l.artist === 'game-used' && l.category === 'object');
const guSold = gu.filter(l => l.status === 'sold' && l.priceUsd);
const guUp = upcoming.filter(l => l.artist === 'game-used');

function cov(rows: AuctionLot[], name: string) {
  const n = rows.length;
  const c = (f: (l: AuctionLot) => unknown) => rows.filter(l => { const v = f(l); return v !== null && v !== undefined && v !== ''; }).length;
  console.log(`\n== ${name} (n=${n}) ==`);
  console.log('playerSlug:', c(l => (l as any).playerSlug), `(${(100 * c(l => (l as any).playerSlug) / n).toFixed(1)}%)`);
  console.log('entity:    ', c(l => l.entity), `(${(100 * c(l => l.entity) / n).toFixed(1)}%)`);
  console.log('objectType:', c(l => l.objectType), `(${(100 * c(l => l.objectType) / n).toFixed(1)}%)`);
  console.log('eventKey:  ', c(l => l.eventKey), `(${(100 * c(l => l.eventKey) / n).toFixed(1)}%)`);
  console.log('sportYear: ', c(l => l.sportYear), `(${(100 * c(l => l.sportYear) / n).toFixed(1)}%)`);
  console.log('estimateLow:', c(l => l.estimateLow), `(${(100 * c(l => l.estimateLow) / n).toFixed(1)}%)`);
  console.log('formKey stamped:', c(l => (l as any).formKey), `(${(100 * c(l => (l as any).formKey) / n).toFixed(1)}%)`);
  // title-derived player fallback
  const pf = rows.filter(l => playerOf(l.title || '', l.artist).playerSlug).length;
  console.log('playerOf(title) parses:', pf, `(${(100 * pf / n).toFixed(1)}%)`);
  // either playerSlug OR title-parse
  const either = rows.filter(l => (l as any).playerSlug || playerOf(l.title || '', l.artist).playerSlug).length;
  console.log('playerSlug OR titleParse:', either, `(${(100 * either / n).toFixed(1)}%)`);
}

cov(guSold, 'game-used SOLD (corpus)');
cov(guUp, 'game-used UPCOMING (live book)');

// sportsForm distribution on sold
const formDist: Record<string, number> = {};
for (const l of guSold) { const f = sportsForm(l) ?? 'null'; formDist[f] = (formDist[f] || 0) + 1; }
console.log('\nsportsForm dist (sold):', formDist);
const otDist: Record<string, number> = {};
for (const l of guSold) { const t = l.objectType ?? 'null'; otDist[t] = (otDist[t] || 0) + 1; }
console.log('objectType dist (sold):', otDist);

// ── gate-stage funnel on a 120-lot sample of sold game-used (same shape as audit2) ──
const sample = guSold.filter((_, i) => i % Math.max(1, Math.floor(guSold.length / 120)) === 0).slice(0, 120);
let sBand = 0;
const funnel = { slugSold: [] as number[], plusForm: [] as number[], plusIdentity: [] as number[] };
let noIdentityAnchor = 0;
for (const lot of sample) {
  const form = sportsForm(lot) ?? classifyForm(lot);
  const idKey = (lot as any).playerSlug || null; // SPORTS_SLUGS path → playerSlug only
  if (!idKey) noIdentityAnchor++;
  const s1 = all.filter(l => l.artist === lot.artist && l.status === 'sold' && l.priceUsd && l.id !== lot.id);
  const s2 = s1.filter(l => (sportsForm(l) ?? classifyForm(l)) === form);
  const s3 = idKey ? s2.filter(l => ((l as any).playerSlug || null) === idKey) : [];
  funnel.slugSold.push(s1.length); funnel.plusForm.push(s2.length); funnel.plusIdentity.push(s3.length);
  if (soldCompBand(lot, all)) sBand++;
}
const stats = (a: number[]) => {
  const s = a.slice().sort((x, y) => x - y);
  return { min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1], ge3: a.filter(x => x >= 3).length };
};
console.log('\n== FUNNEL on', sample.length, 'sampled sold game-used ==');
console.log('anchors with NO identity (playerSlug null):', noIdentityAnchor);
console.log('stage1 same-slug sold:', stats(funnel.slugSold));
console.log('stage2 +compFormKey:  ', stats(funnel.plusForm));
console.log('stage3 +identity:     ', stats(funnel.plusIdentity));
console.log('soldCompBand produced:', sBand, '/', sample.length);
