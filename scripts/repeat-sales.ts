/**
 * repeat-sales.ts — the gold-standard, MIX-IMMUNE price index.
 *
 * WHY THIS EXISTS: every index in this repo that regresses a CROSS-SECTION of
 * lots (the cohort median in app/lib/indices.ts, even the hedonic in
 * scripts/hedonic-index.ts) must fight the composition problem — if the MIX of
 * what sold shifts, the number moves even when nothing appreciated. The hedonic
 * fights it with quality controls (maker/form/size dummies); a median doesn't
 * fight it at all. A REPEAT-SALES index sidesteps it entirely: it measures the
 * price change of a SINGLE physical object across its OWN resales, so the object
 * is its own control. No hedonic dummies, no mix bias, no "which cards sold this
 * quarter" leak. This is the Case-Shiller / Bailey-Muth-Nourse method, the same
 * one behind the S&P CoreLogic home-price indices.
 *
 * THE METHOD (Bailey-Muth-Nourse 1963, "A Regression Method for Real Estate
 * Price Index Construction", JASA):
 *   1. Link an object's SOLD sales across dates via a stable object key.
 *   2. Form consecutive-sale PAIRS. Each pair (sale at period q1 → sale at q2)
 *      contributes ONE observation: the log-price relative r = ln(p2/p1).
 *   3. That relative EQUALS the cumulative index change over the interval:
 *          ln(p2/p1) = β[q2] − β[q1] + ε
 *      where β[q] is the (log) index level at period q. So we regress the vector
 *      of relatives onto a design D whose row for a pair is +1 in column q2, −1
 *      in column q1, 0 elsewhere. β is recovered by least squares (D'D β = D'r),
 *      D'D being the SPARSE, weighted period-adjacency Laplacian. The base
 *      period is dropped (β[base]≡0) to identify the system.
 *   4. Rebase exp(β) to 100 at the base quarter → a level series; horizon
 *      changes are exp(β[end]−β[start])−1 with CIs from the residual variance.
 *
 * KEYING (caller-supplied): `keyOf(lot)` returns a stable object-linkage key —
 * a cert number for a graded card, an objectFingerprint otherwise — or null to
 * skip. The engine NEVER guesses identity; it links only what the keyer asserts
 * is the same object. Swap the keyer, keep the engine.
 *
 * HONESTY: same discipline as hedonic-index.ts. Thin markets ABSTAIN rather than
 * emit a confident-looking number: a horizon publishes only when it clears a min
 * pair count AND a min distinct-object count AND its CI resolves the sign and
 * isn't pure noise. A market that can't be measured SAYS SO.
 *
 * KNOWN BIASES (documented, not hidden):
 *  • INTERVAL BIAS: repeat-sales weights long-held objects the same as fast
 *    flips; heteroskedasticity grows with holding time. We apply the standard
 *    BMN 3-stage GLS correction (weight each pair by 1/√Var(ε) where Var grows
 *    with the gap) to de-bias, and report both OLS and GLS-adjusted CIs.
 *  • SELECTION / SURVIVORSHIP: only objects that resold enter — flippers and
 *    "hot" cards are over-represented vs buy-and-hold. This tilts the sample.
 *  • THIN TAILS: early quarters carry few pairs; their β is noisy and their CI
 *    wide. The gating refuses to publish a horizon anchored on a thin quarter.
 *
 * BUILD-TIME ONLY (Node/tsx). No client bundle impact. Mirrors the ml-matrix /
 * Cholesky / gating conventions of scripts/hedonic-index.ts.
 */
import { Matrix, CholeskyDecomposition, EigenvalueDecomposition } from 'ml-matrix';
import type { AuctionLot } from '../app/types';

