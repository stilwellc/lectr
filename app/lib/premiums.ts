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

/** ERA-DATED premium schedules (Oct 5 2026) — houses whose buyer's premium
 *  changed over the years the corpus spans. [first saleDate (YYYY-MM-DD) the
 *  rate applies to, factor], ascending; a saleDate before the first entry takes
 *  the first rate.
 *
 *  REA (183k rows, 2004 → today, NO stamped buyerPremiumPct/hammer). MEASURED
 *  on the corpus by increment quantization: for every sold REA row ≥ $1,000,
 *  the share whose price ÷ factor is a round flat bid increment is ~100% for
 *  exactly ONE factor per sale and ~0% for the neighbours (≥ 85% where the
 *  remainder are off-ladder bids), with clean break points between sales:
 *    2004 (Apr)                  1.15   100%
 *    2005 – 2006                 1.16   100%
 *    2007 – 2011                 1.175  100%
 *    2012 – Spring 2014 (Apr)    1.185  100%
 *    Fall 2014 (Oct) – Jul 2025  1.20   85–100%
 *    Sep 2025 → today            1.23   79–90%
 *  CONFIRMED against REA's published terms ("A N% buyer's premium will be
 *  added to all winning bids" — one flat rate, no card/cash variant; checked
 *  Oct 5 2026 on Wayback captures):
 *    15%   web.archive.org/web/20040302013238/http://www.robertedwardauctions.com/site/terms.asp
 *    16%   web.archive.org/web/20051109084900/http://www.robertedwardauctions.com/site/terms.asp
 *    17.5% web.archive.org/web/20071009013020/http://bid.robertedwardauctions.com/terms.aspx
 *    18.5% web.archive.org/web/20120511121233/http://bid.robertedwardauctions.com/terms.aspx
 *          (still 18.5% at …/20140407193704/…/terms.aspx)
 *    20%   web.archive.org/web/20150301124756/http://bid.robertedwardauctions.com/terms.aspx
 *          (… through …/20250801160420/https://bid.collectrea.com/terms-and-conditions)
 *    23%   web.archive.org/web/20251006210043/https://bid.collectrea.com/terms-and-conditions
 *          effective Sep 1 2025 (REA customer notice, reported by postwarcards.com).
 *  The capture dates lag the changes; the boundaries below are the sale
 *  seasons the corpus quantization pins (Spring 2014 = 18.5, Fall 2014 = 20).
 *
 *  USED BY the price-bleed sentinel's honesty test (scripts/assemble.ts
 *  computeSentinel): the 29+ standing REA "poison" signatures were real flat
 *  increments × the OLDER premiums that the flat 1.175 could not see. And
 *  (Oct 5 2026, engine) by lotAllInFactor → inferHammerUsd / buyerFields /
 *  vsBidRead whenever the lot carries a saleDate: measured on the live book
 *  (Sep 14 snapshot, 145 REA lots sold by Oct 5, true hammer = realized ÷ the
 *  era premium) the served expected hammer moved median abs error 40.3% →
 *  34.8%, ±30% 37.9% → 46.2%, hammers ≤ max bid 57.9% → 49.7% (nominal 30);
 *  all-in figures are unchanged by construction. docs/ENGINE_LANES.md §10. */
export const DATED_PREMIUMS: Record<string, Array<[string, number]>> = {
  REA: [
    ['0000-01-01', 1.15],
    ['2005-01-01', 1.16],
    ['2007-01-01', 1.175],
    ['2012-01-01', 1.185],
    ['2014-07-01', 1.20],
    ['2025-09-01', 1.23], // REA's stated effective date
  ],
};

/** The house's premium factor AT a sale date: the era schedule when the house
 *  has one and the date parses, else houseAllInFactor (same as undated). */
export function houseAllInFactorAt(house: string | null | undefined, hammerUsd: number | null | undefined, saleDate: string | null | undefined): number {
  const eras = house ? DATED_PREMIUMS[house] : undefined;
  const d = typeof saleDate === 'string' ? saleDate.slice(0, 10) : '';
  if (!eras || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return houseAllInFactor(house, hammerUsd);
  let f = eras[0][1];
  for (const [from, factor] of eras) if (d >= from) f = factor;
  return f;
}

/** The factor for a specific lot: its own stamped premium wins, then the house
 *  schedule AS OF the lot's saleDate (era-dated houses), then the undated
 *  schedule. `usd` disambiguates the tiered houses' band. */
export function lotAllInFactor(lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null; saleDate?: string | null }, usd?: number | null): number {
  const bp = lot.buyerPremiumPct;
  if (typeof bp === 'number' && bp > 0 && bp < 60) return 1 + bp / 100;
  // the premium IN FORCE on the lot's sale date (DATED_PREMIUMS; REA's eras) —
  // a sold lot's hammer, and a live lot's expected hammer / max bid at the
  // premium it will actually be charged. Undated lots take the house schedule.
  if (lot.saleDate) return houseAllInFactorAt(lot.auctionHouse, usd, lot.saleDate);
  return houseAllInFactor(lot.auctionHouse, usd);
}

