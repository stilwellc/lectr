/**
 * cards-gate.ts — THE CARD CALIBRATION + PUBLISH GATE (Oct 3 2026).
 *
 * Card / TCG tier values were ~90% of the live call book while ~20% of them
 * landed within ±30% (calls ledger, Oct 2). Product decision (Collin, Oct 3):
 * gate card calls harder — a tier publishes a value only where its own recent
 * OUT-OF-SAMPLE record clears a bar; everything else abstains with a reason.
 *
 * Input: point-in-time residuals of the tier pricer — every recently sold card
 * priced AS OF its own sale day from strictly earlier sales (build-market's
 * calibration pass), lr = log(realized / tier value).
 *
 *  · TIER CALIBRATION (what the live value wears): per tier, the median
 *    residual over the last CARD_GATE.biasDays, shrunk toward 0 (K), as a
 *    bias multiplier; the 13/87 band and the MAXBID_Q quantile of the
 *    bias-corrected residuals around it.
 *  · THE GATE (whether it publishes): per market × tier × confidence cell,
 *    every residual of the last CARD_GATE.windowDays corrected by the tier
 *    bias AS IT STOOD the week the card sold (fit only on that tier's rows
 *    from the biasDays before that week — the live correction, replayed
 *    point-in-time). The cell publishes iff n ≥ minN, ±30% hit ≥ within30Pct
 *    and |bias| ≤ maxBias. Reason codes: 'card:uncalibrated' (n below the
 *    floor), 'card:gate-accuracy', 'card:gate-bias'.
 */
import { median, quantileSorted } from './stats';

export const CARD_GATE = {
  /** the gate's out-of-sample window */
  windowDays: 365,
  /** the live bias/band fit window (and the rolling PIT bias window) */
  biasDays: 120,
  /** rows a cell needs before it can publish */
  minN: 50,
  /** ±30% hit rate a cell must reach (percent) */
  within30Pct: 45,
  /** |median residual| a cell may carry after correction (multiplier) */
  maxBias: 1.15,
  /** shrink of the tier bias toward 1 (rows of effective weight) */
  K: 30,
  /** rows a tier needs before its bias/band apply */
  tierMinN: 50,
} as const;
/** band quantiles (13/87 — the published-value band convention) and the
 *  max-bid quantile (value.MAXBID_Q) */
const BAND_Q = 0.13;
const MB_Q = 0.3;

export type CardResidual = { tier: string; conf: string; market: string; ms: number; lr: number };
export interface CardTierCal { bias: number; lo: number; hi: number; mb: number; n: number }
export type CardGateReason = 'card:uncalibrated' | 'card:gate-accuracy' | 'card:gate-bias';
/** the same bar on the no-estimate hedonic path (value.noEstGate) */
export type NoEstGateReason = 'noest:uncalibrated' | 'noest:gate-accuracy' | 'noest:gate-bias';
export interface CardGateCell { n: number; within30Pct: number | null; bias: number | null; pass: boolean; reason?: CardGateReason | NoEstGateReason }
export interface CardCalibration { tiers: Record<string, CardTierCal>; cells: Record<string, CardGateCell>; asOf: string }

export const cardCellKey = (market: string, tier: string, conf: string) => `${market}:${tier}:${conf}`;
const DAY = 864e5;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** shrunk tier bias (log) from residuals; null under the tier floor */
function tierBiasLog(lrs: number[]): number | null {
  if (lrs.length < CARD_GATE.tierMinN) return null;
  const b = median(lrs);
  return (lrs.length * b) / (lrs.length + CARD_GATE.K);
}

/** Fit the tier calibration (live) and the publish gate (per cell) from
 *  point-in-time residuals, as of `nowMs` (rows at/after it are ignored). */
