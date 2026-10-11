/**
 * collection-eval.ts — spot-check "For your collection" (app/lib/collection-picks)
 * against the live book.
 *
 *   npx tsx scripts/collection-eval.ts [seed] [perKind]
 *
 * Draws desks from the sold archive (one held lot per desk for upgrades /
 * makers; 2–4 singles of one set; 1–2 prints of one series), runs the picks
 * over the live block (public/data/ray/upcoming.json) and prints every
 * match as `held ⇒ candidate · reason` with counts per kind, so a reviewer
 * can read the identity ties line by line. Nothing is written.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { AuctionLot } from '../app/types';
import { collectionPicks, type HeldInput, type PickKind } from '../app/lib/collection-picks';
import { parseCard, cardYearKey } from '../app/lib/cards';
import { taxonOf } from '../app/lib/taxonomy';

const ROOT = join(__dirname, '..', 'public', 'data', 'ray');
const seed0 = parseInt(process.argv[2] || '7', 10);
const PER = parseInt(process.argv[3] || '40', 10);
let s = seed0;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];

const live: AuctionLot[] = (JSON.parse(readFileSync(join(ROOT, 'upcoming.json'), 'utf8')).lots as AuctionLot[]).filter(l => l.status === 'upcoming');
const sold: AuctionLot[] = [];
for (let i = 0; i < 10; i++) {
  const f = join(ROOT, `sold-archive-${i}.json`);
  if (existsSync(f)) sold.push(...(JSON.parse(readFileSync(f, 'utf8')) as AuctionLot[]));
}
// the corpus shards carry the art / watch history the sold archive does not
for (let i = 0; i < 15; i++) {
  const f = join(ROOT, `lots-${i}.json`);
  if (!existsSync(f)) continue;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  for (const l of (Array.isArray(j) ? j : j.lots) as AuctionLot[]) if (l.status === 'sold') sold.push(l);
}
const NOW = Date.parse('2026-10-09T20:00:00Z');
console.log(`live ${live.length} · sold archive ${sold.length}`);

const asHeld = (l: AuctionLot, owned = true): HeldInput => ({ id: l.id, owned, title: l.title, artist: l.artist, lot: l });
const counts: Record<PickKind, number> = { upgrade: 0, set: 0, series: 0, maker: 0 };
const lines: string[] = [];
function run(desk: AuctionLot[], want: PickKind) {
  const r = collectionPicks(desk.map(l => asHeld(l)), live, { nowMs: NOW, n: 60 });
  for (const p of r.picks.filter(x => x.kind === want)) {
    counts[p.kind]++;
    const from = desk.filter(d => p.fromIds.includes(d.id)).map(d => d.title.slice(0, 70)).join(' + ');
    lines.push(`[${p.kind}] ${from}\n    ⇒ ${p.lot.title.slice(0, 100)}\n    · ${p.reason}`);
  }
}

// (a) upgrades: held cards whose identity is live in another grade
const cardSold = sold.filter(l => { const c = taxonOf(l).cat; return c === 'sports-cards' || c === 'tcg'; });
const watchSold = sold.filter(l => taxonOf(l).cat === 'watches');
const artSold = sold.filter(l => taxonOf(l).cat === 'fine-art');
for (let i = 0; i < 4000 && counts.upgrade < PER; i++) run([pick(cardSold)], 'upgrade');
for (let i = 0; watchSold.length && i < 1500 && counts.upgrade < PER + 10; i++) run([pick(watchSold)], 'upgrade');
// (b) sets: 2–4 singles of one sold set
const bySet = new Map<string, AuctionLot[]>();
for (const l of cardSold) { const c = parseCard(l.title); if (!c.year || !c.setName || !c.cardNo) continue; const k = `${cardYearKey(c.year)}|${c.setName}`; (bySet.get(k) || bySet.set(k, []).get(k)!).push(l); }
const setKeys = Array.from(bySet.keys()).filter(k => bySet.get(k)!.length >= 3);
for (let i = 0; i < 3000 && counts.set < PER; i++) { const xs = bySet.get(pick(setKeys))!; run([pick(xs), pick(xs), pick(xs)], 'set'); }
// (c) series: prints with a series in the title
const serSold = artSold.filter(l => /\bfrom\b|F\.?\s*&\s*S|s[ée]rie/i.test(l.title));
console.log(`cards ${cardSold.length} · watches ${watchSold.length} · art ${artSold.length} · series-titled ${serSold.length}`);
for (let i = 0; serSold.length && i < 3000 && counts.series < PER; i++) run([pick(serSold)], 'series');
// (d) makers
for (let i = 0; i < 400 && counts.maker < PER; i++) run([pick(sold)], 'maker');

console.log(lines.join('\n'));
console.log('\ncounts', counts);
