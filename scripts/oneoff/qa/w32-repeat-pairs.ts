/**
 * W32 (Oct 11 2026) — THE ESTIMATE CARRIED THROUGH TIME, measured on
 * REPEAT-SALE PAIRS: the same object sold at t1 and again at t2. The t1 row
 * (an estimate lot) is valued AS OF t2 — the point-in-time market index,
 * house-bias index and calibration of t2's quarter, comps known before t2
 * (the t2 row itself is never a comp) — under the W24 engine (BEFORE: the
 * estimate anchor sits at its t1 level) and the W32 engine (AFTER: the anchor
 * is carried by the market index), and each value is scored against the t2
 * realized price (all-in to all-in): median abs error, share within ±30%,
 * bias = median realized / value — by age gap (0–1y, 1–2y, 2–4y, 4y+), by
 * market and by identity class.
 *
 * Identity — only keys the corpus already carries, never new matching:
 *   phys   the physical repeat-sale groups (scripts/lib/repeat-sale
 *          groupRepeatSales: serial / numbered edition / photo-matched entity,
 *          complete linkage) — the same object
 *   work   art / design: comp-purity.sameWorkComp (same title, house family,
 *          dimensions within 10%) — the engine's own same-work test
 *   ref    watches: backtest-core.identityKeyOf (the numeric reference) —
 *          the same model, not the same unit
 *   ed     art editions: identityKeyOf (the edition identity) — another
 *          impression of the same edition
 * phys and work are object-level truths; ref and ed are model-level (a
 * noisier truth, reported apart). Cards never enter (the card tiers carry no
 * estimate anchor — untouched by W32).
 *
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/oneoff/qa/w32-repeat-pairs.ts [--cap 1500] [--out data/qa/w32-repeat-pairs.json]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readCorpus } from '../../corpus-io';
import { prepare, candidatePriors, identityKeyOf, calibrationFor, rehydrateState, hasAnyEst, type L, type BacktestState, type Prepared } from '../../backtest-core';
import { groupRepeatSales } from '../../lib/repeat-sale';
import { sameWorkComp } from '../../../app/lib/comp-purity';
import {
  resolveComps, estimateValueEx, setEngineFlags, setCalibration, setTimeIndex, setHouseBias, quarterKey,
  ENGINE_FLAGS_W24, ENGINE_FLAGS_W32, type TimeIndex, type HouseBias, type EngineCalibration, type ValueResult,
} from '../../../app/lib/value';
import type { AuctionLot } from '../../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };
/** the most pairs kept per identity class × market × age gap (seeded sample) */
const CAP = Number(arg('cap') ?? 1500);
const OUT = arg('out') || path.join(process.cwd(), 'data', 'qa', 'w32-repeat-pairs.json');
const ENGINE_EXCLUDED = new Set(['sports-cards', 'graded-cards', 'pokemon']);

type Cls = 'phys' | 'work' | 'ref' | 'ed';
type Pair = { a: L; b: L; cls: Cls };
const GAPS: [string, number, number][] = [['0-1y', 0, 1], ['1-2y', 1, 2], ['2-4y', 2, 4], ['4y+', 4, 1e9]];
const dayOf = (l: AuctionLot) => String(l.saleDate || '').slice(0, 10);
const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
const gapOf = (y: number) => GAPS.find(([, lo, hi]) => y >= lo && y < hi)![0];
const qStartOf = (d: string) => { const q = quarterKey(d); return `${q.slice(0, 4)}-${String((+q.slice(5) - 1) * 3 + 1).padStart(2, '0')}-01`; };

// a seeded shuffle (mulberry32) so a re-run reads the same pairs
let seed = 20261011;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = <T>(a: T[]): T[] => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
interface Grade { n: number; medErr: number | null; w30: number | null; bias: number | null }
const grade = (ratios: number[]): Grade => {
  if (!ratios.length) return { n: 0, medErr: null, w30: null, bias: null };
  const errs = ratios.map(r => Math.abs(r - 1));
  return { n: ratios.length, medErr: Math.round(median(errs) * 1000) / 10, w30: Math.round(1000 * errs.filter(e => e <= 0.3).length / errs.length) / 10, bias: Math.round(median(ratios) * 1000) / 1000 };
};