export function fitCardCalibration(rows: CardResidual[], nowMs: number): CardCalibration {
  const past = rows.filter(r => r.ms < nowMs && Number.isFinite(r.lr));
  // ── tier calibration (the live correction + band) ──
  const tiers: Record<string, CardTierCal> = {};
  const recent = past.filter(r => r.ms >= nowMs - CARD_GATE.biasDays * DAY);
  const byTier = new Map<string, number[]>();
  for (const r of recent) (byTier.get(r.tier) || byTier.set(r.tier, []).get(r.tier)!).push(r.lr);
  byTier.forEach((lrs, tier) => {
    const b = tierBiasLog(lrs);
    if (b == null) return;
    const z = lrs.map(x => x - b).sort((a, c) => a - c);
    const lo = Math.min(1, Math.exp(quantileSorted(z, BAND_Q)));
    tiers[tier] = {
      bias: r3(Math.exp(b)),
      lo: r3(lo),
      hi: r3(Math.max(1, Math.exp(quantileSorted(z, 1 - BAND_Q)))),
      mb: r3(Math.min(1, Math.max(lo, Math.exp(quantileSorted(z, MB_Q))))),
      n: lrs.length,
    };
  });
  // ── the gate: rolling point-in-time correction, then per-cell accuracy ──
  const win = past.filter(r => r.ms >= nowMs - CARD_GATE.windowDays * DAY);
  const pitBias = new Map<string, number>(); // `${tier}|${week}` → log bias (0 when the tier was under its floor)
  const tierRows = new Map<string, CardResidual[]>();
  for (const r of past) (tierRows.get(r.tier) || tierRows.set(r.tier, []).get(r.tier)!).push(r);
  const biasAt = (tier: string, ms: number): number => {
    const wk = Math.floor(ms / (7 * DAY));
    const key = `${tier}|${wk}`;
    const hit = pitBias.get(key);
    if (hit !== undefined) return hit;
    const ws = wk * 7 * DAY;
    const lrs = (tierRows.get(tier) || []).filter(x => x.ms < ws && x.ms >= ws - CARD_GATE.biasDays * DAY).map(x => x.lr);
    const b = tierBiasLog(lrs) ?? 0;
    pitBias.set(key, b);
    return b;
  };
  const byCell = new Map<string, number[]>();
  for (const r of win) {
    const k = cardCellKey(r.market, r.tier, r.conf);
    (byCell.get(k) || byCell.set(k, []).get(k)!).push(r.lr - biasAt(r.tier, r.ms));
  }
  const cells: Record<string, CardGateCell> = {};
  byCell.forEach((z, k) => { cells[k] = gateCell(z); });
  return { tiers, cells, asOf: new Date(nowMs).toISOString().slice(0, 10) };
}

/** Grade one cell's out-of-sample log residuals (log realized / value)
 *  against the bar. `path` prefixes the reason code. */
export function gateCell(z: number[], path: 'card' | 'noest' = 'card'): CardGateCell {
  const n = z.length;
  if (n < CARD_GATE.minN) {
    return { n, within30Pct: null, bias: null, pass: false, reason: `${path}:uncalibrated` };
  }
  const w30 = Math.round(1000 * z.filter(x => Math.abs(x) <= Math.log(1.3)).length / n) / 10;
  const bias = r3(Math.exp(median(z)));
  if (w30 < CARD_GATE.within30Pct) return { n, within30Pct: w30, bias, pass: false, reason: `${path}:gate-accuracy` };
  if (bias > CARD_GATE.maxBias || bias < 1 / CARD_GATE.maxBias) return { n, within30Pct: w30, bias, pass: false, reason: `${path}:gate-bias` };
  return { n, within30Pct: w30, bias, pass: true };
}

/** The gate verdict for a live value's cell (a cell never measured fails as
 *  'card:uncalibrated'). */
export function cardGate(cal: CardCalibration | null, market: string, tier: string, conf: string): CardGateCell {
  const c = cal?.cells[cardCellKey(market, tier, conf)];
  return c || { n: 0, within30Pct: null, bias: null, pass: false, reason: 'card:uncalibrated' };
}
