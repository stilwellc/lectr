/**
 * settled-appraisal.ts — THE SETTLED APPRAISAL (W31, Oct 11 2026).
 *
 * The engine stamps `value` on LIVE lots only; a settled row the reader owns
 * read "— · not on the block" on /profile. This module holds the pure rules
 * of the build pass that values the SERVED SOLD rows too (build-market.ts
 * §1b hedonic / §3 card tiers) — the scope, the target order, the stamp's
 * shape and its grade — so they are testable without the corpus.
 *
 * THE READ IS TODAY'S VALUE OF A PAST OBJECT: the same engine, the same comp
 * pools, the same floor / gate / confidence rules as a live lot valued
 * tonight — the valued row is never in its own pool (resolveComps skips its
 * id), and comps dated AFTER its sale are admitted (priorTo = today). It is
 * NOT what the engine would have said before the hammer (that is the
 * backtest's point-in-time replay). Every stamped row names the day it was
 * read: `valueAsOf` = the build day.
 *
 * No call rides a settled value: `signal` and `vsBid` are null (there is no
 * bid to make on a hammered lot), so no surface prints "below estimate"
 * against an estimate the house published years ago. The value, its band,
 * the buyer's hammer fields, the comp pool and n are the engine's own.
 *
 * Scope: RAY_SETTLED_MONTHS (served sold rows whose sale is within that many
 * months of the build day; 0 = every served sold row; 'off' = pass disabled)
 * and RAY_SETTLED_BUDGET_S (wall-clock budget — newest rows first, so a
 * budget hit leaves the oldest unstamped, never the ones a reader is most
 * likely to hold). Idempotent: the build clears last night's stamps first
 * and re-reads every row in scope from tonight's corpus.
 */
import type { ValueResult } from '../../app/lib/value';
import { quantile, median } from '../../app/lib/stats';

/** the nightly's defaults (measured Oct 11 2026 — see the W31 report):
 *  24 months of served sold rows fit the assemble job's budget; 480s caps the
 *  pass on a slow night */
export const SETTLED_DEFAULTS = { months: 24, budgetS: 480 } as const;

export interface SettledScope {
  /** sale within this many months of the build day; null = every served sold row */
  months: number | null;
  /** wall-clock budget for the hedonic pass (ms) */
  budgetMs: number;
}

/** RAY_SETTLED_MONTHS: integer months (0 = all) · 'off' / '-1' = disabled (null)
 *  RAY_SETTLED_BUDGET_S: seconds (default SETTLED_DEFAULTS.budgetS) */
export function settledScopeOf(env: Record<string, string | undefined>): SettledScope | null {
  const raw = (env.RAY_SETTLED_MONTHS ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'false' || raw === 'none') return null;
  let months: number | null = SETTLED_DEFAULTS.months;
  if (raw !== '') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    months = n === 0 ? null : Math.floor(n);
  }
  const bs = Number((env.RAY_SETTLED_BUDGET_S ?? '').trim() || SETTLED_DEFAULTS.budgetS);
  const budgetMs = (Number.isFinite(bs) && bs > 0 ? bs : SETTLED_DEFAULTS.budgetS) * 1000;
  return { months, budgetMs };
}

/** the first sale day in scope (ISO day): `months` calendar months before
 *  `todayIso`; '0000-00-00' when the scope is every row */