// ── public shapes ──────────────────────────────────────────────────────────
export interface RepeatSalePoint {
  period: string;   // 'YYYY-Q{n}'
  value: number;    // index, 100 at the base quarter (FLOAT — display rounds)
  ciLo: number;     // 95% CI lower on the index level
  ciHi: number;     // 95% CI upper
  nPairs: number;   // pairs whose interval spans (touches) this quarter
}
export interface RepeatSaleHorizon {
  changePct: number | null;   // 100·(exp(β[end]−β[start])−1)
  ciLoPct: number | null;
  ciHiPct: number | null;
  publishable: boolean;
  reason: string;             // '' when publishable, else why not
}
export interface RepeatSaleResult {
  series: RepeatSalePoint[];
  horizons: Record<string, RepeatSaleHorizon>;  // '1Y' | '3Y' | '5Y'
  nPairs: number;             // pairs contributing period contrast (q1 ≠ q2)
  nObjects: number;           // distinct linked objects with ≥2 dated sales
  note: string;
}

// ── tunables (documented; see the gating section) ───────────────────────────
export interface RepeatSaleOpts {
  now?: Date;
  minPairs?: number;          // whole-index floor: below this, abstain entirely
  minObjects?: number;        // whole-index floor: distinct objects
  minQuarterPairs?: number;   // a quarter earns a β column only with ≥ this many
                              //   pairs touching it (else pooled into the base)
  horizonMinPairs?: number;   // a HORIZON publishes only if both endpoints clear
  horizonMinObjects?: number; //   this many pairs / distinct objects
  maxLogRelative?: number;    // |ln(p2/p1)| above this ⇒ mis-link / data error,
                              //   pair dropped (a >e^3≈20× swing on the "same"
                              //   object is almost always a keyer false-positive)
  ridge?: number;             // λ on β for numerical stability of D'D
  /** period granularity: 4 = quarters (default), 2 = half-years. Halves exist
      for SEASONAL markets (design trades ~2 real quarters/year), where
      quarterly endpoints starve the pair gates even though a year of data
      clears them. A documented aggregation choice, not a gate change: the
      same pair floors apply to the half-year endpoints. */
  periodsPerYear?: 4 | 2;
}
const DEFAULTS: Required<Omit<RepeatSaleOpts, 'now'>> = {
  minPairs: 150,
  minObjects: 60,
  minQuarterPairs: 8,
  horizonMinPairs: 40,
  horizonMinObjects: 20,
  maxLogRelative: 3.0,
  ridge: 1e-6,
  periodsPerYear: 4,
};

// ── small helpers (mirror hedonic-index.ts) ─────────────────────────────────
function quarterOf(saleDate: string, ppy: 4 | 2 = 4): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(saleDate);
  if (!m) return null;
  const mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  const bucket = Math.ceil(mo / (12 / ppy));
  return ppy === 4 ? `${m[1]}-Q${bucket}` : `${m[1]}-H${bucket}`;
}
/** integer index of a period for arithmetic (year*ppy + p-1). */
function quarterOrdinal(period: string): number {
  const half = period.includes('-H');
  const [ys, qs] = period.split(half ? '-H' : '-Q');
  return half ? +ys * 2 + (+qs - 1) : +ys * 4 + (+qs - 1);
}
function currentQuarter(now: Date, ppy: 4 | 2 = 4): string {
  const y = now.getUTCFullYear();
  const b = Math.floor(now.getUTCMonth() / (12 / ppy)) + 1;
  return ppy === 4 ? `${y}-Q${b}` : `${y}-H${b}`;
}
function shiftQuarter(period: string, k: number): string {
  const half = period.includes('-H');
  const per = half ? 2 : 4;
  const total = quarterOrdinal(period) - k;
  const y = Math.floor(total / per);
  const q = (total % per + per) % per + 1;
  return `${y}-${half ? 'H' : 'Q'}${q}`;
}

// ── linear algebra (mirror hedonic-index.ts) ────────────────────────────────
function solveSPD(A: Matrix, B: Matrix): Matrix {
  try {
    return new CholeskyDecomposition(A).solve(B);
  } catch {
    return pseudoInverse(A).mmul(B);
  }
}
function pseudoInverse(A: Matrix): Matrix {
  const evd = new EigenvalueDecomposition(A);
  const V = evd.eigenvectorMatrix;
  const d = evd.realEigenvalues;
  const tol = 1e-10 * Math.max(...d.map(Math.abs), 1e-30);
  const dInv = d.map((x) => (Math.abs(x) > tol ? 1 / x : 0));
  return V.mmul(Matrix.diag(dInv)).mmul(V.transpose());
}

