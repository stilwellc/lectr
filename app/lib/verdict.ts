import type { AuctionLot } from '../types';
import { lotAllInFactor, maxHammerFor } from './premiums';
import { valueFloor } from './lanes';

/**
 * LotVerdict — the lot's "why", in ONE coherent frame (Oct 3 2026).
 *
 * lectr's validated edge is forecasting the HAMMER better than the house
 * estimate; flagged lots get bid UP. So the headline is the engine's
 * expected hammer against the house estimate — never a "below market"
 * multiple — and every number under it is on a stated basis:
 *
 *   expected hammer   value.compValueUsd (the engine's published, all-in
 *                     prediction) ÷ this lot's buyer's premium
 *   likely range      value.low / value.high, same conversion (the engine's
 *                     calibrated 15–85% outcome band)
 *   comps median      value.compMedianUsd — ALL-IN realized prices, the
 *                     similarity × recency weighted median of the closest
 *                     comps (TOP_K = 10 in lib/value.ts) out of n that
 *                     cleared the gates
 *   value floor       lanes.valueFloor — the band's low edge (all-in), only
 *                     at medium+ confidence
 *   max bid           the hammer that lands exactly on the floor after the
 *                     premium (premiums.maxHammerFor)
 *
 * Before this, the page printed a green "3.6× below market" next to "Max bid
 * ≤ $4K hammer" under a $5K estimate — two true numbers on two unstated
 * bases that read as a contradiction.
 */

/** the engine's weighted-median depth (lib/value.ts TOP_K) */
export const ENGINE_WEIGHTED_K = 10;

export interface Verdict {
  /** engine's expected hammer (premium stripped) */
  expected: number;
  bandLo: number;
  bandHi: number;
  /** all-in counterparts, for the strip plot (comps are all-in) */
  expectedAllIn: number;
  confidence: 'high' | 'medium' | 'low';
  estLow: number | null;
  estHigh: number | null;
  estMid: number | null;
  /** expected hammer vs the estimate midpoint, signed % (null without estimate) */
  vsEstPct: number | null;
  /** live bid (no-estimate lots read against it) */
  bid: number | null;
  /** the engine flagged it (its directional call over the estimate) */
  flagged: boolean;
  beatRatePct: number | null;
  compMedianAllIn: number | null;
  compN: number;
  floorAllIn: number | null;
  maxBid: number | null;
  premiumPct: number;
}

/** the estimate in USD — the canonical est*Usd fields first (non-USD houses),
    the legacy aliases after */
function estUsd(lot: AuctionLot): { lo: number | null; hi: number | null } {
  return { lo: lot.estLowUsd ?? lot.estimateLow ?? null, hi: lot.estHighUsd ?? lot.estimateHigh ?? null };
}

/* ── THE LOT READ'S FIGURES — one source (Oct 6 2026, pricing wave 3) ──
   LotPage, LotCard and the verdict read every bid-facing number here. */

/** a value whose comp ratio the build would call a data fault (×5 sanity) */
function saneValue(lot: AuctionLot): NonNullable<AuctionLot['value']> | null {
  const v = lot.value;
  if (!v || !(v.compValueUsd > 0)) return null;
  if (v.compRatio != null && (v.compRatio > 5 || v.compRatio < 1 / 5)) return null;
  return v;
}

/** THE VALUE FLOOR a reader may bid against — lanes.valueFloor, the ONE floor
 *  rule (value.low only at non-low confidence). */
export function lotFloor(lot: AuctionLot): number | null {
  return valueFloor(lot)?.floor ?? null;
}

/** THE MAX BID (hammer) and its all-in: the engine's own calibrated
 *  value.maxBidUsd (MAXBID_Q of hammers landed at or under it; floored at
 *  the live bid) wherever the floor rule certifies the value — the page used
 *  to print maxHammerFor(value.low), the band's all-in low edge, ~20% under
 *  the engine's max bid. null = no certified floor or no engine max bid. */
export function lotMaxBid(lot: AuctionLot): { hammer: number; allIn: number } | null {
  // (Oct 6 2026, wave 4) THE ENGINE'S MAX BID ONLY: value.maxBidUsd (floored
  // at the live bid by the build), on a value the floor rule certifies. The
  // page used to derive one from a 0.85 × card-median floor (175 live lots,
  // 84 of them under the bid already on the lot) and from maxHammerFor(low)
  // on values the ×5 sanity rejects — numbers the engine never made.
  const fl = valueFloor(lot);
  if (!fl || fl.src !== 'value.low') return null;
  const v = saneValue(lot) as (NonNullable<AuctionLot['value']> & { maxBidUsd?: number }) | null;
  const hammer = v?.maxBidUsd || 0;
  if (!(hammer > 0)) return null;
  return { hammer, allIn: Math.round(hammer * lotAllInFactor(lot, hammer)) };
}

