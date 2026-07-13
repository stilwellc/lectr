export type AuctionHouse = 'Phillips' | "Sotheby's" | "Christie's" | 'Wright' | 'Rago' | 'Heritage' | 'Bonhams' | 'Hindman' | 'Goldin';
export type LotStatus = 'upcoming' | 'sold' | 'bought_in' | 'withdrawn';
export type Currency = 'USD' | 'GBP' | 'EUR' | 'HKD' | 'CNY' | 'AUD' | 'CHF';
export type LotCategory = 'original' | 'print' | 'photograph' | 'sculpture' | 'design' | 'object' | 'unknown';
/** how a sold price was established: a verified hammer, or the last bid Ray
    tracked before a house that publishes no results closed (Goldin) */
export type PriceBasis = 'hammer' | 'last-tracked-bid';

export interface AuctionLot {
  id: string;
  artist: string;
  title: string;
  year: string | null;
  medium: string | null;
  dimensions: string | null;
  category: LotCategory;
  imageUrl: string | null;
  auctionHouse: AuctionHouse;
  saleName: string;
  saleDate: string;
  lotNumber: number | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  currency: Currency;
  hammerPrice: number | null;
  premiumPrice: number | null;
  priceUsd: number | null;
  priceBasis?: PriceBasis;
  /** live bid on a no-estimate bid auction (Goldin) — real money on the lot now */
  currentBid?: number;
  bidCount?: number;
  status: LotStatus;
  url: string;
  /** Precomputed at crawl time for upcoming lots (comps median vs estimate
      midpoint) so the feed can paint before the full history downloads.
      undefined = not precomputed (compute client-side from allLots). */
  signal?: { label: 'Below Market' | 'Above Market'; pct: number; basis?: number; kind?: 'edition' | 'form'; form?: string; confidence?: 'very-high' | 'high' | 'medium' | 'low' } | null;
}

export interface PricePoint {
  date: string;
  avgPrice: number;
  medianPrice: number;
  totalSales: number;
  highPrice: number;
}

export interface HouseCount {
  house: AuctionHouse;
  count: number;
  totalValue: number;
}

export interface MarketStats {
  lastUpdated: string;
  totalLotsTracked: number;
  avgPriceLast12Months: number;
  medianPriceLast12Months: number;
  recordPrice: number;
  recordTitle: string;
  recordDate: string;
  recordHouse: AuctionHouse;
  appreciationRate: number;
  totalAuctionRevenue: number;
  priceHistory: PricePoint[];
  houseDistribution: HouseCount[];
}
