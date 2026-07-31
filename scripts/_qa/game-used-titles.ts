/* game-used-titles.ts — why does playerOf fail on sold game-used titles? */
import * as fs from 'fs';
import { cleanGoldinTitle } from '../../app/lib/comps';
import { playerOf } from '../../app/lib/cards';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const guSold = all.filter(l => l.artist === 'game-used' && l.category === 'object' && l.status === 'sold' && l.priceUsd);

console.log('sample of 25 sold titles:');
for (let i = 0; i < 25; i++) {
  const l = guSold[Math.floor(i * guSold.length / 25)];
  console.log(' •', JSON.stringify((l.title || '').slice(0, 110)), '| src:', (l as any).source, '| house:', (l as any).house ?? (l as any).auctionHouse);
}

// source distribution
const src: Record<string, number> = {};
for (const l of guSold) { const s = (l as any).source ?? 'none'; src[s] = (src[s] || 0) + 1; }
console.log('\nsource dist:', src);

// does cleanGoldinTitle unlock playerOf?
let raw = 0, cleaned = 0;
const cleanedSlugDist: Record<string, number> = {};
for (const l of guSold) {
  if (playerOf(l.title || '', l.artist).playerSlug) raw++;
  const p = playerOf(cleanGoldinTitle(l.title || ''), l.artist);
  if (p.playerSlug) { cleaned++; cleanedSlugDist[p.playerSlug] = (cleanedSlugDist[p.playerSlug] || 0) + 1; }
}
console.log('\nplayerOf(raw title):', raw, `(${(100 * raw / guSold.length).toFixed(1)}%)`);
console.log('playerOf(cleanGoldinTitle(title)):', cleaned, `(${(100 * cleaned / guSold.length).toFixed(1)}%)`);
const top = Object.entries(cleanedSlugDist).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log('top slugs after clean:', top);
console.log('distinct slugs after clean:', Object.keys(cleanedSlugDist).length);
