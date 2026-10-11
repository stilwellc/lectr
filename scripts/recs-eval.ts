/**
 * recs-eval.ts — offline evaluation of app/lib/recs.ts on the real live book.
 *
 *   npx tsx scripts/recs-eval.ts [path/to/upcoming.json] [--json out.json] [--impl <module>] [--quiet]
 *
 * `--impl` swaps the recommender module (e.g. a saved copy of the previous
 * recs.ts) so one run of this script measures before vs after on the same
 * personas, the same book and the same clock.
 *
 * THREE KINDS OF SIMULATED COLLECTOR, each built from REAL lots on the block:
 *
 * 1 · DESK personas (saves). A taste predicate picks their kind of lot, a
 *     seeded shuffle gives them 8 saves (the first one owned, saved 3–90
 *     days ago) and HOLDS OUT 6 more lots they would have liked. The
 *     recommender sees only the saves.
 *       P@12        share of the top 12 that fit the persona's taste predicate
 *       HR@12/@50   share of the held-out lots that the top 12 / 50 recover
 *       top-5%      share of the held-out lots ranked in the top 5% of the block
 *       AUC         held-out lots' mean percentile in the full ranking of the
 *                   on-block pool (unscored lots tie at the bottom) — 0.5 = chance
 *       sim         mean best lotSim of each top-12 pick to the held-out lots
 *     against the anonymous "What matters" shortlist and the OLD For-you.
 *
 * 2 · PRICE-SENSITIVE personas: the same kind of lot (vintage graded
 *     baseball singles), one desk entirely under $500, one entirely over
 *     $25K. Their predicate includes the price (a $90K Mantle is not a pick
 *     for the $200 desk, however alike the cards are).
 *
 * 3 · FEW-SIGNAL personas: one or two follows (a Pokémon, a player, a rare
 *     player with 2 live lots, two thin makers) or a single save — the
 *     cold-ish start most readers live in. Measured on coverage (how many of
 *     the 24 seats fill) and P@12 against a broad "would this reader care"
 *     predicate.
 *
 * Every persona also reports:
 *   price-fit   share of the top 12 inside the desk's own price span (min/1.5 …
 *               max×1.5 of the saves' anchors) — desks with ≥3 priced saves
 *   below-mkt   share of the top 12 the engine flags below market (isFlagged)
 *   rotation    the recommender run on day 0, +1, +2 over the WHOLE book
 *               (unfiltered — recs must drop what closed on its own):
 *               stale = picks no longer on the block (must be 0), turnover =
 *               share of the next day's 12 that is new, fill = seats filled
 */
import fs from 'node:fs';
import path from 'node:path';
import type * as RecsMod from '../app/lib/recs';
import { taxonOf } from '../app/lib/taxonomy';
import { lotFacets } from '../app/lib/facets';
import { shortlist, forYou, priorityOf, closeMsOf } from '../app/lib/priority';
import { affinityOf, catFollow, entityFollow, type Follow } from '../app/lib/follows';
import { isFlagged } from '../app/lib/flags';
import { isOnBlock, craftTitle, formatPrice } from '../app/utils';
import { makerLineOf } from '../app/lib/lot-labels';

const args = process.argv.slice(2);
const argOf = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const jsonOut = argOf('--json');
const impl = argOf('--impl');
const quiet = args.includes('--quiet');
const src = args.find(a => a.endsWith('.json') && !a.startsWith('--') && a !== jsonOut) || 'public/data/ray/upcoming.json';
const NOW = Date.parse('2026-10-09T20:00:00Z');
const TODAY = '2026-10-09';
const log = (...xs: unknown[]) => { if (!quiet) console.log(...xs); };

type L = RecsMod.RecLot & { estimateLow?: number | null; estimateHigh?: number | null };

