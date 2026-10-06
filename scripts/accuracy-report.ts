/**
 * accuracy-report.ts — THE MONTHLY ENGINE ACCURACY REPORT (Oct 2026).
 *
 * Grades what lectr SAID before the hammer against what the hammer did, for
 * every lot that settled in the reporting window, from records the nightly
 * already keeps:
 *
 *   value tape    data/corpus/value-tape.json.gz (R2 latest/value-tape.json.gz)
 *                 — the FIRST value each upcoming lot was served, engine-version
 *                 tagged (scripts/build-market-tape.ts). Only persisted across
 *                 nights since Oct 3 2026; earlier months have no tape rows.
 *   calls ledger  data/corpus/calls-ledger.json.gz (R2 latest/calls-ledger.json.gz)
 *                 — first call per lot × product (card comp · bid projection ·
 *                 THE GAP · THE SLEEPERS), scripts/lib/calls-ledger.ts.
 *   sold corpus   data/corpus/lots.json.gz + sold-archive.json.gz (or the
 *                 per-house segments) — realized, hammer, premium, estimate.
 *
 * BASIS: everything is graded on HAMMER. lectr's prediction is the served
 * expectedHammerUsd (tape `xh`; else the all-in value ÷ the lot's premium
 * factor), the house's is the estimate midpoint (estimates are hammer), and
 * the realized all-in price is converted to hammer through the lot's own
 * premium (app/lib/premiums.ts inferHammerUsd — the published hammer when the
 * lot has one). "Closer than the house" on this basis is the same comparison
 * as lectr all-in vs house mid × premium.
 *
 * ERROR CONVENTION (same as validate-engine G5): log errors. medAbsErrPct =
 * exp(median |ln(actual/pred)|) − 1; within ±30% = |ln(actual/pred)| ≤ ln 1.3;
 * bias = exp(median ln(actual/pred)) (>1 = lots sold above what we said).
 *
 * Output: docs/accuracy/<YYYY-MM>.md (human) + <YYYY-MM>.json (machine), with
 * the trend against the previous three JSON reports in the same folder. Thin
 * data is REPORTED, never thrown: the script exits 0 whenever it could write
 * a report.
 *
 *   npx tsx scripts/accuracy-report.ts                     # previous calendar month
 *   npx tsx scripts/accuracy-report.ts --month 2026-09
 *   npx tsx scripts/accuracy-report.ts --from 2026-10-01 --to 2026-10-05 --out-dir /tmp/acc
 */
import * as fs from 'fs';
import * as path from 'path';
import { streamGzLines } from './corpus-io';
import { inferHammerUsd, lotAllInFactor } from '../app/lib/premiums';
import { marketOf } from '../app/constants';
import { median } from '../app/lib/stats';
import type { TapeServe } from './build-market-tape';

// ── thresholds ──────────────────────────────────────────────────────────────
/** below this a metric is not computed at all (printed as "—") */
export const MIN_SHOW = 10;
/** below this a computed metric is labelled THIN */
export const MIN_SOLID = 30;
/** the max bid is the walk-away hammer: ~30% of hammers should land at/under it */
export const MAXBID_TARGET_PCT = 30;
const LN13 = Math.log(1.3);

// ── input shapes ────────────────────────────────────────────────────────────
export type TapeRow = {
  id: string; d: string; m?: string; p: number; lo: number; hi: number; c: string;
  k: 'e' | 'n' | 'c'; e?: number; s?: 'b' | 'a' | 't'; v: string; sh?: 1; xh?: number; mb?: number;
  /** (Oct 6) calibrated odds % + house factor at call time; the last served state (build-market-tape TapeRow) */
  o?: number; hf?: number; L?: TapeServe;
  /** (report-only) 1 = RECONSTRUCTED from a dated served snapshot, not read off the tape */
  rc?: 1;
};
export type CallRow = { id: string; d: string; k: string; p: number; f?: number; m?: string; s?: string; r?: number; sd?: string };
/** one settled (or passed) lot, hammer basis */
export type SoldInfo = {
  id: string;
  status: 'sold' | 'bought_in' | 'other';
  sd: string;            // sale day YYYY-MM-DD
  r: number;             // realized all-in USD (0 when not sold)
  h: number;             // hammer USD (0 when not sold)
  f: number;             // all-in factor (realized ÷ hammer) for this lot
  estLo?: number; estHi?: number;  // house estimate (hammer USD)
  market: string;
  house: string;
};

