/**
 * recs-eval.ts — offline evaluation of app/lib/recs.ts on a real live book.
 *
 *   npx tsx scripts/recs-eval.ts [path/to/upcoming.json] [--impl <module>] [--json out.json] [--n 80] [--quiet]
 *                                [--sweep] [--holdout-only]
 *
 * `--impl` loads a second recommender module and every metric is reported
 * for both, paired on the same collectors, the same book and the same clock
 * (save the previous recs.ts as app/lib/recs_base.ts — never committed — and
 * pass --impl app/lib/recs_base.ts).
 * `--sweep` re-runs the holdout for tuning variants (RecOpts.tune) — how
 * REC_TUNE was chosen. EVAL_LOSSES=1 prints each collector the names
 * baseline beats, and why (rank, seed, sale of every missed holdout).
 *
 * THE CLOCK is the book's own (generatedAt + 1h) — never a hard-coded day —
 * so a fresh book is read the way a reader sees it the morning it lands.
 *
 * (Oct 11 2026) The old eval held out lots drawn by the very predicates the
 * scorer keys on (P@12 was guaranteed, AUC over the whole block trivial) and
 * skipped personas the book could not fill. This one is built so the model
 * can lose:
 *
 * 1 · LATENT-TASTE HOLDOUT (R3). N simulated collectors per mix. Each has a
 *     hidden taste: three NAMES (entities with ≥5 lots on the block) in one
 *     category · sub · sport, and a price band (±0.4 decade around the names'
 *     median RAW price — the estimate / bid, not the scorer's anchor). They
 *     save 2 lots of each name inside the band; the holdouts are drawn
 *     uniformly from what that hidden taste covers — more of the same names in
 *     the band ("entity") and other names of the same cut in the band ("cut").
 *     Two mixes: entity-heavy 4:2 and cut-heavy 2:4. Nothing about a holdout
 *     is chosen by a recommender feature (facets, sims, anchors).
 *       HR@24   share of the holdouts in the top 24
 *       nDCG@24, distinct names in the 24, max seats from one sale
 *     against THE BASELINE TO BEAT: the names the reader saved, their live
 *     lots sorted by priority (the "matters most" score). Paired Δ ± 95% CI
 *     and wins / losses per collector.
 *
 * 2 · SCENARIOS (R3's audit, as regressions):
 *       signals   8 saves + N lot views of another market → seats the views explain
 *       negative  "Not for me" on the top pick 5 times → the explaining seed's seats
 *       skew      follow ONE name → top-12 median price vs the name's own median
 *       flagged   engine-flagged share of picks vs of scored candidates
 *       reasons   price-range claims on lots outside the printed band (must be 0)
 *       memo      a long-lived tab 3 days on vs a fresh one (positions that differ)
 *       market    a quick-start market with no names → its picks
 *       stated    a stated floor / cap → share of picks inside it
 *       fresh     closed / closing-pending lots in picks over 3 days (must be 0)
 *       cold      no seeds → no picks
 *
 * 3 · TEN COLLECTORS (R1's prod personas, Oct 11): their follows, quick-start
 *     answers and device signals, seeded exactly as the prod run did; each
 *     pick judged by an encoded version of R1's "would a demanding collector
 *     of this kind keep it" (category, object kind, price range, near-duplicate
 *     of a pick above). Reported as hits / picks.
 */
import fs from 'node:fs';
import path from 'node:path';
import type * as RecsMod from '../app/lib/recs';
import { taxonOf } from '../app/lib/taxonomy';
import { lotFacets } from '../app/lib/facets';
import { priorityOf, closeMsOf, saleKeyOf } from '../app/lib/priority';
import { entityFollow, makerFollow, type Follow } from '../app/lib/follows';
import { signalsToTaste, type SignalStore, quietKeysOf } from '../app/lib/recs-signals';
import { isFlagged } from '../app/lib/flags';
import { parseCard } from '../app/lib/cards';
import { isOnBlock, isClosedPending } from '../app/utils';

const args = process.argv.slice(2);
const argOf = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const jsonOut = argOf('--json');
const implB = argOf('--impl');
const quiet = args.includes('--quiet');
const NP = Number(argOf('--n') ?? 80);
const sweep = args.includes('--sweep');
const holdoutOnly = args.includes('--holdout-only');
const src = args.find(a => a.endsWith('.json') && a !== jsonOut) || 'public/data/ray/upcoming.json';
const log = (...xs: unknown[]) => { if (!quiet) console.log(...xs); };
const say = (...xs: unknown[]) => console.log(...xs);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the eval reads raw book fields
type L = RecsMod.RecLot & Record<string, any>;
type M = typeof RecsMod;

const book = JSON.parse(fs.readFileSync(src, 'utf8'));
const all: L[] = (book.lots || book) as L[];
const NOW = (Date.parse(book.generatedAt ?? '') || Date.now()) + 3600e3;
const dayOf = (ms: number) => new Date(ms - 7 * 3600e3).toISOString().slice(0, 10); // US-local day
const TODAY = dayOf(NOW);
const pool: L[] = all.filter(l => isOnBlock(l as Parameters<typeof isOnBlock>[0], TODAY, NOW));

