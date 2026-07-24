/**
 * hedonic-index.ts — a statistically defensible price-change index.
 *
 * WHY THIS EXISTS: the legacy cohort index (app/lib/indices.ts) is artifact-
 * ridden — partial-quarter endpoints, seasonal mix swings, integer rounding,
 * backfill composition breaks, mean-pinning. It looks authoritative and is not
 * publishable. This is its rigorous replacement.
 *
 * THE METHOD: a hedonic log-price regression. We regress ln(realizedUsd) on
 * quality controls (maker, form, size, object-decade, auction house) PLUS a set
 * of QUARTER dummies. The quarter coefficients are the pure TIME effect — the
 * price movement of a like-for-like lot, holding the mix of what sold constant.
 * That is exactly the thing a naive median can't give you: if a marquee quarter
 * over-samples expensive makers, a median jumps even when nothing appreciated;
 * the hedonic τ does not, because the maker dummies absorb the mix.
 *
 * ROBUSTNESS: Huber IRLS (fat auction tails would let a few whale lots drag OLS);
 * a tiny ridge on the non-intercept coefficients for numerical stability.
 *
 * HONESTY: every horizon change is gated. A change is published ONLY if the
 * endpoint quarter is complete and dense, the CI resolves the sign, and there is
 * no source/house composition break between the two endpoints. Otherwise it is
 * marked not-publishable with a human-readable reason. A market that cannot be
 * measured defensibly SAYS SO rather than emitting a confident-looking number.
 *
 * PERFORMANCE: the design matrix is SPARSE — each row activates ~6 dummies out
 * of a few hundred columns. We never materialize the dense n×p matrix (that is
 * ~1GB and O(n·p²)); we accumulate X'WX and X'Wy by iterating only each row's
 * nonzero features (O(n·k²), k≈6) and solve the small p×p system with ml-matrix.
 *
 * BUILD-TIME ONLY (Node/tsx). No client bundle impact.
 */
import { Matrix, CholeskyDecomposition, EigenvalueDecomposition } from 'ml-matrix';
import type { AuctionLot } from '../app/types';

// ── public shapes ──────────────────────────────────────────────────────────
export interface HedonicSeriesPoint {
  period: string;   // 'YYYY-Q{n}'
  value: number;    // index, 100 at the base quarter (FLOAT — display rounds)
  ciLo: number;     // 95% CI lower on the index level
  ciHi: number;     // 95% CI upper
  n: number;        // lots in that quarter
}
export interface HedonicHorizon {
  changePct: number | null;   // 100·(exp(τb−τa)−1)
  ciLoPct: number | null;
  ciHiPct: number | null;
  nStart: number;
  nEnd: number;
  publishable: boolean;
  reason: string;             // '' when publishable, else why not
}
export interface HedonicResult {
  series: HedonicSeriesPoint[];
  horizons: Record<string, HedonicHorizon>;   // '1Y' | '3Y' | '5Y' | 'MAX'
  lastCompleteQuarter: string | null;
  note: string;
  composite?: CompositeResult;                 // market-level composite (task 2)
}
/** Per-maker hedonic index (task 1). Same shape as HedonicResult plus coverage. */
export interface MakerIndexResult {
  series: HedonicSeriesPoint[];
  horizons: Record<string, HedonicHorizon>;
  lastCompleteQuarter: string | null;
  coverageMakerLots: number;                   // total sold lots this maker contributed
  note: string;
}
export interface CompositeComponent { slug: string; weightPct: number; changePct: number | null; publishable: boolean; }
/** Market composite built bottom-up from publishable component maker indices. */
export interface CompositeResult {
  series: HedonicSeriesPoint[];                // value-weighted (capped) geo-mean, rebased 100
  seriesEqualWeight: HedonicSeriesPoint[];     // equal-weight cross-check
  horizons: Record<string, HedonicHorizon>;
  components: CompositeComponent[];
  method: string;
  publishable: boolean;
  reason: string;
}

// ── tunables (documented; see the gating section) ───────────────────────────
const MIN_MAKER_SALES = 30;        // makers below this fold into 'maker:other'
const RIDGE = 1e-3;                // λ on non-intercept coefficients
const HUBER_PASSES = 5;            // IRLS reweighting passes
const HUBER_K = 1.345;             // Huber tuning const × robust residual scale
const MIN_QUARTER_N_FIT = 12;      // a quarter needs this many lots to get a dummy
// gating thresholds
const DENSITY_MIN_N = 120;         // endpoint quarter must have ≥ this many lots
const DENSITY_MIN_MAKERS = 8;      // …and ≥ this many distinct makers
const PARTIAL_VOL_FRAC = 0.6;      // endpoint volume ≥ 60% of trailing-4Q median
const CI_MAGNITUDE_MULT = 2.0;     // CI half-width must be < 2× |point estimate|
const COMP_HI = 0.40;              // a single source/house >40% of one endpoint…
const COMP_LO = 0.12;              // …while <12% of the other ⇒ composition break
const MAKER_DOMINANCE = 0.60;      // if one maker-slug is >60% of an endpoint, the
                                   // "like-for-like" control is really that ONE
                                   // heterogeneous bucket — see gate 6e.
// per-MAKER index gates (task 1): the within-maker analogues of the market gates
const MK_DENSITY_MIN_N = 80;       // endpoint quarter must have ≥ this many maker lots
const MK_MIN_FORMS = 4;            // …and ≥ this many distinct forms/references so the
                                   //    within-maker mix is actually controlled
const MK_REFMODEL_DOMINANCE = 0.60;// no single reference/form > 60% of an endpoint
const MK_REF_COVERAGE = 0.40;      // a maker has genuine reference-level control only
                                   //   when ≥40% of its lots carry a real ref/model
                                   //   (watches/design yes; print-heavy art no)
