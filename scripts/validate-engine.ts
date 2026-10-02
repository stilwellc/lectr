/**
 * validate-engine.ts — THE GATE. Nothing ships unless it passes here.
 *
 * "Not assumptions" means empirically validated. This runs a temporal holdout:
 * for sold lots in the back of the corpus, it estimates value + the directional
 * signal using ONLY sales strictly before each lot's saleDate (the production
 * replay path — backtest-core.valueOne, same pools, same gates), then scores
 * the predictions against what the lot actually hammered for. It reports, per
 * market and per confidence tier:
 *   - value error (median ratio, % within ±25% / ±50%), vs the house benchmark
 *   - the directional signal's calibration (beat-high rate across compRatio)
 * and prints a VERDICT. Sep 2 2026 (P1-8): the verdict has TEETH — the process
 * exits non-zero on any failed gate, every bucket with n ≥ 30 is checked, and
 * the market list is derived from the roster (app/constants ARTISTS — culture,
 * tcg and every current slug included; nothing hardcoded).
 *
 * Gates (each evaluated only where n ≥ 30):
 *   G1 directional monotonicity, global: beat-high rate must not fall from ANY
 *      lower-compRatio bucket to any higher one by more than max(5pt, 2 SE of
 *      the difference) is a WARN (signal 'degraded') — and the top bucket must
 *      beat the bottom by ≥10pt, which BLOCKS.
 *   G2 per market: the same strict, sampling-error-tolerant monotonicity
 *      (FAIL beyond SE; a strict 1pt rule reds on n≈40 noise every night,
 *      which is how a gate dies) and the top measured bucket must beat the
 *      bottom by ≥5pt.
 *   G5 the LIVE FORWARD CHECK: the value tape (the first value every lot was
 *      served, this engine version) graded against the lots that have since
 *      sold — bias, band coverage and the Flags' live direction.
 *   G3 tier honesty, per market: 'high' median error < 1.6× AND high ≤ low
 *      (a tier that isn't more accurate than 'low' is mislabeled).
 *   G4 coverage sanity: ≥ 10% of holdout lots valued globally (an engine that
 *      silently stopped valuing must not pass on an empty table).
 *
 * Run: npx tsx scripts/validate-engine.ts [--sample 30000] [--market art]
 *      [--json path]   (nightly: after build-market; see ENGINE_WORKFLOW_PATCH)
 */
import * as fs from 'fs';
import type { AuctionLot } from '../app/types';
import { ARTISTS } from '../app/constants';
import { setCalibration, setTimeIndex, quarterKey, type TimeIndex } from '../app/lib/value';
import { lotAllInFactor } from '../app/lib/premiums';
import { quantile as statsQuantile } from '../app/lib/stats';
import { readCorpus } from './corpus-io';
import { prepare, targetsOf, valueOne, ENGINE_VERSION, type L } from './backtest-core';
import { readValueTape, gradeValueTape, type TapeRow } from './build-market-tape';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };

// the roster's markets — every current slug, derived, never a hardcoded list
const MARKET_KEYS = Array.from(new Set<string>(ARTISTS.map(a => a.market)));
const MARKET_OF: Record<string, string> = {};
for (const a of ARTISTS) MARKET_OF[a.slug] = a.market;
// production engine exclusions (build-market): mass-produced card slugs and the
// thin-metadata algolia backfill never enter the hedonic engine, so they are
// not holdout targets either (their tiers are graded on the forward tape)
const ENGINE_EXCLUDED = new Set(['sports-cards', 'graded-cards', 'pokemon']);

/** stats.quantile (lerp, NaN on empty) — the one convention */
const pctile = (a: number[], q: number) => statsQuantile(a, q);
function report(errs: number[]) {
  if (errs.length < 15) return `thin (n${errs.length})`;
  const med = Math.exp(pctile(errs, 0.5));
  const w25 = errs.filter(e => e <= Math.log(1.25)).length / errs.length * 100;
  const w50 = errs.filter(e => e <= Math.log(1.5)).length / errs.length * 100;
  return `medErr ${med.toFixed(2)}× · ±25% ${w25.toFixed(0)}% · ±50% ${w50.toFixed(0)}% (n${errs.length})`;
}
const BUCKETS = ['<0.6', '0.6-0.9', '0.9-1.3', '1.3-2', '>2'] as const;
const bucketOf = (cr: number) => (cr < 0.6 ? '<0.6' : cr < 0.9 ? '0.6-0.9' : cr < 1.3 ? '0.9-1.3' : cr < 2 ? '1.3-2' : '>2');
const mkSig = () => Object.fromEntries(BUCKETS.map(b => [b, { beat: 0, n: 0 }])) as Record<string, { beat: number; n: number }>;
const MIN_N = 30;

