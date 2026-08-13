/**
 * premiums.ts — the per-house buyer's-premium schedule.
 *
 * Everything premium-aware previously leaned on one flat 1.25× fallback
 * (backtest-core PREMIUM_FALLBACK). Actual schedules run 1.175×–1.28× and the
 * big three tier by hammer band — a ~10% cross-house bias on comp medians and
 * the blocker for max-bid guidance ("your walk-away hammer for this band").
 *
 * Sources: measured corpus ratios where hammer+premium pairs exist
 * (Goldin med 1.220 n=182k; Bonhams 1.250 n=16k p90 1.28; Wright 1.250
 * n=16k), bid-increment quantization reverse-derivation (REA 1.175 — the
 * integrity audit's $6,463 = $5,500 × 1.175 clusters), and published fee
 * schedules for the rest. A lot's own stamped buyerPremiumPct always wins.
 */

// flat factors (realized = hammer × factor)
const FLAT: Record<string, number> = {
  'Goldin': 1.22,          // measured 1.220 (2022-24 rows run 1.20)
  'REA': 1.175,            // derived from increment quantization
  'Huggins & Scott': 1.195,
  'SCP': 1.20,
  'Lelands': 1.20,
  'Memory Lane': 1.20,
  'Love of the Game': 1.195,
  'RR Auction': 1.25,
  'Wright': 1.25,          // measured 1.250
  'Rago': 1.25,
  'LAMA': 1.25,
};

// tiered schedules for the estimate houses (hammer-USD bands, descending BP)
const TIERED: Record<string, [number, number][]> = {
  // [band ceiling, factor] — first band whose ceiling >= hammer wins
  "Sotheby's": [[1_000_000, 1.27], [4_500_000, 1.21], [Infinity, 1.15]],
  "Christie's": [[1_000_000, 1.26], [6_000_000, 1.21], [Infinity, 1.15]],
  'Phillips': [[1_000_000, 1.27], [4_500_000, 1.21], [Infinity, 1.15]],
  'Bonhams': [[1_000_000, 1.28], [Infinity, 1.20]], // measured p90 1.28 low bands
};

/** realized = hammer × factor for this house at this hammer level. */
export function houseAllInFactor(house: string | null | undefined, hammerUsd?: number | null): number {
  if (!house) return 1.25;
  const tiers = TIERED[house];
  if (tiers) {
    const h = hammerUsd && hammerUsd > 0 ? hammerUsd : 0;
    for (const [ceil, f] of tiers) if (h <= ceil) return f;
    return tiers[tiers.length - 1][1];
  }
  return FLAT[house] ?? 1.25;
}

/** The factor for a specific lot: its own stamped premium wins, then the house
 *  schedule. `usd` disambiguates the tiered houses' band. */
export function lotAllInFactor(lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null }, usd?: number | null): number {
  const bp = lot.buyerPremiumPct;
  if (typeof bp === 'number' && bp > 0 && bp < 60) return 1 + bp / 100;
  return houseAllInFactor(lot.auctionHouse, usd);
}

/** Max-bid guidance: the walk-away HAMMER for a target all-in value. */
export function maxHammerFor(allInUsd: number, lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null }): number {
  return Math.floor(allInUsd / lotAllInFactor(lot, allInUsd));
}