(async () => {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576);
  console.log(`[w32] reading corpus… heap ${mb()}MB`);
  const corpus = readCorpus() as unknown as AuctionLot[];
  const all = corpus.filter(l => !ENGINE_EXCLUDED.has(l.artist) && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
  console.log(`[w32] ${corpus.length} rows · ${all.length} engine-eligible · ${elapsed()} · heap ${mb()}MB`);
  setCalibration(null);
  const prep: Prepared = prepare(all, console.log, elapsed);
  const marketOf = (l: L) => prep.marketBySlug[l.artist] || 'other';
  const soldSorted = prep.sold.slice().sort((a, b) => (a.saleDate < b.saleDate ? -1 : a.saleDate > b.saleDate ? 1 : 0));

  // ── the pairs ────────────────────────────────────────────────────────────
  const pairs: Pair[] = [];
  const pushPairs = (rows: L[], cls: Cls, maxLaterPer = 3) => {
    // every row with an estimate against up to `maxLaterPer` LATER sales of
    // the same identity (seeded), different sale days
    const sorted = rows.slice().sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      if (!hasAnyEst(a)) continue;
      const later = sorted.slice(i + 1).filter(b => dayOf(b) > dayOf(a) && (b.realizedUsd || 0) > 0);
      for (const b of shuffle(later).slice(0, maxLaterPer)) pairs.push({ a, b, cls });
    }
  };
  // phys — the physical repeat-sale groups
  {
    const rs = groupRepeatSales(soldSorted as AuctionLot[], all, prep.tbl);
    const byG = new Map<string, L[]>();
    const byId = new Map(prep.sold.map(l => [String(l.id), l]));
    rs.groupOf.forEach((g, id) => { const l = byId.get(id); if (l) (byG.get(g) || byG.set(g, []).get(g)!).push(l); });
    byG.forEach(rows => pushPairs(rows, 'phys', 10));
    console.log(`[w32] phys: ${rs.physPairs} physical pairs → ${rs.physGroups} groups → ${pairs.length} estimate pairs (${rs.seconds}s)`);
  }
  // work — comp-purity.sameWorkComp within (artist, first two title tokens)
  {
    const n0 = pairs.length;
    const blocks = new Map<string, L[]>();
    for (const l of prep.sold) {
      const m = marketOf(l);
      if (m !== 'art' && m !== 'design') continue;
      const x = l as L & { heightCm?: number | null; widthCm?: number | null };
      if (!((x.heightCm || 0) > 0 && (x.widthCm || 0) > 0)) continue;
      const k = `${l.artist}|${(l.titleTokens || []).slice(0, 2).join(' ')}`;
      (blocks.get(k) || blocks.set(k, []).get(k)!).push(l);
    }
    const seen = new Set<string>();
    blocks.forEach(rows => {
      if (rows.length < 2 || rows.length > 400) return;
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
        const [a, b] = rows[i].saleDate < rows[j].saleDate ? [rows[i], rows[j]] : [rows[j], rows[i]];
        if (dayOf(a) === dayOf(b) || !hasAnyEst(a) || !((b.realizedUsd || 0) > 0)) continue;
        if (!sameWorkComp(a as never, b as never)) continue;
        const k = `${a.id}|${b.id}`;
        if (seen.has(k)) continue;
        seen.add(k); pairs.push({ a, b, cls: 'work' });
      }
    });
    console.log(`[w32] work: ${pairs.length - n0} same-work pairs (art / design) · ${elapsed()}`);
  }
  // ref / ed — the engine's exact identity key
  {
    const n0 = pairs.length;
    const byKey = new Map<string, L[]>();
    for (const l of prep.sold) {
      const m = marketOf(l);
      if (m !== 'watches' && m !== 'art') continue;
      const k = identityKeyOf(l);
      if (k) (byKey.get(`${m}|${k}`) || byKey.set(`${m}|${k}`, []).get(`${m}|${k}`)!).push(l);
    }
    byKey.forEach((rows, k) => { if (rows.length >= 2 && rows.length <= 300) pushPairs(rows, k.startsWith('watches|') ? 'ref' : 'ed', 1); });
    console.log(`[w32] ref / ed: ${pairs.length - n0} same-identity pairs · ${elapsed()}`);
  }
  // the seeded cap per class × market × gap
  const buckets = new Map<string, Pair[]>();
  for (const p of pairs) {
    const k = `${p.cls}|${marketOf(p.a)}|${gapOf(yearsBetween(dayOf(p.a), dayOf(p.b)))}`;
    (buckets.get(k) || buckets.set(k, []).get(k)!).push(p);
  }
  const kept: Pair[] = [];
  buckets.forEach(ps => { for (const p of shuffle(ps).slice(0, CAP)) kept.push(p); });
  console.log(`[w32] ${pairs.length} pairs → ${kept.length} kept (cap ${CAP} per class × market × gap) · ${elapsed()} · heap ${mb()}MB`);

  // ── point-in-time context per t2 quarter ─────────────────────────────────
  let state: BacktestState | null = null;
  try {
    state = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(process.cwd(), 'data', 'corpus', 'backtest-state.json.gz'))).toString('utf8')) as BacktestState;
    rehydrateState(state, prep, console.log);
  } catch { state = null; console.log('[w32] no backtest state — the engines run uncalibrated'); }
  const tiCache = new Map<string, TimeIndex>(), hbCache = new Map<string, HouseBias>(), calCache = new Map<string, EngineCalibration | null>();
  const ctxFor = (t2: string) => {
    const q = qStartOf(t2);
    if (!tiCache.has(q)) {
      tiCache.set(q, prep.timeIndexer!(q));
      hbCache.set(q, prep.houseBiasIndexer!(q));
      calCache.set(q, state ? calibrationFor(state, q, prep.marketBySlug) : null);
    }
    setTimeIndex(tiCache.get(q)!); setHouseBias(hbCache.get(q)!); setCalibration(calCache.get(q)!);
  };
  // comps KNOWN before t2 (the t2 row and its own sale day excluded by the
  // strict cut), the same candidate index + admission as the replay
  const compsAsOf = (a: L, b: L) => {
    const asOf = { ...a, saleDate: dayOf(b) } as L;
    const { priors, cands } = candidatePriors(prep, asOf);
    if (priors < 3) return null;
    let cs = cands.filter(c => c.id !== b.id && c.id !== a.id);
    if (marketOf(a) === 'sports') {
      const pid = (l: L) => { const x = l as L & { playerSlug?: string | null; entity?: string | null }; return x.playerSlug || (x.entity ? x.entity.toLowerCase().trim() : null); };
      const p = pid(a);
      if (p) cs = cs.filter(c => pid(c) === p);
    }
    return resolveComps(a, cs, prep.tbl, dayOf(b));
  };

  // ── value t1 as of t2 — BEFORE (W24) and AFTER (W32) ─────────────────────
  type Row = { cls: Cls; market: string; gap: string; gapY: number; a: string; b: string; t1: string; t2: string; realized: number; realized1: number; compAdj: number | null; before: number | null; after: number | null; afterAbstain: string | null; carry: ValueResult['estCarry'] | null; conf0: string | null; conf1: string | null };
  const rows: Row[] = [];
  kept.sort((p, q) => (dayOf(p.b) < dayOf(q.b) ? -1 : 1)); // quarter-ordered → the caches stay small
  let done = 0;
  for (const p of kept) {
    if (++done % 2000 === 0) console.log(`[w32] ${done}/${kept.length} (${elapsed()})`);
    ctxFor(dayOf(p.b));
    const comps = compsAsOf(p.a, p.b);
    if (!comps) continue;
    setEngineFlags(ENGINE_FLAGS_W24);
    const v0 = estimateValueEx(p.a, comps, prep.tbl);
    setEngineFlags(ENGINE_FLAGS_W32);
    const v1 = estimateValueEx(p.a, comps, prep.tbl);
    setEngineFlags(null);
    const gapY = yearsBetween(dayOf(p.a), dayOf(p.b));
    rows.push({
      cls: p.cls, market: marketOf(p.a), gap: gapOf(gapY), gapY: Math.round(gapY * 100) / 100, a: String(p.a.id), b: String(p.b.id), t1: dayOf(p.a), t2: dayOf(p.b),
      realized: p.b.realizedUsd!, realized1: p.a.realizedUsd!, compAdj: v0.value?.compAdjUsd ?? null, before: v0.value?.compValueUsd ?? null, after: v1.value?.compValueUsd ?? null, afterAbstain: v1.value ? null : (v1.abstain || 'abstain'),
      carry: v1.value?.estCarry ?? null, conf0: v0.value?.confidence ?? null, conf1: v1.value?.confidence ?? null,
    });
  }
  setTimeIndex(null); setHouseBias(null); setCalibration(null);

  // ── the tables ──────────────────────────────────────────────────────────
  const both = rows.filter(r => r.before != null && r.after != null);
  const cell = (rs: Row[]) => ({ before: grade(rs.map(r => r.realized / r.before!)), after: grade(rs.map(r => r.realized / r.after!)) });
  const table = (title: string, rs: Row[], keyOf: (r: Row) => string, keys: string[]) => {
    console.log(`\n${title}`);
    console.log('| cell | n | BEFORE medErr / ±30% / bias | AFTER medErr / ±30% / bias | Δ medErr |');
    console.log('|---|---|---|---|---|');
    const out: Record<string, ReturnType<typeof cell>> = {};
    for (const k of keys) {
      const sub = rs.filter(r => keyOf(r) === k);
      if (!sub.length) continue;
      const c = cell(sub); out[k] = c;
      console.log(`| ${k} | ${c.before.n} | ${c.before.medErr}% / ${c.before.w30}% / ${c.before.bias}× | ${c.after.medErr}% / ${c.after.w30}% / ${c.after.bias}× | ${(c.after.medErr! - c.before.medErr!).toFixed(1)}pt |`);
    }
    return out;
  };
  const gapKeys = GAPS.map(g => g[0]);
  const markets = Array.from(new Set(both.map(r => r.market))).sort();
  const result: Record<string, unknown> = {};
  const objectLevel = both.filter(r => r.cls === 'phys' || r.cls === 'work');
  result.objectByGap = table(`OBJECT-LEVEL pairs (phys + work) by age gap — n${objectLevel.length}`, objectLevel, r => r.gap, gapKeys);
  result.allByGap = table(`ALL pairs by age gap — n${both.length}`, both, r => r.gap, gapKeys);
  for (const c of ['phys', 'work', 'ref', 'ed'] as Cls[]) result[`${c}ByGap`] = table(`${c} by age gap`, both.filter(r => r.cls === c), r => r.gap, gapKeys);
  result.byMarket = table('ALL pairs by market', both, r => r.market, markets);
  result.byMarketGap = table('ALL pairs by market × gap', both, r => `${r.market} ${r.gap}`, markets.flatMap(m => gapKeys.map(g => `${m} ${g}`)));
  result.objectByMarket = table('OBJECT-LEVEL pairs by market', objectLevel, r => r.market, markets);
  // the carry's own record
  const carried = both.filter(r => r.carry);
  result.carryStatus = table('AFTER rows by carry status (thin = confidence demoted)', both, r => (r.carry ? (r.carry.thin ? 'thin' : 'ok') : 'none'), ['none', 'ok', 'thin']);
  const noIndex = rows.filter(r => r.before != null && r.afterAbstain === 'no-index');
  console.log(`\ncoverage: ${rows.length} pairs valued-or-abstained · both valued ${both.length} · carried ${carried.length} · AFTER abstains 'no-index' on ${noIndex.length} rows BEFORE valued (markets: ${JSON.stringify(Object.fromEntries(Array.from(new Set(noIndex.map(r => r.market))).map(m => [m, noIndex.filter(r => r.market === m).length])))})`);
  if (noIndex.length) console.log(`  the no-index rows BEFORE: ${JSON.stringify(grade(noIndex.map(r => r.realized / r.before!)))}`);
  const fs1 = carried.map(r => r.carry!.f).sort((a, b) => a - b);
  if (fs1.length) console.log(`  carry factor on carried rows: median ${median(fs1).toFixed(3)} · p10 ${fs1[Math.floor(fs1.length * 0.1)].toFixed(3)} · p90 ${fs1[Math.floor(fs1.length * 0.9)].toFixed(3)}`);
  // does the index move say anything about the OBJECT's own move (p2 / p1)?
  const slope = (xs: number[], ys: number[]) => {
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return { slope: Math.round(sxy / sxx * 1000) / 1000, corr: Math.round(sxy / Math.sqrt(sxx * syy) * 1000) / 1000 };
  };
  if (carried.length) {
    const own = slope(carried.map(r => Math.log(r.carry!.f)), carried.map(r => Math.log(r.realized / r.realized1)));
    const vsValue = slope(carried.map(r => Math.log(r.carry!.f)), carried.map(r => Math.log(r.realized / r.before!)));
    console.log(`  log(p2 / p1) on log(carry): slope ${own.slope} corr ${own.corr} · log(realized / BEFORE value) on log(carry): slope ${vsValue.slope} corr ${vsValue.corr}`);
    result.indexVsObject = { own, vsValue };
  }
  // the pure comp read as of t2 (compAdjUsd — comps carried to t2, no estimate anchor) beside the anchored value
  const compRows = both.filter(r => r.compAdj);
  console.log(`  pure comps as of t2 (compAdjUsd) on the same rows: ${JSON.stringify(grade(compRows.map(r => r.realized / r.compAdj!)))} vs BEFORE ${JSON.stringify(grade(compRows.map(r => r.realized / r.before!)))}`);
  result.pureCompsByGap = Object.fromEntries(gapKeys.map(g => { const s = compRows.filter(r => r.gap === g && (r.cls === 'phys' || r.cls === 'work')); return [g, { comps: grade(s.map(r => r.realized / r.compAdj!)), before: grade(s.map(r => r.realized / r.before!)) }]; }));
  console.log(`  object-level, pure comps vs BEFORE by gap: ${JSON.stringify(result.pureCompsByGap)}`);
  result.coverage = { rows: rows.length, both: both.length, carried: carried.length, noIndex: noIndex.length, noIndexBefore: grade(noIndex.map(r => r.realized / r.before!)) };
  // sample real pairs for the pinned test: object-level, carried, gap ≥ 2y
  result.samplePairs = objectLevel.filter(r => r.carry && r.gapY >= 2).slice(0, 12);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), cap: CAP, calibrated: !!state, ...result, rows }, null, 1));
  console.log(`\n[w32] wrote ${OUT} · ${rows.length} rows · total ${elapsed()} · heap ${mb()}MB`);
})().catch(e => { console.error(e); process.exit(1); });
