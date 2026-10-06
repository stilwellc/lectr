/**
 * accuracy-ledger.ts — THE LIVE ACCURACY LEDGER (Oct 2026): the nightly,
 * automated version of the hand-graded live re-audits.
 *
 * Every night, after assemble has appended tonight's serves to the value tape
 * and the corpus carries tonight's results, this grades every lot whose sale
 * has SETTLED against the LAST value lectr served for it on or before its sale
 * day — point-in-time, no lookahead:
 *
 *   serves    every non-shadow value-tape row is a serve on its day `d`; a
 *             row's `L` (build-market-tape: the last CHANGED serve under that
 *             version) is a later serve on `L.d`. Shadow rows were never
 *             served and are never graded. Within a day the later tape
 *             position wins (the tape is appended in run order).
 *   pick      the latest serve with day ≤ the sale day. A lot whose every
 *             serve is dated AFTER its sale (a stale "upcoming" row resolved
 *             late) is counted as `lookahead`, never graded.
 *   basis     HAMMER, through the monthly report's own grader
 *             (accuracy-report gradeTape: served expectedHammerUsd, else the
 *             all-in value ÷ the lot premium; realized = inferHammerUsd, the
 *             dated-premium inverse lotHammerFromAllIn). The house estimate
 *             midpoint is graded on the SAME lots as the baseline.
 *   unsold    a bought-in lot is a FAILED outcome (no beat, a flag miss, odds
 *             outcome 0) only inside the record's UNSOLD-CAPTURED cells
 *             (backtest-core unsoldCapturedCells: house × quarter with ≥ 3
 *             bought-ins at ≥ 3% of concluded range-estimate lots); elsewhere
 *             it is counted and left out. Unsold lots never enter price error
 *             or band coverage (there is no price to grade).
 *
 * Output: public/data/ray/accuracy-ledger.json (rides the served payload →
 * lectr.bid/data/ray/accuracy-ledger.json; also latest/accuracy-ledger.json in
 * R2 so tomorrow appends to it) — compact daily rows (one per sale day,
 * append-only: days older than RESTATE_DAYS are frozen from the prior ledger)
 * and rolling 7/30/90-day rollups overall / by market / house / engine
 * version / confidence tier. DRIFT warns (::warning, never blocks — the G5
 * warn-not-block decision) per market at n ≥ 30. Exits 0 whenever it wrote a
 * ledger; thin data is reported, never thrown.
 *
 *   npx tsx scripts/accuracy-ledger.ts
 *   npx tsx scripts/accuracy-ledger.ts --corpus-dir /tmp/c --out /tmp/l.json --as-of 2026-10-06
 *   npx tsx scripts/accuracy-ledger.ts --snapshot-tape <dir>   # backfill only: dated served snapshots as extra serves
 */
import * as fs from 'fs';
import * as path from 'path';
import { streamGzLines } from './corpus-io';
import {
  gradeTape, cellOf, soldInfoOf, readSnapshotTape, BASIS, MIN_SHOW, MIN_SOLID,
  type TapeRow, type SoldInfo, type Graded, type Cell,
} from './accuracy-report';
import { unsoldCapturedCells, unsoldCellKey, type L } from './backtest-core';
import { adjustedTop, estKindOf } from '../app/lib/value';

// ── rules ───────────────────────────────────────────────────────────────────
export const WINDOWS = [7, 30, 90] as const;
/** daily rows newer than this are recomputed every night (late results,
 *  post-sale settlements); older ones are frozen from the prior ledger */
export const RESTATE_DAYS = 14;
/** daily rows older than this are dropped */
export const KEEP_DAYS = 400;
/** DRIFT (warn only): per market at n ≥ minN graded in the trailing 30 days */
export const DRIFT = { minN: 30, minCoveragePct: 72, maxErrWorsen: 1.2, biasLo: 0.85, biasHi: 1.18 } as const;
/** odds calibration buckets (lower edges, %) */
export const ODDS_EDGES = [0, 40, 50, 60, 70] as const;
const LN13 = Math.log(1.3);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const dayAdd = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// ── serves ──────────────────────────────────────────────────────────────────
/** one served state of a lot: a tape row (first serve) or its `L` (last change) */
export type Serve = TapeRow & { ord: number };
/** Every serve per lot, in (day, run order). Snapshot rows (backfill) sort
 *  before tape rows of the same day, so a real tape serve wins a tie. */