// ── pair extraction ─────────────────────────────────────────────────────────
interface Sale { period: string; ord: number; logP: number; date: string; price: number; }
interface Pair {
  q1: string; q2: string;   // sale periods (q1 < q2 by construction after sort)
  ord1: number; ord2: number;
  r: number;                // ln(p2/p1)
  gap: number;              // q2ord − q1ord (in quarters, ≥1 for kept pairs)
  key: string;              // object key (for distinct-object counting per horizon)
}
/** Group a lot's SOLD sales by key, keep keys with ≥2 dated sales, form
 *  consecutive-sale pairs. Returns pairs + the distinct-object count. */
function extractPairs(
  lots: AuctionLot[],
  keyOf: (l: AuctionLot) => string | null,
  maxLogRelative: number,
  ppy: 4 | 2 = 4,
): { pairs: Pair[]; nObjects: number; totalConsecutive: number } {
  const byKey = new Map<string, Sale[]>();
  for (const l of lots) {
    if (l.status !== 'sold') continue;
    const price = l.priceUsd || 0;
    if (!(price > 0)) continue;
    const date = l.saleDate;
    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue;
    const period = quarterOf(date, ppy);
    if (!period) continue;
    const key = keyOf(l);
    if (!key) continue;
    (byKey.get(key) || byKey.set(key, []).get(key)!).push({
      period, ord: quarterOrdinal(period), logP: Math.log(price), date, price,
    });
  }
  const pairs: Pair[] = [];
  let nObjects = 0;
  let totalConsecutive = 0;
  for (const [key, salesRaw] of Array.from(byKey.entries())) {
    // need ≥2 sales AND ≥2 DISTINCT sale dates (two lots on the same day at the
    // same auction aren't a resale of one object through time — they're two
    // interchangeable copies; the interval is undefined). Sort by date.
    const sales = salesRaw.slice().sort((a, b) => a.date.localeCompare(b.date));
    const distinctDates = new Set(sales.map((s) => s.date));
    if (sales.length < 2 || distinctDates.size < 2) continue;
    nObjects++;
    for (let i = 1; i < sales.length; i++) {
      const a = sales[i - 1], b = sales[i];
      totalConsecutive++;
      const r = b.logP - a.logP;
      // drop implausible relatives (keyer false-positive / data error) and
      // same-PERIOD pairs (no period contrast — they can't move any β, though
      // they'd inflate residual dof; standard BMN drops them from the fit).
      if (Math.abs(r) > maxLogRelative) continue;
      if (b.ord === a.ord) continue;
      pairs.push({ q1: a.period, q2: b.period, ord1: a.ord, ord2: b.ord, r, gap: b.ord - a.ord, key });
    }
  }
  return { pairs, nObjects, totalConsecutive };
}