// COMPOSITE gates + weights (task 2)
const COMPOSITE_MIN_COMPONENTS = 3;    // ≥3 measurable component makers…
const COMPOSITE_MIN_COMPONENTS_SMALL = 2; // …or ≥2 for 5-maker markets (watches/design)
const COMPOSITE_MIN_COVERAGE = 0.50;   // components must cover ≥50% of market realized
const COMPOSITE_WEIGHT_CAP = 0.35;     // no single maker weight > 35% after capping

// ── small helpers ────────────────────────────────────────────────────────────
function quarterOf(saleDate: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(saleDate);
  if (!m) return null;
  const mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  return `${m[1]}-Q${Math.ceil(mo / 3)}`;
}
function median(a: number[]): number {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
/** Index of the quarter that is fully in the PAST relative to `now`.
 *  We never end on the current (stub) quarter — see gate 6a. */
function currentQuarter(now: Date): string {
  const y = now.getUTCFullYear();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}
/** Move a 'YYYY-Q{n}' back by `k` quarters (k≥0). */
function shiftQuarter(period: string, k: number): string {
  const [ys, qs] = period.split('-Q');
  let y = +ys, q = +qs;
  let total = y * 4 + (q - 1) - k;
  y = Math.floor(total / 4);
  q = (total % 4) + 1;
  return `${y}-Q${q}`;
}

// ── feature extraction ───────────────────────────────────────────────────────
interface FeatureRow {
  y: number;                 // ln(realizedUsd)
  maker: string;             // capped: rare makers folded to 'maker:other'
  rawMaker: string;          // true artist slug (for dominance gate 6e)
  refModel: string;          // reference ?? modelKey ?? formKey (model feature)
  refReal: string | null;    // reference ?? modelKey ONLY (null when absent) — for
                             //   the dominance gate, so a missing-ref fallback
                             //   bucket ('wristwatch') is not mistaken for one product
  form: string;
  size: string;
  yearBucket: string;
  house: string;
  quarter: string;
  source: string;            // for composition-break check (not a model feature)
  realized: number;          // realizedUsd (for value-weighting composites)
}
/** The within-maker quality proxy: a watch reference, else a furniture/model
 *  code, else the form. This is what makes a per-maker index like-for-like —
 *  a Daytona vs a Datejust, a Conoid bench vs a slab table. */
function refModelOf(l: AuctionLot): string {
  return refRealOf(l) || l.formKey || l.category || 'na';
}
/** The GENUINE product identifier (watch ref / furniture model), or null. */
function refRealOf(l: AuctionLot): string | null {
  return (l as AuctionLot & { reference?: string | null }).reference
    || (l as AuctionLot & { modelKey?: string | null }).modelKey
    || null;
}
function extractRows(lots: AuctionLot[]): FeatureRow[] {
  // first pass: maker cardinality cap
  const makerCount = new Map<string, number>();
  const staged: (FeatureRow | null)[] = lots.map((l) => {
    const price = l.realizedUsd || 0;
    if (l.status !== 'sold' || price <= 0 || !l.saleDate) return null;
    const q = quarterOf(l.saleDate);
    if (!q) return null;
    const maker = l.artist || 'maker:na';
    makerCount.set(maker, (makerCount.get(maker) || 0) + 1);
    const yn = l.yearNum;
    const yearBucket = yn && yn > 1000 && yn < 2100 ? `${Math.floor(yn / 10) * 10}s` : 'na';
    return {
      y: Math.log(price),
      maker,
      rawMaker: maker,
      refModel: refModelOf(l),
      refReal: refRealOf(l),
      form: l.formKey || l.category || 'na',
      size: l.sizeClass || 'na',
      yearBucket,
      house: l.auctionHouse || 'na',
      quarter: q,
      source: (l as AuctionLot & { source?: string }).source || 'native',
      realized: price,
    };
  });
  const rows: FeatureRow[] = [];
  for (const r of staged) {
    if (!r) continue;
    // rawMaker is already set to the true slug; only the model `maker` collapses.
    if ((makerCount.get(r.maker) || 0) < MIN_MAKER_SALES) r.maker = 'maker:other';
    rows.push(r);
  }
  return rows;
}

// ── sparse design: build a column index and per-row nonzero feature list ─────
// Each categorical drops ONE reference level (the most frequent) to avoid
// collinearity with the intercept. The intercept is column 0.
interface Design {
  colIndex: Map<string, number>;   // feature-key → column
  quarterCols: Map<string, number>; // quarter → its column (subset of colIndex)
  rowFeatures: number[][];          // per row: [0, ...active non-reference cols]
  p: number;                        // total columns
}
/** Feature groups for the MARKET-level index (maker dummies carry the mix). */
const MARKET_GROUPS: Record<string, (r: FeatureRow) => string> = {
  maker: (r) => r.maker,
  form: (r) => r.form,
  size: (r) => r.size,
  year: (r) => r.yearBucket,
  house: (r) => r.house,
  quarter: (r) => r.quarter,
};
/** Feature groups for the per-MAKER index. Maker is constant → dropped. The
 *  within-maker price drivers carry the mix: refModel (watch ref / furniture
 *  model), form, size, object-decade, house. */
const MAKER_GROUPS: Record<string, (r: FeatureRow) => string> = {
  refModel: (r) => r.refModel,
  form: (r) => r.form,
  size: (r) => r.size,
  year: (r) => r.yearBucket,
  house: (r) => r.house,
  quarter: (r) => r.quarter,
};
function buildDesign(rows: FeatureRow[], groups: Record<string, (r: FeatureRow) => string> = MARKET_GROUPS): Design {
  const counts: Record<string, Map<string, number>> = {};
  for (const g of Object.keys(groups)) counts[g] = new Map();
  for (const r of rows) for (const g of Object.keys(groups)) {
    const v = groups[g](r);
    counts[g].set(v, (counts[g].get(v) || 0) + 1);
  }
  const colIndex = new Map<string, number>();
  const quarterCols = new Map<string, number>();
  colIndex.set('__intercept__', 0);
  let next = 1;
  const refLevel: Record<string, string> = {};
  for (const g of Object.keys(groups)) {
    const entries = Array.from(counts[g].entries()).sort((a, b) => b[1] - a[1]);
    // reference = most frequent level (dropped). For quarters, the reference is
    // handled at rebase time, but we still drop the most-frequent quarter here
    // to keep the intercept identified — the rebase re-expresses everything
    // relative to the chosen base quarter regardless of which is dropped.
    if (!entries.length) continue;
    refLevel[g] = entries[0][0];
    for (let i = 0; i < entries.length; i++) {
      const [lvl, cnt] = entries[i];
      if (lvl === refLevel[g]) continue;
      // a quarter needs a minimum sample to earn its own dummy; a too-thin
      // quarter is pooled into the reference (its lots still inform the controls)
      if (g === 'quarter' && cnt < MIN_QUARTER_N_FIT) continue;
      const key = `${g}=${lvl}`;
      colIndex.set(key, next);
      if (g === 'quarter') quarterCols.set(lvl, next);
      next++;
    }
  }
  const rowFeatures: number[][] = rows.map((r) => {
    const feats = [0]; // intercept
    for (const g of Object.keys(groups)) {
      const lvl = groups[g](r);
      if (lvl === refLevel[g]) continue;
      const c = colIndex.get(`${g}=${lvl}`);
      if (c !== undefined) feats.push(c);
    }
    return feats;
  });
  return { colIndex, quarterCols, rowFeatures, p: next };
}

// ── sparse robust OLS (Huber IRLS + ridge) ───────────────────────────────────
interface FitResult {
  beta: number[];            // length p
  cov: number[][];           // p×p covariance (σ̂²·(X'WX+ridge)^-1)
  p: number;
}
function solveSPD(A: Matrix, B: Matrix): Matrix {
  // Cholesky for the SPD normal equations; fall back to eigen-pseudo-inverse if
  // the matrix is numerically not-quite-PD (ridge normally prevents this).
  try {
    const cho = new CholeskyDecomposition(A);
    return cho.solve(B);
  } catch {
    return pseudoInverse(A).mmul(B);
  }
}
function pseudoInverse(A: Matrix): Matrix {
  // symmetric pseudo-inverse via eigendecomposition (A is symmetric PSD here)
  const evd = new EigenvalueDecomposition(A);
  const V = evd.eigenvectorMatrix;         // columns are eigenvectors
  const d = evd.realEigenvalues;
  const tol = 1e-10 * Math.max(...d.map(Math.abs));
  const dInv = d.map((x) => (Math.abs(x) > tol ? 1 / x : 0));
  const Dinv = Matrix.diag(dInv);
  return V.mmul(Dinv).mmul(V.transpose());
}
function fitRobust(rows: FeatureRow[], design: Design): FitResult {
  const { rowFeatures, p } = design;
  const n = rows.length;
  const y = rows.map((r) => r.y);
  const weights = new Float64Array(n).fill(1);

  let beta = new Array(p).fill(0);
  let ATWAinv: Matrix | null = null;
  let sigma2 = 1;

  for (let pass = 0; pass < HUBER_PASSES; pass++) {
    // accumulate X'WX (dense p×p) and X'Wy by iterating each row's nonzeros only
    const ATWA = new Float64Array(p * p);
    const ATWy = new Float64Array(p);
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      const feats = rowFeatures[i];
      const yi = y[i];
      for (let a = 0; a < feats.length; a++) {
        const ca = feats[a];
        ATWy[ca] += w * yi;
        const base = ca * p;
        for (let b = 0; b < feats.length; b++) {
          ATWA[base + feats[b]] += w; // all nonzero entries are 1 (dummies)
        }
      }
    }
    // ridge on non-intercept (col 0 is intercept — leave it un-penalized)
    for (let c = 1; c < p; c++) ATWA[c * p + c] += RIDGE;

    const A = new Matrix(p, p);
    for (let r = 0; r < p; r++) for (let c = 0; c < p; c++) A.set(r, c, ATWA[r * p + c]);
    const B = Matrix.columnVector(Array.from(ATWy));
    const sol = solveSPD(A, B);
    beta = sol.to1DArray();

    // residuals
    const resid = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let pred = 0;
      const feats = rowFeatures[i];
      for (let a = 0; a < feats.length; a++) pred += beta[feats[a]];
      resid[i] = y[i] - pred;
    }
    // robust scale via MAD (consistent for normal: /0.6745)
    const absr: number[] = [];
    for (let i = 0; i < n; i++) absr.push(Math.abs(resid[i]));
    const mad = median(absr) / 0.6745 || 1e-9;
    const k = HUBER_K * mad;
    // Huber weights: 1 inside band, k/|r| outside
    for (let i = 0; i < n; i++) {
      const ar = Math.abs(resid[i]);
      weights[i] = ar <= k ? 1 : k / ar;
    }
    // robust σ̂²: Huber-weighted residual variance with dof correction
    let wrss = 0, wsum = 0;
    for (let i = 0; i < n; i++) { wrss += weights[i] * resid[i] * resid[i]; wsum += weights[i]; }
    sigma2 = wrss / Math.max(wsum - p, 1);
    ATWAinv = pseudoInverse(A); // (X'WX + ridge)^-1 for the covariance
  }

  // covariance = σ̂²·(X'WX)^-1
  const covM = ATWAinv!.mul(sigma2);
  const cov: number[][] = covM.to2DArray();
  return { beta, cov, p };
}