export function settledCut(todayIso: string, months: number | null): string {
  if (months == null) return '0000-00-00';
  const d = new Date(`${todayIso.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

type TargetRow = { id: string; status?: string; saleDate?: string | null; realizedUsd?: number | null; titleTokens?: string[] | null };

/** a served sold row the hedonic pass can read: priced, dated, tokenized
 *  (the comp pool's own predicate — a row with no title tokens has no
 *  vector and would force a full-roster scan to abstain) */
export function isSettledTarget(l: TargetRow, cut: string): boolean {
  return l.status === 'sold' && (l.realizedUsd || 0) > 0 && !!l.saleDate && l.saleDate.slice(0, 10) >= cut
    && Array.isArray(l.titleTokens) && l.titleTokens.length > 0;
}

/** the rows in scope, NEWEST SALE FIRST (ties by id) — the budget cuts the
 *  oldest, never the rows a reader most likely holds */
export function settledTargets<T extends TargetRow>(rows: readonly T[], cut: string): T[] {
  const out: T[] = [];
  for (const l of rows) if (isSettledTarget(l, cut)) out.push(l);
  out.sort((a, b) => {
    const da = a.saleDate!.slice(0, 10), db = b.saleDate!.slice(0, 10);
    if (da !== db) return da < db ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/** THE SETTLED STAMP: the engine's value with no call on it — `signal` and
 *  `vsBid` null, no live-bid floor. Everything else (the prediction, its band,
 *  the buyer's hammer fields, pool ids / n / otherWorkIds, confidence, tier,
 *  compRatio / flagRatio / houseFactor as statistics, engineVersion) is the
 *  engine's own. A fresh object: the engine's result is never mutated. */
export function settledValueOf<V extends ValueResult>(v: V): V {
  const out = { ...v, signal: null, vsBid: null } as V & { bidFloor?: number };
  if ('bidFloor' in out) delete out.bidFloor;
  return out;
}

export interface SettledGrade { n: number; medAbsErrPct: number | null; within30Pct: number | null; bias: number | null }
/** 'e' = estimate lot (hedonic), 'n' = no-estimate hedonic, 'c' = card / TCG tier */
export type SettledPath = 'e' | 'n' | 'c';

type GradedRow = {
  saleDate?: string | null; realizedUsd?: number | null; estLowUsd?: number | null; estHighUsd?: number | null;
  value?: { compValueUsd: number; basis?: string } | null;
};

export function settledPathOf(l: GradedRow): SettledPath {
  if (l.value?.basis === 'card-comp') return 'c';
  return (l.estLowUsd || 0) > 0 || (l.estHighUsd || 0) > 0 ? 'e' : 'n';
}

function gradeOf(ratios: number[]): SettledGrade {
  if (!ratios.length) return { n: 0, medAbsErrPct: null, within30Pct: null, bias: null };
  const errs = ratios.map(r => Math.abs(r - 1));
  return {
    n: ratios.length,
    medAbsErrPct: Math.round(median(errs) * 1000) / 10,
    within30Pct: Math.round(1000 * errs.filter(e => e <= 0.3).length / errs.length) / 10,
    bias: Math.round(median(ratios) * 1000) / 1000,
  };
}

/** THE SANITY CHECK: rows sold within `days` of the build day, valued as of
 *  today vs what they realized (all-in to all-in: value.compValueUsd vs
 *  realizedUsd). Reported like the live gate — median abs error, share within
 *  ±30%, bias = median realized / value. Comps after the sale are admitted
 *  here (today's read), so this is a tracking check, not the point-in-time
 *  record. */
export function gradeSettled(rows: readonly GradedRow[], todayIso: string, days = 60): { days: number; all: SettledGrade; byPath: Record<SettledPath, SettledGrade> } {
  const cut = new Date(Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`) - days * 864e5).toISOString().slice(0, 10);
  const all: number[] = [];
  const by: Record<SettledPath, number[]> = { e: [], n: [], c: [] };
  for (const l of rows) {
    const v = l.value;
    if (!v || !(v.compValueUsd > 0) || !(l.realizedUsd! > 0)) continue;
    const d = (l.saleDate || '').slice(0, 10);
    if (!d || d < cut || d > todayIso.slice(0, 10)) continue;
    const r = l.realizedUsd! / v.compValueUsd;
    all.push(r); by[settledPathOf(l)].push(r);
  }
  return { days, all: gradeOf(all), byPath: { e: gradeOf(by.e), n: gradeOf(by.n), c: gradeOf(by.c) } };
}

export interface CohortRatio { n: number; medRatio: number | null; q1: number | null; q3: number | null }
/** how today's value sits against the realized price by SALE AGE — the
 *  diagnostic for an estimate-anchored read on an old sale (a cohort pinned
 *  at ratio ≈ 1 with no spread is reading the old estimate, not the market) */
export const SETTLED_COHORTS: readonly [string, number, number][] = [
  ['0-2m', 0, 2], ['2-12m', 2, 12], ['12-24m', 12, 24], ['24-36m', 24, 36], ['36m+', 36, 10_000],
];
export function cohortRatios(rows: readonly GradedRow[], todayIso: string): Record<string, Record<SettledPath | 'all', CohortRatio>> {
  const t = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  const acc: Record<string, Record<SettledPath | 'all', number[]>> = {};
  for (const [k] of SETTLED_COHORTS) acc[k] = { all: [], e: [], n: [], c: [] };
  for (const l of rows) {
    const v = l.value;
    if (!v || !(v.compValueUsd > 0) || !(l.realizedUsd! > 0)) continue;
    const ms = Date.parse(`${(l.saleDate || '').slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(ms)) continue;
    const ageM = (t - ms) / (30.4375 * 864e5);
    const c = SETTLED_COHORTS.find(([, lo, hi]) => ageM >= lo && ageM < hi);
    if (!c) continue;
    const r = l.realizedUsd! / v.compValueUsd;
    acc[c[0]].all.push(r); acc[c[0]][settledPathOf(l)].push(r);
  }
  const cell = (a: number[]): CohortRatio => {
    if (!a.length) return { n: 0, medRatio: null, q1: null, q3: null };
    const s = a.slice().sort((x, y) => x - y);
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    return { n: a.length, medRatio: r3(quantile(s, 0.5)), q1: r3(quantile(s, 0.25)), q3: r3(quantile(s, 0.75)) };
  };
  const out: Record<string, Record<SettledPath | 'all', CohortRatio>> = {};
  for (const [k] of SETTLED_COHORTS) out[k] = { all: cell(acc[k].all), e: cell(acc[k].e), n: cell(acc[k].n), c: cell(acc[k].c) };
  return out;
}
