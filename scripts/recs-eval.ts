/**
 * recs-eval.ts — offline evaluation of app/lib/recs.ts on the real live book.
 *
 *   npx tsx scripts/recs-eval.ts [path/to/upcoming.json] [--json out.json]
 *
 * Six simulated collectors, each built from REAL lots on the block: a taste
 * predicate picks their kind of lot, a seeded shuffle gives them 8 saves (the
 * first one owned, saved 3–90 days ago) and HOLDS OUT 6 more lots they would
 * have liked. The recommender sees only the saves. Reported per persona:
 *
 *   P@12        share of the top 12 that fit the persona's taste predicate
 *   HR@12/@50   share of the held-out lots that the top 12 / 50 recover
 *   top-5%      share of the held-out lots the full ranking puts in the top 5% of the block
 *   AUC         held-out lots' mean percentile in the full ranking of the
 *               on-block pool (unscored lots tie at the bottom) — 0.5 = chance
 *   sim         mean best lotSim of each top-12 pick to the held-out lots
 *
 * against two baselines: the anonymous "What matters" shortlist (no taste),
 * and the OLD For-you (priority.forYou over a follow of the persona's main
 * category · sub — the best the old tab could do).
 */
import fs from 'node:fs';
import { buildTaste, recommend, scoreLots, featOf, lotSim, recNote, type RecLot, type SavedInput } from '../app/lib/recs';
import { taxonOf } from '../app/lib/taxonomy';
import { lotFacets } from '../app/lib/facets';
import { shortlist, forYou, priorityOf } from '../app/lib/priority';
import { affinityOf, catFollow, entityFollow, type Follow } from '../app/lib/follows';
import { isOnBlock, craftTitle, formatPrice } from '../app/utils';
import { makerLineOf } from '../app/lib/lot-labels';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const src = args.find(a => a.endsWith('.json') && !a.startsWith('--') && a !== jsonOut) || 'public/data/ray/upcoming.json';
const NOW = Date.parse('2026-10-09T20:00:00Z');
const TODAY = '2026-10-09';

type L = RecLot & { estimateLow?: number | null; estimateHigh?: number | null };
const book = JSON.parse(fs.readFileSync(src, 'utf8'));
const all: L[] = (book.lots || book) as L[];
const pool = all.filter(l => isOnBlock(l as Parameters<typeof isOnBlock>[0], TODAY, NOW));