/* ── helpers ── */
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const med = (xs: number[]) => { const a = xs.slice().sort((p, q) => p - q); return a.length ? (a.length % 2 ? a[a.length >> 1] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN; };
const ci = (xs: number[]) => { const m = mean(xs); return 1.96 * Math.sqrt(mean(xs.map(x => (x - m) ** 2))) / Math.sqrt(Math.max(1, xs.length)); };
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
const sgn = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle<X>(xs: readonly X[], r: () => number): X[] { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const T = (l: L) => taxonOf(l);
const FX = (l: L) => lotFacets(l);
const PRIO = (l: L) => priorityOf(l, NOW)?.score ?? 0;
/** the RAW price a collector sees (realized, else estimate mid, else the bid) in USD — not the scorer's anchor */
const FXR: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, CHF: 1.12, HKD: 0.128, JPY: 0.0067, CNY: 0.14, SEK: 0.095, DKK: 0.145, CAD: 0.73, AUD: 0.66 };
function usd(l: L): number | null {
  if (l.priceUsd && l.priceUsd > 0) return l.priceUsd;
  const fx = FXR[l.currency || 'USD'] ?? 1;
  const lo = l.estimateLow, hi = l.estimateHigh;
  if (lo && lo > 0) return (hi && hi > lo ? (lo + hi) / 2 : lo) * fx;
  if (l.currentBid && l.currentBid > 0) return l.currentBid * fx;
  return null;
}
const logUsd = (l: L) => { const u = usd(l); return u ? Math.log10(u) : null; };
const ekOf = (M0: M, l: L) => M0.featOf(l, NOW).ek;
const saved = (ls: L[]): RecsMod.SavedInput[] => ls.map((l, i) => ({ id: l.id, lot: l, owned: i === 0, savedAt: new Date(NOW - (3 + i * 9) * 864e5).toISOString() }));
const normT = (t: string) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function main() {
  const A: M = await import('../app/lib/recs');
  const B: M | null = implB ? await import(path.resolve(implB)) : null;
  const impls: [string, M][] = B ? [['new', A], ['base', B]] : [['new', A]];
  /** --sweep: the holdout re-run for tuning variants of the new recommender
   *  (RecOpts.tune) — how REC_TUNE was chosen */
  const variants: [string, Partial<RecsMod.RecTune>][] = sweep ? [
    // R3's proposals, re-run under this deal (its caps / phases / quota)
    ['R3 v8: soft quality + softer diversity, entity tie .34', { entityTie: 0.34, namedEnt: 0.9, namedSale: 0.93, namedSeed: 0.9, genEnt: 0.9, genSale: 0.93, genSeed: 0.9 }],
    ['R3 v7: v8 + entity tie .5', { namedEnt: 0.9, namedSale: 0.93, namedSeed: 0.9, genEnt: 0.9, genSale: 0.93, genSeed: 0.9 }],
    // one knob at a time off the shipped tune
    ['one curve for every tie (named = generic)', { namedEnt: 0.7, namedSale: 0.93, namedSeed: 0.95 }],
    ['named ties discounted (.9/.93/.9)', { namedEnt: 0.9, namedSale: 0.93, namedSeed: 0.9 }],
    ['generic ties harder (.6/.85/.8)', { genEnt: 0.6, genSale: 0.85, genSeed: 0.8 }],
    ['entity tie .34 (was)', { entityTie: 0.34 }],
    ['quality .45 + .55q (was)', { qBase: 0.45 }],
    ['named lift x1.5', { namedLift: 1.5 }],
    ['no generic sale cap', { saleShare: 1 }],
    ['no signal seats', { sigSeats: 0 }],
  ] : [];
  const out: Record<string, unknown> = { book: book.generatedAt, now: new Date(NOW).toISOString(), pool: pool.length };
  say(`# recs eval · book ${book.generatedAt} · clock ${new Date(NOW).toISOString()} · ${pool.length} lots on the block${B ? ` · base = ${implB}` : ''}`);

  /* ═══ 1 · latent-taste holdout ═══ */
  const byEnt = new Map<string, L[]>();
  for (const l of pool) { const ek = ekOf(A, l); if (ek && !ek.startsWith('cs:')) { if (!byEnt.has(ek)) byEnt.set(ek, []); byEnt.get(ek)!.push(l); } }
  const entList = Array.from(byEnt.entries()).filter(([, v]) => v.length >= 5).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  type P = { saves: L[]; held: L[]; nE: number; eks: Set<string> };
  function personas(nE: number, nC: number, seed: number): P[] {
    const r = rng(seed); const ps: P[] = []; let g = 0;
    while (ps.length < NP && g++ < 20000) {
      const [k0, v0] = entList[Math.floor(r() * entList.length)];
      const t0 = T(v0[0]);
      const sibs = entList.filter(([k, v]) => k !== k0 && T(v[0]).cat === t0.cat && T(v[0]).sub === t0.sub && (T(v[0]).sport ?? null) === (t0.sport ?? null));
      if (sibs.length < 2) continue;
      const ents = [[k0, v0] as [string, L[]], ...shuffle(sibs, r).slice(0, 2)];
      const prices = ents.flatMap(([, v]) => v.map(logUsd).filter((x): x is number => x != null));
      if (prices.length < 6) continue;
      const c = med(prices);
      const inBand = (l: L) => { const a = logUsd(l); return a != null && Math.abs(a - c) <= 0.4; };
      const used = new Set<string>(); const usedT = new Set<string>(); const saves: L[] = [];
      for (const [, v] of ents) for (const l of shuffle(v.filter(inBand), r).slice(0, 2)) { saves.push(l); used.add(l.id); usedT.add(normT(l.title)); }
      if (saves.length < 5) continue;
      const fresh = (l: L) => !used.has(l.id) && !usedT.has(normT(l.title));
      const eks = new Set(ents.map(([k]) => k));
      const heldE = shuffle(ents.flatMap(([, v]) => v.filter(inBand)), r).filter(fresh).slice(0, nE);
      const cut = shuffle(pool.filter(l => { const t = T(l); return t.cat === t0.cat && t.sub === t0.sub && (t.sport ?? null) === (t0.sport ?? null) && !eks.has(ekOf(A, l) ?? '') && inBand(l); }), r).filter(fresh).slice(0, nC);
      if (heldE.length < nE || cut.length < nC) continue;
      ps.push({ saves, held: [...heldE, ...cut], nE, eks });
    }
    return ps;
  }
  const dcg = (ids: string[], held: Set<string>) => ids.reduce((s, id, i) => s + (held.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
  const idcg = (k: number) => { let s = 0; for (let i = 0; i < k; i++) s += 1 / Math.log2(i + 2); return s; };
  const holdout: Record<string, unknown> = {};
  for (const [mix, nE, nC, seed] of [['entity-heavy 4:2', 4, 2, 2026], ['cut-heavy 2:4', 2, 4, 4040]] as const) {
    const ps = personas(nE, nC, seed);
    say(`\n## 1 · latent-taste holdout · ${mix} · ${ps.length} collectors (cats: ${Array.from(new Set(ps.map(p => T(p.saves[0]).cat))).join(', ')})`);
    say('| impl | HR@24 | ±95% | entity HR | cut HR | nDCG@24 | names in 24 | max/sale | Δ vs names-by-priority (W/L) | Δ vs the same, one seat per object (W/L) |');
    say('|---|---|---|---|---|---|---|---|---|---|');
    // THE BASELINES: the saved names' live lots by priority — as is, and with
    // the recommender's own one-seat-per-object rule (the same card in another
    // grade, the same title at one house, a twin of a save is one seat)
    const baseHr: number[] = [], baseHrD: number[] = [];
    const objKey = (l: L) => { const f = A.featOf(l, NOW); return f.card ? `card:${f.card}` : `t:${l.auctionHouse}|${normT(l.title)}`; };
    for (const p of ps) {
      const s = new Set(p.saves.map(l => l.id)); const eks = new Set(p.saves.map(l => ekOf(A, l)));
      const sorted = pool.filter(l => eks.has(ekOf(A, l)) && !s.has(l.id)).sort((a, b) => PRIO(b) - PRIO(a) || (a.id < b.id ? -1 : 1));
      const top = sorted.slice(0, 24).map(l => l.id);
      baseHr.push(p.held.filter(h => top.includes(h.id)).length / p.held.length);
      const taken = new Set(p.saves.map(objKey)); const topD: string[] = [];
      for (const l of sorted) { if (topD.length >= 24) break; const k = objKey(l); if (taken.has(k)) continue; taken.add(k); topD.push(l.id); }
      baseHrD.push(p.held.filter(h => topD.includes(h.id)).length / p.held.length);
    }
    const res: Record<string, number[]> = {};
    const runs: [string, M, Partial<RecsMod.RecTune> | undefined][] = [...impls.map(([a, b]) => [a, b, undefined] as [string, M, undefined]), ...variants.map(([a, t]) => [`new · ${a}`, A, t] as [string, M, Partial<RecsMod.RecTune>])];
    for (const [name, R, tune] of runs) {
      const hr: number[] = [], he: number[] = [], hc: number[] = [], nd: number[] = [], names: number[] = [], maxSale: number[] = [];
      for (const p of ps) {
        const t = R.buildTaste({ saved: saved(p.saves), follows: [], nowMs: NOW });
        const rec = R.recommend(pool, t, { nowMs: NOW, n: 24, tune });
        const ids = rec.map(x => x.lot.id); const set = new Set(ids);
        const held = new Set(p.held.map(h => h.id));
        hr.push(p.held.filter(h => set.has(h.id)).length / p.held.length);
        if (process.env.EVAL_LOSSES && name === 'new' && !tune) {
          const sv = new Set(p.saves.map(l => l.id)); const eks = new Set(p.saves.map(l => ekOf(A, l)));
          const top = pool.filter(l => eks.has(ekOf(A, l)) && !sv.has(l.id)).sort((a, b) => PRIO(b) - PRIO(a) || (a.id < b.id ? -1 : 1)).slice(0, 24).map(l => l.id);
          const bh = p.held.filter(h => top.includes(h.id)).length, nh = p.held.filter(h => set.has(h.id)).length;
          if (bh > nh) {
            const rows = R.scoreLots(pool, t, { nowMs: NOW }); const ranked = rows.map(x => x.l.id);
            const sameName = pool.filter(l => eks.has(ekOf(A, l)) && !sv.has(l.id)).length;
            console.log(`LOSS ${bh} vs ${nh} · names ${Array.from(eks).join(', ')} (${sameName} live) · picks same-name ${rec.filter(x => eks.has(ekOf(A, x.lot as L))).length}/24`);
            for (const h of p.held.slice(0, p.nE)) if (!set.has(h.id) && top.includes(h.id)) { const rw = rows.find(x => x.l.id === h.id); console.log(`   missed ${h.title.slice(0, 50)} $${Math.round(usd(h) ?? 0)} · rank ${ranked.indexOf(h.id)} · score ${rw?.score.toFixed(3)} seed ${rw?.best.seed.kind}:${rw?.best.seed.label.slice(0, 30)} ent ${rw?.best.parts?.entity} card ${rw?.f.card} · sale ${saleKeyOf(h as Parameters<typeof saleKeyOf>[0])}`); }
            console.log(`   picks: ${rec.map(x => `${x.score.toFixed(2)}${eks.has(ekOf(A, x.lot as L)) ? 'N' : x.tier !== 1 ? 'L' : 'c'}`).join(' ')}`);
            for (const x of rec.filter(x => !eks.has(ekOf(A, x.lot as L))).slice(0, 4)) console.log(`   other: ${x.lot.title.slice(0, 50)} $${Math.round(usd(x.lot as L) ?? 0)} ← ${x.reason.slice(0, 60)}`);
          }
        }
        he.push(p.held.slice(0, p.nE).filter(h => set.has(h.id)).length / p.nE);
        hc.push(p.held.slice(p.nE).filter(h => set.has(h.id)).length / (p.held.length - p.nE));
        nd.push(dcg(ids, held) / idcg(Math.min(24, held.size)));
        names.push(new Set(rec.map(x => ekOf(A, x.lot as L) ?? x.lot.id)).size);
        const bySale = new Map<string, number>(); for (const x of rec) { const k = saleKeyOf(x.lot as Parameters<typeof saleKeyOf>[0]); bySale.set(k, (bySale.get(k) ?? 0) + 1); }
        maxSale.push(Math.max(0, ...Array.from(bySale.values())));
      }
      res[name] = hr;
      const dB = hr.map((x, i) => x - baseHr[i]);
      const dD = hr.map((x, i) => x - baseHrD[i]);
      const wl = (d: number[]) => `${d.filter(x => x > 0).length}/${d.filter(x => x < 0).length}`;
      say(`| ${name} | ${pct(mean(hr))} | ${pct(ci(hr))} | ${pct(mean(he))} | ${pct(mean(hc))} | ${mean(nd).toFixed(3)} | ${mean(names).toFixed(1)} | ${mean(maxSale).toFixed(1)} | ${sgn(mean(dB))} ± ${(ci(dB) * 100).toFixed(1)} (${wl(dB)}) | ${sgn(mean(dD))} ± ${(ci(dD) * 100).toFixed(1)} (${wl(dD)}) |`);
      holdout[`${mix}:${name}`] = { hr: mean(hr), ci: ci(hr), entityHr: mean(he), cutHr: mean(hc), ndcg: mean(nd), names: mean(names), maxSale: mean(maxSale), vsNames: mean(dB), vsNamesDedup: mean(dD) };
    }
    if (B) {
      const d = res.new.map((x, i) => x - res.base[i]);
      say(`| new − base (paired) | ${sgn(mean(d))} ± ${(ci(d) * 100).toFixed(1)} pts | wins ${d.filter(x => x > 0).length} / losses ${d.filter(x => x < 0).length} | | | | | | | |`);
      holdout[`${mix}:delta`] = { d: mean(d), ci: ci(d), w: d.filter(x => x > 0).length, l: d.filter(x => x < 0).length };
    }
    say(`| baseline: saved names by priority | ${pct(mean(baseHr))} | ${pct(ci(baseHr))} | | | | | | | |`);
    say(`| baseline: the same, one seat per object | ${pct(mean(baseHrD))} | ${pct(ci(baseHrD))} | | | | | | | |`);
    holdout[`${mix}:namesBaseline`] = mean(baseHr);
    holdout[`${mix}:namesBaselineDedup`] = mean(baseHrD);
  }
  out.holdout = holdout;
  if (holdoutOnly) return;

  /* ═══ 2 · scenarios ═══ */
  say('\n## 2 · scenarios');
  const vintageBb = (l: L) => T(l).cat === 'sports-cards' && T(l).sub === 'singles' && T(l).sport === 'baseball' && FX(l).has('era-vintage') && FX(l).has('graded');
  const scen: Record<string, Record<string, unknown>> = {};
  for (const [name, R] of impls) {
    const S: Record<string, unknown> = (scen[name] = {});
    // signals: 8 vintage-baseball saves + N views of TCG lots
    {
      const r = rng(5);
      const desk = shuffle(pool.filter(vintageBb), r).slice(0, 8);
      const poke = shuffle(pool.filter(l => T(l).cat === 'tcg'), r);
      const row: string[] = [];
      for (const n of [0, 5, 15, 40]) {
        const extra = poke.slice(0, n).map(l => ({ lot: l, weight: 0.25, reason: 'looked at' }));
        const t = R.buildTaste({ saved: saved(desk), follows: [], extra, nowMs: NOW });
        const rec = R.recommend(pool, t, { nowMs: NOW, n: 24 });
        row.push(`N=${n}: ${rec.filter(x => x.seed.kind === 'signal').length}/24`);
        S[`signals${n}`] = rec.filter(x => x.seed.kind === 'signal').length;
      }
      say(`[${name}] signals · 8 saves + N TCG lot views → seats the views explain: ${row.join(' · ')}`);
    }
    // negative feedback: pass on the top pick 5 times
    {
      const r = rng(13);
      const rows: number[][] = [];
      for (let i = 0; i < 12; i++) {
        const ents = shuffle(entList.filter(([, v]) => v.length >= 10), r).slice(0, 3);
        const desk = ents.flatMap(([, v]) => v.slice(0, 2));
        const t0 = R.buildTaste({ saved: saved(desk), follows: [], nowMs: NOW });
        const base = R.recommend(pool, t0, { nowMs: NOW, n: 12 });
        if (!base.length) continue;
        const seedLabel = base[0].seed.label;
        const ek0 = ekOf(A, base[0].lot as L);
        let ids: string[] = [], keys: string[] = [], lots: L[] = [];
        let rec = base;
        for (let k = 0; k < 5 && rec.length; k++) {
          const top = rec[0].lot as L;
          ids = [...ids, top.id]; keys = [...keys, ...quietKeysOf(top)]; lots = [...lots, top];
          const t = R.buildTaste({ saved: saved(desk), follows: [], negative: { ids, keys, lots } as RecsMod.NegativeInput, nowMs: NOW });
          rec = R.recommend(pool, t, { nowMs: NOW, n: 12 });
        }
        rows.push([base.filter(x => x.seed.label === seedLabel).length, rec.filter(x => x.seed.label === seedLabel).length, base.filter(x => ekOf(A, x.lot as L) === ek0).length, rec.filter(x => ekOf(A, x.lot as L) === ek0).length]);
      }
      S.negSeed = [mean(rows.map(x => x[0])), mean(rows.map(x => x[1]))];
      S.negEnt = [mean(rows.map(x => x[2])), mean(rows.map(x => x[3]))];
      say(`[${name}] "Not for me" ×5 on the top pick · its seed ${mean(rows.map(x => x[0])).toFixed(1)} → ${mean(rows.map(x => x[1])).toFixed(1)} of 12 · its entity ${mean(rows.map(x => x[2])).toFixed(1)} → ${mean(rows.map(x => x[3])).toFixed(1)} of 12`);
      // a pass on a lot with no named entity (a collection bucket) quiets its cut
      const cs = pool.filter(l => vintageBb(l) && !(ekOf(A, l) ?? '').match(/^(?:pl|mk|sj|st):/));
      if (cs.length) {
        const tf = R.buildTaste({ saved: [], follows: [{ kind: 'cat', key: 'sports-cards:singles', label: 'Sports Cards · Singles' }], nowMs: NOW });
        const r0 = R.recommend(pool, tf, { nowMs: NOW, n: 24 });
        const victim = r0.find(x => !(ekOf(A, x.lot as L) ?? '').match(/^(?:pl|mk|sj|st):/));
        if (victim) {
          const cutOf = (l: L) => `${T(l).cat}|${T(l).sub}|${T(l).sport}|${Array.from(FX(l)).find(k => k.startsWith('era-')) ?? ''}`;
          const vc = cutOf(victim.lot as L);
          const tn = R.buildTaste({ saved: [], follows: [{ kind: 'cat', key: 'sports-cards:singles', label: 'Sports Cards · Singles' }], negative: { ids: [victim.lot.id], keys: quietKeysOf(victim.lot), lots: [victim.lot] } as RecsMod.NegativeInput, nowMs: NOW });
          const r1 = R.recommend(pool, tn, { nowMs: NOW, n: 24 });
          S.negCut = [r0.filter(x => cutOf(x.lot as L) === vc).length, r1.filter(x => cutOf(x.lot as L) === vc).length];
          say(`[${name}] "Not for me" on an unnamed lot (cut ${vc}) · same-cut seats ${r0.filter(x => cutOf(x.lot as L) === vc).length} → ${r1.filter(x => cutOf(x.lot as L) === vc).length} of 24`);
        }
      }
    }
    // price skew: follow one name
    {
      const rows: string[] = []; const ratios: number[] = [];
      for (const [slug, label, kind] of [['andy-warhol', 'Andy Warhol', 'maker'], ['shohei-ohtani', 'Shohei Ohtani', 'maker'], ['sj:tcg|k:charizard', 'Charizard', 'entity'], ['michael-jordan', 'Michael Jordan', 'maker'], ['pablo-picasso', 'Pablo Picasso', 'maker']] as const) {
        const fo: Follow = kind === 'maker' ? makerFollow(slug, label) : entityFollow(slug, label);
        const mine = pool.filter(l => kind === 'maker' ? (l.artist === slug || l.playerSlug === slug || ekOf(A, l) === `pl:${slug}` || ekOf(A, l) === `mk:${slug}`) : ekOf(A, l) === slug).map(usd).filter((x): x is number => !!x);
        if (mine.length < 6) continue;
        const t = R.buildTaste({ saved: [], follows: [fo], nowMs: NOW });
        const rec = R.recommend(pool, t, { nowMs: NOW, n: 12 });
        const pm = med(rec.map(x => usd(x.lot as L)).filter((x): x is number => !!x));
        const ratio = pm / med(mine);
        ratios.push(ratio);
        rows.push(`${label} ×${ratio.toFixed(1)} ($${Math.round(pm).toLocaleString()} vs $${Math.round(med(mine)).toLocaleString()})`);
      }
      S.skew = ratios;
      say(`[${name}] follow one name → top-12 median price ÷ the name's median: ${rows.join(' · ')}`);
    }
    // engine-flagged share + band-claim honesty + per-sale concentration
    {
      const r = rng(77);
      const fp: number[] = [], fc: number[] = [];
      let claims = 0, bad = 0;
      for (let i = 0; i < 40; i++) {
        const ents = shuffle(entList.filter(([, v]) => v.length >= 8), r).slice(0, 2);
        const desk = ents.flatMap(([, v]) => shuffle(v, r).slice(0, 3));
        const t = R.buildTaste({ saved: saved(desk), follows: [], nowMs: NOW });
        const rec = R.recommend(pool, t, { nowMs: NOW, n: 24 });
        const rows = R.scoreLots(pool, t, { nowMs: NOW });
        fp.push(rec.filter(x => isFlagged(x.lot as Parameters<typeof isFlagged>[0])).length / Math.max(1, rec.length));
        fc.push(rows.filter(x => isFlagged(x.l as Parameters<typeof isFlagged>[0])).length / Math.max(1, rows.length));
        for (const x of rec) {
          const note = R.recNote(x);
          const m = note.match(/(?:in your |· )\$([\d.]+)(K|M)?[–-]([\d.]+)(K|M)?(?: range)?/);
          if (!m || /near your/.test(note)) continue;
          const num = (v: string, u?: string) => Number(v) * (u === 'M' ? 1e6 : u === 'K' ? 1e3 : 1);
          const lo = num(m[1], m[2]), hi = num(m[3], m[4]);
          const a = R.featOf(x.lot, NOW).logA;
          claims++;
          if (a != null && (Math.pow(10, a) < lo * 0.95 || Math.pow(10, a) > hi * 1.05)) bad++;
        }
      }
      S.flagged = [mean(fp), mean(fc)];
      S.bandClaims = [claims, bad];
      say(`[${name}] engine-flagged: ${pct(mean(fp))} of picks vs ${pct(mean(fc))} of candidates · printed price bands ${claims}, lot outside its band ${bad}`);
    }
    // memo: a long-lived tab vs a fresh one, 3 days on
    {
      const r = rng(31);
      const desk = shuffle(pool.filter(vintageBb), r).slice(0, 8);
      const t0 = R.buildTaste({ saved: saved(desk), follows: [makerFollow('mickey-mantle', 'Mickey Mantle')], nowMs: NOW });
      R.recommend(pool, t0, { nowMs: NOW, n: 24 }); // warm the memo at day 0
      const later = NOW + 3 * 864e5;
      const m1 = R.recommend(pool, R.buildTaste({ saved: saved(desk), follows: [makerFollow('mickey-mantle', 'Mickey Mantle')], nowMs: later }), { nowMs: later, n: 24 }).map(x => x.lot.id);
      const fresh: L[] = JSON.parse(JSON.stringify(pool)); const deskF = desk.map(d => fresh.find(x => x.id === d.id)!);
      const m2 = R.recommend(fresh, R.buildTaste({ saved: saved(deskF), follows: [makerFollow('mickey-mantle', 'Mickey Mantle')], nowMs: later }), { nowMs: later, n: 24 }).map(x => x.lot.id);
      S.memoDiff = m1.filter((id, i) => m2[i] !== id).length;
      say(`[${name}] memo · a tab kept open 3 days vs a fresh load: ${S.memoDiff} of 24 positions differ`);
    }
    // quick start: a market with no names; a stated range
    {
      const rows: string[] = [];
      for (const m of ['tcg', 'art', 'sports', 'culture']) {
        const t = R.buildTaste({ saved: [], follows: [], markets: [m], nowMs: NOW } as RecsMod.TasteInput);
        const rec = R.recommend(pool, t, { nowMs: NOW, n: 24 });
        rows.push(`${m} ${rec.length}`);
        S[`market:${m}`] = rec.length;
      }
      say(`[${name}] quick start, a market and no names → picks: ${rows.join(' · ')}`);
      const st: string[] = [];
      for (const [fo, price, lab] of [
        [[makerFollow('patek-philippe', 'Patek Philippe'), makerFollow('audemars-piguet', 'Audemars Piguet')], { minUsd: 50000, maxUsd: null }, 'Patek+AP $50K+'],
        [[entityFollow('sj:tcg|k:charizard', 'Charizard')], { minUsd: null, maxUsd: 1000 }, 'Charizard <$1K'],
        [[makerFollow('pablo-picasso', 'Pablo Picasso'), makerFollow('andy-warhol', 'Andy Warhol')], { minUsd: null, maxUsd: 1000 }, 'Picasso+Warhol <$1K'],
      ] as [Follow[], RecsMod.StatedPriceInput, string][]) {
        const t = R.buildTaste({ saved: [], follows: fo, price, nowMs: NOW });
        const rec = R.recommend(pool, t, { nowMs: NOW, n: 24 });
        const inR = rec.filter(x => { const u = usd(x.lot as L); return u != null && (price.minUsd == null || u >= price.minUsd * 0.8) && (price.maxUsd == null || u <= price.maxUsd * 1.25); }).length;
        const top12 = rec.slice(0, 12).filter(x => { const u = usd(x.lot as L); return u != null && (price.minUsd == null || u >= price.minUsd * 0.8) && (price.maxUsd == null || u <= price.maxUsd * 1.25); }).length;
        st.push(`${lab}: ${inR}/${rec.length} in range (top 12: ${top12})`);
        S[`stated:${lab}`] = [inR, rec.length, top12];
      }
      say(`[${name}] stated range: ${st.join(' · ')}`);
    }
    // freshness over 3 days on the WHOLE book (recs must drop closed lots on their own)
    {
      const r = rng(41);
      const desk = shuffle(pool.filter(vintageBb), r).slice(0, 8);
      let stale = 0;
      for (let d = 0; d < 3; d++) {
        const now = NOW + d * 864e5;
        const rec = R.recommend(all, R.buildTaste({ saved: saved(desk), follows: [], nowMs: now }), { nowMs: now, n: 24 });
        for (const x of rec) { const c = closeMsOf(x.lot as Parameters<typeof closeMsOf>[0]); if ((c != null && c <= now) || isClosedPending(x.lot as Parameters<typeof isClosedPending>[0], now)) stale++; }
      }
      S.stale = stale;
      const cold = R.recommend(pool, R.buildTaste({ saved: [], follows: [], nowMs: NOW }), { nowMs: NOW }).length;
      S.cold = cold;
      say(`[${name}] freshness: ${stale} closed picks over 3 days · cold start: ${cold} picks`);
    }
    // perf
    {
      const r = rng(7);
      const desk = shuffle(pool.filter(vintageBb), r).slice(0, 8);
      const t = R.buildTaste({ saved: saved(desk), follows: [], nowMs: NOW });
      R.recommend(pool, t, { nowMs: NOW, n: 24 });
      const t0 = performance.now(); for (let i = 0; i < 5; i++) R.recommend(pool, t, { nowMs: NOW, n: 24 }); S.ms = (performance.now() - t0) / 5;
      say(`[${name}] perf: warm recommend n=24 for an 8-save desk ${(S.ms as number).toFixed(0)} ms`);
    }
  }
  out.scenarios = scen;

  /* ═══ 3 · ten collectors (R1) ═══ */
  say('\n## 3 · ten collectors (R1 personas, encoded judge)');
  const D = 864e5;
  const byId = new Map(all.map(l => [l.id, l]));
  const ent = (id: string, label: string, ago = 2 * D, n = 2, dwell = 30000) => ({ k: 'entity' as const, id, label, t0: NOW - ago - D, t: NOW - ago, n, dwell });
  const srch = (id: string, ago = D) => ({ k: 'search' as const, id, t0: NOW - ago, t: NOW - ago, n: 1 });
  const mk = (key: string, label: string): Follow => ({ kind: 'maker', key, label });
  const en = (key: string, label: string): Follow => ({ kind: 'entity', key, label });
  const cat = (key: string, label: string): Follow => ({ kind: 'cat', key, label });
  const title = (l: L) => String(l.title || '');
  const year = (l: L): number | null => {
    if (l.yearNum) return l.yearNum;
    const m = title(l).match(/\b(19[0-9]{2}|20[0-3][0-9])\b/); if (m) return Number(m[1]);
    const s = title(l).match(/^'?([0-9]{2})\s/); return s ? (Number(s[1]) > 40 ? 1900 : 2000) + Number(s[1]) : null;
  };
  const grade = (l: L) => { const c = parseCard(title(l)); return c.gradeNum ?? null; };
  const isCard = (l: L) => { const c = parseCard(title(l)); return !c.notCard && !!(c.cardNo || c.setName) && !/\b(vinyl|guitar|les paul|book|poster|jersey (?:signed|framed)|record)\b/i.test(title(l)); };
  /** the price a collector reads on the card: the estimate / projected hammer (the engine anchor), else the raw bid */
  const shown = (l: L) => priorityOf(l, NOW)?.a || usd(l);
  const priced = (l: L, lo: number | null, hi: number | null) => { const u = shown(l); if (u == null) return true; return (lo == null || u >= lo * 0.8) && (hi == null || u <= hi * 1.25); };
  const POP_PRINT = /^(?:andy-warhol|keith-haring|roy-lichtenstein|kaws|david-hockney|jean-michel-basquiat|banksy|takashi-murakami|alex-katz|robert-indiana|ed-ruscha|jeff-koons|tom-wesselmann|james-rosenquist|robert-rauschenberg|jasper-johns|damien-hirst|george-condo|kenny-scharf|futura-2000)$/;
  const ROCK = /\b(beatles|lennon|mccartney|harrison|ringo|rolling stones|jagger|keith richards|elvis|hendrix|led zeppelin|jimmy page|robert plant|queen|freddie mercury|bowie|pink floyd|the who|doors|jim morrison|nirvana|cobain|kiss|ac\/dc|springsteen|dylan|pearl jam|guns n|metallica|clapton|grateful dead|janis joplin|ramones|sex pistols|u2|bon jovi|aerosmith|van halen|eagles|fleetwood|prince|stones)\b/i;
  const SW = /\b(star wars|mandalorian|andor|ahsoka|jedi|sith|stormtrooper|lightsaber|grogu|boba fett|darth|chewbacca|skywalker|obi-wan|empire strikes|clone wars|rogue one|ewok|snowtrooper|bowcaster)\b/i;
  interface R1P { id: string; who: string; follows: Follow[]; interests: { markets: string[]; minUsd: number | null; maxUsd: number | null }; ev: Record<string, unknown>[]; more: string[]; hit: (l: L) => boolean }
  const R1: R1P[] = [
    { id: 'p01-warhol-haring', who: 'Warhol/Haring prints < $20K', follows: [mk('andy-warhol', 'Andy Warhol'), mk('keith-haring', 'Keith Haring'), cat('fine-art:prints', 'Fine Art · Prints & Multiples')], interests: { markets: ['art'], minUsd: null, maxUsd: 20000 },
      ev: [ent('mk:andy-warhol', 'Andy Warhol'), srch('warhol screenprint'), srch('haring pop shop')], more: [],
      hit: l => T(l).cat === 'fine-art' && POP_PRINT.test(l.artist) && !/\b(poster|westwood|jacket|shirt|dress|garment|skirt|t-shirt)\b/i.test(title(l)) && priced(l, l.artist === 'andy-warhol' || l.artist === 'keith-haring' ? null : 800, 20000) },
    { id: 'p02-vintage-baseball', who: 'Vintage baseball PSA 5–8 (Mantle, Mays, Aaron) $1K–50K', follows: [mk('mickey-mantle', 'Mickey Mantle'), mk('willie-mays', 'Willie Mays'), mk('hank-aaron', 'Hank Aaron')], interests: { markets: ['sports'], minUsd: 1000, maxUsd: 50000 },
      ev: [ent('pl:mickey-mantle', 'Mickey Mantle'), srch('1952 topps mantle'), srch('psa 7 mays')], more: ['goldin-202608-2520-1750-9ce6b59c-1e50-41e9-9f13-732c49951f2a'],
      hit: l => T(l).cat === 'sports-cards' && T(l).sport === 'baseball' && isCard(l) && (year(l) ?? 2000) <= 1979 && !/reprint|archives|complete set|\(\d{3,}\)/i.test(title(l)) && (grade(l) ?? 0) >= 4 && priced(l, 1000, 50000) },
    { id: 'p03-modern-hoops', who: 'Modern basketball rookies (Wembanyama, Flagg) $250–10K', follows: [mk('victor-wembanyama', 'Victor Wembanyama'), mk('cooper-flagg', 'Cooper Flagg'), cat('sports-cards:singles', 'Sports Cards · Singles')], interests: { markets: ['sports'], minUsd: 250, maxUsd: 10000 },
      ev: [ent('pl:victor-wembanyama', 'Victor Wembanyama'), srch('wembanyama prizm rookie'), srch('flagg rookie auto')], more: [],
      hit: l => T(l).cat === 'sports-cards' && T(l).sport === 'basketball' && isCard(l) && (year(l) ?? 0) >= 2018 && priced(l, 250, 10000) },
    { id: 'p04-pokemon-vintage-jp', who: 'Pokémon vintage Japanese graded $500–25K', follows: [en('sj:tcg|k:charizard', 'Charizard'), en('sj:tcg|k:pikachu', 'Pikachu'), cat('tcg:vintage', 'Pokémon & TCG · Vintage (1996–2003)')], interests: { markets: ['tcg'], minUsd: 500, maxUsd: 25000 },
      ev: [srch('japanese base set psa'), srch('pocket monsters'), ent('sj:tcg|k:charizard', 'Charizard')], more: [],
      hit: l => T(l).cat === 'tcg' && isCard(l) && (year(l) ?? 2010) <= 2003 && FX(l).has('graded') && priced(l, 500, 25000) },
    { id: 'p05-patek-ap', who: 'Patek / AP watch buyer $50K+', follows: [mk('patek-philippe', 'Patek Philippe'), mk('audemars-piguet', 'Audemars Piguet')], interests: { markets: ['watches'], minUsd: 50000, maxUsd: null },
      ev: [ent('mk:patek-philippe', 'Patek Philippe'), srch('patek perpetual calendar'), srch('royal oak')], more: [],
      hit: l => T(l).cat === 'watches' && (l.objectClass === 'watch' || /watch|montre|chrono/i.test(title(l))) && !/\b(menu|collier|necklace|bracelet maillons)\b/i.test(title(l)) && (shown(l) ?? 0) >= 40000 },
    { id: 'p06-star-wars-props', who: 'Star Wars props $1K+', follows: [en('sj:culture|fr:fr-starwars', 'Star Wars'), cat('entertainment:props-costumes', 'Entertainment · Props & Wardrobe')], interests: { markets: ['culture'], minUsd: 1000, maxUsd: null },
      ev: [srch('star wars screen used'), srch('stormtrooper helmet')], more: [],
      hit: l => T(l).cat === 'entertainment' && (SW.test(title(l)) || FX(l).has('fr-starwars') || (/production[- ](?:used|made)|screen[- ](?:used|worn)|hero prop/i.test(title(l)) && priced(l, 1000, null))) },
    { id: 'p07-apollo-flown', who: 'Apollo flown items $1K+', follows: [en('sj:science|m:apollo-11', 'Apollo 11'), cat('space-science:apollo', 'Space · Apollo')], interests: { markets: ['science'], minUsd: 1000, maxUsd: null },
      ev: [srch('flown apollo'), srch('lunar surface flown'), ent('sj:science|m:apollo-11', 'Apollo 11')], more: [],
      hit: l => T(l).cat === 'space-science' && /apollo|lunar|moon(?!walk)/i.test(title(l)) && (FX(l).has('flown') || /\bflown\b/i.test(title(l))) },
    { id: 'p08-beatles-rock', who: 'Beatles / rock signed $500–50K', follows: [en('sj:culture|fr:fr-beatles', 'The Beatles'), en('sj:culture|p:john-lennon', 'John Lennon'), en('sj:culture|fr:fr-stones', 'Rolling Stones'), cat('entertainment:instruments-records', 'Entertainment · Instruments, Records & Awards')], interests: { markets: ['culture'], minUsd: 500, maxUsd: 50000 },
      ev: [srch('beatles signed'), srch('signed album')], more: [],
      hit: l => T(l).cat === 'entertainment' && ROCK.test(title(l)) && priced(l, 500, 50000) },
    { id: 'p09-design', who: 'Design: Prouvé, Nakashima $2.5K–100K', follows: [mk('jean-prouve', 'Jean Prouvé'), mk('george-nakashima', 'George Nakashima'), cat('design:seating', 'Design · Seating')], interests: { markets: ['design'], minUsd: 2500, maxUsd: 100000 },
      ev: [ent('mk:george-nakashima', 'George Nakashima'), srch('conoid')], more: [],
      hit: l => T(l).cat === 'design' && priced(l, 2500, 100000) },
    { id: 'p10-mixed', who: 'Mixed: Jordan + Charizard + Rolex $1K–100K', follows: [mk('michael-jordan', 'Michael Jordan'), en('sj:tcg|k:charizard', 'Charizard'), mk('rolex', 'Rolex')], interests: { markets: ['sports', 'tcg', 'watches'], minUsd: 1000, maxUsd: 100000 },
      ev: [srch('jordan fleer rookie'), srch('daytona')], more: [],
      hit: l => priced(l, 1000, 100000) && !/complete set|\(\d{3,}\)|lot of/i.test(title(l)) && ((/jordan/i.test(title(l)) && (T(l).cat === 'sports-cards' || T(l).cat === 'sports-memorabilia')) || (T(l).cat === 'tcg' && /charizard/i.test(title(l)) && isCard(l)) || (T(l).cat === 'watches' && l.artist === 'rolex')) },
  ];
  /** a near-duplicate of a pick above (one sale, the same title stem) never counts twice */
  const stem = (l: L) => `${saleKeyOf(l as Parameters<typeof saleKeyOf>[0])}|${normT(title(l)).replace(/\b(left|right|pair|one|two|no|lot|\d+)\b/g, '').replace(/\s+/g, ' ').slice(0, 34)}`;
  const r1: Record<string, unknown> = {};
  const totals: Record<string, [number, number]> = {};
  say('| persona | ' + impls.map(([n]) => `${n}: hits/picks · max/sale · in range`).join(' | ') + ' |');
  for (const p of R1) {
    const cells: string[] = [];
    for (const [name, R] of impls) {
      const store: SignalStore = { v: 1, ev: p.ev as unknown as SignalStore['ev'], marks: p.more.map(id => ({ k: 'more' as const, id, t: NOW - D, lot: byId.get(id) as never })) };
      const { extra, negative } = signalsToTaste(store, NOW, id => byId.get(id));
      const taste = R.buildTaste({ saved: [], follows: p.follows, extra, negative, price: { minUsd: p.interests.minUsd, maxUsd: p.interests.maxUsd }, markets: p.interests.markets, nowMs: NOW } as RecsMod.TasteInput);
      const rec = R.recommend(pool, taste, { nowMs: NOW, n: Math.max(24, R.recDepth(taste)) }).slice(0, 24);
      const seen = new Set<string>();
      let hits = 0; const misses: string[] = [];
      for (const x of rec) {
        const l = x.lot as L; const s = stem(l);
        const ok = p.hit(l) && !seen.has(s);
        seen.add(s);
        if (ok) hits++; else misses.push(`${String(l.title).slice(0, 58)} ($${Math.round(usd(l) ?? 0)}) ← ${x.reason.slice(0, 60)}`);
      }
      const bySale = new Map<string, number>(); for (const x of rec) { const k = saleKeyOf(x.lot as Parameters<typeof saleKeyOf>[0]); bySale.set(k, (bySale.get(k) ?? 0) + 1); }
      const inR = rec.filter(x => priced(x.lot as L, p.interests.minUsd, p.interests.maxUsd) && usd(x.lot as L) != null).length;
      cells.push(`${hits}/${rec.length} · ${Math.max(0, ...Array.from(bySale.values()))} · ${inR}`);
      const t = (totals[name] ??= [0, 0]); t[0] += hits; t[1] += rec.length;
      r1[`${p.id}:${name}`] = { hits, picks: rec.length, misses, reasons: rec.map(x => `${x.lot.id} :: ${String(x.lot.title).slice(0, 60)} :: ${R.recNote(x)}`) };
      if (name === 'new' && !quiet) { log(`   ${p.id} misses (new):`); for (const m of misses) log(`     · ${m}`); }
    }
    say(`| ${p.id} | ${cells.join(' | ')} |`);
  }
  say(`| TOTAL | ${impls.map(([n]) => `${totals[n][0]}/${totals[n][1]} (${pct(totals[n][0] / Math.max(1, totals[n][1]))})`).join(' | ')} |`);
  out.r1 = r1; out.r1Totals = totals;
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
}

main().catch(e => { console.error(e); process.exit(1); });
