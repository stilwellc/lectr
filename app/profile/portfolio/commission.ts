/**
 * commission.ts — the SELLER'S side of the premium table (THE DESK v3 §6
 * Portfolio, Oct 11 2026).
 *
 * app/lib/premiums.ts says what a BUYER pays on top of the hammer. "If sold
 * now" needs the other side: what a consignor keeps after the house's
 * seller's commission. No house publishes one number — consignment terms
 * are negotiated per lot and the schedules change — so this module states
 * ONE ASSUMED RATE PER HOUSE TIER, names it an assumption everywhere it is
 * printed (COMMISSION_NOTE), and never dresses it as a quote.
 *
 *   estimate      the estimate houses (Sotheby's, Christie's, Phillips,
 *                 Bonhams) — assumed 10% of the hammer
 *   collectibles  the card and memorabilia houses (Goldin, REA, …) whose
 *                 published seller's fees run 0–10% — assumed 5%
 *   specialist    every other house (design, autograph, regional) — assumed 15%
 *
 * Hammer basis: the engine's expected hammer (lotVerdict().expected, premium
 * stripped) × (1 − rate). Shipping, insurance, photography and taxes are not
 * in the number, and the note says so. Pure: no React, no I/O.
 */

export type HouseTier = 'estimate' | 'collectibles' | 'specialist';

/** the assumed seller's commission by tier (a share of the hammer) */
export const SELLER_RATE: Record<HouseTier, number> = {
  estimate: 0.10,
  collectibles: 0.05,
  specialist: 0.15,
};

export const TIER_LABEL: Record<HouseTier, string> = {
  estimate: 'estimate house',
  collectibles: 'card & memorabilia house',
  specialist: 'specialist house',
};

const ESTIMATE_HOUSES: ReadonlySet<string> = new Set(["Sotheby's", "Christie's", 'Phillips', 'Bonhams']);
/** the sports / card houses premiums.ts measures flat (minus the design and autograph houses) */
const COLLECTIBLES_HOUSES: ReadonlySet<string> = new Set([
  'Goldin', 'REA', 'Huggins & Scott', 'SCP', 'Lelands', 'Memory Lane', 'Love of the Game',
  'MLB Auctions', 'NFL Auctions', 'NBA Auctions', 'NHL Auctions',
]);

/** the tier a house falls in (an unknown or missing house reads as specialist) */
export function houseTier(house: string | null | undefined): HouseTier {
  if (!house) return 'specialist';
  if (ESTIMATE_HOUSES.has(house)) return 'estimate';
  if (COLLECTIBLES_HOUSES.has(house)) return 'collectibles';
  return 'specialist';
}

export interface SoldNow {
  /** what the consignor keeps: hammer × (1 − rate) */
  net: number;
  /** the house's assumed cut, in dollars */
  commission: number;
  rate: number;
  tier: HouseTier;
  house: string;
}

/** the consignor's proceeds from an expected hammer at this house (null: no hammer) */
export function soldNowOf(expectedHammer: number | null | undefined, house: string | null | undefined): SoldNow | null {
  if (expectedHammer == null || !(expectedHammer > 0)) return null;
  const tier = houseTier(house);
  const rate = SELLER_RATE[tier];
  const commission = Math.round(expectedHammer * rate);
  return { net: Math.round(expectedHammer - commission), commission, rate, tier, house: house || 'the house' };
}

/** the one sentence every "if sold now" figure is footnoted with */
export const COMMISSION_NOTE =
  `Assumed seller's commission on the engine's expected hammer: ${Math.round(SELLER_RATE.estimate * 100)}% at the estimate houses (Sotheby's, Christie's, Phillips, Bonhams), ` +
  `${Math.round(SELLER_RATE.collectibles * 100)}% at the card and memorabilia houses (Goldin, REA, …), ${Math.round(SELLER_RATE.specialist * 100)}% elsewhere. ` +
  'Consignment terms are negotiated per lot and change; this is an assumption, not a quote. Shipping, insurance, photography and taxes are not in the number.';