// ── the BMN regression ───────────────────────────────────────────────────────
// Columns = quarters that earn a β (≥ minQuarterPairs pairs touch them), minus
// the BASE (earliest such quarter, β≡0). Each pair row is +1 @ q2, −1 @ q1.
// We never materialize the dense n×p design: we accumulate D'WD (p×p) and D'Wr
// by touching only each pair's two nonzero entries — O(nPairs) not O(nPairs·p).
interface FitOut {
  cols: string[];                 // quarter for each β column (base excluded)
  colOf: Map<string, number>;     // quarter → column index (base absent ⇒ β=0)
  beta: number[];                 // length p (log index level, base=0 implied)
  cov: number[][];                // p×p covariance of β
  sigma2: number;
  base: string;
  quarters: string[];             // ALL indexable quarters incl. base, sorted
  pairsTouching: Map<string, number>;
}
function fitBMN(pairs: Pair[], minQuarterPairs: number, ridge: number, gls: boolean): FitOut | null {
  // count pairs touching each quarter (endpoint membership)
  const touch = new Map<string, number>();
  for (const p of pairs) {
    touch.set(p.q1, (touch.get(p.q1) || 0) + 1);
    touch.set(p.q2, (touch.get(p.q2) || 0) + 1);
  }
  const quarters = Array.from(touch.keys())
    .filter((q) => (touch.get(q) || 0) >= minQuarterPairs)
    .sort();
  if (quarters.length < 2) return null;
  const keep = new Set(quarters);
  // keep only pairs whose BOTH endpoints are indexable quarters (a pair to a
  // pooled thin quarter has no defined contrast)
  const usable = pairs.filter((p) => keep.has(p.q1) && keep.has(p.q2));
  if (usable.length < 1) return null;

  const base = quarters[0];
  const cols = quarters.filter((q) => q !== base);
  const colOf = new Map<string, number>();
  cols.forEach((q, i) => colOf.set(q, i));
  const p = cols.length;
  if (p < 1) return null;

  // GLS weights: BMN 3-stage. Stage 1 = OLS (w=1). Stage 2 = regress squared OLS
  // residuals on the gap to estimate Var(ε)=A+B·gap, weight by 1/Var. We compute
  // a single GLS refit here when `gls` is true, using an OLS pass to get resids.
  const solveWeighted = (weights: number[]): { beta: number[]; cov: number[][]; sigma2: number } => {
    const DtWD = new Float64Array(p * p);
    const DtWr = new Float64Array(p);
    for (let i = 0; i < usable.length; i++) {
      const pr = usable[i];
      const w = weights[i];
      const c2 = colOf.has(pr.q2) ? colOf.get(pr.q2)! : -1; // base ⇒ -1 (β=0)
      const c1 = colOf.has(pr.q1) ? colOf.get(pr.q1)! : -1;
      // row has +1 @ c2, −1 @ c1. Accumulate outer product · w and D'Wr.
      if (c2 >= 0) { DtWr[c2] += w * pr.r; DtWD[c2 * p + c2] += w; }
      if (c1 >= 0) { DtWr[c1] += -w * pr.r; DtWD[c1 * p + c1] += w; }
      if (c2 >= 0 && c1 >= 0) { DtWD[c2 * p + c1] -= w; DtWD[c1 * p + c2] -= w; }
    }
    for (let c = 0; c < p; c++) DtWD[c * p + c] += ridge;
    const A = new Matrix(p, p);
    for (let r = 0; r < p; r++) for (let c = 0; c < p; c++) A.set(r, c, DtWD[r * p + c]);
    const B = Matrix.columnVector(Array.from(DtWr));
    const beta = solveSPD(A, B).to1DArray();
    // residuals + robust-ish σ² (weighted RSS / dof)
    let wrss = 0, wsum = 0;
    const resid = new Float64Array(usable.length);
    for (let i = 0; i < usable.length; i++) {
      const pr = usable[i];
      const b2 = colOf.has(pr.q2) ? beta[colOf.get(pr.q2)!] : 0;
      const b1 = colOf.has(pr.q1) ? beta[colOf.get(pr.q1)!] : 0;
      const e = pr.r - (b2 - b1);
      resid[i] = e;
      wrss += weights[i] * e * e; wsum += weights[i];
    }
    const sigma2 = wrss / Math.max(usable.length - p, 1);
    const Ainv = pseudoInverse(A);
    const cov = Ainv.mul(sigma2).to2DArray();
    return { beta, cov, sigma2, resid: Array.from(resid) } as unknown as { beta: number[]; cov: number[][]; sigma2: number };
  };

  // Stage 1: OLS
  const ols = solveWeighted(new Array(usable.length).fill(1));
  let final = ols;
  if (gls) {
    // Stage 2: Var(ε_i) ≈ a + b·gap_i, fit by OLS on squared residuals; floor at
    // a small positive so 1/Var is finite. Weight = 1/Var, refit (Stage 3).
    const resids = (ols as unknown as { resid?: number[] }).resid;
    if (resids && resids.length === usable.length) {
      // simple 2-param regression of e² on gap
      let sg = 0, sgg = 0, se = 0, sge = 0; const n = usable.length;
      for (let i = 0; i < n; i++) { const g = usable[i].gap, e2 = resids[i] * resids[i]; sg += g; sgg += g * g; se += e2; sge += g * e2; }
      const det = n * sgg - sg * sg;
      let a = ols.sigma2, b = 0;
      if (Math.abs(det) > 1e-12) { b = (n * sge - sg * se) / det; a = (se - b * sg) / n; }
      const floor = Math.max(ols.sigma2 * 0.05, 1e-6);
      const weights = usable.map((pr) => {
        const v = a + b * pr.gap;
        return 1 / Math.max(v, floor);
      });
      final = solveWeighted(weights);
    }
  }

  return {
    cols, colOf, beta: final.beta, cov: final.cov, sigma2: final.sigma2,
    base, quarters, pairsTouching: touch,
  };
}

