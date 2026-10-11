/**
 * lot-face.ts — ONE LOT, ONE NUMBER (r8, Oct 10 2026).
 *
 * Every figure a surface prints about a live lot's value comes from HERE:
 * the /value call plate and ledger rows, the lot page, the comps modal, the
 * lot card and the home table. Each figure is read off the engine's own
 * stamp (lot.value, and lot.signal — its build stamp of comps.engineFlagOf),
 * formatted once (verdict.fmtUsd) and labelled once (FACE_LABEL). A surface
 * never re-derives a median, a range or a ratio of its own.
 *
 * QA3 N1 (the bug this closes): /value's headline lot printed "4.0× below
 * market", "expected hammer $411" and, in the modal, "lectr value $2K ·
 * Range $5K — $5K" — the modal labelled the comps median "lectr value" and
 * took its range from the one pool row the client could resolve. The three
 * figures, and what each one is:
 *
 *   value  "lectr value"   the engine's PREDICTION — expected hammer and its
 *                          calibrated likely range (value.expectedHammerUsd /
 *                          bandLowUsd / bandHighUsd, hammer basis; verdict.ts)
 *   comps  "Comps median"  the WEIGHTED median (similarity × recency) of the
 *                          engine's pool, all-in realized — value.compMedianUsd.
 *                          A weighted median is always one of the pool's own
 *                          sales (stats.weightedMedian), so `medId` names the
 *                          row it is; the rows a surface lists are the pool
 *                          (poolIds), never another read.
 *   call   "4.0×"          the engine's flag ratio — computed FROM the comps
 *                          median above: its hammer (the lot's premium
 *                          stripped) over the estimate midpoint as this house
 *                          habitually clears it (value.houseFactor). `net`
 *                          spells that basis out, so the printed ratio is
 *                          reconstructable from printed numbers.
 */
import type { AuctionLot } from '../types';
import { engineFlagOf, signalMagnitude } from './comps';
import { enginePoolOf } from './engine-pool';
import { lotHammerFromAllIn } from './premiums';
import { fmtUsd, lotVerdict } from './verdict';

/** the one set of labels — a surface that prints a face figure prints its label */
export const FACE_LABEL = {
  value: 'lectr value',
  valueSub: 'expected hammer',
  range: 'likely',
  comps: 'Comps median',
  compsSub: 'weighted',
} as const;

/** the one formatter for every face figure ($1.7K, $416, $4.96M) */
export const fmtFace = fmtUsd;

export interface FaceValue {
  /** expected hammer (premium stripped) */
  hammer: number;
  lo: number;
  hi: number;
  /** the same prediction all-in (value.compValueUsd) */
  allIn: number;
  confidence: 'high' | 'medium' | 'low';
  /** "$416" */
  text: string;
  /** "$292–$927" */
  range: string;
}

export interface FaceComps {
  /** the weighted comps median, all-in realized */
  med: number;
  /** the pool's size (the engine's n) */
  n: number;
  /** the pool's ids (the rows behind the median) */
  ids: string[];
  /** "$1.7K" */
  text: string;
  /** "weighted · 4 sales" */
  sub: string;
}

export interface FaceCall {
  label: 'Below Market' | 'Above Market';
  pct: number;
  /** the engine's flag ratio (null on a legacy crawl-stamped signal) */
  ratio: number | null;
  /** "4.0×" / "+45%" / "−20%" — signalMagnitude, the capped token */
  text: string;
  confidence: 'very-high' | 'high' | 'medium' | 'low';
  /** the comps median's hammer — the numerator the ratio reads */
  compsHammer: number | null;
  /** the estimate midpoint × the house's habit — the denominator */
  askAdj: number | null;
  /** "net of 25% premium · ask × 1.10 house habit" */
  net: string | null;
  /** "$1.3K comps hammer ÷ $331 adj. ask" — the ratio from printed numbers */
  derivation: string | null;
}

export interface LotFace {
  value: FaceValue | null;
  comps: FaceComps | null;
  call: FaceCall | null;
}

function estMidOf(lot: AuctionLot): number | null {
  const lo = lot.estLowUsd ?? lot.estimateLow ?? lot.estHighUsd ?? lot.estimateHigh ?? null;
  const hi = lot.estHighUsd ?? lot.estimateHigh ?? lo;
  return lo && hi ? (lo + hi) / 2 : null;
}

