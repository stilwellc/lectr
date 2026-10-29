/**
 * recs-sweep.ts — read "Lots you may like" the way the owner does (Oct 29 2026).
 *
 *   npx tsx scripts/recs-sweep.ts [path/to/upcoming.json] [--desk "2 Warhol"] [--n 24]
 *
 * Eleven realistic desks are built from the live book itself (a watch
 * collector, a Warhol prints desk, modern basketball, vintage baseball,
 * Pokémon, space, film autographs, design, mixed sports memorabilia, a
 * follows-only desk, a one-card hockey desk) and each is dealt by
 * app/lib/recs.recommend. Every pick prints with its lane (D = the discover
 * lane, L2–L4 = a fallback rung), house, anchor price, days to close, title
 * and the reason the row would show. Run it after every tuning and read the
 * lists: "would I actually want to look at this?" — wrong-kind lots, reasons
 * that overclaim, one house flooding, price-band misses, unpriced lots
 * leading. THE CLOCK is the book's own (generatedAt + 1h), as recs-eval's.
 * Pure read: nothing is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildTaste, recommend, featOf, type RecLot } from '../app/lib/recs';
import { isOnBlock } from '../app/utils';
import { taxonOf } from '../app/lib/taxonomy';
import { makerFollow, entityFollow, catFollow, type Follow } from '../app/lib/follows';
import { closeMsOf } from '../app/lib/priority';

const args = process.argv.slice(2);
const flag = (k: string): string | null => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] ?? null : null; };
const src = args.find(a => a.endsWith('.json')) ?? path.join(process.cwd(), 'public/data/ray/upcoming.json');
const only = flag('--desk');
const N = Number(flag('--n') ?? 24);

const book = JSON.parse(fs.readFileSync(src, 'utf8'));
const all: RecLot[] = book.lots || book;
const NOW = (Date.parse(book.generatedAt ?? '') || Date.now()) + 3600e3;
const TODAY = new Date(NOW - 7 * 3600e3).toISOString().slice(0, 10); // US-local day, as the eval reads it
const pool = all.filter(l => isOnBlock(l as Parameters<typeof isOnBlock>[0], TODAY, NOW));
console.log(`${pool.length} lots on the block as of ${new Date(NOW).toISOString()} (${path.relative(process.cwd(), src)})`);

const cat = (c: string) => (l: RecLot) => taxonOf(l).cat === c;
const priced = (l: RecLot) => featOf(l, NOW).logA != null;
const usd = (l: RecLot) => { const a = featOf(l, NOW).logA; return a == null ? '—' : `$${Math.round(Math.pow(10, a)).toLocaleString()}`; };
const days = (l: RecLot) => { const c = closeMsOf(l); return c == null ? 'undated' : `${((c - NOW) / 864e5).toFixed(1)}d`; };
const ek = (l: RecLot) => featOf(l, NOW).ek ?? l.id;
const est = (l: RecLot, lo: number, hi: number) => { const a = featOf(l, NOW).logA; return a != null && a >= Math.log10(lo) && a <= Math.log10(hi); };
/** the first n priced lots matching f, one per distinct key */
const pick = (f: (l: RecLot) => boolean, n: number, distinctBy?: (l: RecLot) => string) => {
  const seen = new Set<string>(); const out: RecLot[] = [];
  for (const l of pool) {
    if (!f(l) || !priced(l)) continue;
    const k = distinctBy ? distinctBy(l) : l.id;
    if (seen.has(k)) continue;
    seen.add(k); out.push(l);
    if (out.length >= n) break;
  }
  return out;
};