/** THE PROJECTED CLOSE (all-in): only a projection whose house × days-out ×
 *  band cell is validated on the graded tape (build-upcoming stamps
 *  bidProj.ok) — an unvalidated cell ran 1.3–4.7× off. */
export function lotProjectedClose(lot: AuctionLot): number | null {
  const p = lot.bidProj;
  return p && p.ok === true && p.allIn > 0 ? p.allIn : null;
}

/** THE CARD'S COMPS FIGURE on the BID's basis (hammer): a live bid is a
 *  hammer bid, so "comps ~$X" over "$Y bid" must be the comps' hammer — the
 *  card printed the all-in comp value over the hammer bid. A value the build
 *  floored at the live bid (bidFloor) is not a comps figure: the comps' own
 *  hammer is recovered from the comps-vs-bid read, else nothing prints. A
 *  card value the engine marked context-only (abstain 'card:…') never prints. */
export function cardCompsHammer(lot: AuctionLot): number | null {
  const v = lot.value as (NonNullable<AuctionLot['value']> & { expectedHammerUsd?: number; premiumFactor?: number; bidFloor?: number; abstain?: string | null }) | null | undefined;
  if (!v || v.basis !== 'card-comp' || !v.estimateUsd) return null;
  if (typeof v.abstain === 'string' && v.abstain.startsWith('card:')) return null;
  if (v.bidFloor) {
    const bid = lot.currentBid || 0;
    if (!(bid > 0) || !v.vsBid) return null;
    const compsAllIn = (bid * lotAllInFactor(lot, bid)) / (1 + v.vsBid.pct / 100);
    return Math.round(maxHammerFor(compsAllIn, lot));
  }
  if (v.expectedHammerUsd && v.expectedHammerUsd > 0) return v.expectedHammerUsd;
  return Math.round(v.premiumFactor && v.premiumFactor > 0 ? v.estimateUsd / v.premiumFactor : maxHammerFor(v.estimateUsd, lot));
}

/** The verdict, or null when the engine made no sane value call. */
export function lotVerdict(lot: AuctionLot): Verdict | null {
  const v = lot.value;
  if (!v || !(v.compValueUsd > 0)) return null;
  // ×5 ESTIMATE-BAND SANITY (build-upcoming's rule) — a ratio the build
  // called a data fault never resurrects as a forecast here
  if (v.compRatio != null && (v.compRatio > 5 || v.compRatio < 1 / 5)) return null;
  const f = lotAllInFactor(lot, v.compValueUsd);
  const toHammer = (allIn: number) => maxHammerFor(allIn, lot);
  const { lo: rawLo, hi: rawHi } = estUsd(lot);
  const eLo = rawLo || rawHi || null;
  const eHi = rawHi || rawLo || null;
  const estMid = eLo && eHi ? (eLo + eHi) / 2 : null;
  // the engine publishes hammer-basis fields (Oct 3, engine 2026.10.03):
  // prefer them so the page and the engine can never disagree; fall back
  // to deriving them for values served before that engine
  const ve = v as typeof v & { expectedHammerUsd?: number; bandLowUsd?: number; bandHighUsd?: number; maxBidUsd?: number };
  const expected = ve.expectedHammerUsd && ve.expectedHammerUsd > 0 ? ve.expectedHammerUsd : toHammer(v.compValueUsd);
  const fl = valueFloor(lot);
  const flagged = v.signal?.label === 'below comparable market';
  return {
    expected,
    bandLo: ve.bandLowUsd && ve.bandLowUsd > 0 ? ve.bandLowUsd : toHammer(v.low || v.compValueUsd),
    bandHi: ve.bandHighUsd && ve.bandHighUsd > 0 ? ve.bandHighUsd : toHammer(v.high || v.compValueUsd),
    expectedAllIn: v.compValueUsd,
    confidence: v.confidence,
    estLow: rawLo || null,
    estHigh: rawHi || null,
    estMid,
    vsEstPct: estMid ? Math.round((expected / estMid - 1) * 100) : null,
    bid: (lot.currentBid || 0) > 0 ? lot.currentBid! : null,
    flagged,
    beatRatePct: flagged ? v.signal?.beatRatePct ?? null : null,
    compMedianAllIn: v.compMedianUsd ?? null,
    compN: v.n || 0,
    floorAllIn: fl ? fl.floor : null,
    maxBid: lotMaxBid(lot)?.hammer ?? null,
    premiumPct: Math.round((f - 1) * 100),
  };
}

/** $6.5K / $18K / $1.2M / $850 — one decimal under $10K so close numbers
    stay distinguishable (formatPrice rounds $6,548 and $7,400 both to $7K) */