// ── the index (quarter coefficients → rebased levels + CIs) ──────────────────
interface QuarterStat {
  n: number;
  makers: Set<string>;
  forms: Set<string>;              // distinct formKey — within-maker mix control depth
  refModels: Set<string>;          // distinct refModel (incl. form fallback)
  realRefs: Set<string>;           // distinct GENUINE refs/models (no fallback)
  nWithRef: number;                // lots carrying a genuine ref/model
  makerShare: Map<string, number>;
  formShare: Map<string, number>;
  realRefShare: Map<string, number>; // over the with-ref lots only
  srcShare: Map<string, number>;
  houseShare: Map<string, number>;
  realized: number;                // Σ realizedUsd in the quarter (composite weights)
}
function quarterStats(rows: FeatureRow[]): Map<string, QuarterStat> {
  const m = new Map<string, QuarterStat>();
  for (const r of rows) {
    let s = m.get(r.quarter);
    if (!s) {
      s = { n: 0, makers: new Set(), forms: new Set(), refModels: new Set(), realRefs: new Set(), nWithRef: 0, makerShare: new Map(), formShare: new Map(), realRefShare: new Map(), srcShare: new Map(), houseShare: new Map(), realized: 0 };
      m.set(r.quarter, s);
    }
    s.n++;
    s.makers.add(r.maker);
    s.forms.add(r.form);
    s.refModels.add(r.refModel);
    s.realized += r.realized;
    // dominance uses the RAW maker (pre-'maker:other' collapse) so a single
    // mega-slug (sports-cards) is counted as itself, not merged into 'other'.
    s.makerShare.set(r.rawMaker, (s.makerShare.get(r.rawMaker) || 0) + 1);
    s.formShare.set(r.form, (s.formShare.get(r.form) || 0) + 1);
    if (r.refReal) { s.realRefs.add(r.refReal); s.nWithRef++; s.realRefShare.set(r.refReal, (s.realRefShare.get(r.refReal) || 0) + 1); }
    s.srcShare.set(r.source, (s.srcShare.get(r.source) || 0) + 1);
    s.houseShare.set(r.house, (s.houseShare.get(r.house) || 0) + 1);
  }
  return m;
}
/** Max single-key share of a Map over total n. */
function topShare(m: Map<string, number>, n: number): { key: string; share: number } {
  let top = 0, key = '';
  for (const [k, c] of Array.from(m.entries())) if (c > top) { top = c; key = k; }
  return { key, share: n > 0 ? top / n : 0 };
}