export function servesOf(tape: TapeRow[], snapshots: TapeRow[] = []): Map<string, Serve[]> {
  const by = new Map<string, Serve[]>();
  const push = (s: Serve) => { const a = by.get(s.id) || by.set(s.id, []).get(s.id)!; a.push(s); };
  snapshots.forEach((t, i) => { if (!t.sh) push({ ...t, ord: -snapshots.length + i }); });
  tape.forEach((t, i) => {
    if (t.sh) return;
    const { L: last, ...first } = t;
    push({ ...first, ord: 2 * i });
    if (last && last.d > t.d) push({ ...first, ...last, ord: 2 * i + 1 });
  });
  by.forEach(a => a.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.ord - y.ord)));
  return by;
}
/** THE POINT-IN-TIME PICK: the last serve dated on or before the sale day
 *  (null when every serve postdates the sale — never graded). */
export function lastServeBefore(serves: Serve[], saleDay: string): Serve | null {
  let best: Serve | null = null;
  for (const s of serves) if (s.d <= saleDay) best = s;   // sorted ascending
  return best;
}

// ── grading ─────────────────────────────────────────────────────────────────
/** one graded lot. Sold: a Graded (hammer basis) + house; unsold: outcome only. */
export type LedgerLot = {
  id: string; saleDay: string; market: string; house: string; version: string; tier: string;
  sold: boolean;
  g?: Graded;
  /** flagged 'below comparable market' on an estimate lot */
  flagged: boolean;
  /** hammer beat the house-adjusted top (null = no estimate to beat) */
  beat: boolean | null;
  /** calibrated odds at the serve (0–1) */
  odds?: number;
};
export type LedgerCounts = {
  lots: number; settled: number; graded: number; unsoldCounted: number; unsoldUncaptured: number;
  lookahead: number; unsettled: number; notInCorpus: number;
};

/** Grade every settled lot on its last pre-sale serve. `asOf` bounds the sale
 *  day (a corpus "sold" stamped in the future is not settled yet). */
export function gradeLedger(serves: Map<string, Serve[]>, sold: Map<string, SoldInfo>, capturedCells: Set<string>, asOf: string): { lots: LedgerLot[]; counts: LedgerCounts } {
  const counts: LedgerCounts = { lots: serves.size, settled: 0, graded: 0, unsoldCounted: 0, unsoldUncaptured: 0, lookahead: 0, unsettled: 0, notInCorpus: 0 };
  const out: LedgerLot[] = [];
  const W = { from: '0000-00-00', to: asOf };
  serves.forEach((ss, id) => {
    const s = sold.get(id);
    if (!s) { counts.notInCorpus++; return; }
    const settled = (s.status === 'sold' && s.h > 0) || s.status === 'bought_in';
    if (!settled || !s.sd || s.sd > asOf) { counts.unsettled++; return; }
    counts.settled++;
    const t = lastServeBefore(ss, s.sd);
    if (!t) { counts.lookahead++; return; }
    const kind = estKindOf(s.estLo, s.estHi);
    const top = (s.estLo || s.estHi) ? adjustedTop(s.estLo, s.estHi, t.hf && t.hf > 0 ? t.hf : 1, kind) : 0;
    const base = {
      id, saleDay: s.sd, market: t.m || s.market || 'other', house: s.house || 'unknown', version: t.v, tier: t.c || 'low',
      flagged: t.k === 'e' && t.s === 'b', ...((t.o || 0) > 0 ? { odds: t.o! / 100 } : {}),
    };
    if (s.status === 'bought_in') {
      if (!capturedCells.has(unsoldCellKey(s.house, s.sd))) { counts.unsoldUncaptured++; return; }
      out.push({ ...base, sold: false, beat: top > 0 ? false : null });
      counts.unsoldCounted++;
      return;
    }
    const { graded } = gradeTape([t], new Map([[id, s]]), W);
    if (!graded.length) { counts.unsettled++; return; }
    out.push({ ...base, sold: true, g: graded[0], beat: top > 0 ? s.h > top : null });
    counts.graded++;
  });
  out.sort((a, b) => (a.saleDay < b.saleDay ? -1 : a.saleDay > b.saleDay ? 1 : a.id < b.id ? -1 : 1));
  return { lots: out, counts };
}

