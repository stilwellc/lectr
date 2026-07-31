/* game-used-upcoming-look.ts — what does the live game-used book actually look like? */
import * as fs from 'fs';
import type { AuctionLot } from '../../app/types';

const upcoming: AuctionLot[] = JSON.parse(fs.readFileSync('public/data/ray/upcoming.json', 'utf8')).lots;
const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const guSold = all.filter(l => l.artist === 'game-used' && l.category === 'object' && l.status === 'sold' && l.priceUsd);
const guUp = upcoming.filter(l => l.artist === 'game-used');

const houses: Record<string, number> = {};
for (const l of guUp) { const h = (l as any).house ?? (l as any).auctionHouse ?? (l as any).source ?? '?'; houses[h] = (houses[h] || 0) + 1; }
console.log('upcoming houses:', houses);
const shouses: Record<string, number> = {};
for (const l of guSold) { const h = (l as any).house ?? (l as any).auctionHouse ?? '?'; shouses[h] = (shouses[h] || 0) + 1; }
console.log('sold houses:', shouses);

console.log('\n20 upcoming titles (stamped playerSlug | entity | objectType):');
for (let i = 0; i < 20; i++) {
  const l = guUp[Math.floor(i * guUp.length / 20)];
  console.log(' •', JSON.stringify((l.title || '').slice(0, 90)));
  console.log('    slug:', (l as any).playerSlug, '| entity:', l.entity, '| type:', l.objectType, '| sport:', (l as any).sport);
}

// sold-corpus sport mix: how many sold rows are NBA-jersey-like vs other sports
const sportGuess = (t: string) => /nba|basketball/i.test(t) ? 'nba' : /nfl|football|super bowl/i.test(t) ? 'nfl' : /mlb|baseball|world series/i.test(t) ? 'mlb' : /nhl|hockey|stanley/i.test(t) ? 'nhl' : 'other';
const sMix: Record<string, number> = {}, uMix: Record<string, number> = {};
for (const l of guSold) { const s = sportGuess(l.title || ''); sMix[s] = (sMix[s] || 0) + 1; }
for (const l of guUp) { const s = sportGuess(l.title || ''); uMix[s] = (uMix[s] || 0) + 1; }
console.log('\nsold sport mix:', sMix);
console.log('upcoming sport mix:', uMix);