/** τ for a quarter: its dummy coefficient, or 0 for the dropped reference/pooled
 *  quarter. Returns null when the quarter never earned a dummy AND isn't the
 *  reference (i.e. it was pooled — we can't read a coefficient for it). */
function tauOf(quarter: string, design: Design, beta: number[]): { tau: number; col: number | null } {
  const col = design.quarterCols.get(quarter);
  if (col === undefined) return { tau: 0, col: null }; // reference or pooled → 0
  return { tau: beta[col], col };
}

// ── task 2 · market/all COMPOSITE from component maker indices ────────────────
// A real index is a composite of measurable components. We build the market
// index as a value-weighted (capped) geometric mean of its PUBLISHABLE per-maker
// indices — so a market with no defensible single-maker components is honestly
// un-measurable, and no single maker can dominate the tape (35% cap).
export interface CompositeInput { slug: string; index: MakerIndexResult; realized: number; }

const COMPOSITE_METHOD = `capped value-weighted geometric mean of publishable per-maker hedonic indices (cap 35%, ≥3 components / ≥50% realized coverage; equal-weight cross-check emitted)`;

/** Recover SE(Δln) for a maker horizon from its change + CI (log scale). */
function horizonLogSE(h: HedonicHorizon): number | null {
  if (h.changePct === null || h.ciLoPct === null || h.ciHiPct === null) return null;
  const hi = Math.log(1 + h.ciHiPct / 100);
  const lo = Math.log(1 + h.ciLoPct / 100);
  return (hi - lo) / (2 * 1.96);
}
/** Cap weights at COMPOSITE_WEIGHT_CAP and renormalize (water-filling): repeatedly
 *  clip over-cap makers to the cap and redistribute the excess pro-rata among the
 *  uncapped, until no weight exceeds the cap. */
function cappedWeights(raw: Map<string, number>): Map<string, number> {
  const total = Array.from(raw.values()).reduce((a, b) => a + b, 0) || 1;
  let w = new Map(Array.from(raw.entries()).map(([k, v]) => [k, v / total]));
  for (let iter = 0; iter < 50; iter++) {
    const over = Array.from(w.entries()).filter(([, v]) => v > COMPOSITE_WEIGHT_CAP + 1e-9);
    if (!over.length) break;
    let excess = 0;
    for (const [k] of over) { excess += w.get(k)! - COMPOSITE_WEIGHT_CAP; w.set(k, COMPOSITE_WEIGHT_CAP); }
    const under = Array.from(w.entries()).filter(([, v]) => v < COMPOSITE_WEIGHT_CAP - 1e-9);
    const underSum = under.reduce((a, [, v]) => a + v, 0);
    if (underSum <= 0) break; // everyone at cap — can't redistribute further
    for (const [k, v] of under) w.set(k, v + excess * (v / underSum));
  }
  return w;
}