// ── cells ───────────────────────────────────────────────────────────────────
export type OddsBucket = { from: number; n: number; predPct: number | null; realizedPct: number | null };
export type LedgerCell = {
  /** priced (sold) lots graded · unsold lots counted as failed outcomes */
  n: number; unsold: number; thin: boolean;
  medAbsErrPct: number | null; within30Pct: number | null; bias: number | null;
  bandCoveragePct: number | null; bandN: number;
  /** the house estimate midpoint on the SAME lots (lots carrying an estimate) */
  house: { n: number; medAbsErrPct: number | null; within30Pct: number | null; bias: number | null };
  closerPct: number | null;
  /** flagged lots that beat the house-adjusted top (bought-in = miss) */
  flags: { n: number; hits: number; precisionPct: number | null };
  /** calibrated odds vs beat outcomes: Brier score + buckets */
  odds: { n: number; brier: number | null; buckets?: OddsBucket[] };
};
export function ledgerCell(lots: LedgerLot[], withBuckets = false): LedgerCell {
  const priced = lots.filter(l => l.sold && l.g).map(l => l.g!);
  const c: Cell = cellOf(priced);
  const fl = lots.filter(l => l.flagged && l.beat != null);
  const hits = fl.filter(l => l.beat).length;
  const od = lots.filter(l => l.odds != null && l.beat != null);
  const brier = od.length >= MIN_SHOW ? r3(od.reduce((a, l) => a + (l.odds! - (l.beat ? 1 : 0)) ** 2, 0) / od.length) : null;
  const cell: LedgerCell = {
    n: priced.length, unsold: lots.length - priced.length, thin: priced.length < MIN_SOLID,
    medAbsErrPct: c.lectr.medAbsErrPct, within30Pct: c.lectr.within30Pct, bias: c.lectr.bias,
    bandCoveragePct: c.band.pct, bandN: c.band.n,
    house: { n: c.house.n, medAbsErrPct: c.house.medAbsErrPct, within30Pct: c.house.within30Pct, bias: c.house.bias },
    closerPct: c.closer.pct,
    flags: { n: fl.length, hits, precisionPct: fl.length >= MIN_SHOW ? r1(100 * hits / fl.length) : null },
    odds: { n: od.length, brier },
  };
  if (withBuckets && od.length) {
    cell.odds.buckets = ODDS_EDGES.map((from, i) => {
      const to = ODDS_EDGES[i + 1] ?? 101;
      const b = od.filter(l => l.odds! * 100 >= from && l.odds! * 100 < to);
      return {
        from, n: b.length,
        predPct: b.length >= MIN_SHOW ? r1(100 * b.reduce((a, l) => a + l.odds!, 0) / b.length) : null,
        realizedPct: b.length >= MIN_SHOW ? r1(100 * b.filter(l => l.beat).length / b.length) : null,
      };
    }).filter(b => b.n > 0);
  }
  return cell;
}
function groupBy(lots: LedgerLot[], key: (l: LedgerLot) => string, withBuckets = false): Record<string, LedgerCell> {
  const by = new Map<string, LedgerLot[]>();
  for (const l of lots) { const k = key(l); (by.get(k) || by.set(k, []).get(k)!).push(l); }
  return Object.fromEntries(Array.from(by.keys()).sort().map(k => [k, ledgerCell(by.get(k)!, withBuckets)]));
}

// ── rollups + daily rows ────────────────────────────────────────────────────
export type Rollup = {
  from: string; to: string;
  overall: LedgerCell;
  byMarket: Record<string, LedgerCell>; byHouse: Record<string, LedgerCell>;
  byVersion: Record<string, LedgerCell>; byTier: Record<string, LedgerCell>;
};
/** sale days in (asOf − days, asOf] */
export const inTrailing = (d: string, asOf: string, days: number, offset = 0) => d > dayAdd(asOf, -(days + offset)) && d <= dayAdd(asOf, -offset);
export function rollupOf(lots: LedgerLot[], asOf: string, days: number): Rollup {
  const w = lots.filter(l => inTrailing(l.saleDay, asOf, days));
  return {
    from: dayAdd(asOf, -(days - 1)), to: asOf,
    overall: ledgerCell(w, true),
    byMarket: groupBy(w, l => l.market, true),
    byHouse: groupBy(w, l => l.house),
    byVersion: groupBy(w, l => l.version),
    byTier: groupBy(w, l => l.tier),
  };
}