export function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** "Confidence: medium, 2 of 4" — the accessible name for every dot meter */
export function confidenceA11y(c?: string | null): string {
  const map: Record<string, [string, number]> = { 'very-high': ['very high', 4], high: ['high', 3], medium: ['medium', 2], low: ['low', 1] };
  const [w, n] = map[c || 'low'] || map.low;
  return `Confidence: ${w}, ${n} of 4`;
}

export function estLabel(v: Verdict): string {
  if (v.estLow && v.estHigh && v.estLow !== v.estHigh) return `${fmtUsd(v.estLow)}–${fmtUsd(v.estHigh)}`;
  return fmtUsd((v.estLow || v.estHigh)!);
}

export const VERDICT_CSS = `
.lectr-vd{margin:18px 0 4px}
.lectr-vd-cell{min-height:0;padding:20px 22px;border-radius:16px}
.lectr-vd-cell .ns-cell-label{font-size:13px}
.lectr-vd-stat{font-family:var(--font-mono),monospace;font-size:clamp(30px,3.2vw,40px);font-weight:500;letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums;margin:10px 0 8px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.lectr-vd-vs{font-family:var(--font-sans);font-size:15px;font-weight:400;letter-spacing:0;opacity:.82}
.lectr-vd-cell .ns-cell-body{font-size:13px;font-weight:400;line-height:1.5;max-width:46ch}
.lectr-vd-rows{margin-top:8px}
.lectr-vd-row{display:flex;justify-content:space-between;align-items:baseline;gap:6px 16px;flex-wrap:wrap}
.lectr-vd-k{font-size:13px;color:var(--color-text-muted);flex:none}
.lectr-vd-v{display:flex;align-items:baseline;justify-content:flex-end;gap:10px;min-width:0;text-align:right;flex-wrap:wrap}
.lectr-vd-sub{font-size:11.5px;font-weight:400;color:var(--color-text-muted);line-height:1.45}
.lectr-vd-num{font-size:13.5px;font-weight:500;font-variant-numeric:tabular-nums;color:var(--color-fg);white-space:nowrap}
.lectr-vd-note{font-size:12px;line-height:1.55;color:var(--color-text-muted);margin:10px 0 0;max-width:62ch}
/* the comp strip — HTML-positioned marks on a log axis (text inside a
   stretched svg distorts; law) */
.lectr-strip{position:relative;margin:16px 4px 4px}
.lectr-strip-track{position:relative;height:44px;border-bottom:1px solid var(--hairline)}
.lectr-strip-est{position:absolute;top:6px;bottom:0;background:color-mix(in srgb,var(--color-fg) 7%,transparent);border-left:1px dotted var(--color-border-mid);border-right:1px dotted var(--color-border-mid)}
.lectr-strip-dot{position:absolute;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;background:var(--color-bg);border:1.5px solid var(--color-text-secondary)}
.lectr-strip-line{position:absolute;top:0;bottom:-4px;width:0;margin-left:-1px;border-left:2px solid var(--color-fg)}
.lectr-strip-line.exp{border-left:2px dashed var(--color-fg)}
.lectr-strip-line.exp.up{border-left-color:var(--color-up)}
.lectr-strip-axis{position:relative;height:18px;font-size:11px;color:var(--color-text-faint);font-variant-numeric:tabular-nums}
.lectr-strip-axis span{position:absolute;top:4px;transform:translateX(-50%);white-space:nowrap}
.lectr-strip-axis span:first-child{transform:none}
.lectr-strip-axis span:last-child{transform:translateX(-100%)}
.lectr-strip-key{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11.5px;color:var(--color-text-muted);margin-top:6px}
.lectr-strip-key i{display:inline-block;vertical-align:middle;margin-right:6px}
.lectr-strip-key .k-dot{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--color-text-secondary)}
.lectr-strip-key .k-med{width:0;height:12px;border-left:2px solid var(--color-fg)}
.lectr-strip-key .k-exp{width:0;height:12px;border-left:2px dashed var(--color-fg)}
.lectr-strip-key .k-exp.up{border-left-color:var(--color-up)}
.lectr-strip-key .k-est{width:14px;height:10px;background:color-mix(in srgb,var(--color-fg) 9%,transparent);border-left:1px dotted var(--color-border-mid);border-right:1px dotted var(--color-border-mid)}
@media (max-width:899px){
  .lectr-vd-stat{font-size:30px}
  .lectr-vd-sub{white-space:normal}
}
`;

/** the estimate band grossed up by the lot's premium (comps are all-in) */
export function estAllIn(lot: AuctionLot): { lo: number; hi: number } | null {
  const e = estUsd(lot);
  const lo = e.lo || e.hi, hi = e.hi || e.lo;
  if (!lo || !hi) return null;
  return { lo: Math.round(lo * lotAllInFactor(lot, lo)), hi: Math.round(hi * lotAllInFactor(lot, hi)) };
}