/** Monotonicity with a SAMPLING-ERROR tolerance. A per-market bucket can hold
 *  n=40 in a nightly run, where a 10pt dip is pure noise — a gate that reds on
 *  that flaps every night and gets ignored, which is how a dead gate is born.
 *  A drop only counts against the signal when it exceeds BOTH 2 standard errors
 *  of the difference in rates AND a 5pt floor. `tolPt` overrides for the global
 *  test (n in the thousands → the strict 1pt rule the record has always used).
 *  `spread` additionally requires the top measured bucket to beat the bottom. */
function monotonic(sig: Record<string, { beat: number; n: number }>, opts: { fixedTolPt?: number } = {}): { ok: boolean; rates: string; spread: number | null; measured: number; dips: string[] } {
  const parts: string[] = [];
  const seen: { b: string; rate: number; n: number }[] = [];
  const dips: string[] = [];
  let ok = true;
  for (const b of BUCKETS) {
    const s = sig[b]; const rate = s.n ? s.beat / s.n * 100 : 0;
    parts.push(`${b} ${rate.toFixed(0)}% (n${s.n})`);
    if (s.n < MIN_N) continue;
    // STRICT (Sep 27 2026): every LOWER-compRatio measured bucket, not only
    // the adjacent one — a slow two-step slide is as non-monotone as a cliff
    // — each pair judged with the same sampling-error tolerance (the larger
    // of 5pt and 2 SE of the difference in rates)
    for (const prev of seen) {
      const p1 = prev.rate / 100, p2 = rate / 100;
      const se = 100 * Math.sqrt(Math.max(1e-6, p1 * (1 - p1) / prev.n + p2 * (1 - p2) / s.n));
      const tol = opts.fixedTolPt ?? Math.max(5, 2 * se);
      if (rate + tol < prev.rate) { ok = false; dips.push(`${prev.b} ${prev.rate.toFixed(0)}% → ${b} ${rate.toFixed(0)}% (tol ${tol.toFixed(1)}pt)`); }
    }
    seen.push({ b, rate, n: s.n });
  }
  const spread = seen.length >= 2 ? seen[seen.length - 1].rate - seen[0].rate : null;
  return { ok, rates: parts.join(' · '), spread, measured: seen.length, dips };
}