/** Max-bid guidance: the walk-away HAMMER for a target all-in value. */
export function maxHammerFor(allInUsd: number, lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null }): number {
  return Math.floor(allInUsd / lotAllInFactor(lot, allInUsd));
}

/** THE hammer inference (P1-5, Sep 2 2026): the lot's published hammer when
 *  it has one, else realized ÷ the lot's own premium factor (stamped
 *  buyerPremiumPct, then the house schedule; the tiered houses read the band
 *  off the realized figure, the closest proxy for the hammer band). Every
 *  hammer-basis read — indices.houseAccuracy, build-market houseCal +
 *  seasonality, the backtest's hammer perfs — goes through here; there is no
 *  flat /1.25 left in the engine. */
export function inferHammerUsd(lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null; hammerUsd?: number | null; realizedUsd?: number | null; priceUsd?: number | null }): number {
  const h = lot.hammerUsd;
  if (typeof h === 'number' && h > 0) return h;
  const realized = (lot.realizedUsd && lot.realizedUsd > 0 ? lot.realizedUsd : lot.priceUsd) || 0;
  if (!(realized > 0)) return 0;
  return realized / lotAllInFactor(lot, realized);
}

/** Houses whose bid ladder is PERCENTAGE-based, not flat: each next bid is the
 *  current bid + 10%, unrounded (1,050 → 1,155 → 1,271 → 1,398 → 1,538 → 1,692 …).
 *  Measured on the Sep 27 audit: Memory Lane / Lelands / Love of the Game
 *  repeat-price clusters sit on exactly these rungs — a REAL geometric ladder,
 *  not placeholder prices (a null rule there would have wiped ~7k honest rows). */
export const BID_LADDER_PCT: Record<string, number> = {
  'Lelands': 0.10,
  'Memory Lane': 0.10,
  'Love of the Game': 0.10,
};

/** A percentage bid ladder to test against: `pct` per step, and `peers` = the
 *  OTHER prices that house repeatedly clears at (the ladder's observed rungs). */
export type BidLadder = { pct: number; peers: Iterable<number> };

/** Is `hammer` a round bid increment? Poisoned feeds stamp one arbitrary
 *  price across a batch ($10,050 ×3,622); honest repeats are increment ×
 *  premium ties ($1,000 × 1.22 = $1,220 ×40 inside one sale). Absolute
 *  tolerance on purpose: a relative one would bless any large number.
 *
 *  PERCENTAGE LADDERS (Sep 27 2026): a flat-step test can never see a 10%
 *  geometric ladder — its rungs are unrounded by construction. When a `ladder`
 *  is passed (the house's step pct + its other repeat prices), the value is ALSO
 *  honest if it sits ON that ladder: at least two neighbouring rungs, each one
 *  step (×(1+pct)) away, chained through the peer set (value ↔ rung ↔ rung, in
 *  either direction). Requiring a 3-rung chain keeps an isolated bleed from being
 *  blessed by one coincidental neighbour. Rung tolerance is ±max(1.5, 0.2%) —
 *  the ladder rounds each step to the dollar, so rounding drifts by <1/step. */
export function isRoundIncrement(hammer: number, tolUsd = 1, ladder?: BidLadder): boolean {
  if (!(hammer > 0)) return false;
  const step = hammer < 5_000 ? 50 : hammer < 50_000 ? 100 : hammer < 500_000 ? 500 : 1_000;
  const r = Math.round(hammer / step) * step;
  if (Math.abs(hammer - r) <= tolUsd) return true;
  if (!ladder || !(ladder.pct > 0)) return false;
  return onPercentLadder(hammer, ladder);
}

function onPercentLadder(v: number, ladder: BidLadder): boolean {
  const k = 1 + ladder.pct;
  const peers = Array.from(ladder.peers).filter(p => p > 0 && p !== v).sort((a, b) => a - b);
  if (peers.length < 2) return false;
  const tolOf = (x: number) => Math.max(1.5, x * 0.002);
  // binary-search a peer within tolerance of `target`
  const has = (target: number, exclude: number): number | null => {
    const tol = tolOf(target);
    let lo = 0, hi = peers.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (peers[mid] < target - tol) lo = mid + 1; else hi = mid - 1;
    }
    for (let i = lo; i < peers.length && peers[i] <= target + tol; i++) if (peers[i] !== exclude) return peers[i];
    return null;
  };
  const up = has(v * k, v), down = has(v / k, v);
  // v sits between two rungs, or at the end of a 3-rung run in either direction
  if (up !== null && down !== null) return true;
  if (up !== null && has(up * k, v) !== null) return true;
  if (down !== null && has(down / k, v) !== null) return true;
  return false;
}