function desk(name: string, saved: RecLot[], follows: Follow[] = []) {
  if (only && !name.startsWith(only)) return;
  const t = buildTaste({ saved: saved.map(l => ({ id: l.id, lot: l, savedAt: new Date(NOW - 3 * 864e5).toISOString() })), follows, nowMs: NOW });
  const rs = recommend(pool, t, { nowMs: NOW, n: N });
  const houses = new Map<string, number>();
  for (const r of rs) houses.set(r.lot.auctionHouse ?? '?', (houses.get(r.lot.auctionHouse ?? '?') ?? 0) + 1);
  const far = rs.filter(r => { const c = closeMsOf(r.lot); return c == null || c - NOW > 14 * 864e5; }).length;
  console.log(`\n== ${name} · saves: ${saved.map(l => `${l.title.slice(0, 38)} (${usd(l)})`).join(' | ') || '—'}${follows.length ? ` · follows: ${follows.map(f => f.label).join(', ')}` : ''}`);
  console.log(`   ${rs.length} picks · ${rs.filter(r => r.tier && r.tier > 1).length} ladder · ${rs.filter(r => r.lane === 'discover').length} discover · ${far} past 14 days · houses ${Array.from(houses.entries()).map(([k, v]) => `${k.slice(0, 9)}:${v}`).join(' ')} · no photo ${rs.filter(r => !r.lot.imageUrl).length} · unpriced ${rs.filter(r => !priced(r.lot)).length}`);
  rs.forEach((r, i) => console.log(`${String(i).padStart(2)} ${r.lane === 'discover' ? 'D ' : r.tier && r.tier > 1 ? `L${r.tier}` : '  '} ${(r.lot.auctionHouse ?? '').slice(0, 9).padEnd(9)} ${usd(r.lot).padStart(9)} ${days(r.lot).padStart(7)} ${r.lot.title.slice(0, 52).padEnd(52)} | ${r.reason.slice(0, 92)}`));
}

desk('1 watch collector', pick(l => cat('watches')(l) && est(l, 3000, 15000), 3, ek));
desk('2 Warhol prints', pick(l => l.artist === 'andy-warhol' && taxonOf(l).sub === 'prints' && est(l, 3000, 40000), 3));
desk('3 modern basketball', pick(l => cat('sports-cards')(l) && taxonOf(l).sport === 'basketball' && featOf(l, NOW).fx.has('era-modern') && featOf(l, NOW).fx.has('psa') && est(l, 150, 1500), 3, ek));
desk('4 vintage baseball', pick(l => cat('sports-cards')(l) && taxonOf(l).sport === 'baseball' && featOf(l, NOW).fx.has('era-vintage') && featOf(l, NOW).fx.has('psa') && est(l, 100, 1000) && ek(l).startsWith('pl:'), 3, ek));
desk('5 Pokemon', pick(l => cat('tcg')(l) && taxonOf(l).sub === 'vintage' && featOf(l, NOW).fx.has('psa') && est(l, 200, 3000), 2, ek));
desk('6 space', pick(l => cat('space-science')(l) && ek(l).startsWith('sj:science|p:') && est(l, 300, 5000), 2, ek));
desk('7 film autographs', pick(l => cat('entertainment')(l) && taxonOf(l).sub === 'autographs-documents' && featOf(l, NOW).fx.has('film-tv') && est(l, 200, 3000) && !!l.imageUrl, 3, ek));
desk('8 design', pick(l => cat('design')(l), 2));
desk('9 sports memorabilia', [
  ...pick(l => cat('sports-memorabilia')(l) && taxonOf(l).sub === 'game-used' && est(l, 500, 10000), 1),
  ...pick(l => cat('sports-memorabilia')(l) && taxonOf(l).sub === 'autographs' && est(l, 200, 3000), 1),
  ...pick(l => cat('sports-memorabilia')(l) && taxonOf(l).sub === 'tickets' && est(l, 100, 3000), 1),
]);
desk('10 follows only', [], [makerFollow('michael-jordan', 'Michael Jordan'), entityFollow('sj:tcg|k:charizard', 'Charizard'), catFollow('fine-art', 'prints')]);
desk('11 one hockey card', pick(l => cat('sports-cards')(l) && taxonOf(l).sport === 'hockey' && ek(l).startsWith('pl:'), 1));