/** one sale day, compact: sums so a reader can re-aggregate, medians as of that day */
export type DailyRow = {
  d: string; n: number; u: number;
  mae: number | null; w30: number | null; bias: number | null;
  /** within ±30% count, band hits / band n (sums: additive across days) */
  w30n: number; bandHit: number; bandN: number;
  houseMae: number | null;
  flagN: number; flagHit: number;
  oddsN: number; brierSum: number;
  /** graded (priced + unsold) lots per engine version and per market */
  v: Record<string, number>; m: Record<string, number>;
};
export function dailyRowsOf(lots: LedgerLot[]): DailyRow[] {
  const by = new Map<string, LedgerLot[]>();
  for (const l of lots) (by.get(l.saleDay) || by.set(l.saleDay, []).get(l.saleDay)!).push(l);
  return Array.from(by.keys()).sort().map(d => {
    const day = by.get(d)!;
    const c = ledgerCell(day);
    const priced = day.filter(l => l.sold && l.g).map(l => l.g!);
    const banded = priced.filter(g => (g.bandLoH || 0) > 0 && (g.bandHiH || 0) > 0);
    const od = day.filter(l => l.odds != null && l.beat != null);
    const tally = (k: (l: LedgerLot) => string) => { const o: Record<string, number> = {}; for (const l of day) o[k(l)] = (o[k(l)] || 0) + 1; return o; };
    return {
      d, n: c.n, u: c.unsold, mae: c.medAbsErrPct, w30: c.within30Pct, bias: c.bias,
      w30n: priced.filter(g => Math.abs(Math.log(g.h / g.predH)) <= LN13 + 1e-12).length,
      bandHit: banded.filter(g => g.h >= g.bandLoH! && g.h <= g.bandHiH!).length, bandN: banded.length,
      houseMae: c.house.medAbsErrPct,
      flagN: c.flags.n, flagHit: c.flags.hits,
      oddsN: od.length, brierSum: r3(od.reduce((a, l) => a + (l.odds! - (l.beat ? 1 : 0)) ** 2, 0)),
      v: tally(l => l.version), m: tally(l => l.market),
    };
  });
}
/** APPEND-ONLY merge: prior rows older than the restate horizon are frozen
 *  (kept even when tonight cannot recompute them — a lost tape night never
 *  erases history); newer days are tonight's recomputation. */
export function mergeDaily(prior: DailyRow[], tonight: DailyRow[], asOf: string): DailyRow[] {
  const frozenBefore = dayAdd(asOf, -RESTATE_DAYS);
  const keepFrom = dayAdd(asOf, -KEEP_DAYS);
  const by = new Map<string, DailyRow>();
  for (const r of tonight) if (r.d <= asOf) by.set(r.d, r);
  for (const r of prior) if (r && typeof r.d === 'string' && r.d < frozenBefore) by.set(r.d, r);
  return Array.from(by.values()).filter(r => r.d >= keepFrom).sort((a, b) => a.d.localeCompare(b.d));
}

// ── drift ───────────────────────────────────────────────────────────────────
export type Drift = { scope: string; metric: 'bandCoverage' | 'errorWorsened' | 'bias'; value: number; threshold: string; n: number; message: string };
/** DRIFT on the trailing 30 days vs the 30 before them, per market (and all),
 *  at n ≥ DRIFT.minN graded. Warn-only by contract. */
export function driftOf(lots: LedgerLot[], asOf: string): Drift[] {
  const out: Drift[] = [];
  const cur = lots.filter(l => inTrailing(l.saleDay, asOf, 30));
  const prev = lots.filter(l => inTrailing(l.saleDay, asOf, 30, 30));
  const scopes = ['all', ...Array.from(new Set(cur.map(l => l.market))).sort()];
  for (const sc of scopes) {
    const pick = (a: LedgerLot[]) => (sc === 'all' ? a : a.filter(l => l.market === sc));
    const c = ledgerCell(pick(cur));
    if (c.n < DRIFT.minN) continue;
    const label = sc === 'all' ? 'all markets' : sc;
    if (c.bandCoveragePct != null && c.bandN >= DRIFT.minN && c.bandCoveragePct < DRIFT.minCoveragePct) {
      out.push({ scope: sc, metric: 'bandCoverage', value: c.bandCoveragePct, threshold: `≥ ${DRIFT.minCoveragePct}%`, n: c.bandN, message: `${label}: 30-day band coverage ${c.bandCoveragePct}% (n ${c.bandN}) under ${DRIFT.minCoveragePct}%` });
    }
    const p = ledgerCell(pick(prev));
    if (p.n >= DRIFT.minN && c.medAbsErrPct != null && p.medAbsErrPct != null && p.medAbsErrPct > 0 && c.medAbsErrPct > DRIFT.maxErrWorsen * p.medAbsErrPct) {
      const ratio = r3(c.medAbsErrPct / p.medAbsErrPct);
      out.push({ scope: sc, metric: 'errorWorsened', value: ratio, threshold: `≤ ${DRIFT.maxErrWorsen}× prior 30 days`, n: c.n, message: `${label}: 30-day median abs error ${c.medAbsErrPct}% vs ${p.medAbsErrPct}% the 30 days before (${ratio}×, n ${c.n} vs ${p.n})` });
    }
    if (c.bias != null && (c.bias < DRIFT.biasLo || c.bias > DRIFT.biasHi)) {
      out.push({ scope: sc, metric: 'bias', value: c.bias, threshold: `${DRIFT.biasLo}–${DRIFT.biasHi}`, n: c.n, message: `${label}: 30-day bias ${c.bias}× (realized ÷ served, n ${c.n}) outside ${DRIFT.biasLo}–${DRIFT.biasHi}` });
    }
  }
  return out;
}