// ── main entry ────────────────────────────────────────────────────────────
export function buildRepeatSaleIndex(
  lots: AuctionLot[],
  keyOf: (l: AuctionLot) => string | null,
  opts: RepeatSaleOpts = {},
): RepeatSaleResult {
  const o = { ...DEFAULTS, ...opts };
  const now = opts.now || new Date();

  const { pairs, nObjects } = extractPairs(lots, keyOf, o.maxLogRelative, o.periodsPerYear);
  const nPairs = pairs.length;

  const abstain = (reason: string): RepeatSaleResult => ({
    series: [], horizons: emptyHorizons(reason), nPairs, nObjects, note: reason,
  });

  if (nPairs < o.minPairs) return abstain(`insufficient repeat-sale pairs (${nPairs} < ${o.minPairs})`);
  if (nObjects < o.minObjects) return abstain(`too few linked objects (${nObjects} < ${o.minObjects})`);

  const fit = fitBMN(pairs, o.minQuarterPairs, o.ridge, /* gls */ true);
  if (!fit) return abstain('fewer than 2 index-able quarters after pooling thin quarters');

  // β for a quarter: its column coefficient, or 0 for the base (dropped level).
  // A quarter that never earned a column (pooled) has no defined level.
  const betaOf = (q: string): { b: number; col: number | null } => {
    if (q === fit.base) return { b: 0, col: null };
    const c = fit.colOf.get(q);
    if (c === undefined) return { b: NaN, col: null };
    return { b: fit.beta[c], col: c };
  };
  const varOfDiff = (colA: number | null, colB: number | null): number => {
    const vaa = colA !== null ? fit.cov[colA][colA] : 0;
    const vbb = colB !== null ? fit.cov[colB][colB] : 0;
    const cab = colA !== null && colB !== null ? fit.cov[colA][colB] : 0;
    return Math.max(vaa + vbb - 2 * cab, 0);
  };

  // ── level series, rebased to 100 at the base quarter ──
  const series: RepeatSalePoint[] = fit.quarters.map((q) => {
    const { b, col } = betaOf(q);
    const se = Math.sqrt(varOfDiff(col, null));
    return {
      period: q,
      value: 100 * Math.exp(b),
      ciLo: 100 * Math.exp(b - 1.96 * se),
      ciHi: 100 * Math.exp(b + 1.96 * se),
      nPairs: fit.pairsTouching.get(q) || 0,
    };
  });

  // distinct-object + pair counts per horizon endpoint (for gating)
  const endpointStats = (q: string): { pairs: number; objects: number } => {
    let pc = 0; const objs = new Set<string>();
    for (const p of pairs) {
      if (p.q1 === q || p.q2 === q) { pc++; objs.add(p.key); }
    }
    return { pairs: pc, objects: objs.size };
  };

  // last complete quarter = latest indexed quarter strictly before the current
  // (stub) quarter (never end on the partial current quarter).
  const curQ = currentQuarter(now, o.periodsPerYear);
  const past = fit.quarters.filter((q) => q < curQ);
  const lastComplete = past.length ? past[past.length - 1] : null;

  const horizons: Record<string, RepeatSaleHorizon> = {};
  // horizon lags in PERIODS (quarters or halves)
  const perYr = o.periodsPerYear;
  const HZ: [string, number][] = [['1Y', perYr], ['3Y', 3 * perYr], ['5Y', 5 * perYr]];
  for (const [lbl, back] of HZ) {
    horizons[lbl] = computeHorizon(lbl, back, lastComplete, fit, betaOf, varOfDiff, endpointStats, o);
  }

  const note =
    `BMN repeat-sales regression (GLS gap-weighted); ${nPairs} contrast pairs over ` +
    `${nObjects} linked objects; ${fit.quarters.length} quarters; base ${fit.base}. ` +
    `Mix-immune (each object is its own control); biases: interval/holding-time ` +
    `heteroskedasticity (GLS-corrected), resale-selection (flippers over-sampled), ` +
    `thin early-quarter tails.`;

  return { series, horizons, nPairs, nObjects, note };
}