// ── metric cells ────────────────────────────────────────────────────────────
export type ErrStats = { n: number; thin: boolean; medAbsErrPct: number | null; within30Pct: number | null; bias: number | null };
export type Rate = { n: number; thin: boolean; pct: number | null };
export type Cell = {
  n: number;
  thin: boolean;
  lectr: ErrStats;
  /** the house estimate mid, graded on the SAME lots (only lots with an estimate) */
  house: ErrStats;
  /** share of estimate-carrying lots where lectr's hammer call was strictly closer than the house mid (ties = half) */
  closer: Rate;
  band: Rate;
  maxBid: Rate;
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function errStats(pairs: { actual: number; pred: number }[]): ErrStats {
  const lr = pairs.filter(p => p.actual > 0 && p.pred > 0).map(p => Math.log(p.actual / p.pred));
  const n = lr.length;
  if (n < MIN_SHOW) return { n, thin: true, medAbsErrPct: null, within30Pct: null, bias: null };
  return {
    n, thin: n < MIN_SOLID,
    medAbsErrPct: r1((Math.exp(median(lr.map(Math.abs))) - 1) * 100),
    within30Pct: r1(100 * lr.filter(x => Math.abs(x) <= LN13 + 1e-12).length / n),
    bias: r3(Math.exp(median(lr))),
  };
}
export function rate(hits: number, n: number): Rate {
  return { n, thin: n < MIN_SOLID, pct: n < MIN_SHOW ? null : r1(100 * hits / n) };
}

/** a tape or call row joined to its settlement, everything on hammer basis */
export type Graded = {
  id: string; src: 'tape' | 'snapshot' | 'calls'; kind: string; version: string; shadow: boolean;
  market: string; tier: string; callDay: string; saleDay: string;
  h: number;            // realized hammer
  predH: number;        // lectr's hammer call
  houseMid?: number;    // house estimate mid (hammer)
  estHi?: number;
  bandLoH?: number; bandHiH?: number;
  mb?: number;
  signal?: 'b' | 'a' | 't';
  path?: 'e' | 'n' | 'c';
};

export function cellOf(rows: Graded[]): Cell {
  const withHouse = rows.filter(g => (g.houseMid || 0) > 0);
  let closer = 0;
  for (const g of withHouse) {
    const el = Math.abs(Math.log(g.h / g.predH)), eh = Math.abs(Math.log(g.h / g.houseMid!));
    closer += el < eh - 1e-12 ? 1 : Math.abs(el - eh) <= 1e-12 ? 0.5 : 0;
  }
  const banded = rows.filter(g => (g.bandLoH || 0) > 0 && (g.bandHiH || 0) > 0);
  const inBand = banded.filter(g => g.h >= g.bandLoH! && g.h <= g.bandHiH!).length;
  const mbRows = rows.filter(g => (g.mb || 0) > 0);
  const under = mbRows.filter(g => g.h <= g.mb!).length;
  return {
    n: rows.length, thin: rows.length < MIN_SOLID,
    lectr: errStats(rows.map(g => ({ actual: g.h, pred: g.predH }))),
    house: errStats(withHouse.map(g => ({ actual: g.h, pred: g.houseMid! }))),
    closer: rate(closer, withHouse.length),
    band: rate(inBand, banded.length),
    maxBid: rate(under, mbRows.length),
  };
}

export function groupCells(rows: Graded[], keyOf: (g: Graded) => string): Record<string, Cell> {
  const by = new Map<string, Graded[]>();
  for (const g of rows) { const k = keyOf(g); (by.get(k) || by.set(k, []).get(k)!).push(g); }
  return Object.fromEntries(Array.from(by.keys()).sort().map(k => [k, cellOf(by.get(k)!)]));
}

// ── joins ───────────────────────────────────────────────────────────────────
export type Window = { from: string; to: string };
export const inWindow = (day: string, w: Window) => day >= w.from && day <= w.to;
const mid = (lo?: number, hi?: number) => { const a = lo ?? hi, b = hi ?? lo; return a && b && a > 0 && b > 0 ? (a + b) / 2 : undefined; };

export type JoinCounts = { rows: number; settledInWindow: number; graded: number; boughtIn: number; soldBeforeCall: number; notInCorpus: number; unsettled: number };

/** Grade value-tape rows: sold in the window, ON/AFTER the call day. */
export function gradeTape(tape: TapeRow[], sold: Map<string, SoldInfo>, w: Window): { graded: Graded[]; counts: JoinCounts } {
  const counts: JoinCounts = { rows: tape.length, settledInWindow: 0, graded: 0, boughtIn: 0, soldBeforeCall: 0, notInCorpus: 0, unsettled: 0 };
  const graded: Graded[] = [];
  for (const t of tape) {
    const s = sold.get(t.id);
    if (!s) { counts.notInCorpus++; continue; }
    if (!s.sd || !inWindow(s.sd, w)) { if (s.status !== 'sold' && s.status !== 'bought_in') counts.unsettled++; continue; }
    counts.settledInWindow++;
    if (s.status === 'bought_in') { counts.boughtIn++; continue; }
    if (s.status !== 'sold' || !(s.h > 0) || !(t.p > 0)) { counts.unsettled++; continue; }
    if (s.sd < t.d) { counts.soldBeforeCall++; continue; }
    // the SERVED premium factor (value ÷ expected hammer) puts the all-in band
    // on hammer; rows from before xh existed fall back to the lot's own factor
    const fServed = (t.xh || 0) > 0 ? t.p / t.xh! : s.f;
    graded.push({
      id: t.id, src: t.rc ? 'snapshot' : 'tape', kind: `path:${t.k}`, version: t.v, shadow: !!t.sh,
      market: t.m || s.market || 'other', tier: t.c || 'low', callDay: t.d, saleDay: s.sd,
      h: s.h,
      predH: (t.xh || 0) > 0 ? t.xh! : t.p / s.f,
      houseMid: (t.e || 0) > 0 ? t.e : mid(s.estLo, s.estHi),
      estHi: s.estHi ?? s.estLo,
      bandLoH: t.lo > 0 ? t.lo / fServed : undefined,
      bandHiH: t.hi > 0 ? t.hi / fServed : undefined,
      mb: (t.mb || 0) > 0 ? t.mb : undefined,
      signal: t.s, path: t.k,
    });
    counts.graded++;
  }
  return { graded, counts };
}

export const CALL_KIND_LABEL: Record<string, string> = {
  card: 'card comp value', vsbid: 'bid projection', gap: 'THE GAP (projected close)', quiet: 'THE SLEEPERS (appraisal)',
};
export const CALL_TIER_LABEL: Record<string, Record<string, string>> = {
  card: { x: 'exact', g: 'grade-adjusted', p: 'player', t: 'tcg', m: 'comps median (legacy)' },
  gap: { w: 'wire', f: 'forming' },
  quiet: { e: 'fair-estimate anchor', v: 'appraised anchor' },
};

/** Grade calls-ledger rows the same way (all-in predictions ÷ the lot's factor → hammer). */
export function gradeCallRows(calls: CallRow[], sold: Map<string, SoldInfo>, w: Window): { graded: Graded[]; counts: JoinCounts } {
  const counts: JoinCounts = { rows: calls.length, settledInWindow: 0, graded: 0, boughtIn: 0, soldBeforeCall: 0, notInCorpus: 0, unsettled: 0 };
  const graded: Graded[] = [];
  for (const c of calls) {
    const s = sold.get(c.id);
    if (!s) { if (c.sd && inWindow(c.sd.slice(0, 10), w)) counts.notInCorpus++; continue; }
    if (!s.sd || !inWindow(s.sd, w)) continue;
    counts.settledInWindow++;
    if (s.status === 'bought_in') { counts.boughtIn++; continue; }
    if (s.status !== 'sold' || !(s.h > 0) || !(c.p > 0)) { counts.unsettled++; continue; }
    if (s.sd < c.d) { counts.soldBeforeCall++; continue; }
    graded.push({
      id: c.id, src: 'calls', kind: c.k, version: 'untagged', shadow: false,
      market: c.m || s.market || 'other', tier: c.s || (c.k === 'card' ? 'm' : '-'), callDay: c.d, saleDay: s.sd,
      h: s.h, predH: c.p / s.f, houseMid: mid(s.estLo, s.estHi), estHi: s.estHi ?? s.estLo,
    });
    counts.graded++;
  }
  return { graded, counts };
}

// ── reconstruction from served snapshots (backfill only) ────────────────────
/** One served upcoming lot (public/data/ray/upcoming.json `lots[]`). */
export type ServedLot = {
  id: string | number; status?: string; artist?: string; estimateLow?: number | null; estimateHigh?: number | null;
  value?: { compValueUsd?: number; low?: number; high?: number; confidence?: string; basis?: string; signal?: { label?: string; beatRatePct?: number } | null; expectedHammerUsd?: number; maxBidUsd?: number; houseFactor?: number; engineVersion?: string } | null;
};
/** The tape row a served lot would have written that day (build-market-tape's
 *  appendValueTape, minus the shadow leg). */
export function tapeRowOfServed(l: ServedLot, day: string): TapeRow | null {
  const v = l.value;
  if (!v || !((v.compValueUsd || 0) > 0)) return null;
  const lo = l.estimateLow ?? l.estimateHigh, hi = l.estimateHigh ?? l.estimateLow;
  const e = lo && hi && lo > 0 && hi > 0 ? (lo + hi) / 2 : undefined;
  const lab = v.signal?.label || '';
  return {
    id: String(l.id), d: day, m: marketOf(String(l.artist || '')),
    p: Math.round(v.compValueUsd!), lo: Math.round(v.low || 0), hi: Math.round(v.high || 0),
    c: v.confidence || 'low', k: v.basis === 'card-comp' ? 'c' : e ? 'e' : 'n',
    ...(e ? { e: Math.round(e) } : {}),
    ...(lab ? { s: lab.startsWith('below') ? 'b' as const : lab.startsWith('above') ? 'a' as const : 't' as const } : {}),
    ...((v.expectedHammerUsd || 0) > 0 ? { xh: Math.round(v.expectedHammerUsd!) } : {}),
    ...((v.maxBidUsd || 0) > 0 ? { mb: Math.round(v.maxBidUsd!) } : {}),
    ...((v.signal?.beatRatePct || 0) > 0 ? { o: Math.round(v.signal!.beatRatePct! * 10) / 10 } : {}),
    ...((v.houseFactor || 0) > 0 ? { hf: v.houseFactor } : {}),
    v: v.engineVersion || 'unversioned', rc: 1,
  };
}
/** Merge reconstructed rows under the tape: first call wins per version × lot
 *  (the earliest day; on a tie the real tape row, which is listed first). */
export function mergeTape(tape: TapeRow[], recon: TapeRow[]): TapeRow[] {
  const best = new Map<string, TapeRow>();
  for (const t of [...tape, ...recon]) {
    const k = `${t.v}|${t.sh ? 's' : ''}|${t.id}`;
    const b = best.get(k);
    if (!b || t.d < b.d) best.set(k, t);
  }
  return Array.from(best.values());
}
/** Read dated served snapshots: `<dir>/<YYYYMMDD…>/upcoming.json`. */
export function readSnapshotTape(dir: string): { rows: TapeRow[]; days: string[] } {
  const rows: TapeRow[] = []; const days: string[] = [];
  for (const sub of fs.readdirSync(dir).sort()) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(sub);
    const f = path.join(dir, sub, 'upcoming.json');
    if (!m || !fs.existsSync(f)) continue;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { lots?: ServedLot[] } | ServedLot[];
    const lots = Array.isArray(j) ? j : j.lots || [];
    days.push(day);
    for (const l of lots) { if (l.status && l.status !== 'upcoming') continue; const t = tapeRowOfServed(l, day); if (t) rows.push(t); }
  }
  return { rows, days };
}