// ── the ledger ──────────────────────────────────────────────────────────────
export type Ledger = {
  schema: 1;
  generatedAt: string; asOf: string;
  basis: string;
  rules: { pick: string; unsold: string; restateDays: number; minShow: number; minSolid: number; drift: typeof DRIFT; oddsEdges: readonly number[] };
  sources: Record<string, string>;
  /** first tape day + the versions graded */
  tapeSince: string | null; versions: string[];
  counts: LedgerCounts;
  rollups: Record<string, Rollup>;
  drift: Drift[];
  daily: DailyRow[];
};
export function buildLedger(input: { tape: TapeRow[]; snapshots?: TapeRow[]; sold: Map<string, SoldInfo>; capturedCells: Set<string>; asOf: string; now: Date; prior?: Partial<Ledger> | null; sources?: Record<string, string> }): Ledger {
  const serves = servesOf(input.tape, input.snapshots || []);
  const { lots, counts } = gradeLedger(serves, input.sold, input.capturedCells, input.asOf);
  const priorDaily = Array.isArray(input.prior?.daily) ? input.prior!.daily as DailyRow[] : [];
  return {
    schema: 1,
    generatedAt: input.now.toISOString(), asOf: input.asOf,
    basis: BASIS,
    rules: {
      pick: 'the LAST value served on or before the sale day (tape first serve + its last changed serve, per version; shadow rows never); serves dated after the sale are never graded',
      unsold: 'a bought-in lot counts as a failed outcome (no beat, flag miss, odds outcome 0) only in unsold-captured house × quarter cells; never in price error or band coverage',
      restateDays: RESTATE_DAYS, minShow: MIN_SHOW, minSolid: MIN_SOLID, drift: DRIFT, oddsEdges: ODDS_EDGES,
    },
    sources: input.sources || {},
    tapeSince: input.tape.filter(t => !t.sh).map(t => t.d).sort()[0] || null,
    versions: Array.from(new Set(lots.map(l => l.version))).sort(),
    counts,
    rollups: Object.fromEntries(WINDOWS.map(d => [String(d), rollupOf(lots, input.asOf, d)])),
    drift: driftOf(lots, input.asOf),
    daily: mergeDaily(priorDaily, dailyRowsOf(lots), input.asOf),
  };
}