const A = (l: L) => priorityOf(l, NOW)?.a ?? 0;
interface Persona { key: string; name: string; fits: (l: L) => boolean; follow?: Follow; main: [string, string] }
const fx = (l: L) => lotFacets(l);
const T = (l: L) => taxonOf(l);
const PERSONAS: Persona[] = [
  {
    key: 'art-prints', name: 'Art print collector (Warhol / Lichtenstein / Haring, $2K–80K)', main: ['fine-art', 'prints'],
    fits: l => T(l).cat === 'fine-art' && T(l).sub === 'prints' && ['andy-warhol', 'roy-lichtenstein', 'keith-haring', 'david-hockney', 'kaws', 'banksy', 'takashi-murakami', 'alex-katz'].includes(l.artist) && A(l) >= 2000 && A(l) <= 80000,
  },
  {
    key: 'vintage-baseball', name: 'Vintage baseball (1946–79 graded singles)', main: ['sports-cards', 'singles'],
    fits: l => T(l).cat === 'sports-cards' && T(l).sub === 'singles' && T(l).sport === 'baseball' && fx(l).has('era-vintage') && fx(l).has('graded'),
    follow: { kind: 'maker', key: 'mickey-mantle', label: 'Mickey Mantle' },
  },
  {
    key: 'modern-basketball', name: 'Modern basketball (2000+ graded singles)', main: ['sports-cards', 'singles'],
    fits: l => T(l).cat === 'sports-cards' && T(l).sub === 'singles' && T(l).sport === 'basketball' && fx(l).has('era-modern') && fx(l).has('graded'),
  },
  {
    key: 'pokemon-vintage', name: 'Pokémon vintage graded (WOTC era, slabbed)', main: ['tcg', 'vintage'],
    fits: l => T(l).cat === 'tcg' && T(l).sub === 'vintage' && fx(l).has('graded'),
    follow: entityFollow('sj:tcg|k:charizard', 'Charizard'),
  },
  {
    key: 'watches', name: 'Watches (Patek Philippe / Rolex)', main: ['watches', 'wristwatches'],
    fits: l => T(l).cat === 'watches' && (l.artist === 'patek-philippe' || l.artist === 'rolex'),
  },
  {
    key: 'star-wars', name: 'Pop culture — Star Wars', main: ['entertainment', 'props-costumes'],
    fits: l => T(l).cat === 'entertainment' && (fx(l).has('fr-starwars') || l.ek === 'sj:culture|fr:fr-starwars'),
  },
];

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle<X>(xs: X[], seed: number): X[] {
  const r = rng(seed); const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const report: Record<string, unknown>[] = [];
const totals = { top5: 0, p12: 0, hr12: 0, hr50: 0, auc: 0, sim: 0, bP12: 0, oP12: 0, oHr50: 0, oAuc: 0 };

for (const [pi, p] of Array.from(PERSONAS.entries())) {
  // one object per card/title — a persona never "holds out" the twin of a save
  const seenT = new Set<string>();
  const cands = shuffle(pool.filter(p.fits), 1009 + pi * 7919).filter(l => {
    const k = `${l.auctionHouse}|${craftTitle(l.title).toLowerCase()}`; if (seenT.has(k)) return false; seenT.add(k); return true;
  });
  if (cands.length < 14) { console.log(`\n## ${p.name}: only ${cands.length} lots on the block — skipped`); continue; }
  const saves = cands.slice(0, 8);
  const held = cands.slice(8, 14);
  const savedInputs: SavedInput[] = saves.map((l, i) => ({
    id: l.id, lot: l, owned: i === 0, savedAt: new Date(NOW - (3 + i * 12) * 864e5).toISOString(),
  }));
  const taste = buildTaste({ saved: savedInputs, follows: [], nowMs: NOW });
  const recs = recommend(pool, taste, { nowMs: NOW, n: 12 });
  const recs50 = recommend(pool, taste, { nowMs: NOW, n: 50 });
  const ranked = scoreLots(pool, taste, { nowMs: NOW });
  const heldIds = new Set(held.map(l => l.id));
  const p12 = recs.filter(r => p.fits(r.lot as L)).length / Math.max(1, recs.length);
  const hr12 = recs.filter(r => heldIds.has(r.lot.id)).length / held.length;
  const hr50 = recs50.filter(r => heldIds.has(r.lot.id)).length / held.length;
  const poolN = pool.length - saves.length;
  const rankOf = new Map(ranked.map((r, i) => [r.l.id, i]));
  const unscoredMid = ranked.length + (poolN - ranked.length) / 2;
  const auc = held.reduce((s, l) => s + (1 - (rankOf.get(l.id) ?? unscoredMid) / poolN), 0) / held.length;
  // held-out lots the full ranking puts in the top 5% of the block
  const top5 = held.filter(l => (rankOf.get(l.id) ?? Infinity) < poolN * 0.05).length / held.length;
  const heldF = held.map(l => featOf(l, NOW));
  const sim = recs.reduce((s, r) => s + Math.max(...heldF.map(h => lotSim(featOf(r.lot, NOW), h).sim)), 0) / Math.max(1, recs.length);

  // baselines
  const glob = shortlist(pool, NOW, 12);
  const bP12 = glob.filter(l => p.fits(l)).length / Math.max(1, glob.length);
  const oldF = [catFollow(p.main[0] as Parameters<typeof catFollow>[0], p.main[1])];
  const old = forYou(pool, l => affinityOf(l, oldF), NOW, 50);
  const oP12 = old.slice(0, 12).filter(l => p.fits(l)).length / Math.max(1, Math.min(12, old.length));
  const oHr50 = old.filter(l => heldIds.has(l.id)).length / held.length;
  const oRank = new Map(old.map((l, i) => [l.id, i]));
  const oAuc = held.reduce((s, l) => s + (1 - (oRank.get(l.id) ?? (old.length + (poolN - old.length) / 2)) / poolN), 0) / held.length;

  Object.entries({ top5, p12, hr12, hr50, auc, sim, bP12, oP12, oHr50, oAuc }).forEach(([k, v]) => { (totals as Record<string, number>)[k] += v; });

  console.log(`\n## ${p.name}   (${cands.length} fitting lots on the block of ${pool.length})`);
  console.log('saves:');
  for (const [i, l] of Array.from(saves.entries())) console.log(`  ${i === 0 ? 'OWN ' : 'save'} ${makerLineOf(l).name} — ${craftTitle(l.title, l.auctionHouse).slice(0, 70)} · ${l.auctionHouse} · ${formatPrice(A(l))}`);
  console.log(`held out: ${held.map(l => craftTitle(l.title, l.auctionHouse).slice(0, 40)).join(' | ')}`);
  console.log(`metrics: P@12 ${pct(p12)} · HR@12 ${pct(hr12)} · HR@50 ${pct(hr50)} · top-5% ${pct(top5)} · AUC ${auc.toFixed(3)} · sim ${sim.toFixed(2)}  ||  What-matters P@12 ${pct(bP12)} · old For-you(${p.main.join(':')}) P@12 ${pct(oP12)} HR@50 ${pct(oHr50)} AUC ${oAuc.toFixed(3)}`);
  console.log('top 10:');
  for (const [i, r] of Array.from(recs.slice(0, 10).entries())) {
    const l = r.lot as L;
    console.log(`  ${String(i + 1).padStart(2)}. ${p.fits(l) ? '✓' : '·'}${heldIds.has(l.id) ? 'H' : ' '} ${makerLineOf(l).name} — ${craftTitle(l.title, l.auctionHouse).slice(0, 64)} · ${l.auctionHouse} · ${formatPrice(A(l))}\n        ↳ ${recNote(r)}`);
  }
  const row: Record<string, unknown> = {
    persona: p.key, name: p.name, fitting: cands.length, p12, hr12, hr50, top5, auc, sim, baseline: { whatMattersP12: bP12, oldForYouP12: oP12, oldForYouHr50: oHr50, oldForYouAuc: oAuc },
    top10: recs.slice(0, 10).map(r => ({ id: r.lot.id, maker: makerLineOf(r.lot).name, title: craftTitle(r.lot.title, r.lot.auctionHouse), house: r.lot.auctionHouse, anchor: A(r.lot as L), note: recNote(r), fits: p.fits(r.lot as L), heldOut: heldIds.has(r.lot.id) })),
    saves: saves.map(l => l.id), heldOut: held.map(l => l.id),
  };
  if (p.follow) {
    const t2 = buildTaste({ saved: savedInputs, follows: [p.follow], nowMs: NOW });
    const r2 = recommend(pool, t2, { nowMs: NOW, n: 12 });
    console.log(`with a follow (${p.follow.label}): ${r2.filter(r => r.reason.startsWith('You follow')).length}/12 explained by the follow; P@12 ${pct(r2.filter(r => p.fits(r.lot as L)).length / Math.max(1, r2.length))}`);
    for (const r of r2.filter(x => x.reason.startsWith('You follow')).slice(0, 3)) console.log(`        · ${craftTitle(r.lot.title, r.lot.auctionHouse).slice(0, 60)} ↳ ${recNote(r)}`);
    row.withFollow = r2.map(r => ({ id: r.lot.id, note: recNote(r) }));
  }
  report.push(row);
}

const n = report.length;
console.log(`\n== MEAN over ${n} personas: P@12 ${pct(totals.p12 / n)} · HR@12 ${pct(totals.hr12 / n)} · HR@50 ${pct(totals.hr50 / n)} · top-5% ${pct(totals.top5 / n)} · AUC ${(totals.auc / n).toFixed(3)} · sim ${(totals.sim / n).toFixed(2)}`);
console.log(`   baselines: What-matters P@12 ${pct(totals.bP12 / n)} · old For-you P@12 ${pct(totals.oP12 / n)} HR@50 ${pct(totals.oHr50 / n)} AUC ${(totals.oAuc / n).toFixed(3)}`);

// cold start: no seeds → nothing (never fake picks)
const cold = recommend(pool, buildTaste({ saved: [], follows: [], nowMs: NOW }), { nowMs: NOW });
console.log(`cold start: ${cold.length} picks`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), pool: pool.length, personas: report }, null, 2));