// ── the Flags' directional edge ─────────────────────────────────────────────
export type FlagGroup = { n: number; thin: boolean; medRealizedOverEst: number | null; beatHighPct: number | null };
export type FlagsEdge = {
  flagged: FlagGroup; unflagged: FlagGroup;
  above: FlagGroup; at: FlagGroup; none: FlagGroup;
  /** flagged − unflagged, both medians (×estimate) and beat-high points; null when either side is under MIN_SHOW */
  edgeRatio: number | null; edgeBeatHighPt: number | null;
};
function flagGroup(rows: Graded[]): FlagGroup {
  const ok = rows.filter(g => (g.houseMid || 0) > 0);
  const n = ok.length;
  if (n < MIN_SHOW) return { n, thin: true, medRealizedOverEst: null, beatHighPct: null };
  const hi = ok.filter(g => (g.estHi || 0) > 0);
  return {
    n, thin: n < MIN_SOLID,
    medRealizedOverEst: r3(median(ok.map(g => g.h / g.houseMid!))),
    beatHighPct: hi.length >= MIN_SHOW ? r1(100 * hi.filter(g => g.h > g.estHi!).length / hi.length) : null,
  };
}
/** Flagged = the engine said 'below comparable market' (tape s='b') on an estimate lot. */
export function flagsEdge(rows: Graded[]): FlagsEdge {
  const est = rows.filter(g => g.path === 'e' && (g.houseMid || 0) > 0);
  const flagged = flagGroup(est.filter(g => g.signal === 'b'));
  const unflagged = flagGroup(est.filter(g => g.signal !== 'b'));
  return {
    flagged, unflagged,
    above: flagGroup(est.filter(g => g.signal === 'a')),
    at: flagGroup(est.filter(g => g.signal === 't')),
    none: flagGroup(est.filter(g => !g.signal)),
    edgeRatio: flagged.medRealizedOverEst != null && unflagged.medRealizedOverEst != null ? r3(flagged.medRealizedOverEst - unflagged.medRealizedOverEst) : null,
    edgeBeatHighPt: flagged.beatHighPct != null && unflagged.beatHighPct != null ? r1(flagged.beatHighPct - unflagged.beatHighPct) : null,
  };
}

// ── abstention ──────────────────────────────────────────────────────────────
export type Abstention = {
  /** the live book at report time (abstain reasons are only stamped on upcoming rows) */
  book: { asOf: string; upcoming: number; valued: number; abstained: number; neither: number; abstainPct: number | null; reasons: Record<string, number> };
  /** settled lots in the window that sat in the live book while the tape was recording: how many wore a served value */
  settled: { tapeSince: string | null; eligible: number; valued: number; valuedPct: number | null; byMarket: Record<string, { eligible: number; valued: number; valuedPct: number | null }> };
};

// ── the report ──────────────────────────────────────────────────────────────
export type Headline = {
  tapeGraded: number; tapeMedAbsErrPct: number | null; tapeWithin30Pct: number | null; tapeBias: number | null;
  houseMedAbsErrPct: number | null; closerPct: number | null; bandPct: number | null; maxBidPct: number | null;
  flagEdgeRatio: number | null;
  /** the estimate-lot path alone: where lectr meets the house head to head */
  estGraded?: number; estMedAbsErrPct?: number | null;
  calls: Record<string, { graded: number; medAbsErrPct: number | null; within30Pct: number | null; bias: number | null; closerPct: number | null }>;
};
export type Report = {
  schema: 1;
  month: string;
  window: Window;
  partial: boolean;
  generatedAt: string;
  basis: string;
  thresholds: { minShow: number; minSolid: number; maxBidTargetPct: number };
  sources: Record<string, string>;
  tape: {
    counts: JoinCounts; versionsOnTape: string[]; tapeSince: string | null;
    overall: Cell; byMarket: Record<string, Cell>; byTier: Record<string, Cell>; byVersion: Record<string, Cell>; byPath: Record<string, Cell>;
    /** the persisted tape vs rows reconstructed from served snapshots (--snapshot-tape) */
    byOrigin: Record<string, Cell>;
    flags: FlagsEdge;
  };
  calls: {
    counts: JoinCounts;
    byKind: Record<string, Cell>;
    byKindTier: Record<string, Record<string, Cell>>;
    byKindMarket: Record<string, Record<string, Cell>>;
  };
  abstention: Abstention;
  headline: Headline;
  trend: { month: string; partial: boolean; headline: Headline }[];
  notes: string[];
};

