import type { MarketData } from '../../hooks/useRayData';
import { ARTIST_LABEL, ARTIST_MARKET, type Market } from '../../constants';

/* ============================================================
   VERIFIED MOVERS — the ONLY price-movement reads the hedonic
   engine will stand behind. A maker publishes a horizon only
   when its 95% CI resolves the sign; everything else abstains.
   We surface the longest defensible horizon per maker (5Y > 3Y
   > 1Y) as its headline move, with the interval carried along.
   ============================================================ */

export interface VerifiedMover {
  slug: string;
  label: string;
  market: Market;
  horizon: string; // '5Y' | '3Y' | '1Y'
  changePct: number;
  ciLoPct: number;
  ciHiPct: number;
  dir: 'up' | 'down';
  n: number; // coverage lots behind the fit
  series: number[]; // rebased index level, for the sparkline
}

// longest window first — a 5Y read is the more meaningful collector signal
const HORIZON_PREF = ['5Y', '3Y', '1Y'] as const;

/**
 * The publishable makers, optionally scoped to a market. Sorted by the
 * strongest absolute move. `all` (or no scope) returns every publishable maker.
 */
export function verifiedMovers(market: MarketData | null, scope?: Market): VerifiedMover[] {
  const mi = market?.makerIndex;
  if (!mi) return [];
  const out: VerifiedMover[] = [];
  for (const [slug, r] of Object.entries(mi)) {
    const mkt = ARTIST_MARKET[slug];
    if (scope && scope !== 'all' && mkt !== scope) continue;
    // the longest horizon whose CI resolves the sign
    let pick: string | null = null;
    for (const h of HORIZON_PREF) {
      if (r.horizons?.[h]?.publishable) { pick = h; break; }
    }
    if (!pick) continue;
    const hz = r.horizons[pick];
    if (hz.changePct == null) continue;
    out.push({
      slug,
      label: ARTIST_LABEL[slug] || slug,
      market: mkt,
      horizon: pick,
      changePct: hz.changePct,
      ciLoPct: hz.ciLoPct ?? hz.changePct,
      ciHiPct: hz.ciHiPct ?? hz.changePct,
      dir: hz.changePct >= 0 ? 'up' : 'down',
      n: r.coverageMakerLots || 0,
      series: (r.series || []).map((p) => p.value),
    });
  }
  return out.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

export const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
