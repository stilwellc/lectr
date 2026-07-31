import * as fs from 'fs';
import { normalizeCorpus, recoverPlayerSlug } from '../../scripts/lib/corpus-normalize';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
console.log('corpus:', all.length);

// spot: the extractor on known shapes
console.log('spot marino:', recoverPlayerSlug('1994 Dan Marino Miami Dolphins Signed Game-Issued Left Cleat - MEARS Authentic'));
console.log('spot oneal:', recoverPlayerSlug('Shaquille O’Neal Phoenix Suns 2008-2009 Game Worn Sneakers'));
console.log('spot team-ball:', recoverPlayerSlug('Orlando Magic Team Signed Ball'));

const t0 = Date.now();
normalizeCorpus(all);
console.log('pass 1:', Date.now() - t0, 'ms');

// key gate checks
const flips = all.filter(l => (l as any).catReclass);
console.log('category flips:', flips.length, 'o2p:', flips.filter(l => (l as any).catReclass === 'o2p').length, 'p2o:', flips.filter(l => (l as any).catReclass === 'p2o').length);
const matisse = all.find(l => l.id === 'bonhams-32662-178');
console.log('the Jazz plate now:', matisse?.category, (matisse as any)?.catReclass, (matisse as any)?.formKey);
const gu = all.filter(l => l.artist === 'game-used' && l.category === 'object');
const guCov = gu.filter(l => (l as any).playerSlug).length / gu.length;
console.log('game-used identity coverage:', (guCov * 100).toFixed(1) + '%', 'of', gu.length);
const cult = all.filter(l => ['movie-tv','music-memorabilia','entertainment-memorabilia'].includes(l.artist));
console.log('culture rows:', cult.length, 'with subjectKeys:', cult.filter(l => (l as any).subjectKeys?.length).length, 'with itemClass:', cult.filter(l => (l as any).itemClass).length);
const fkCov = all.filter(l => (l as any).formKey !== undefined).length;
console.log('formKey coverage:', fkCov, '/', all.length);

// idempotency: second run must be ~no-op on flips/stamps
const snap = JSON.stringify(all.slice(0, 500).map(l => [(l as any).category, (l as any).catReclass, (l as any).playerSlug, (l as any).formKey]));
normalizeCorpus(all);
const snap2 = JSON.stringify(all.slice(0, 500).map(l => [(l as any).category, (l as any).catReclass, (l as any).playerSlug, (l as any).formKey]));
console.log('idempotent (sample):', snap === snap2);