export const BASIS = 'HAMMER. lectr = served expectedHammerUsd (else served all-in value ÷ the lot premium factor); house = estimate midpoint (hammer); realized = the published hammer, else realized all-in ÷ the lot premium factor. Errors are log errors: med abs err = exp(median|ln(actual/pred)|)−1; ±30% = |ln(actual/pred)| ≤ ln 1.3; bias = exp(median ln(actual/pred)), >1 means lots sold ABOVE the call.';

export function headlineOf(r: Pick<Report, 'tape' | 'calls'>): Headline {
  const o = r.tape.overall;
  return {
    tapeGraded: o.n,
    tapeMedAbsErrPct: o.lectr.medAbsErrPct, tapeWithin30Pct: o.lectr.within30Pct, tapeBias: o.lectr.bias,
    houseMedAbsErrPct: o.house.medAbsErrPct, closerPct: o.closer.pct, bandPct: o.band.pct, maxBidPct: o.maxBid.pct,
    flagEdgeRatio: r.tape.flags.edgeRatio,
    estGraded: r.tape.byPath?.['path:e']?.n ?? 0, estMedAbsErrPct: r.tape.byPath?.['path:e']?.lectr.medAbsErrPct ?? null,
    calls: Object.fromEntries(Object.entries(r.calls.byKind).map(([k, c]) => [k, {
      graded: c.n, medAbsErrPct: c.lectr.medAbsErrPct, within30Pct: c.lectr.within30Pct, bias: c.lectr.bias, closerPct: c.closer.pct,
    }])),
  };
}

export function buildReport(input: {
  month: string; window: Window; partial: boolean; now: Date;
  tape: TapeRow[]; calls: CallRow[]; sold: Map<string, SoldInfo>;
  abstention: Abstention; prior: { month: string; partial: boolean; headline: Headline }[];
  sources: Record<string, string>;
  /** days of the served snapshots that reconstructed rows (rc) came from */
  snapshotDays?: string[];
}): Report {
  const { graded: tapeAll, counts: tapeCounts } = gradeTape(input.tape, input.sold, input.window);
  const served = tapeAll.filter(g => !g.shadow);
  const { graded: callRows, counts: callCounts } = gradeCallRows(input.calls, input.sold, input.window);
  const kinds = Array.from(new Set(callRows.map(g => g.kind))).sort();
  const tapeDays = input.tape.filter(t => !t.sh).map(t => t.d).sort();
  const tapeSince = tapeDays[0] || null;
  const realSince = input.tape.filter(t => !t.sh && !t.rc).map(t => t.d).sort()[0] || null;
  const recon = input.tape.filter(t => t.rc);
  const reconGraded = served.filter(g => g.src === 'snapshot').length;
  const notes: string[] = [];
  if (!input.tape.length) notes.push('The value tape is EMPTY — no served value can be graded this month.');
  else if (tapeSince && tapeSince > input.window.from) notes.push(`The served-value record only starts on ${tapeSince}${recon.length ? '' : ' (the tape was reborn empty every night until the Oct 3 2026 persistence fix)'}, so lots that sold in this window before then have no served-value record. Their accuracy is not measured here — the calls ledger section covers the card / projection / lane products for the whole window.`);
  if (recon.length) notes.push(`RECONSTRUCTED rows: the persisted tape starts on ${realSince || 'n/a'}; ${recon.length} earlier first-served values were rebuilt from dated served snapshots (${Array.from(new Set(input.snapshotDays || [])).join(', ') || 'n/a'}). A lot first served before the earliest snapshot is graded on its first SNAPSHOT value (a later, easier claim), and snapshot gaps can do the same. ${reconGraded} of the ${served.length} graded served values come from snapshots — see "By record origin".`);
  if (input.partial) notes.push(`PARTIAL window: ${input.window.from} → ${input.window.to}. Lots still open at the cut are not graded; the full-month report replaces this one.`);
  if (served.length < MIN_SOLID) notes.push(served.length ? `Only ${served.length} served values settled in the window — every value-tape figure below is THIN or withheld (shown only at n ≥ ${MIN_SHOW}, labelled thin under n ${MIN_SOLID}).` : 'No served value settled in the window, so the value-tape sections below are empty.');
  const shadowN = tapeAll.length - served.length;
  if (shadowN) notes.push(`${shadowN} graded SHADOW rows (a candidate engine's never-served values) are reported per version only, never in the headline.`);
  const report: Report = {
    schema: 1,
    month: input.month, window: input.window, partial: input.partial,
    generatedAt: input.now.toISOString(),
    basis: BASIS,
    thresholds: { minShow: MIN_SHOW, minSolid: MIN_SOLID, maxBidTargetPct: MAXBID_TARGET_PCT },
    sources: input.sources,
    tape: {
      counts: tapeCounts,
      versionsOnTape: Array.from(new Set(input.tape.map(t => `${t.v}${t.sh ? ' (shadow)' : ''}`))).sort(),
      tapeSince,
      overall: cellOf(served),
      byMarket: groupCells(served, g => g.market),
      byTier: groupCells(served, g => g.tier),
      byVersion: groupCells(tapeAll, g => `${g.version}${g.shadow ? ' (shadow)' : ''}`),
      byPath: groupCells(served, g => g.kind),
      byOrigin: groupCells(served, g => g.src === 'snapshot' ? 'reconstructed from snapshots' : 'value tape'),
      flags: flagsEdge(served),
    },
    calls: {
      counts: callCounts,
      byKind: groupCells(callRows, g => g.kind),
      byKindTier: Object.fromEntries(kinds.map(k => [k, groupCells(callRows.filter(g => g.kind === k), g => g.tier)])),
      byKindMarket: Object.fromEntries(kinds.map(k => [k, groupCells(callRows.filter(g => g.kind === k), g => g.market)])),
    },
    abstention: input.abstention,
    headline: undefined as unknown as Headline,
    trend: [],
    notes,
  };
  report.headline = headlineOf(report);
  report.trend = input.prior.filter(p => p.month < input.month).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 3);
  return report;
}

