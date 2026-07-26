/**
 * compute-stats.ts — the per-maker MarketStats builder, shared by the nightly
 * crawl (every maker) and build-market (the sports-cards row, whose sold lots
 * are corpus-only and so must be aggregated at build). Verbatim extraction
 * from ray-crawl.ts — one implementation, one shape.
 */
import type { AuctionLot, MarketStats, PricePoint, HouseCount, AuctionHouse } from '../app/types';

export function computeStats(lots: AuctionLot[], existingStats: MarketStats | null): MarketStats {
  const sold = lots.filter(l => l.status === 'sold' && l.priceUsd);
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

  // parse each sold lot's saleDate → Date ONCE (both the recent-window filter and
  // the quarterly loop below need it; the quarter derives from LOCAL getFullYear/
  // getMonth so a bare ms won't do). NaN getTime for invalid dates, preserving
  // the isNaN gate exactly (`isNaN(saleMs[i])` == the old `isNaN(d.getTime())`).
  const saleDates = sold.map(l => new Date(l.saleDate));
  const saleMs = saleDates.map(d => d.getTime());
  const oneYearAgoMs = oneYearAgo.getTime();

  const recentSold = sold.filter((_l, i) => !isNaN(saleMs[i]) && saleMs[i] >= oneYearAgoMs);

  const prices = recentSold.map(l => l.priceUsd!).sort((a, b) => a - b);
  const avg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : existingStats?.avgPriceLast12Months || 0;
  const median = prices.length ? (prices.length % 2 ? prices[prices.length >> 1] : Math.round((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)) : existingStats?.medianPriceLast12Months || 0;

  const record = sold.reduce((best, l) =>
    (l.priceUsd || 0) > (best?.priceUsd || 0) ? l : best, sold[0]);

  // Build quarterly price history
  const quarters = new Map<string, number[]>();
  sold.forEach((lot, i) => {
    const d = saleDates[i];
    if (isNaN(saleMs[i])) return;
    const q = `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
    if (!quarters.has(q)) quarters.set(q, []);
    quarters.get(q)!.push(lot.priceUsd!);
  });

  const priceHistory: PricePoint[] = Array.from(quarters.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pxs]) => ({
      date,
      avgPrice: Math.round(pxs.reduce((a, b) => a + b, 0) / pxs.length),
      // sort a COPY (avoid mutating the map's array) and average the two middles
      // on even counts (the bare floor-index was biased to the upper-middle).
      medianPrice: (() => { const s = [...pxs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[n >> 1] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2); })(),
      totalSales: pxs.length,
      highPrice: Math.max(...pxs),
    }));

  // House distribution
  const houseCounts = new Map<string, { count: number; totalValue: number }>();
  for (const lot of sold) {
    const h = lot.auctionHouse;
    const existing = houseCounts.get(h) || { count: 0, totalValue: 0 };
    existing.count++;
    existing.totalValue += lot.priceUsd || 0;
    houseCounts.set(h, existing);
  }

  const houseDistribution: HouseCount[] = Array.from(houseCounts.entries()).map(([house, data]) => ({
    house: house as AuctionHouse,
    count: data.count,
    totalValue: data.totalValue,
  }));

  // Compute appreciation rate from price history
  // Compare avg price over recent 4 quarters vs 4 quarters from 3 years ago
  let appreciationRate = 0;
  if (priceHistory.length >= 8) {
    const recent4 = priceHistory.slice(-4);
    const older4 = priceHistory.slice(-12, -8);
    if (older4.length === 4) {
      const recentAvg = recent4.reduce((s, p) => s + p.avgPrice, 0) / 4;
      const olderAvg = older4.reduce((s, p) => s + p.avgPrice, 0) / 4;
      if (olderAvg > 0) {
        appreciationRate = Math.round(((recentAvg / olderAvg) ** (1 / 3) - 1) * 1000) / 10;
      }
    }
  }

  const recordTitle = record?.title || existingStats?.recordTitle || '';

  return {
    lastUpdated: now.toISOString(),
    totalLotsTracked: lots.length,
    avgPriceLast12Months: avg,
    medianPriceLast12Months: median,
    recordPrice: record?.priceUsd || existingStats?.recordPrice || 0,
    recordTitle: recordTitle.length > 60 ? recordTitle.substring(0, 57) + '...' : recordTitle,
    recordDate: record?.saleDate || existingStats?.recordDate || '',
    recordHouse: record?.auctionHouse || existingStats?.recordHouse || 'Phillips',
    appreciationRate,
    totalAuctionRevenue: sold.reduce((sum, l) => sum + (l.priceUsd || 0), 0),
    priceHistory: priceHistory.length > 0 ? priceHistory : existingStats?.priceHistory || [],
    houseDistribution: houseDistribution.length > 0 ? houseDistribution : existingStats?.houseDistribution || [],
  };
}
