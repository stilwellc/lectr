export type AuctionHouse = 'Phillips' | "Sotheby's" | "Christie's" | 'Wright' | 'Rago' | 'Heritage' | 'Bonhams' | 'Hindman';
export type LotStatus = 'upcoming' | 'sold' | 'bought_in' | 'withdrawn';
export type Currency = 'USD' | 'GBP' | 'EUR' | 'HKD' | 'CNY' | 'AUD' | 'CHF';
export type LotCategory = 'original' | 'print' | 'photograph' | 'sculpture' | 'design' | 'unknown';

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
  status: LotStatus;
  url: string;
  /** Precomputed at crawl time for upcoming lots (comps median vs estimate
      midpoint) so the feed can paint before the full history downloads.
      undefined = not precomputed (compute client-side from allLots). */
  signal?: { label: 'Below Market' | 'Above Market'; pct: number } | null;
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