// ── rendering (step summary + workflow commands) ────────────────────────────
const pct = (x: number | null | undefined) => (x == null ? '—' : `${x}%`);
const times = (x: number | null | undefined) => (x == null ? '—' : `${x}×`);
export function summaryMarkdown(l: Ledger): string {
  const L: string[] = [`### Live accuracy ledger · as of ${l.asOf}`, ''];
  const c = l.counts;
  L.push(`Settled ${c.settled} of ${c.lots} served lots: **${c.graded} graded**, ${c.unsoldCounted} unsold counted (captured cells), ${c.unsoldUncaptured} unsold outside captured cells, ${c.lookahead} served only after their sale (not graded). Tape since ${l.tapeSince || 'n/a'}.`, '');
  L.push('| window | n | lectr med abs err | ±30% | bias | band | house med abs err | closer | flag precision | Brier |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [k, r] of Object.entries(l.rollups)) {
    const o = r.overall;
    L.push(`| ${k}d | ${o.n}${o.unsold ? ` (+${o.unsold} unsold)` : ''} | ${pct(o.medAbsErrPct)} | ${pct(o.within30Pct)} | ${times(o.bias)} | ${pct(o.bandCoveragePct)} | ${pct(o.house.medAbsErrPct)} | ${pct(o.closerPct)} | ${pct(o.flags.precisionPct)}${o.flags.n ? ` (n ${o.flags.n})` : ''} | ${o.odds.brier ?? '—'} |`);
  }
  const m30 = l.rollups['30']?.byMarket || {};
  if (Object.keys(m30).length) {
    L.push('', '30-day by market:', '', '| market | n | med abs err | ±30% | bias | band | house |', '|---|---:|---:|---:|---:|---:|---:|');
    for (const [k, o] of Object.entries(m30)) L.push(`| ${k} | ${o.n} | ${pct(o.medAbsErrPct)} | ${pct(o.within30Pct)} | ${times(o.bias)} | ${pct(o.bandCoveragePct)} | ${pct(o.house.medAbsErrPct)} |`);
  }
  L.push('', l.drift.length ? `**Drift (warn only):**\n${l.drift.map(d => `- ${d.message}`).join('\n')}` : `No drift (checked per market at n ≥ ${DRIFT.minN}).`, '');
  return L.join('\n');
}

