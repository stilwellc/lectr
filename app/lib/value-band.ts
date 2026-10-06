/**
 * value-band.ts — read the calibrated outcome band the way the engine wears it.
 *
 * Since Sep 27 the replay publishes `calibration.valueBand` keyed by PATH
 * ('e' = estimate-blend lots, 'n' = no-estimate lots) and then confidence tier
 * (and `valueBandByMarket[market][path][tier]` where a market is deep enough).
 * app/lib/value.ts reads it that way; the client readers used to index it by
 * tier directly (`valueBand[confidence]`), which is always undefined, so they
 * silently fell back to the legacy conformal `band` (a different, wider band
 * the served lots no longer wear). This is the one reader for the client.
 */
export type Band = { lo: number; hi: number; mb?: number };
type BandsByTier = Record<string, Band>;
export interface BandCalibration {
  valueBand?: Record<string, BandsByTier>;
  valueBandByMarket?: Record<string, Record<string, BandsByTier>>;
  band?: BandsByTier;
  bandByMarket?: Record<string, BandsByTier>;
}

/** 'e' when the lot carries an estimate (either side — RR posts a low only;
 *  mirrors value.ts `estMid`), else 'n'. */
export function bandPathOf(lot: { estimateLow?: number | null; estimateHigh?: number | null }): 'e' | 'n' {
  return (lot.estimateLow ?? lot.estimateHigh) ? 'e' : 'n';
}

/** The band a lot of this path × tier (× market) wears — the same ladder
 *  value.ts walks: per-market valueBand → valueBand → per-market legacy
 *  conformal band → legacy band (older backtest.json, or a cell valueBand
 *  does not cover). */
export function calibratedBand(cal: BandCalibration | null | undefined, confidence: string, path: 'e' | 'n' = 'e', market?: string | null): Band | null {
  if (!cal) return null;
  return (market ? cal.valueBandByMarket?.[market]?.[path]?.[confidence] : undefined)
    ?? cal.valueBand?.[path]?.[confidence]
    ?? (market ? cal.bandByMarket?.[market]?.[confidence] : undefined)
    ?? cal.band?.[confidence]
    ?? null;
}

/** Every tier's band for one path — the Lab's band-width figure. Falls back
 *  to the legacy per-tier `band` only when no valueBand exists at all. */
export function calibratedBands(cal: BandCalibration | null | undefined, path: 'e' | 'n' = 'e'): BandsByTier | undefined {
  if (!cal) return undefined;
  if (cal.valueBand) return cal.valueBand[path];
  return cal.band;
}