// ── markdown ────────────────────────────────────────────────────────────────
const pct = (x: number | null | undefined) => (x == null ? '—' : `${x}%`);
const times = (x: number | null | undefined) => (x == null ? '—' : `${x}×`);
const thinTag = (n: number) => (n < MIN_SHOW ? ` (n ${n}, too few)` : n < MIN_SOLID ? ` (n ${n}, thin)` : '');
const PATH_LABEL: Record<string, string> = { 'path:e': 'estimate lots (blend)', 'path:n': 'no-estimate hedonic', 'path:c': 'card tiers' };

function cellTable(cells: Record<string, Cell>, label: (k: string) => string = k => k, bands = true): string[] {
  const out = [
    `| | n | lectr med abs err | lectr ±30% | bias | house med abs err | house ±30% | lectr closer |${bands ? ' band coverage | hammer ≤ max bid |' : ''}`,
    `|---|---:|---:|---:|---:|---:|---:|---:|${bands ? '---:|---:|' : ''}`,
  ];
  const sub = (x: Rate, n: number) => `${pct(x.pct)}${x.n && x.n !== n ? ` (n ${x.n})` : ''}`;
  for (const [k, c] of Object.entries(cells)) {
    out.push(`| ${label(k)}${c.n < MIN_SOLID ? (c.n < MIN_SHOW ? ' *(too few)*' : ' *(thin)*') : ''} | ${c.n} | ${pct(c.lectr.medAbsErrPct)} | ${pct(c.lectr.within30Pct)} | ${times(c.lectr.bias)} | ${pct(c.house.medAbsErrPct)}${c.house.n && c.house.n !== c.n ? ` (n ${c.house.n})` : ''} | ${pct(c.house.within30Pct)} | ${pct(c.closer.pct)} |${bands ? ` ${sub(c.band, c.n)} | ${sub(c.maxBid, c.n)} |` : ''}`);
  }
  return out;
}

/** Under 0.02× on realized ÷ estimate the two groups are not separated; the
 *  beat-high gap then carries the read. */