function computeHorizon(
  label: string,
  back: number,
  lastComplete: string | null,
  fit: FitOut,
  betaOf: (q: string) => { b: number; col: number | null },
  varOfDiff: (a: number | null, b: number | null) => number,
  endpointStats: (q: string) => { pairs: number; objects: number },
  o: Required<Omit<RepeatSaleOpts, 'now'>>,
): RepeatSaleHorizon {
  const notPub = (reason: string): RepeatSaleHorizon =>
    ({ changePct: null, ciLoPct: null, ciHiPct: null, publishable: false, reason });

  if (!lastComplete) return notPub('no complete quarter to end on (partial-quarter guard)');
  const end = lastComplete;
  const start = shiftQuarter(end, back);
  if (!fit.quarters.includes(start)) return notPub(`no index-able quarter ${back / 4}y before ${end}`);
  if (start === end) return notPub('start and end are the same quarter');

  const { b: bE, col: colE } = betaOf(end);
  const { b: bS, col: colS } = betaOf(start);
  if (!isFinite(bE) || !isFinite(bS)) return notPub('an endpoint quarter has no index level (pooled)');

  // endpoint thinness gate — the repeat-sales analogue of the hedonic density gate
  const sE = endpointStats(end), sS = endpointStats(start);
  if (sE.pairs < o.horizonMinPairs) return notPub(`${end} thin (${sE.pairs} pairs < ${o.horizonMinPairs})`);
  if (sS.pairs < o.horizonMinPairs) return notPub(`${start} thin (${sS.pairs} pairs < ${o.horizonMinPairs})`);
  if (sE.objects < o.horizonMinObjects) return notPub(`${end} too few objects (${sE.objects} < ${o.horizonMinObjects})`);
  if (sS.objects < o.horizonMinObjects) return notPub(`${start} too few objects (${sS.objects} < ${o.horizonMinObjects})`);

  const diff = bE - bS;
  const se = Math.sqrt(varOfDiff(colE, colS));
  const changePct = 100 * (Math.exp(diff) - 1);
  const loPct = 100 * (Math.exp(diff - 1.96 * se) - 1);
  const hiPct = 100 * (Math.exp(diff + 1.96 * se) - 1);

  // CI must resolve the sign, and its magnitude must not be pure noise
  if (loPct <= 0 && hiPct >= 0) return notPub(`CI spans zero (${loPct.toFixed(1)}%…${hiPct.toFixed(1)}%) — direction unresolved`);
  const halfWidth = (hiPct - loPct) / 2;
  if (Math.abs(changePct) > 0 && halfWidth >= 2.0 * Math.abs(changePct)) {
    return notPub(`CI too wide (±${halfWidth.toFixed(1)}% vs point ${changePct.toFixed(1)}%) — magnitude is noise`);
  }

  return { changePct, ciLoPct: loPct, ciHiPct: hiPct, publishable: true, reason: '' };
}

function emptyHorizons(reason: string): Record<string, RepeatSaleHorizon> {
  const h: Record<string, RepeatSaleHorizon> = {};
  for (const k of ['1Y', '3Y', '5Y']) {
    h[k] = { changePct: null, ciLoPct: null, ciHiPct: null, publishable: false, reason };
  }
  return h;
}