export function buildComposite(inputs: CompositeInput[], marketSlugCount: number, now: Date = new Date()): CompositeResult {
  const notPub = (reason: string, components: CompositeComponent[] = []): CompositeResult =>
    ({ series: [], seriesEqualWeight: [], horizons: emptyHorizons(reason), components, method: COMPOSITE_METHOD, publishable: false, reason });

  // a component is measurable if its index has a series AND at least one
  // publishable horizon (its price movement is defensibly measured).
  const measurable = inputs.filter((c) => c.index.series.length >= 2 && Object.values(c.index.horizons).some((h) => h.publishable));
  const minComponents = marketSlugCount <= 5 ? COMPOSITE_MIN_COMPONENTS_SMALL : COMPOSITE_MIN_COMPONENTS;
  const totalRealized = inputs.reduce((a, c) => a + c.realized, 0) || 1;
  const coverage = measurable.reduce((a, c) => a + c.realized, 0) / totalRealized;

  // capped value weights over the measurable components
  const rawW = new Map(measurable.map((c) => [c.slug, c.realized]));
  const wMap = cappedWeights(rawW);
  const components: CompositeComponent[] = inputs.map((c) => {
    const w = wMap.get(c.slug) || 0;
    const h1 = c.index.horizons['1Y'];
    return { slug: c.slug, weightPct: +(w * 100).toFixed(1), changePct: h1?.changePct ?? null, publishable: measurable.some((m) => m.slug === c.slug) };
  }).sort((a, b) => b.weightPct - a.weightPct);

  if (measurable.length < minComponents) return notPub(`only ${measurable.length} measurable component maker(s) (need ≥${minComponents})`, components);
  if (coverage < COMPOSITE_MIN_COVERAGE) return notPub(`measurable components cover ${(coverage * 100).toFixed(0)}% of realized (< ${COMPOSITE_MIN_COVERAGE * 100}%)`, components);
  const maxW = Math.max(...Array.from(wMap.values()));
  if (maxW > COMPOSITE_WEIGHT_CAP + 1e-6) return notPub(`a component exceeds the ${COMPOSITE_WEIGHT_CAP * 100}% cap after capping (${(maxW * 100).toFixed(0)}%)`, components);

  // ── composite SERIES: per-quarter capped-weight geometric mean of component
  // levels, over the components present that quarter, rebased to 100 at the
  // earliest quarter where ≥ minComponents are present. Equal-weight variant is
  // the same with uniform weights (cross-check). ──
  const buildSeries = (weightMode: 'value' | 'equal'): HedonicSeriesPoint[] => {
    // quarter → [{slug, lnLevel, seLevel, n}]
    const perQ = new Map<string, { slug: string; ln: number; se: number; n: number }[]>();
    for (const c of measurable) {
      for (const p of c.index.series) {
        // per-quarter level SE recovered from the level CI (log scale)
        const seLvl = (Math.log(p.ciHi / 100 + 1e-12) - Math.log(p.ciLo / 100 + 1e-12)) / (2 * 1.96);
        (perQ.get(p.period) || perQ.set(p.period, []).get(p.period)!).push({ slug: c.slug, ln: Math.log(p.value / 100), se: Math.abs(seLvl), n: p.n });
      }
    }
    const quarters = Array.from(perQ.keys()).sort();
    const out: { period: string; ln: number; varLn: number; n: number }[] = [];
    for (const q of quarters) {
      const parts = perQ.get(q)!;
      if (parts.length < minComponents) continue;
      const wq = weightMode === 'value'
        ? cappedWeights(new Map(parts.map((p) => [p.slug, wMap.get(p.slug) || 0])))
        : new Map(parts.map((p) => [p.slug, 1 / parts.length]));
      let ln = 0, varLn = 0, n = 0;
      for (const p of parts) { const w = wq.get(p.slug) || 0; ln += w * p.ln; varLn += w * w * p.se * p.se; n += p.n; }
      out.push({ period: q, ln, varLn, n });
    }
    if (!out.length) return [];
    const base = out[0].ln;
    return out.map((o) => {
      const d = o.ln - base;
      const se = Math.sqrt(Math.max(o.varLn + out[0].varLn, 0));
      return { period: o.period, value: 100 * Math.exp(d), ciLo: 100 * Math.exp(d - 1.96 * se), ciHi: 100 * Math.exp(d + 1.96 * se), n: o.n };
    });
  };
  const series = buildSeries('value');
  const seriesEqualWeight = buildSeries('equal');

  // ── composite HORIZONS: aggregate each contributing component's OWN published
  // horizon change (weighted). Components are fit on DISJOINT lot sets, so the
  // regressions are independent ⇒ Var(Σ wᵢ Δlnᵢ) = Σ wᵢ² Var(Δlnᵢ). No cross-cov.
  const horizons: Record<string, HedonicHorizon> = {};
  for (const hz of ['1Y', '3Y', '5Y', 'MAX']) {
    const contrib = measurable.map((c) => ({ slug: c.slug, h: c.index.horizons[hz] })).filter((x) => x.h && x.h.publishable);
    if (contrib.length < minComponents) {
      horizons[hz] = { changePct: null, ciLoPct: null, ciHiPct: null, nStart: 0, nEnd: 0, publishable: false, reason: `only ${contrib.length} component(s) publish ${hz} (need ≥${minComponents})` };
      continue;
    }
    // renormalize capped weights among the contributing components
    const wq = cappedWeights(new Map(contrib.map((c) => [c.slug, wMap.get(c.slug) || 0])));
    let diff = 0, varDiff = 0, nStart = 0, nEnd = 0;
    for (const c of contrib) {
      const w = wq.get(c.slug) || 0;
      const dln = Math.log(1 + c.h.changePct! / 100);
      const se = horizonLogSE(c.h) || 0;
      diff += w * dln; varDiff += w * w * se * se;
      nStart += c.h.nStart; nEnd += c.h.nEnd;
    }
    const se = Math.sqrt(Math.max(varDiff, 0));
    const changePct = 100 * (Math.exp(diff) - 1);
    const loPct = 100 * (Math.exp(diff - 1.96 * se) - 1);
    const hiPct = 100 * (Math.exp(diff + 1.96 * se) - 1);
    if (loPct <= 0 && hiPct >= 0) {
      horizons[hz] = { changePct, ciLoPct: loPct, ciHiPct: hiPct, nStart, nEnd, publishable: false, reason: `composite CI spans zero (${loPct.toFixed(1)}%…${hiPct.toFixed(1)}%)` };
    } else {
      horizons[hz] = { changePct, ciLoPct: loPct, ciHiPct: hiPct, nStart, nEnd, publishable: true, reason: '' };
    }
  }

  // composite is publishable if the 1Y OR 3Y horizon resolves (the short-horizon
  // read is the headline; MAX/5Y may lack deep component history).
  const shortResolved = horizons['1Y'].publishable || horizons['3Y'].publishable;
  const reason = shortResolved ? '' : 'neither 1Y nor 3Y composite horizon resolves the sign';
  return { series, seriesEqualWeight, horizons, components, method: COMPOSITE_METHOD, publishable: shortResolved, reason };
}

