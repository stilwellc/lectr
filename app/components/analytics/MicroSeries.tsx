'use client';
/**
 * MicroSeries — the desk's two small market-microstructure instruments,
 * both drawn from the eager market.json series:
 *   SellThroughPanel — % of offered lots finding a buyer, quarterly
 *   DepthPanel       — sales per quarter (liquidity), counts never dressed
 *                      as price movement
 * Both render the trailing window on the HeroChart instrument, headline the
 * latest COMPLETE reading, and label method + base.
 */
import React from 'react';
import HeroChart from '../../preview/terminal/HeroChart';
import type { MarketData } from '../../hooks/useRayData';
import { SellMark, DepthMark } from '../marks';

function panel(
  title: string,
  method: string,
  headline: React.ReactNode,
  sub: string,
  chart: React.ReactNode,
  mark?: React.ReactNode,
) {
  return (
    <div className="ray-vm ray-vm-card glass glass-quiet">
      <div className="ray-vm-head">
        <span className="ray-vm-title">{mark ? <span className="ray-sect-mark" aria-hidden>{mark}</span> : null}{title}</span>
        <span className="ray-vm-method">{method}</span>
      </div>
      <div style={{ margin: '10px 0 2px' }}>
        <span style={{ fontSize: 26, fontWeight: 550, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>{headline}</span>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>{sub}</span>
      </div>
      {chart}
    </div>
  );
}

export function SellThroughPanel({ marketData, scope }: { marketData: MarketData | null; scope: string }) {
  const series = marketData?.markets?.[scope]?.sellThrough || [];
  if (series.length < 8) return null;
  const win = series.slice(-24);
  const last = win[win.length - 1];
  return panel(
    'Sell-through',
    'sold ÷ offered · quarterly · bought-ins observed, never inferred',
    <>{Math.round(last.value)}%</>,
    `of offered lots found a buyer · ${last.period}`,
    <HeroChart
      anchor={{ key: '_st', label: 'Sell-through', color: '', unit: 'pct', points: win.map(p => ({ period: p.period, value: p.value, n: p.n ?? 0 })) }}
      height={120}
      compact
      hideTickLabels
      play={false}
    />,
    <SellMark size={16} />,
  );
}

export function DepthPanel({ marketData, scope }: { marketData: MarketData | null; scope: string }) {
  const series = marketData?.markets?.[scope]?.volume || [];
  if (series.length < 8) return null;
  // the current quarter is partial — headline the last COMPLETE one
  const win = series.slice(-25, -1);
  if (win.length < 8) return null;
  const last = win[win.length - 1];
  return panel(
    'Market depth',
    'sales per quarter · liquidity, not price · current partial quarter excluded',
    <>{Math.round(last.value).toLocaleString()}</>,
    `sales settled in ${last.period}`,
    <HeroChart
      anchor={{ key: '_vol', label: 'Sales', color: '', unit: 'count', points: win.map(p => ({ period: p.period, value: p.value, n: p.n ?? 0 })) }}
      height={120}
      compact
      hideTickLabels
      play={false}
    />,
    <DepthMark size={16} />,
  );
}