async function main() {
  const R: typeof RecsMod = impl
    ? await import(path.resolve(impl))
    : await import('../app/lib/recs');
  const { buildTaste, recommend, scoreLots, featOf, lotSim, recNote } = R;

  const book = JSON.parse(fs.readFileSync(src, 'utf8'));
  const all: L[] = (book.lots || book) as L[];
  const dayIso = (d: number) => new Date(NOW + d * 864e5).toISOString().slice(0, 10);
  const pool = all.filter(l => isOnBlock(l as Parameters<typeof isOnBlock>[0], TODAY, NOW));

  const A = (l: L) => priorityOf(l, NOW)?.a ?? 0;
  const fx = (l: L) => lotFacets(l);
  const T = (l: L) => taxonOf(l);
  const vintageBb = (l: L) => T(l).cat === 'sports-cards' && T(l).sub === 'singles' && T(l).sport === 'baseball' && fx(l).has('era-vintage') && fx(l).has('graded');

  interface Persona { key: string; name: string; fits: (l: L) => boolean; follow?: Follow; main: [string, string]; group: 'desk' | 'price' }
  const PERSONAS: Persona[] = [
    {
      key: 'art-prints', group: 'desk', name: 'Art print collector (Warhol / Lichtenstein / Haring, $2K–80K)', main: ['fine-art', 'prints'],
      fits: l => T(l).cat === 'fine-art' && T(l).sub === 'prints' && ['andy-warhol', 'roy-lichtenstein', 'keith-haring', 'david-hockney', 'kaws', 'banksy', 'takashi-murakami', 'alex-katz'].includes(l.artist) && A(l) >= 2000 && A(l) <= 80000,
    },
    {
      key: 'vintage-baseball', group: 'desk', name: 'Vintage baseball (1946–79 graded singles)', main: ['sports-cards', 'singles'],
      fits: vintageBb, follow: { kind: 'maker', key: 'mickey-mantle', label: 'Mickey Mantle' },
    },
    {
      key: 'modern-basketball', group: 'desk', name: 'Modern basketball (2000+ graded singles)', main: ['sports-cards', 'singles'],
      fits: l => T(l).cat === 'sports-cards' && T(l).sub === 'singles' && T(l).sport === 'basketball' && fx(l).has('era-modern') && fx(l).has('graded'),
    },
    {
      key: 'pokemon-vintage', group: 'desk', name: 'Pokémon vintage graded (WOTC era, slabbed)', main: ['tcg', 'vintage'],
      fits: l => T(l).cat === 'tcg' && T(l).sub === 'vintage' && fx(l).has('graded'),
      follow: entityFollow('sj:tcg|k:charizard', 'Charizard'),
    },
    {
      key: 'watches', group: 'desk', name: 'Watches (Patek Philippe / Rolex)', main: ['watches', 'wristwatches'],
      fits: l => T(l).cat === 'watches' && (l.artist === 'patek-philippe' || l.artist === 'rolex'),
    },
    {
      key: 'star-wars', group: 'desk', name: 'Pop culture — Star Wars', main: ['entertainment', 'props-costumes'],
      fits: l => T(l).cat === 'entertainment' && (fx(l).has('fr-starwars') || l.ek === 'sj:culture|fr:fr-starwars'),
    },
    {
      key: 'bb-budget', group: 'price', name: 'Budget vintage baseball (every save < $500)', main: ['sports-cards', 'singles'],
      fits: l => vintageBb(l) && A(l) > 0 && A(l) < 500,
    },
    {
      key: 'bb-trophy', group: 'price', name: 'Trophy vintage baseball (every save > $25K)', main: ['sports-cards', 'singles'],
      fits: l => vintageBb(l) && A(l) > 25000,
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
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

  /** price-fit of a pick list against a desk's own span (null: < 3 priced saves) */
  function priceFit(recs: { lot: L }[], saves: L[]): number | null {
    const ps = saves.map(A).filter(a => a > 0);
    if (ps.length < 3 || !recs.length) return null;
    const lo = Math.min(...ps) / 1.5, hi = Math.max(...ps) * 1.5;
    return recs.filter(r => { const a = A(r.lot); return a > 0 && a >= lo && a <= hi; }).length / recs.length;
  }
  const belowShare = (recs: { lot: L }[]) => (recs.length ? recs.filter(r => isFlagged(r.lot)).length / recs.length : 0);

  /** run the recommender on day 0, +1, +2 over the whole (unfiltered) book */
  function rotation(input: Parameters<typeof buildTaste>[0]) {
    let prev: Set<string> | null = null;
    const turnover: number[] = [];
    let stale = 0, fillMin = Infinity;
    for (let d = 0; d < 3; d++) {
      const now = NOW + d * 864e5;
      const taste = buildTaste({ ...input, nowMs: now });
      const recs = recommend(all, taste, { nowMs: now, n: 12 });
      for (const r of recs) {
        const c = closeMsOf(r.lot);
        if (!isOnBlock(r.lot as Parameters<typeof isOnBlock>[0], dayIso(d), now) || (c != null && c <= now)) stale++;
      }
      fillMin = Math.min(fillMin, recs.length);
      const ids = new Set(recs.map(r => r.lot.id));
      if (prev) { let fresh = 0; ids.forEach(id => { if (!prev!.has(id)) fresh++; }); turnover.push(ids.size ? fresh / ids.size : 0); }
      prev = ids;
    }
    return { stale, turnover: mean(turnover), fill: fillMin };
  }

  const report: Record<string, unknown>[] = [];
  const deskRows: Record<string, number>[] = [];
  const priceRows: Record<string, number>[] = [];
  const fitAll: number[] = [], belowAll: number[] = [], turnAll: number[] = [];
  let staleAll = 0;

  for (const [pi, p] of Array.from(PERSONAS.entries())) {
    // one object per card/title — a persona never "holds out" the twin of a save
    const seenT = new Set<string>();
    const cands = shuffle(pool.filter(p.fits), 1009 + pi * 7919).filter(l => {
      const k = `${l.auctionHouse}|${craftTitle(l.title).toLowerCase()}`; if (seenT.has(k)) return false; seenT.add(k); return true;
    });
    if (cands.length < 14) { log(`\n## ${p.name}: only ${cands.length} lots on the block — skipped`); continue; }
    const saves = cands.slice(0, 8);
    const held = cands.slice(8, 14);
    const savedInputs: RecsMod.SavedInput[] = saves.map((l, i) => ({
      id: l.id, lot: l, owned: i === 0, savedAt: new Date(NOW - (3 + i * 12) * 864e5).toISOString(),
    }));
    const taste = buildTaste({ saved: savedInputs, follows: [], nowMs: NOW });
    const recs = recommend(pool, taste, { nowMs: NOW, n: 12 }) as RecsMod.Rec<L>[];
    const recs50 = recommend(pool, taste, { nowMs: NOW, n: 50 });
    const ranked = scoreLots(pool, taste, { nowMs: NOW });
    const heldIds = new Set(held.map(l => l.id));
    const p12 = recs.filter(r => p.fits(r.lot)).length / Math.max(1, recs.length);
    const hr12 = recs.filter(r => heldIds.has(r.lot.id)).length / held.length;
    const hr50 = recs50.filter(r => heldIds.has(r.lot.id)).length / held.length;
    const poolN = pool.length - saves.length;
    const rankOf = new Map(ranked.map((r, i) => [r.l.id, i]));
    const unscoredMid = ranked.length + (poolN - ranked.length) / 2;
    const auc = held.reduce((s, l) => s + (1 - (rankOf.get(l.id) ?? unscoredMid) / poolN), 0) / held.length;
    const top5 = held.filter(l => (rankOf.get(l.id) ?? Infinity) < poolN * 0.05).length / held.length;
    const heldF = held.map(l => featOf(l, NOW));
    const sim = recs.reduce((s, r) => s + Math.max(...heldF.map(h => lotSim(featOf(r.lot, NOW), h).sim)), 0) / Math.max(1, recs.length);
    const pf = priceFit(recs, saves);
    const bm = belowShare(recs);
    const fitPoolBelow = cands.filter(l => isFlagged(l)).length;
    const rot = rotation({ saved: savedInputs, follows: [] });

    // baselines
    const glob = shortlist(pool, NOW, 12);
    const bP12 = glob.filter(l => p.fits(l)).length / Math.max(1, glob.length);
    const oldF = [catFollow(p.main[0] as Parameters<typeof catFollow>[0], p.main[1])];
    const old = forYou(pool, l => affinityOf(l, oldF), NOW, 50);
    const oP12 = old.slice(0, 12).filter(l => p.fits(l)).length / Math.max(1, Math.min(12, old.length));

    const row = { p12, hr12, hr50, top5, auc, sim, bP12, oP12 };
    (p.group === 'desk' ? deskRows : priceRows).push(row);
    if (pf != null) fitAll.push(pf);
    belowAll.push(bm); turnAll.push(rot.turnover); staleAll += rot.stale;

    log(`\n## ${p.name}   (${cands.length} fitting lots on the block of ${pool.length}; ${fitPoolBelow} of them engine-flagged)`);
    log('saves:');
    for (const [i, l] of Array.from(saves.entries())) log(`  ${i === 0 ? 'OWN ' : 'save'} ${makerLineOf(l).name} — ${craftTitle(l.title, l.auctionHouse).slice(0, 70)} · ${l.auctionHouse} · ${formatPrice(A(l))}`);
    log(`metrics: P@12 ${pct(p12)} · HR@12 ${pct(hr12)} · HR@50 ${pct(hr50)} · top-5% ${pct(top5)} · AUC ${auc.toFixed(3)} · sim ${sim.toFixed(2)} · price-fit ${pf == null ? '—' : pct(pf)} · below-mkt ${pct(bm)} · rotation stale ${rot.stale} turnover ${pct(rot.turnover)} fill ${rot.fill}  ||  What-matters P@12 ${pct(bP12)} · old For-you P@12 ${pct(oP12)}`);
    log('top 10:');
    for (const [i, r] of Array.from(recs.slice(0, 10).entries())) {
      const l = r.lot;
      log(`  ${String(i + 1).padStart(2)}. ${p.fits(l) ? '✓' : '·'}${heldIds.has(l.id) ? 'H' : ' '}${isFlagged(l) ? '▼' : ' '} ${makerLineOf(l).name} — ${craftTitle(l.title, l.auctionHouse).slice(0, 60)} · ${l.auctionHouse} · ${formatPrice(A(l))}\n          ↳ ${recNote(r)}`);
    }
    const out: Record<string, unknown> = {
      persona: p.key, group: p.group, name: p.name, fitting: cands.length, ...row, priceFit: pf, belowMarket: bm, rotation: rot,
      top10: recs.slice(0, 10).map(r => ({ id: r.lot.id, maker: makerLineOf(r.lot).name, title: craftTitle(r.lot.title, r.lot.auctionHouse), anchor: A(r.lot), note: recNote(r), fits: p.fits(r.lot), flagged: isFlagged(r.lot) })),
    };
    if (p.follow) {
      const t2 = buildTaste({ saved: savedInputs, follows: [p.follow], nowMs: NOW });
      const r2 = recommend(pool, t2, { nowMs: NOW, n: 12 });
      log(`with a follow (${p.follow.label}): ${r2.filter(r => r.reason.startsWith('You follow')).length}/12 explained by the follow; P@12 ${pct(r2.filter(r => p.fits(r.lot as L)).length / Math.max(1, r2.length))}`);
      out.withFollow = r2.map(r => ({ id: r.lot.id, note: recNote(r) }));
    }
    report.push(out);
  }

  // ── few-signal personas ──
  const pickedSave = shuffle(pool.filter(vintageBb).filter(l => A(l) >= 300 && A(l) <= 3000), 4242)[0];
  interface Few { key: string; name: string; follows: Follow[]; saved?: L[]; fits: (l: L) => boolean }
  const FEW: Few[] = [
    { key: 'f-charizard', name: 'Follows Charizard only', follows: [entityFollow('sj:tcg|k:charizard', 'Charizard')], fits: l => T(l).cat === 'tcg' },
    { key: 'f-mantle', name: 'Follows Mickey Mantle only', follows: [{ kind: 'maker', key: 'mickey-mantle', label: 'Mickey Mantle' }], fits: l => (T(l).cat === 'sports-cards' || T(l).cat === 'sports-memorabilia') && T(l).sport === 'baseball' },
    { key: 'f-ewing', name: 'Follows Patrick Ewing only (2 live lots)', follows: [{ kind: 'maker', key: 'patrick-ewing', label: 'Patrick Ewing' }], fits: l => (T(l).cat === 'sports-cards' || T(l).cat === 'sports-memorabilia') && T(l).sport === 'basketball' },
    { key: 'f-kaws-mcgee', name: 'Follows KAWS + Barry McGee (12 live lots)', follows: [{ kind: 'maker', key: 'kaws', label: 'KAWS' }, { kind: 'maker', key: 'barry-mcgee', label: 'Barry McGee' }], fits: l => T(l).cat === 'fine-art' },
    { key: 'f-one-save', name: `One save (${pickedSave ? craftTitle(pickedSave.title, pickedSave.auctionHouse).slice(0, 44) : '—'})`, follows: [], saved: pickedSave ? [pickedSave] : [], fits: vintageBb },
  ];
  const fewRows: { n24: number; p12: number }[] = [];
  for (const f of FEW) {
    const input = { saved: (f.saved ?? []).map(l => ({ id: l.id, lot: l, savedAt: new Date(NOW - 5 * 864e5).toISOString() })), follows: f.follows };
    const taste = buildTaste({ ...input, nowMs: NOW });
    const recs24 = recommend(pool, taste, { nowMs: NOW, n: 24 }) as RecsMod.Rec<L>[];
    const recs = recs24.slice(0, 12);
    const p12 = recs.filter(r => f.fits(r.lot)).length / Math.max(1, recs.length);
    const rot = rotation(input);
    const bm = belowShare(recs);
    fewRows.push({ n24: recs24.length, p12 });
    belowAll.push(bm); turnAll.push(rot.turnover); staleAll += rot.stale;
    log(`\n## FEW-SIGNAL · ${f.name}`);
    log(`metrics: seats ${recs24.length}/24 · P@12 ${pct(p12)} · below-mkt ${pct(bm)} · rotation stale ${rot.stale} turnover ${pct(rot.turnover)} fill ${rot.fill}`);
    for (const [i, r] of Array.from(recs.slice(0, 8).entries())) log(`  ${String(i + 1).padStart(2)}. ${f.fits(r.lot) ? '✓' : '·'} ${makerLineOf(r.lot).name} — ${craftTitle(r.lot.title, r.lot.auctionHouse).slice(0, 56)} · ${formatPrice(A(r.lot))}\n          ↳ ${recNote(r, { short: true })}`);
    if (recs24.length > 12) for (const r of recs24.slice(-3)) log(`  …  ${f.fits(r.lot) ? '✓' : '·'} ${craftTitle(r.lot.title, r.lot.auctionHouse).slice(0, 56)} ↳ ${recNote(r, { short: true })}`);
    report.push({ persona: f.key, group: 'few', name: f.name, seats24: recs24.length, p12, belowMarket: bm, rotation: rot, top12: recs.map(r => ({ id: r.lot.id, note: recNote(r), fits: f.fits(r.lot) })) });
  }

  const m = (rows: Record<string, number>[], k: string) => mean(rows.map(r => r[k]));
  const summary = {
    desk: { p12: m(deskRows, 'p12'), hr50: m(deskRows, 'hr50'), auc: m(deskRows, 'auc'), top5: m(deskRows, 'top5') },
    price: { p12: m(priceRows, 'p12'), auc: m(priceRows, 'auc') },
    few: { seats24: mean(fewRows.map(r => r.n24)), p12: mean(fewRows.map(r => r.p12)) },
    priceFit: mean(fitAll), belowMarket: mean(belowAll), turnover: mean(turnAll), stale: staleAll,
  };
  console.log(`\n== ${impl ? `[${impl}] ` : ''}DESK (${deskRows.length}): P@12 ${pct(summary.desk.p12)} · HR@50 ${pct(summary.desk.hr50)} · top-5% ${pct(summary.desk.top5)} · AUC ${summary.desk.auc.toFixed(3)}`);
  console.log(`   PRICE (${priceRows.length}): P@12 ${pct(summary.price.p12)} · AUC ${summary.price.auc.toFixed(3)}`);
  console.log(`   FEW-SIGNAL (${fewRows.length}): seats ${summary.few.seats24.toFixed(1)}/24 · P@12 ${pct(summary.few.p12)}`);
  console.log(`   ALL: price-fit ${pct(summary.priceFit)} · below-mkt ${pct(summary.belowMarket)} · day-over-day turnover ${pct(summary.turnover)} · stale picks ${summary.stale}`);
  console.log(`   baselines: What-matters P@12 ${pct(m(deskRows, 'bP12'))} · old For-you P@12 ${pct(m(deskRows, 'oP12'))}`);

  // cold start: no seeds → nothing (never fake picks)
  const cold = recommend(pool, buildTaste({ saved: [], follows: [], nowMs: NOW }), { nowMs: NOW });
  console.log(`   cold start: ${cold.length} picks`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), impl: impl ?? 'app/lib/recs', pool: pool.length, summary, personas: report }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