export const FLAT_EDGE = 0.02;
export function flagVerdict(f: FlagsEdge): string {
  if (f.edgeRatio == null) return '';
  if (f.edgeRatio >= FLAT_EDGE) return 'The direction held.';
  if (f.edgeRatio <= -FLAT_EDGE) return 'The direction did NOT hold this window.';
  const bh = f.edgeBeatHighPt;
  return `Flat on realized ÷ estimate (under ${FLAT_EDGE}×)${bh == null ? '.' : bh > 0 ? '; the beat-high rate still favours flagged lots.' : '; the beat-high rate does not favour flagged lots either.'}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthName(m: string): string { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; }

export function renderMarkdown(r: Report): string {
  const L: string[] = [];
  const o = r.tape.overall;
  L.push(`# Engine accuracy report: ${monthName(r.month)}${r.partial ? ' (partial)' : ''}`, '');
  L.push(`Window: lots that settled **${r.window.from} → ${r.window.to}**${r.partial ? ' (partial month)' : ''}. Generated ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC by \`scripts/accuracy-report.ts\`.`, '');
  L.push(`**Basis.** ${r.basis}`, '');
  L.push(`Sample rules: a figure needs n ≥ ${MIN_SHOW} to print (else "—"); under n ${MIN_SOLID} it is marked *thin* and should not be read as a trend.`, '');
  if (r.notes.length) { L.push('## Read this first', ''); for (const n of r.notes) L.push(`- ${n}`); L.push(''); }

  L.push('## Headline', '');
  if (o.n >= MIN_SHOW) {
    L.push(`- **Served values (value tape), all paths:** ${o.n} lots graded${thinTag(o.n)}. lectr median absolute error **${pct(o.lectr.medAbsErrPct)}**, within ±30% ${pct(o.lectr.within30Pct)}, bias ${times(o.lectr.bias)} (realized ÷ predicted).`);
    const est = r.tape.byPath['path:e'];
    if (est && est.closer.n >= MIN_SHOW) {
      L.push(`- **lectr vs the house** (the ${est.closer.n} estimate lots${thinTag(est.closer.n)}): lectr median absolute error **${pct(est.lectr.medAbsErrPct)}** vs the house estimate's **${pct(est.house.medAbsErrPct)}**; within ±30% lectr ${pct(est.lectr.within30Pct)} vs house ${pct(est.house.within30Pct)}; bias ${times(est.lectr.bias)}. lectr was closer than the house on **${pct(est.closer.pct)}** of them.`);
    } else L.push(`- **lectr vs the house:** only ${o.closer.n} graded lots carried a house estimate — too few to compare.`);
    for (const k of ['path:n', 'path:c']) {
      const c = r.tape.byPath[k];
      if (c) L.push(`- **${PATH_LABEL[k]}:** ${c.n} graded${thinTag(c.n)}, median absolute error ${pct(c.lectr.medAbsErrPct)}, ±30% ${pct(c.lectr.within30Pct)}, bias ${times(c.lectr.bias)} (no house estimate to compare).`);
    }
    L.push(`- **Band coverage:** ${pct(o.band.pct)} of hammers landed inside the published band (nominal 70%). **Max bid:** ${o.maxBid.n ? `${pct(o.maxBid.pct)} of ${o.maxBid.n} hammers at or under the max bid (target ~${MAXBID_TARGET_PCT}%)` : 'no graded row carried a max bid (the tape records it from Oct 3 2026)'}.`);
  } else {
    L.push(`- **Served values (value tape):** ${o.n} graded — too few to score this window.`);
  }
  for (const [k, c] of Object.entries(r.calls.byKind)) {
    L.push(`- **${CALL_KIND_LABEL[k] || k} (calls ledger):** ${c.n} graded${thinTag(c.n)}. Median absolute error ${pct(c.lectr.medAbsErrPct)}, ±30% ${pct(c.lectr.within30Pct)}, bias ${times(c.lectr.bias)}${c.house.n >= MIN_SHOW ? `; on the ${c.house.n} lots with a house estimate: lectr closer on ${pct(c.closer.pct)} (house error ${pct(c.house.medAbsErrPct)})` : c.house.n ? `; only ${c.house.n} carried a house estimate (too few to compare)` : '; none carried a house estimate'}.`);
  }
  if (!Object.keys(r.calls.byKind).length) L.push('- **Calls ledger:** no calls settled in this window.');
  L.push('');

  L.push('## Served values vs the house (value tape)', '');
  const tc = r.tape.counts;
  L.push(`Tape rows: ${tc.rows}${r.sources['reconstructed rows'] ? ` (including reconstructed: ${r.sources['reconstructed rows']})` : ''} (versions: ${r.tape.versionsOnTape.join(', ') || 'none'}; recording since ${r.tape.tapeSince || 'n/a'}). Settled in the window: ${tc.settledInWindow}, of which graded ${tc.graded}, bought in ${tc.boughtIn}, sold before the call ${tc.soldBeforeCall}. Tape lots missing from the corpus altogether (withdrawn or dropped, any date): ${tc.notInCorpus}.`, '');
  L.push('### Overall', '', ...cellTable({ all: o }), '');
  L.push('### By market', '', ...cellTable(r.tape.byMarket), '');
  L.push('### By confidence tier', '', ...cellTable(r.tape.byTier), '');
  L.push('### By valuation path', '', ...cellTable(r.tape.byPath, k => PATH_LABEL[k] || k), '');
  if (Object.keys(r.tape.byOrigin).length > 1 || r.tape.byOrigin['reconstructed from snapshots']) L.push('### By record origin', '', ...cellTable(r.tape.byOrigin), '');
  L.push('### By engine version', '', 'Shadow rows are a candidate engine\'s values, computed alongside and never served.', '', ...cellTable(r.tape.byVersion), '');

  L.push('### Band coverage and max-bid calibration by tier', '');
  L.push('| tier | band n | hammers inside band | max-bid n | hammers ≤ max bid (target ~30%) |', '|---|---:|---:|---:|---:|');
  for (const [k, c] of Object.entries(r.tape.byTier)) L.push(`| ${k} | ${c.band.n} | ${pct(c.band.pct)}${c.band.thin && c.band.pct != null ? ' *(thin)*' : ''} | ${c.maxBid.n} | ${pct(c.maxBid.pct)}${c.maxBid.thin && c.maxBid.pct != null ? ' *(thin)*' : ''} |`);
  L.push('');

  const f = r.tape.flags;
  L.push('## The Flags: directional edge', '');
  L.push('Estimate lots only. *Flagged* = the engine said "below comparable market" when the value was first served. Realized ÷ estimate is hammer ÷ estimate mid; beat-high = hammer above the high estimate.', '');
  L.push('| group | n | median hammer ÷ estimate mid | beat-high rate |', '|---|---:|---:|---:|');
  const fg = (name: string, g: FlagGroup) => L.push(`| ${name}${g.n < MIN_SOLID ? (g.n < MIN_SHOW ? ' *(too few)*' : ' *(thin)*') : ''} | ${g.n} | ${times(g.medRealizedOverEst)} | ${pct(g.beatHighPct)} |`);
  fg('flagged (below market)', f.flagged); fg('unflagged (all others)', f.unflagged); fg('  above market', f.above); fg('  at market', f.at); fg('  no signal', f.none);
  L.push('');
  L.push(f.edgeRatio == null ? 'Edge: not measurable this window (a side is under the print threshold).'
    : `Edge: flagged lots realized ${f.edgeRatio >= 0 ? '+' : ''}${f.edgeRatio}× estimate vs unflagged${f.edgeBeatHighPt != null ? `, beat-high ${f.edgeBeatHighPt >= 0 ? '+' : ''}${f.edgeBeatHighPt} points` : ''}. ${flagVerdict(f)}${f.flagged.thin || f.unflagged.thin ? ' (thin sample)' : ''}`);
  L.push('');

  L.push('## Calls ledger (card comp, bid projection, lanes)', '');
  const cc = r.calls.counts;
  L.push(`Ledger rows: ${cc.rows}. Settled in the window: ${cc.settledInWindow}, graded ${cc.graded}, bought in ${cc.boughtIn}, sold before the call ${cc.soldBeforeCall}; ${cc.notInCorpus} graded on the ledger but missing from the sold corpus (skipped). Calls are not engine-version tagged. Their predictions are all-in and are put on hammer with the lot's own premium, so the ratios match the ledger's own grading.`, '');
  if (Object.keys(r.calls.byKind).length) {
    L.push('### By product', '', ...cellTable(r.calls.byKind, k => CALL_KIND_LABEL[k] || k, false), '');
    for (const k of Object.keys(r.calls.byKindTier)) {
      const tiers = Object.keys(r.calls.byKindTier[k]);
      if (!(tiers.length === 1 && tiers[0] === '-')) L.push(`### ${CALL_KIND_LABEL[k] || k}: by tier`, '', ...cellTable(r.calls.byKindTier[k], t => CALL_TIER_LABEL[k]?.[t] ? `${CALL_TIER_LABEL[k][t]} (${t})` : t, false), '');
      L.push(`### ${CALL_KIND_LABEL[k] || k}: by market`, '', ...cellTable(r.calls.byKindMarket[k], m => m, false), '');
    }
  } else L.push('No calls settled in this window.', '');

  const a = r.abstention;
  L.push('## Abstention', '');
  L.push(`**Live book at report time (${a.book.asOf}).** ${a.book.upcoming} upcoming lots: ${a.book.valued} valued, ${a.book.abstained} abstained${a.book.neither ? `, ${a.book.neither} carrying neither marker` : ''} (abstention rate ${pct(a.book.abstainPct)}). Reasons are only stamped on upcoming rows, so this is a point-in-time read of the book, not of the window.`, '');
  if (Object.keys(a.book.reasons).length) {
    L.push('| reason | lots | share of abstentions |', '|---|---:|---:|');
    for (const [k, v] of Object.entries(a.book.reasons).sort((x, y) => y[1] - x[1])) L.push(`| ${k} | ${v} | ${a.book.abstained ? r1(100 * v / a.book.abstained) : 0}% |`);
    L.push('');
  }
  if (a.settled.tapeSince && a.settled.tapeSince >= r.window.to) {
    L.push(`The served-value record starts on ${a.settled.tapeSince}, after this window, so settled-lot coverage cannot be measured here.`, '');
  } else if (a.settled.tapeSince) {
    L.push(`**Settled lots in the window that were in the live book while the tape recorded (sold after ${a.settled.tapeSince}, first seen before their sale day).** ${a.settled.eligible} lots, ${a.settled.valued} wore a served value (${pct(a.settled.valuedPct)}). The rest were abstained or never reached the engine (reason not kept on sold rows).`, '');
    if (Object.keys(a.settled.byMarket).length) {
      L.push('| market | eligible | valued | valued % |', '|---|---:|---:|---:|');
      for (const [k, v] of Object.entries(a.settled.byMarket)) L.push(`| ${k} | ${v.eligible} | ${v.valued} | ${pct(v.valuedPct)} |`);
      L.push('');
    }
  } else L.push('No value tape rows, so settled-lot coverage cannot be measured for this window.', '');

  L.push('## Trend (previous three reports)', '');
  if (!r.trend.length) L.push('No prior reports in docs/accuracy yet. This is the first.', '');
  else {
    const rows = [{ month: r.month, partial: r.partial, headline: r.headline }, ...r.trend];
    const ck = Array.from(new Set(rows.flatMap(t => Object.keys(t.headline.calls || {})))).sort();
    L.push(`| month | tape graded | lectr med abs err (all paths) | estimate lots | lectr med abs err (estimate lots) | house med abs err | lectr closer | band | ≤ max bid | flag edge |${ck.map(k => ` ${k} graded / med err |`).join('')}`);
    L.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|${ck.map(() => '---:|').join('')}`);
    for (const t of rows) {
      const h = t.headline;
      L.push(`| ${t.month}${t.partial ? ' (partial)' : ''} | ${h.tapeGraded} | ${pct(h.tapeMedAbsErrPct)} | ${h.estGraded ?? '—'} | ${pct(h.estMedAbsErrPct)} | ${pct(h.houseMedAbsErrPct)} | ${pct(h.closerPct)} | ${pct(h.bandPct)} | ${pct(h.maxBidPct)} | ${h.flagEdgeRatio == null ? '—' : `${h.flagEdgeRatio}×`} |${ck.map(k => ` ${h.calls?.[k] ? `${h.calls[k].graded} / ${pct(h.calls[k].medAbsErrPct)}` : '—'} |`).join('')}`);
    }
    L.push('');
  }
  L.push('## Sources', '');
  for (const [k, v] of Object.entries(r.sources)) L.push(`- ${k}: ${v}`);
  L.push('');
  return L.join('\n');
}

// ── window + args ───────────────────────────────────────────────────────────
export function monthWindow(month: string): Window {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
export function previousMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}
export type Args = { month: string; window: Window; partial: boolean; outDir: string; corpusDir: string; servedDir: string; snapshotDir: string | null };
export function parseArgs(argv: string[], now: Date, cwd = process.cwd()): Args {
  const get = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  let from = get('from'), to = get('to');
  let month = get('month');
  if (month && !/^\d{4}-\d{2}$/.test(month)) throw new Error(`--month must be YYYY-MM, got ${month}`);
  if (from && !DAY.test(from)) throw new Error(`--from must be YYYY-MM-DD, got ${from}`);
  if (to && !DAY.test(to)) throw new Error(`--to must be YYYY-MM-DD, got ${to}`);
  if (!month) month = (from || to)?.slice(0, 7) || previousMonth(now);
  const full = monthWindow(month);
  from = from || full.from; to = to || full.to;
  if (from > to) throw new Error(`--from ${from} is after --to ${to}`);
  if (from.slice(0, 7) !== month || to.slice(0, 7) !== month) throw new Error(`the window ${from} → ${to} must sit inside one calendar month (${month}); reports are monthly`);
  // the window is partial when it does not cover the whole month, or the month is not over yet
  const today = now.toISOString().slice(0, 10);
  const partial = from !== full.from || to !== full.to || today <= full.to;
  if (to > today) to = today;
  return {
    month, window: { from, to }, partial,
    outDir: path.resolve(cwd, get('out-dir') || 'docs/accuracy'),
    corpusDir: path.resolve(cwd, get('corpus-dir') || 'data/corpus'),
    servedDir: path.resolve(cwd, get('served-dir') || 'public/data/ray'),
    snapshotDir: get('snapshot-tape') ? path.resolve(cwd, get('snapshot-tape')!) : null,
  };
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

type RawLot = {
  id: string | number; status?: string; saleDate?: string; artist?: string; auctionHouse?: string;
  realizedUsd?: number | null; priceUsd?: number | null; hammerUsd?: number | null; buyerPremiumPct?: number | null;
  estLowUsd?: number | null; estHighUsd?: number | null; value?: unknown; abstain?: string; firstSeen?: string;
};
export function soldInfoOf(l: RawLot): SoldInfo {
  const st = l.status === 'sold' ? 'sold' : l.status === 'bought_in' ? 'bought_in' : 'other';
  const r = st === 'sold' ? (l.realizedUsd && l.realizedUsd > 0 ? l.realizedUsd : l.priceUsd || 0) : 0;
  const h = st === 'sold' ? inferHammerUsd(l) : 0;
  const f = r > 0 && h > 0 ? r / h : lotAllInFactor(l);
  return {
    id: String(l.id), status: st, sd: String(l.saleDate || '').slice(0, 10), r, h, f,
    estLo: l.estLowUsd && l.estLowUsd > 0 ? l.estLowUsd : undefined,
    estHi: l.estHighUsd && l.estHighUsd > 0 ? l.estHighUsd : undefined,
    market: marketOf(String(l.artist || '')), house: String(l.auctionHouse || ''),
  };
}

/** Stream the sold corpus once: join the lots we need, count the window's
 *  settled coverage, and read the live book's abstentions. */
async function scanCorpus(files: string[], need: Set<string>, w: Window, tapeValued: Map<string, string>, tapeSince: string | null, today: string): Promise<{ sold: Map<string, SoldInfo>; abstention: Abstention; scanned: number }> {
  const sold = new Map<string, SoldInfo>();
  const book = { asOf: today, upcoming: 0, valued: 0, abstained: 0, neither: 0, abstainPct: null as number | null, reasons: {} as Record<string, number> };
  const byMarket: Record<string, { eligible: number; valued: number; valuedPct: number | null }> = {};
  let eligible = 0, valued = 0, scanned = 0;
  const ID = /"id":("([^"\\]*)"|(\d+))/, SD = /"saleDate":"(\d{4}-\d{2}-\d{2})/, ST = /"status":"(upcoming|sold)"/;
  for (const file of files) {
    await streamGzLines(file, (buf, s, e) => {
      scanned++;
      const line = buf.toString('utf8', s, e);
      const im = ID.exec(line); const id = im ? (im[2] ?? im[3]) : undefined;
      const sd = SD.exec(line)?.[1];
      const st = ST.exec(line)?.[1];
      const wanted = id !== undefined && need.has(id);
      const settledInWin = !!sd && inWindow(sd, w) && st === 'sold';
      if (!wanted && !settledInWin && st !== 'upcoming') return;
      const rows = JSON.parse(line);
      for (const l of (Array.isArray(rows) ? rows : [rows]) as RawLot[]) {
        const lid = String(l.id);
        if (need.has(lid)) {
          const prev = sold.get(lid), cur = soldInfoOf(l);
          // a lot can appear in both the main corpus and the archive: the settled row wins
          if (!prev || (prev.status !== 'sold' && cur.status === 'sold')) sold.set(lid, cur);
        }
        const day = String(l.saleDate || '').slice(0, 10);
        if (l.status === 'upcoming') {
          book.upcoming++;
          if (l.value) book.valued++;
          else if (l.abstain) { book.abstained++; book.reasons[l.abstain] = (book.reasons[l.abstain] || 0) + 1; }
          else book.neither++;
        } else if (l.status === 'sold' && day && inWindow(day, w) && tapeSince && day > tapeSince && l.firstSeen && l.firstSeen.slice(0, 10) < day) {
          const m = marketOf(String(l.artist || ''));
          const cell = byMarket[m] || (byMarket[m] = { eligible: 0, valued: 0, valuedPct: null });
          eligible++; cell.eligible++;
          const callDay = tapeValued.get(lid);
          if (callDay && callDay <= day) { valued++; cell.valued++; }
        }
      }
    });
  }
  book.abstainPct = book.upcoming >= MIN_SHOW ? r1(100 * book.abstained / book.upcoming) : null;
  for (const c of Object.values(byMarket)) c.valuedPct = c.eligible >= MIN_SHOW ? r1(100 * c.valued / c.eligible) : null;
  return {
    sold, scanned,
    abstention: { book, settled: { tapeSince, eligible, valued, valuedPct: eligible >= MIN_SHOW ? r1(100 * valued / eligible) : null, byMarket: Object.fromEntries(Object.entries(byMarket).sort()) } },
  };
}

export function readPriorReports(dir: string, month: string): { month: string; partial: boolean; headline: Headline }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { month: string; partial: boolean; headline: Headline }[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^(\d{4}-\d{2})\.json$/.exec(f);
    if (!m || m[1] >= month) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Partial<Report>;
      if (j.schema === 1 && j.headline) out.push({ month: m[1], partial: !!j.partial, headline: j.headline });
    } catch (e) { console.warn(`[accuracy] skipping unreadable prior report ${f}: ${(e as Error).message}`); }
  }
  return out;
}

async function main() {
  const now = new Date();
  const args = parseArgs(process.argv.slice(2), now);
  const tapeFile = path.join(args.corpusDir, 'value-tape.json.gz');
  const callsFile = path.join(args.corpusDir, 'calls-ledger.json.gz');
  const sources: Record<string, string> = {};
  const exists = (f: string) => fs.existsSync(f) && fs.statSync(f).size > 0;
  const realTape = exists(tapeFile) ? await readNdjsonGz<TapeRow>(tapeFile) : [];
  sources['value tape'] = exists(tapeFile) ? `${path.relative(process.cwd(), tapeFile)} (${realTape.length} rows)` : 'MISSING';
  // BACKFILL ONLY (never in CI): rebuild first-served values from dated served
  // snapshots for the weeks before the tape persisted
  let tape = realTape, snapshotDays: string[] | undefined;
  if (args.snapshotDir) {
    const snap = readSnapshotTape(args.snapshotDir);
    tape = mergeTape(realTape, snap.rows);
    snapshotDays = snap.days;
    const kept = tape.filter(t => t.rc).length;
    sources['reconstructed rows'] = `${kept} first-served values from ${snap.days.length} served snapshots (${snap.days[0] || '-'} → ${snap.days[snap.days.length - 1] || '-'}), ${snap.rows.length - kept} superseded by earlier/tape rows`;
  }
  const calls = exists(callsFile) ? await readNdjsonGz<CallRow>(callsFile) : [];
  sources['calls ledger'] = exists(callsFile) ? `${path.relative(process.cwd(), callsFile)} (${calls.length} rows)` : 'MISSING';

  // the sold corpus: the merged corpus files when present, else the per-house segments
  let corpusFiles = ['lots.json.gz', 'sold-archive.json.gz'].map(f => path.join(args.corpusDir, f)).filter(exists);
  if (!corpusFiles.length) {
    const seg = path.join(args.corpusDir, 'segments');
    if (fs.existsSync(seg)) corpusFiles = fs.readdirSync(seg).filter(f => f.endsWith('.ndjson.gz')).sort().map(f => path.join(seg, f));
  }
  const need = new Set<string>([...tape.map(t => t.id), ...calls.map(c => c.id)]);
  const tapeValued = new Map<string, string>();
  for (const t of tape) if (!t.sh && (!tapeValued.has(t.id) || t.d < tapeValued.get(t.id)!)) tapeValued.set(t.id, t.d);
  const tapeSince = tape.filter(t => !t.sh).map(t => t.d).sort()[0] || null;
  const scan = await scanCorpus(corpusFiles, need, args.window, tapeValued, tapeSince, now.toISOString().slice(0, 10));
  sources['sold corpus'] = corpusFiles.length ? `${corpusFiles.map(f => path.relative(process.cwd(), f)).join(', ')} (${scan.scanned} rows scanned, ${scan.sold.size} of ${need.size} called lots joined)` : 'MISSING: nothing can be graded';
  const meta = path.join(args.servedDir, 'meta.json');
  if (exists(meta)) { try { sources['data as of (lastCrawl)'] = String(JSON.parse(fs.readFileSync(meta, 'utf8')).lastCrawl || 'unknown'); } catch { /* advisory */ } }

  const report = buildReport({
    month: args.month, window: args.window, partial: args.partial, now,
    tape, calls, sold: scan.sold, abstention: scan.abstention,
    prior: readPriorReports(args.outDir, args.month), sources, snapshotDays,
  });
  if (!corpusFiles.length) report.notes.unshift('The sold corpus was not available to this run, so NOTHING could be graded. Pull it (scripts/data-store.sh pull) and re-run.');
  fs.mkdirSync(args.outDir, { recursive: true });
  const base = path.join(args.outDir, args.month);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 1) + '\n');
  fs.writeFileSync(`${base}.md`, renderMarkdown(report));
  const h = report.headline;
  console.log(`[accuracy] ${args.month}${args.partial ? ' (partial)' : ''} ${args.window.from} → ${args.window.to}: tape graded ${h.tapeGraded} · lectr err ${pct(h.tapeMedAbsErrPct)} vs house ${pct(h.houseMedAbsErrPct)} · closer ${pct(h.closerPct)} · band ${pct(h.bandPct)} · ≤maxBid ${pct(h.maxBidPct)} · calls ${Object.entries(h.calls).map(([k, c]) => `${k} ${c.graded}/${pct(c.medAbsErrPct)}`).join(', ') || 'none'}`);
  console.log(`[accuracy] wrote ${path.relative(process.cwd(), base)}.md + .json`);
}

// entry-module only: scripts/accuracy-ledger.ts imports the graders above
if (process.env.RAY_SKIP_MAIN !== '1' && process.argv[1] && /accuracy-report\.ts$/.test(process.argv[1])) main().catch(e => { console.error(e); process.exit(1); });
