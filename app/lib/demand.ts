/**
 * demand.ts — the Demand Index: how the typical sale performs against its own
 * estimate, trailing twelve months, evaluated at each quarter.
 *
 * This is the mix-proof market read. Price-level series are hostage to WHAT
 * sold (a quarter of prints vs a quarter of canvases); performance-vs-estimate
 * normalizes every lot by its own ask, so a $900 print selling 60% over and a
 * $3M canvas selling 60% over count identically. Houses set estimates tracking
 * prices, which makes over-estimate performance the LEADING demand signal —
 * price levels follow. Median (not mean) keeps single freak results out.
 */
import { AuctionLot } from '../types';

export interface DemandPoint {
  date: string;
  /** median % over estimate midpoint for the trailing year, e.g. +46 */
  value: number;
  /** sales with estimates inside the window */
  n: number;
}

const MIN_WINDOW_SALES = 5;

export function demandSeries(lots: AuctionLot[]): DemandPoint[] {
  const byQuarter: Record<string, number[]> = {};
  for (const l of lots) {
    if (l.status !== 'sold' || !l.priceUsd || !l.estimateLow || !l.estimateHigh) continue;
    const d = new Date(l.saleDate);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    const estMid = (l.estimateLow + l.estimateHigh) / 2;
    if (estMid <= 0) continue;
    (byQuarter[key] = byQuarter[key] || []).push(l.priceUsd / estMid - 1);
  }
  const quarters = Object.keys(byQuarter).sort();
  const points: DemandPoint[] = [];
  quarters.forEach((qk, i) => {
    const window = quarters.slice(Math.max(0, i - 3), i + 1).flatMap(w => byQuarter[w]).sort((a, b) => a - b);
    if (window.length < MIN_WINDOW_SALES) return;
    const m = Math.floor(window.length / 2);
    const median = window.length % 2 === 0 ? (window[m - 1] + window[m]) / 2 : window[m];
    points.push({ date: qk, value: median * 100, n: window.length });
  });
  return points;
}

export function formatDemand(n: number): string {
  const r = Math.round(n);
  return `${r >= 0 ? '+' : ''}${r}%`;
}