// ── the shared engine: rows + design → series + horizons ─────────────────────
// `mode` selects the gating regime: 'market' (maker-dummy index, maker-dominance
// gate) vs 'maker' (per-maker index, within-maker mix gates). Returns the fitted
// pieces too, so composites can read the quarter τ + covariance directly.
interface IndexInternals {
  result: HedonicResult;
  idxQuarters: string[];
  base: string;
  stats: Map<string, QuarterStat>;
  design: Design;
  fit: FitResult;
  varOfDiff: (a: number | null, b: number | null) => number;
}
function runIndex(rows: FeatureRow[], design: Design, mode: 'market' | 'maker', now: Date): IndexInternals | null {
  const fit = fitRobust(rows, design);
  const stats = quarterStats(rows);
  const idxQuarters = Array.from(stats.keys()).sort().filter((q) => stats.get(q)!.n >= MIN_QUARTER_N_FIT);
  if (idxQuarters.length < 2) return null;
  // Decide ONCE (over the whole maker sample, not per-quarter, to avoid a maker
  // flip-flopping between the ref and form gate quarter-to-quarter) whether this
  // maker has genuine reference-level control: a ref/model on ≥ MK_REF_COVERAGE
  // of its lots. Watches (44-72%) and design (39-67%) qualify; art (warhol 23%,
  // picasso 5%) does not — art must clear the form-mix gate instead.
  const withRef = rows.reduce((a, r) => a + (r.refReal ? 1 : 0), 0);
  const hasRefControl = withRef / rows.length >= MK_REF_COVERAGE;
  const base = idxQuarters[0];
  const { tau: tauBase, col: baseCol } = tauOf(base, design, fit.beta);
  const varOfDiff = (colA: number | null, colB: number | null): number => {
    const vaa = colA !== null ? fit.cov[colA][colA] : 0;
    const vbb = colB !== null ? fit.cov[colB][colB] : 0;
    const cab = colA !== null && colB !== null ? fit.cov[colA][colB] : 0;
    return Math.max(vaa + vbb - 2 * cab, 0);
  };
  const series: HedonicSeriesPoint[] = idxQuarters.map((q) => {
    const { tau, col } = tauOf(q, design, fit.beta);
    const d = tau - tauBase;
    const seDiff = Math.sqrt(varOfDiff(col, baseCol));
    return {
      period: q, value: 100 * Math.exp(d),
      ciLo: 100 * Math.exp(d - 1.96 * seDiff),
      ciHi: 100 * Math.exp(d + 1.96 * seDiff),
      n: stats.get(q)!.n,
    };
  });
  const lastComplete = pickLastCompleteQuarter(idxQuarters, currentQuarter(now), stats);
  const horizons: Record<string, HedonicHorizon> = {};
  const HORIZONS: [string, number | null][] = [['1Y', 4], ['3Y', 12], ['5Y', 20], ['MAX', null]];
  for (const [lbl, back] of HORIZONS) {
    horizons[lbl] = computeHorizon(lbl, back, lastComplete, idxQuarters, design, fit, stats, varOfDiff, mode, hasRefControl);
  }
  const note = `hedonic log-price OLS (${mode}, Huber IRLS, ridge ${RIDGE}); ${rows.length} lots, ${design.p} params, ${idxQuarters.length} quarters; base ${base}.`;
  return { result: { series, horizons, lastCompleteQuarter: lastComplete, note }, idxQuarters, base, stats, design, fit, varOfDiff };
}

// ── main entry (MARKET index) ────────────────────────────────────────────────
export function buildHedonicIndex(lots: AuctionLot[], now: Date = new Date()): HedonicResult {
  const rows = extractRows(lots);
  if (rows.length < 200) {
    return { series: [], horizons: emptyHorizons('insufficient sample'), lastCompleteQuarter: null, note: `insufficient sample (${rows.length} lots)` };
  }
  const internals = runIndex(rows, buildDesign(rows, MARKET_GROUPS), 'market', now);
  if (!internals) return { series: [], horizons: emptyHorizons('fewer than 2 index-able quarters'), lastCompleteQuarter: null, note: 'fewer than 2 index-able quarters' };
  return internals.result;
}

