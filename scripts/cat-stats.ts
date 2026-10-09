/**
 * cat-stats.ts — sold-market stats per CLEAN category / sub-category (and per
 * sport for the two sports categories) — the rows /makers needs for the
 * collection markets, where the "maker" is really a category (TCG used to be
 * a single "Pokémon" row). Oct 9.
 *
 * Keys: "cat", "cat:sub", "cat:sub:sport". Same computeStats shape as
 * stats.json (one implementation, one contract), slimmed to what a roster row
 * prints. Must run AFTER normalizeCorpus — subCat/drill (and so taxonOf) are
 * stamped there; on raw segments only ~38% of sports rows carry a sport.
 */
import { computeStats } from './compute-stats';
import { taxonOf } from '../app/lib/taxonomy';
import type { AuctionLot } from '../app/types';

export interface CatStat {
  sold: number;
  sold12m: number;
  median12m: number;
  revenue: number;
  record: { price: number; title: string; date: string; house: string } | null;
  /** last 12 quarters: [quarter, median, count] */
  q: [string, number, number][];
}

const SPORTS_CATS = new Set(['sports-cards', 'sports-memorabilia']);
/** a row prints only with real depth — a 3-lot "market" is noise */
const MIN_SOLD = 20;

export function buildCatStats(lots: AuctionLot[]): Record<string, CatStat> {
  const groups = new Map<string, AuctionLot[]>();
  const push = (k: string, l: AuctionLot) => { const g = groups.get(k); if (g) g.push(l); else groups.set(k, [l]); };
  for (const l of lots) {
    if (l.status !== 'sold' || !l.priceUsd) continue;
    const t = taxonOf(l as unknown as { artist?: string; subCat?: string; drill?: string });
    push(t.cat, l);
    push(`${t.cat}:${t.sub}`, l);
    if (SPORTS_CATS.has(t.cat) && t.sport) push(`${t.cat}:${t.sub}:${t.sport}`, l);
  }
  const out: Record<string, CatStat> = {};
  groups.forEach((g, k) => {
    if (g.length < MIN_SOLD) return;
    const st = computeStats(g, null);
    out[k] = {
      sold: st.totalSoldTracked ?? g.length,
      sold12m: st.sold12m ?? 0,
      median12m: st.medianPriceLast12Months,
      revenue: Math.round(st.totalAuctionRevenue),
      record: st.recordPrice ? { price: st.recordPrice, title: st.recordTitle, date: st.recordDate, house: st.recordHouse } : null,
      q: st.priceHistory.slice(-12).map(p => [p.date, p.medianPrice, p.totalSales] as [string, number, number]),
    };
  });
  return out;
}