function compsSub(n: number, k: number): string {
  // the weighted median reads the pool's closest K (the engine's TOP_K); a
  // larger pool says so, never "N sales" over a median of fewer
  return n > k && k > 0
    ? `${FACE_LABEL.compsSub} · ${k} closest of ${n.toLocaleString()} sales`
    : `${FACE_LABEL.compsSub} · ${n.toLocaleString()} ${n === 1 ? 'sale' : 'sales'}`;
}

/** THE ONE FUNCTION — every printed value figure of a lot. */
export function lotFace(lot: AuctionLot): LotFace {
  // a card value the engine marked context-only (abstain 'card:…') is
  // never printed as a value (verdict.cardCompsHammer's rule)
  const ab = (lot.value as { abstain?: string | null } | null | undefined)?.abstain;
  const v = typeof ab === 'string' && ab.startsWith('card:') ? null : lotVerdict(lot);
  const value: FaceValue | null = v && v.expected > 0 ? {
    hammer: v.expected, lo: v.bandLo, hi: v.bandHi, allIn: v.expectedAllIn, confidence: v.confidence,
    text: fmtFace(v.expected),
    range: `${fmtFace(v.bandLo)}–${fmtFace(v.bandHi)}`,
  } : null;

  // the call: the build stamp (lot.signal ≡ engineFlagOf at build), else
  // the engine's flag read off the value directly
  const sig = (lot.signal !== undefined ? lot.signal : engineFlagOf(lot)) as
    (NonNullable<AuctionLot['signal']> & { med?: number }) | null;

  const ep = enginePoolOf(lot.value);
  const flagMed = sig?.med;
  const comps: FaceComps | null = ep
    ? { med: ep.med, n: ep.n, ids: ep.ids, text: fmtFace(ep.med), sub: compsSub(ep.n, ep.ids.length) }
    : flagMed != null && flagMed > 0
      ? { med: flagMed, n: sig!.basis || 0, ids: [], text: fmtFace(flagMed), sub: compsSub(sig!.basis || 0, 0) }
      : null;

  let call: FaceCall | null = null;
  if (sig) {
    const ev = lot.value as (NonNullable<AuctionLot['value']> & { houseFactor?: number }) | null | undefined;
    const ratio = ev?.flagRatio ?? ev?.compRatio ?? null;
    const mid = estMidOf(lot);
    let compsHammer: number | null = null, askAdj: number | null = null, net: string | null = null, derivation: string | null = null;
    if (comps && mid && ratio != null) {
      compsHammer = Math.round(lotHammerFromAllIn(lot, comps.med));
      const hf = typeof ev?.houseFactor === 'number' && ev.houseFactor > 0 ? ev.houseFactor : 1;
      askAdj = Math.round(mid * hf);
      const prem = compsHammer > 0 ? Math.round((comps.med / compsHammer - 1) * 100) : 0;
      net = [prem > 0 ? `net of ${prem}% premium` : null, Math.abs(hf - 1) >= 0.005 ? `ask × ${hf.toFixed(2)} house habit` : null]
        .filter(Boolean).join(' · ') || null;
      derivation = `${fmtFace(compsHammer)} comps hammer ÷ ${fmtFace(askAdj)} ${Math.abs(hf - 1) >= 0.005 ? 'adj. ' : ''}ask`;
    }
    call = {
      label: sig.label,
      pct: sig.pct,
      ratio,
      text: signalMagnitude(sig.label, sig.pct),
      confidence: sig.confidence || 'low',
      compsHammer, askAdj, net, derivation,
    };
  }
  return { value, comps, call };
}

/** "lectr value $416 · likely $292–$927" — the one sentence form */
export function valueSentence(f: FaceValue): string {
  return `${FACE_LABEL.value} ${f.text} · ${FACE_LABEL.range} ${f.range}`;
}

/** the pool row the weighted median IS — the row at that price (192 of 198
 *  checkable live pools match to the dollar); a row re-priced since the
 *  engine read it (a re-crawled FX or premium, ≤5% on the Oct 9 book) is
 *  still that row: the closest within 5% */
export function medianRowId<T extends { id: string; priceUsd?: number | null }>(rows: readonly T[], med: number): string | null {
  let best: T | null = null, bestD = Infinity;
  for (const r of rows) {
    if (r.priceUsd == null || !(r.priceUsd > 0)) continue;
    const d = Math.abs(r.priceUsd / med - 1);
    if (d < bestD) { best = r; bestD = d; }
  }
  return best && bestD <= 0.05 ? best.id : null;
}