// ── task 1 · per-MAKER index ─────────────────────────────────────────────────
// The maker is constant, so its dummy is dropped; the WITHIN-maker drivers
// (refModel = watch ref / furniture model, form, size, object-decade, house)
// carry the mix. The quarter τ is that maker's mix-controlled price movement.
export function buildMakerIndex(makerLots: AuctionLot[], now: Date = new Date()): MakerIndexResult {
  // A per-maker index is only defensible for a genuine MAKER — a Rolex, a
  // Picasso, a Nakashima — where a reference/model/form holds quality roughly
  // constant. A collectible BUCKET (game-used, trophies-awards, meteorites,
  // fossils, tickets-passes) has entityClass:'category': its lots are mutually
  // incomparable objects under one thematic slug, so a "like-for-like" index is
  // impossible (it posts +900% artifacts). We refuse those at the door, using
  // the type-level entityClass signal rather than tuning a threshold.
  const catN = makerLots.reduce((a, l) => a + ((l as AuctionLot & { entityClass?: string }).entityClass === 'category' ? 1 : 0), 0);
  const rows = extractRows(makerLots);
  const coverageMakerLots = rows.length;
  if (makerLots.length > 0 && catN / makerLots.length > 0.5) {
    return { series: [], horizons: emptyHorizons('collectible bucket (entityClass:category), not a maker — no like-for-like index'), lastCompleteQuarter: null, coverageMakerLots, note: 'collectible bucket (entityClass:category) — per-maker hedonic not defensible' };
  }
  if (rows.length < 150) {
    return { series: [], horizons: emptyHorizons(`insufficient sample (${rows.length} lots)`), lastCompleteQuarter: null, coverageMakerLots, note: `insufficient sample (${rows.length} lots)` };
  }
  const internals = runIndex(rows, buildDesign(rows, MAKER_GROUPS), 'maker', now);
  if (!internals) return { series: [], horizons: emptyHorizons('fewer than 2 index-able quarters'), lastCompleteQuarter: null, coverageMakerLots, note: 'fewer than 2 index-able quarters' };
  const { result } = internals;
  return { series: result.series, horizons: result.horizons, lastCompleteQuarter: result.lastCompleteQuarter, coverageMakerLots, note: result.note };
}

function emptyHorizons(reason: string): Record<string, HedonicHorizon> {
  const h: Record<string, HedonicHorizon> = {};
  for (const k of ['1Y', '3Y', '5Y', 'MAX']) {
    h[k] = { changePct: null, ciLoPct: null, ciHiPct: null, nStart: 0, nEnd: 0, publishable: false, reason };
  }
  return h;
}

/** The last quarter strictly before the current stub quarter whose volume is
 *  ≥ PARTIAL_VOL_FRAC of the trailing-4-quarter median volume (catches a
 *  half-reported latest quarter that isn't really complete yet). */
function pickLastCompleteQuarter(idxQuarters: string[], curQ: string, stats: Map<string, QuarterStat>): string | null {
  const past = idxQuarters.filter((q) => q < curQ);
  for (let i = past.length - 1; i >= 0; i--) {
    const q = past[i];
    const n = stats.get(q)!.n;
    // trailing-4 median over the four quarters ending at q (inclusive)
    const window: number[] = [];
    for (let k = 0; k < 4; k++) {
      const s = stats.get(shiftQuarter(q, k));
      if (s) window.push(s.n);
    }
    const med = median(window);
    if (med === 0) continue;
    if (n >= PARTIAL_VOL_FRAC * med) return q;
  }
  return null;
}