// ── IO ──────────────────────────────────────────────────────────────────────
async function readNdjsonGz<T>(file: string): Promise<T[]> {
  const out: T[] = [];
  await streamGzLines(file, (buf, s, e) => {
    const v = JSON.parse(buf.toString('utf8', s, e));
    if (Array.isArray(v)) for (const x of v) out.push(x); else out.push(v);
  });
  return out;
}
const quarterStart = (d: string) => `${d.slice(0, 4)}-${String(Math.floor((+d.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;

/** One streaming pass: the settlement of every served lot, and the concluded
 *  range-estimate lots of the quarters a served lot can settle in (for the
 *  unsold-captured cells). Only those lines are parsed. */
export async function scanSettlements(files: string[], need: Set<string>, sinceDay: string | null): Promise<{ sold: Map<string, SoldInfo>; capturedCells: Set<string>; scanned: number }> {
  const sold = new Map<string, SoldInfo>();
  const concluded: L[] = [];
  const qFrom = sinceDay ? quarterStart(sinceDay) : '9999';
  const ID = /"id":("([^"\\]*)"|(\d+))/, SD = /"saleDate":"(\d{4}-\d{2}-\d{2})/, ST = /"status":"(sold|bought_in)"/;
  let scanned = 0;
  for (const file of files) {
    await streamGzLines(file, (buf, s, e) => {
      scanned++;
      const line = buf.toString('utf8', s, e);
      const im = ID.exec(line); const id = im ? (im[2] ?? im[3]) : undefined;
      const wanted = id !== undefined && need.has(id);
      const st = ST.exec(line)?.[1];
      const sd = SD.exec(line)?.[1];
      const forCells = !!st && !!sd && sd >= qFrom;
      if (!wanted && !forCells) return;
      const v = JSON.parse(line);
      for (const l of (Array.isArray(v) ? v : [v]) as (L & { id: string | number })[]) {
        const lid = String(l.id);
        if (need.has(lid)) {
          const prev = sold.get(lid), cur = soldInfoOf(l as unknown as Parameters<typeof soldInfoOf>[0]);
          // main corpus + archive can both carry a lot: the settled row wins
          if (!prev || (prev.status !== 'sold' && cur.status === 'sold') || (prev.status === 'other' && cur.status === 'bought_in')) sold.set(lid, cur);
        }
        if ((l.status === 'sold' || l.status === 'bought_in') && l.saleDate && String(l.saleDate).slice(0, 10) >= qFrom) {
          concluded.push({ status: l.status, saleDate: String(l.saleDate).slice(0, 10), auctionHouse: l.auctionHouse, estLowUsd: l.estLowUsd, estHighUsd: l.estHighUsd } as L);
        }
      }
    });
  }
  return { sold, capturedCells: new Set(unsoldCapturedCells(concluded)), scanned };
}

export type Args = { corpusDir: string; out: string; prior: string; asOf: string; snapshotDir: string | null; summary: string | null };
export function parseArgs(argv: string[], now: Date, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Args {
  const get = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const asOf = get('as-of') || now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`--as-of must be YYYY-MM-DD, got ${asOf}`);
  return {
    corpusDir: path.resolve(cwd, get('corpus-dir') || 'data/corpus'),
    out: path.resolve(cwd, get('out') || 'public/data/ray/accuracy-ledger.json'),
    prior: path.resolve(cwd, get('prior') || 'data/qa/accuracy-ledger.prev.json'),
    asOf,
    snapshotDir: get('snapshot-tape') ? path.resolve(cwd, get('snapshot-tape')!) : null,
    summary: get('summary') || env.GITHUB_STEP_SUMMARY || null,
  };
}

async function main() {
  const t0 = Date.now();
  const now = new Date();
  const args = parseArgs(process.argv.slice(2), now);
  const exists = (f: string) => fs.existsSync(f) && fs.statSync(f).size > 0;
  const sources: Record<string, string> = {};
  const tapeFile = path.join(args.corpusDir, 'value-tape.json.gz');
  // a missing or unreadable tape grades nothing tonight; frozen daily rows survive
  let tape: TapeRow[] = [];
  try { tape = exists(tapeFile) ? await readNdjsonGz<TapeRow>(tapeFile) : []; sources['value tape'] = exists(tapeFile) ? `${tape.length} rows` : 'MISSING'; }
  catch (e) { sources['value tape'] = `UNREADABLE (${(e as Error).message})`; console.log(`::warning title=accuracy ledger::value tape unreadable — nothing graded tonight`); }
  let snapshots: TapeRow[] = [];
  if (args.snapshotDir) {
    const snap = readSnapshotTape(args.snapshotDir);
    snapshots = snap.rows;
    sources['served snapshots (backfill)'] = `${snap.rows.length} serves from ${snap.days.length} snapshots (${snap.days[0] || '-'} → ${snap.days[snap.days.length - 1] || '-'})`;
  }
  let prior: Partial<Ledger> | null = null;
  if (exists(args.prior)) {
    try { prior = JSON.parse(fs.readFileSync(args.prior, 'utf8')); sources['prior ledger'] = `${(prior?.daily || []).length} daily rows (as of ${prior?.asOf || '?'})`; }
    catch (e) { sources['prior ledger'] = `UNREADABLE (${(e as Error).message}) — starting fresh`; }
  } else sources['prior ledger'] = 'none (first night)';
  const corpusFiles = ['lots.json.gz', 'sold-archive.json.gz'].map(f => path.join(args.corpusDir, f)).filter(exists);
  const need = new Set<string>([...tape, ...snapshots].filter(t => !t.sh).map(t => t.id));
  const since = [...tape, ...snapshots].filter(t => !t.sh).map(t => t.d).sort()[0] || null;
  const scan = await scanSettlements(corpusFiles, need, since);
  sources['sold corpus'] = corpusFiles.length ? `${corpusFiles.map(f => path.basename(f)).join(' + ')} (${scan.scanned} rows scanned, ${scan.sold.size} of ${need.size} served lots found, ${scan.capturedCells.size} unsold-captured cells)` : 'MISSING';

  const ledger = buildLedger({ tape, snapshots, sold: scan.sold, capturedCells: scan.capturedCells, asOf: args.asOf, now, prior, sources });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(ledger) + '\n');
  const o30 = ledger.rollups['30'].overall;
  console.log(`[ledger] ${args.asOf}: graded ${ledger.counts.graded} (+${ledger.counts.unsoldCounted} unsold) of ${ledger.counts.settled} settled · 30d n ${o30.n} err ${pct(o30.medAbsErrPct)} vs house ${pct(o30.house.medAbsErrPct)} · ±30% ${pct(o30.within30Pct)} · bias ${times(o30.bias)} · band ${pct(o30.bandCoveragePct)} · ${ledger.daily.length} daily rows · ${(fs.statSync(args.out).size / 1024).toFixed(1)}KB · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const d of ledger.drift) console.log(`::warning title=accuracy drift (${d.scope})::${d.message}`);
  if (args.summary) { try { fs.appendFileSync(args.summary, summaryMarkdown(ledger) + '\n'); } catch { /* advisory */ } }
  console.log(`[ledger] wrote ${path.relative(process.cwd(), args.out)}`);
}

if (process.env.RAY_SKIP_MAIN !== '1' && process.argv[1] && /accuracy-ledger\.ts$/.test(process.argv[1])) main().catch(e => { console.error(e); process.exit(1); });