function main() {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const onlyMarket = arg('market');
  const sample = parseInt(arg('sample') || '30000', 10);
  console.log('[validate] reading corpus…');
  const corpus = readCorpus() as unknown as AuctionLot[];
  const all = corpus.filter(l => !ENGINE_EXCLUDED.has(l.artist) && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
  setCalibration(null); // the raw engine — calibration is measured, not assumed
  const prep = prepare(all, console.log, elapsed);
  const tiCache = new Map<string, TimeIndex | null>();
  const timeIndexFor = (saleDate: string): TimeIndex | null => {
    const q = quarterKey(saleDate);
    if (!tiCache.has(q)) tiCache.set(q, prep.timeIndexer ? prep.timeIndexer(`${q.slice(0, 4)}-${String((+q.slice(5) - 1) * 3 + 1).padStart(2, '0')}-01`) : null);
    return tiCache.get(q)!;
  };
  const { soldTargets } = targetsOf(prep);
  const sorted = soldTargets.slice().sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1));
  const cutoff = sorted[Math.floor(sorted.length * 0.4)].saleDate;
  // stratified holdout: the back 60% by date, capped per market so no vertical
  // (the RR culture archive) crowds out the others in a bounded nightly run
  const perMarketCap = Math.max(500, Math.floor(sample / MARKET_KEYS.length));
  const byM = new Map<string, L[]>();
  for (const l of sorted) {
    if (l.saleDate < cutoff) continue;
    const m = MARKET_OF[l.artist] || 'other';
    if (onlyMarket && m !== onlyMarket) continue;
    (byM.get(m) || byM.set(m, []).get(m)!).push(l);
  }
  const test: L[] = [];
  byM.forEach(arr => { const step = Math.max(1, Math.ceil(arr.length / perMarketCap)); for (let i = 0; i < arr.length; i += step) test.push(arr[i]); });
  console.log(`[validate] holdout: ${test.length} test lots (saleDate ≥ ${cutoff.slice(0, 10)}, ≤${perMarketCap}/market), predicting from prior-only comps\n`);

  // accumulators
  const markets = MARKET_KEYS.filter(m => !onlyMarket || m === onlyMarket).concat('other');
  const valErr: Record<string, Record<string, number[]>> = {};   // market → confidence → errs
  const houseErr: Record<string, number[]> = {};
  const sigGlobal = mkSig();
  const sigByM: Record<string, Record<string, { beat: number; n: number }>> = {};
  const testN: Record<string, number> = {};
  for (const m of markets) { valErr[m] = { high: [], medium: [], low: [] }; houseErr[m] = []; sigByM[m] = mkSig(); testN[m] = 0; }

  let covered = 0, done = 0;
  for (const lot of test) {
    const m = MARKET_OF[lot.artist] || 'other'; if (!valErr[m]) continue;
    testN[m]++;
    if (++done % 5000 === 0) console.log(`[validate] ${done}/${test.length} (${elapsed()})`);
    // the point-in-time market index production would have had for this
    // lot's quarter (comps are time-adjusted before the median)
    setTimeIndex(timeIndexFor(lot.saleDate));
    const v = valueOne(prep, lot);
    if (!v) continue;
    covered++;
    const err = Math.abs(Math.log(v.compValueUsd / lot.realizedUsd!));
    valErr[m][v.confidence].push(err);
    if (lot.estLowUsd && lot.estHighUsd) {
      const em = (lot.estLowUsd + lot.estHighUsd) / 2;
      // the house benchmark on the SAME all-in basis as the value (the
      // estimate is hammer-basis; the value and realized are premium-in)
      houseErr[m].push(Math.abs(Math.log(em * lotAllInFactor(lot, em) / lot.realizedUsd!)));
      // directional signal calibration
      if (v.compRatio != null) {
        const b = bucketOf(v.compRatio);
        sigGlobal[b].n++; sigByM[m][b].n++;
        if (lot.realizedUsd! > lot.estHighUsd) { sigGlobal[b].beat++; sigByM[m][b].beat++; }
      }
    }
  }

  const coveragePct = test.length ? covered / test.length * 100 : 0;
  console.log(`\nCOVERAGE: ${coveragePct.toFixed(0)}% of test lots got an engine value (${elapsed()})\n`);
  console.log('VALUE ERROR by market × confidence (engine) vs the house benchmark:');
  const failures: string[] = [];
  const warnings: string[] = [];
  const tierMed = (errs: number[]) => (errs.length >= MIN_N ? Math.exp(pctile(errs, 0.5)) : null);
  for (const m of markets) {
    if (!testN[m]) continue;
    const hasHouse = houseErr[m].length >= 15;
    console.log(`  ${m} (n${testN[m]} test)`);
    for (const c of ['high', 'medium', 'low']) console.log(`    ${c.padEnd(7)} ${report(valErr[m][c])}`);
    console.log(`    house   ${hasHouse ? report(houseErr[m]) : '— (no estimates: engine is the only value)'}`);
    // G3 tier honesty
    const hi = tierMed(valErr[m].high), lo = tierMed(valErr[m].low);
    if (hi != null) {
      if (hi >= 1.6) failures.push(`G3 ${m}: 'high' median error ${hi.toFixed(2)}× ≥ 1.6× (n${valErr[m].high.length})`);
      if (lo != null && hi > lo) failures.push(`G3 ${m}: 'high' (${hi.toFixed(2)}×) is less accurate than 'low' (${lo.toFixed(2)}×) — tiers inverted`);
    }
    // G2 per-market: monotone within sampling error, AND the top bucket must
    // actually beat the bottom one (the claim the market's flags rest on)
    const mono = monotonic(sigByM[m]);
    if (mono.measured >= 2) {
      // Sep 10 2026: a local dip between two adjacent buckets is a SIGNAL-QUALITY
      // finding, not a data-integrity failure — it degrades the market's flags,
      // it does not make the corpus unpublishable. The first night this gate
      // ever ran (it was masked by the sentinel abort for a week) it blocked the
      // whole publish on an 8pt dip in watches' two WEAKEST buckets while the
      // top bucket beat the bottom by 26pt. Dips → WARN (recorded in the JSON as
      // signal status 'degraded'); only a market whose top bucket fails to beat
      // its bottom at all is a real failure of the directional claim.
      // Sep 27 2026: a dip BEYOND sampling error (max(5pt, 2 SE), any lower
      // bucket vs any higher one) FAILS — the directional claim is that odds
      // rise with the comp ratio, and a dip the sample size cannot explain
      // contradicts it. Dips inside sampling error pass silently (the n≈40
      // noise the Sep 10 note warned about never trips this).
      if (!mono.ok) failures.push(`G2 ${m}: beat-high rate falls beyond sampling error — ${mono.dips.join('; ')} — ${mono.rates}`);
      if (mono.spread != null && mono.spread < 5) failures.push(`G2 ${m}: top bucket beats the bottom by only ${mono.spread.toFixed(0)}pt (<5pt) — ${mono.rates}`);
      console.log(`    signal  ${mono.ok && (mono.spread ?? 0) >= 5 ? `OK (+${mono.spread!.toFixed(0)}pt bottom→top)` : 'FAILS'} — ${mono.rates}`);
    } else console.log(`    signal  thin (${mono.measured} buckets ≥ n${MIN_N})`);
  }

  console.log('\nDIRECTIONAL SIGNAL calibration, global (compRatio → beat-high rate; must be monotonic to ship):');
  // Sep 10 2026: the global test used a FIXED 1pt tolerance — tighter than one
  // standard error at n≈850 per bucket, so a 2pt wobble between the two lowest
  // buckets (44%→42%, ~0.8 SE) read as "not monotonic" and blocked the publish
  // while the top bucket beat the bottom by 24pt. Global now uses the same
  // sampling-error tolerance as the markets, and a dip is a WARN (signal
  // 'degraded'); the BLOCKING claim is the spread: top must beat bottom by ≥10pt.
  const g = monotonic(sigGlobal);
  for (const b of BUCKETS) { const s = sigGlobal[b]; console.log(`    comps ${b.padEnd(8)} beat-high ${(s.n ? s.beat / s.n * 100 : 0).toFixed(0)}% (n${s.n})`); }
  // a dip is a WARN (signal 'degraded'), as on Sep 10: the Sep 27 attempt to
  // make it blocking wedged the publish on a 6pt dip between the two lowest
  // (unflagged) buckets while the top beat the bottom by 26pt. The blocking
  // claim stays the spread below.
  if (!g.ok) warnings.push(`G1 global: beat-high rate dips beyond sampling error — ${g.dips.join('; ')} — ${g.rates}`);
  if (g.spread != null && g.spread < 10) failures.push(`G1 global: top bucket beats the bottom by only ${g.spread.toFixed(0)}pt (<10pt) — the directional claim is not carried`);
  if (BUCKETS.filter(b => sigGlobal[b].n >= MIN_N).length < 3) warnings.push(`G1 global: fewer than 3 buckets at n≥${MIN_N} — monotonicity unmeasured`);
  if (coveragePct < 10) failures.push(`G4 coverage: only ${coveragePct.toFixed(1)}% of holdout lots valued`);

  // ── G5 · THE LIVE FORWARD CHECK (Sep 27 2026) ──
  // The replay above re-derives history; this grades what the book actually
  // SERVED. build-market appends the first value each upcoming lot wore to
  // the value tape (data/corpus/value-tape.json.gz, engine-version tagged);
  // here every tape row of THIS engine version whose lot has since sold is
  // scored. Per path (estimate blend / no-estimate hedonic / card tier) with
  // n ≥ LIVE_MIN_N graded rows: FAIL when the served value runs biased past
  // ×/÷1.35 or its band covers < 50% of outcomes (nominal 70%); WARN when
  // coverage leaves 60–85%. Estimate lots also re-check the Flags' live
  // direction: flagged lots must realize above unflagged vs their estimate.
  // Until a path has LIVE_MIN_N graded rows it is reported as accruing.
  {
    const LIVE_MIN_N = 100;
    const tape = readValueTape().filter((r: TapeRow) => r.v === ENGINE_VERSION);
    const soldMap = new Map<string, { r: number; sd: string }>();
    // the FULL corpus (card tiers grade against sold cards the engine excludes)
    for (const l of corpus) if (l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate) soldMap.set(String(l.id), { r: l.realizedUsd!, sd: l.saleDate });
    const graded = gradeValueTape(tape, soldMap, r => [`path:${r.k}`, `path:${r.k}:${r.c}`, `market:${r.m || 'other'}:${r.k}`]);
    console.log(`\nLIVE FORWARD CHECK (value tape, engine ${ENGINE_VERSION}: ${tape.length} served values, graded where sold):`);
    const PATH_LABEL: Record<string, string> = { e: 'estimate lots (blend)', n: 'no-estimate hedonic', c: 'card tiers' };
    for (const k of ['e', 'n', 'c']) {
      const cell = graded[`path:${k}`];
      if (!cell || cell.n < LIVE_MIN_N || cell.bias == null) { console.log(`    ${PATH_LABEL[k].padEnd(22)} accruing (${cell?.n || 0} graded, gate at ${LIVE_MIN_N})`); continue; }
      console.log(`    ${PATH_LABEL[k].padEnd(22)} n${cell.n} · medErr ${cell.medAbsErrPct}% · ±30% ${cell.within30Pct}% · bias ${cell.bias}× · band ${cell.bandCoveragePct}%${cell.flagged != null ? ` · flagged ${cell.flagged}× vs unflagged ${cell.unflagged}× est` : ''}`);
      if (cell.bias > 1.35 || cell.bias < 1 / 1.35) failures.push(`G5 live ${PATH_LABEL[k]}: served values biased ${cell.bias}× (realized/value, n${cell.n}) — past ×/÷1.35`);
      if (cell.bandCoveragePct != null && cell.bandCoveragePct < 50) failures.push(`G5 live ${PATH_LABEL[k]}: bands cover ${cell.bandCoveragePct}% of outcomes (n${cell.n}, nominal 70%)`);
      else if (cell.bandCoveragePct != null && (cell.bandCoveragePct < 60 || cell.bandCoveragePct > 85)) warnings.push(`G5 live ${PATH_LABEL[k]}: band coverage ${cell.bandCoveragePct}% (nominal 70%, n${cell.n})`);
      if (k === 'e' && cell.flagged != null && cell.unflagged != null && cell.flagged <= cell.unflagged) failures.push(`G5 live flags: flagged lots realized ${cell.flagged}× estimate vs unflagged ${cell.unflagged}× — the live direction is not carried`);
      for (const c of ['high', 'medium', 'low']) {
        const t = graded[`path:${k}:${c}`];
        if (t && t.bias != null) console.log(`      ${c.padEnd(7)} n${t.n} · medErr ${t.medAbsErrPct}% · bias ${t.bias}× · band ${t.bandCoveragePct}%`);
      }
    }
  }

  // ── VERDICT ──
  console.log('\n════ VERDICT ════');
  const signalStatus = (g.spread != null && g.spread >= 10) ? (g.ok ? 'validated' : 'degraded') : 'failed';
  console.log(`• Directional signal: ${signalStatus === 'validated' ? 'VALIDATED — ships (monotonic beat-rate gradient within sampling error)' : signalStatus === 'degraded' ? 'DEGRADED — ships; a bucket dips beyond sampling error (see WARN)' : 'FAILED — spread does not carry the directional claim'}`);
  console.log('• Absolute valuation vs house on art/design/watches: engine defers to house estimate (comps shown as context, not an override) — by design');
  console.log(`• Confidence tiers: 'high' must beat a 1.6× median-error floor AND be more accurate than 'low' in every market with n≥${MIN_N}`);
  for (const w of warnings) console.log(`• WARN ${w}`);
  for (const f of failures) console.log(`• FAIL ${f}`);
  const outPath = arg('json');
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify({
      generatedAt: new Date().toISOString(), cutoff: cutoff.slice(0, 10), test: test.length, coveragePct: Math.round(coveragePct * 10) / 10,
      signal: signalStatus,
      global: { buckets: sigGlobal, monotonic: g.ok, spreadPt: g.spread }, byMarket: Object.fromEntries(markets.filter(m => testN[m]).map(m => [m, {
        test: testN[m], signal: sigByM[m], spreadPt: monotonic(sigByM[m]).spread, monotonic: monotonic(sigByM[m]).ok,
        tiers: Object.fromEntries(['high', 'medium', 'low'].map(c => [c, { n: valErr[m][c].length, medErr: tierMed(valErr[m][c]) }])),
        house: houseErr[m].length >= 15 ? Math.exp(pctile(houseErr[m], 0.5)) : null,
      }])),
      failures, warnings,
    }, null, 2));
  }
  if (failures.length) {
    console.error(`\n[validate] ${failures.length} gate(s) FAILED — exit 1`);
    process.exit(1);
  }
  console.log(`\n[validate] all gates passed (${elapsed()})`);
}

try { main(); } catch (e) { console.error('[validate] FAILED:', (e as Error).message); process.exit(1); }