function computeHorizon(
  label: string,
  back: number | null,
  lastComplete: string | null,
  idxQuarters: string[],
  design: Design,
  fit: FitResult,
  stats: Map<string, QuarterStat>,
  varOfDiff: (a: number | null, b: number | null) => number,
  mode: 'market' | 'maker',
  hasRefControl = false,
): HedonicHorizon {
  const notPub = (reason: string, nStart = 0, nEnd = 0): HedonicHorizon =>
    ({ changePct: null, ciLoPct: null, ciHiPct: null, nStart, nEnd, publishable: false, reason });

  if (!lastComplete) return notPub('no complete, dense quarter to end on (partial-quarter guard)');
  const end = lastComplete;
  // start quarter
  let start: string;
  if (back === null) start = idxQuarters[0];
  else {
    start = shiftQuarter(end, back);
    if (!idxQuarters.includes(start)) {
      // not enough history for this horizon
      return notPub(`no index-able quarter ${back / 4}y before ${end}`);
    }
  }
  if (start === end) return notPub('start and end are the same quarter');

  const sStat = stats.get(start)!;
  const eStat = stats.get(end)!;
  const nStart = sStat.n, nEnd = eStat.n;

  const { tau: tauE, col: colE } = tauOf(end, design, fit.beta);
  const { tau: tauS, col: colS } = tauOf(start, design, fit.beta);
  const diff = tauE - tauS;
  const se = Math.sqrt(varOfDiff(colE, colS));
  const changePct = 100 * (Math.exp(diff) - 1);
  const loPct = 100 * (Math.exp(diff - 1.96 * se) - 1);
  const hiPct = 100 * (Math.exp(diff + 1.96 * se) - 1);

  if (mode === 'market') {
    // ── gate 6b: density floor ──
    const density = (q: string, s: QuarterStat): string | null => {
      if (s.n < DENSITY_MIN_N) return `${q} thin (n=${s.n} < ${DENSITY_MIN_N})`;
      if (s.makers.size < DENSITY_MIN_MAKERS) return `${q} too few makers (${s.makers.size} < ${DENSITY_MIN_MAKERS})`;
      return null;
    };
    const dS = density(start, sStat); if (dS) return notPub(dS, nStart, nEnd);
    const dE = density(end, eStat); if (dE) return notPub(dE, nStart, nEnd);

    // ── gate 6e: single-maker (mega-slug) dominance ──
    // If one maker-slug is >MAKER_DOMINANCE of an endpoint, the maker dummy isn't
    // holding quality constant — it's a proxy for one heterogeneous bucket (e.g.
    // 'sports-cards' = 350k wildly different cards under ONE slug). A shift in
    // WHICH cards sold then leaks into the time effect. This is the within-slug
    // analogue of a composition break and is exactly the 'all'/'sports' artifact
    // the audit flagged. Uses the RAW slug (pre-'maker:other' collapse).
    const dominance = (q: string, s: QuarterStat): string | null => {
      const { key, share } = topShare(s.makerShare, s.n);
      if (share > MAKER_DOMINANCE) return `${q} dominated by one maker-slug ('${key}' ${(share * 100).toFixed(0)}%) — hedonic control can't hold quality constant within it`;
      return null;
    };
    const domS = dominance(start, sStat); if (domS) return notPub(domS, nStart, nEnd);
    const domE = dominance(end, eStat); if (domE) return notPub(domE, nStart, nEnd);
  } else {
    // ── per-MAKER gates (task 1) ──
    // density: ≥ MK_DENSITY_MIN_N lots AND ≥ MK_MIN_FORMS distinct forms OR
    // references (so the within-maker mix is actually controlled).
    const mkDensity = (q: string, s: QuarterStat): string | null => {
      if (s.n < MK_DENSITY_MIN_N) return `${q} thin (n=${s.n} < ${MK_DENSITY_MIN_N})`;
      // controls = distinct GENUINE refs/models (watches, design) OR distinct
      // forms (art, where refs are absent) — whichever gives the maker its mix
      // control. The refModel fallback bucket is NOT counted as a control level.
      const controls = Math.max(s.forms.size, s.realRefs.size);
      if (controls < MK_MIN_FORMS) return `${q} too few forms/refs (${controls} < ${MK_MIN_FORMS}) — within-maker mix uncontrolled`;
      return null;
    };
    const dS = mkDensity(start, sStat); if (dS) return notPub(dS, nStart, nEnd);
    const dE = mkDensity(end, eStat); if (dE) return notPub(dE, nStart, nEnd);
    // Degenerate-quarter guard: the quarter must not collapse to ONE weakly-
    // controlled bucket.
    //  (a) When genuine refs/models cover the majority of the quarter, the
    //      reference IS the control — require no single real ref > 60% of the
    //      with-ref lots (a Daytona-only quarter). This is the watches/design
    //      path; a 133-ref rolex quarter passes easily.
    //  (b) When there are NO genuine refs (art: reference/modelKey empty), the
    //      ONLY within-maker control is form + size + year. That is too weak to
    //      hold quality constant when a SINGLE form dominates — a print-only
    //      quarter still spans a $500 poster to a $500k signed proof, and a shift
    //      in WHICH prints sold leaks into the time effect (the exact reason
    //      Picasso/Warhol post implausible ±50-70% moves). So without real refs
    //      we require the top form < 60%: the maker must trade a genuine MIX of
    //      forms (paintings, sculpture, works-on-paper) to be measurable.
    // Route by the maker-level `hasRefControl` decision (stable across quarters,
    // so a maker can't flip between gates quarter-to-quarter):
    //  • hasRefControl (watches/design): the reference IS the control — require
    //    no single real ref > 60% of the ref-bearing lots (no Daytona-only qtr).
    //    Ref-less lots in the quarter are split by form+size+year within form.
    //  • else (print-heavy art): the ONLY control is the form mix, which is too
    //    weak when one form dominates — a print-only quarter spans a $500 poster
    //    to a $500k proof, and a shift in WHICH prints sold leaks into the time
    //    effect (why Picasso/Warhol post implausible ±50-70% moves). Require the
    //    top form < 60%: the maker must trade a genuine MIX of forms.
    const FORM_MIX_MAX = 0.60;
    const mkDom = (q: string, s: QuarterStat): string | null => {
      if (hasRefControl) {
        const t = topShare(s.realRefShare, s.nWithRef);
        if (t.share > MK_REFMODEL_DOMINANCE) return `${q} dominated by one reference ('${t.key}' ${(t.share * 100).toFixed(0)}% of ref-bearing lots) — within-maker control degenerate`;
      } else {
        const f = topShare(s.formShare, s.n);
        if (f.share > FORM_MIX_MAX) return `${q} is ${(f.share * 100).toFixed(0)}% one form ('${f.key}') with no reference-level control — within-maker mix not held constant`;
      }
      return null;
    };
    const mS = mkDom(start, sStat); if (mS) return notPub(mS, nStart, nEnd);
    const mE = mkDom(end, eStat); if (mE) return notPub(mE, nStart, nEnd);
  }

  // ── composition break (source AND house) — applies to BOTH modes ──
  const comp = compositionBreak(sStat, eStat);
  if (comp) return notPub(comp, nStart, nEnd);

  // ── gate 6c: CI resolves the sign + magnitude isn't pure noise ──
  if (loPct <= 0 && hiPct >= 0) return notPub(`CI spans zero (${loPct.toFixed(1)}%…${hiPct.toFixed(1)}%) — direction unresolved`, nStart, nEnd);
  const halfWidthPct = (hiPct - loPct) / 2;
  if (Math.abs(changePct) > 0 && halfWidthPct >= CI_MAGNITUDE_MULT * Math.abs(changePct)) {
    return notPub(`CI too wide (±${halfWidthPct.toFixed(1)}% vs point ${changePct.toFixed(1)}%) — magnitude is noise`, nStart, nEnd);
  }

  return {
    changePct, ciLoPct: loPct, ciHiPct: hiPct,
    nStart, nEnd, publishable: true, reason: '',
  };
}

/** Composition break: any single source OR house that is >COMP_HI of one
 *  endpoint quarter but <COMP_LO of the other. Catches the Algolia backfill
 *  flood (and any house entering/leaving between the two dates). */
function compositionBreak(a: QuarterStat, b: QuarterStat): string | null {
  const check = (label: string, ma: Map<string, number>, mb: Map<string, number>, na: number, nb: number): string | null => {
    const keys = new Set(Array.from(ma.keys()).concat(Array.from(mb.keys())));
    for (const k of Array.from(keys)) {
      const sa = (ma.get(k) || 0) / na;
      const sb = (mb.get(k) || 0) / nb;
      if ((sa > COMP_HI && sb < COMP_LO) || (sb > COMP_HI && sa < COMP_LO)) {
        return `composition break: ${label} '${k}' is ${(Math.max(sa, sb) * 100).toFixed(0)}% of one endpoint but ${(Math.min(sa, sb) * 100).toFixed(0)}% of the other`;
      }
    }
    return null;
  };
  return check('source', a.srcShare, b.srcShare, a.n, b.n)
    || check('house', a.houseShare, b.houseShare, a.n, b.n);
}
