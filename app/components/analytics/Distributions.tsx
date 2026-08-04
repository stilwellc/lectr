'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AuctionLot, MarketStats } from '../../types';
import type { Market } from '../../constants';
import type { MarketSeriesJson } from '../../hooks/useRayData';

// These four distribution charts are recharts-backed and BELOW the fold (this
// whole section lives well under the analytics hero) — and only ONE renders at
// a time behind the tab row. Dynamic-import them (ssr:false — this is a static
// export, the charts are client-only) so recharts leaves the analytics page's
// initial bundle and only the active tab's chart pulls it. A fixed-height
// skeleton holds the band's height so switching tabs never shifts layout.
const ChartSkeleton = ({ h }: { h: number }) => (
  <div className="ray-chart-skel" style={{ height: h }} aria-hidden />
);
const CategoryBreakdown = dynamic(() => import('./CategoryBreakdown'), { ssr: false, loading: () => <ChartSkeleton h={300} /> });
const AuctionHouseDistribution = dynamic(() => import('./AuctionHouseDistribution'), { ssr: false, loading: () => <ChartSkeleton h={300} /> });
const PriceDistribution = dynamic(() => import('./PriceDistribution'), { ssr: false, loading: () => <ChartSkeleton h={280} /> });
const SportBreakdown = dynamic(() => import('./SportBreakdown'), { ssr: false, loading: () => <ChartSkeleton h={300} /> });

type Tab = 'category' | 'house' | 'price' | 'sport';

const TAB_META: { key: Tab; label: string; sub: string }[] = [
  { key: 'category', label: 'Category', sub: 'Bars = total sales value · dots below = lot counts' },
  { key: 'house', label: 'House', sub: 'Ranked by total sales value' },
  { key: 'price', label: 'Price', sub: 'Sold lots by price bracket' },
  // sports market only — sold value ranked by sport (realized, no estimates)
  { key: 'sport', label: 'Sport', sub: 'Sold value ranked by sport' },
];

/**
 * Distributions — the how-the-market-splits charts (category, auction house,
 * price bracket — plus sport, on the sports market only) folded into one
 * section: a small tab row renders one chart at a time instead of stacking
 * full-height sections.
 */
export default function Distributions({ allLots, statsByArtist, market, series }: {
  allLots: AuctionLot[];
  statsByArtist: Record<string, MarketStats>;
  market?: Market;
  series?: MarketSeriesJson | null;
}) {
  const an = series?.analytics;
  const [rawTab, setTab] = useState<Tab>('category');
  // ≤768px the section folds behind a disclosure header — CSS-gated only,
  // the desktop DOM stays eager and identical. Collapsed is the default.
  const [open, setOpen] = useState(false);
  const tabs = TAB_META.filter(t => t.key !== 'sport' || market === 'sports');
  // if the market switches away from sports while the Sport tab is up, fall
  // back to the first tab rather than rendering a blank band
  const tab: Tab = tabs.some(t => t.key === rawTab) ? rawTab : 'category';
  const active = tabs.find(t => t.key === tab)!;

  // the disclosure's headline stat — how many sold lots the charts count.
  // Prefer the build-time full-corpus histogram's base: on sample verticals
  // (sports/science) the loaded array badly undercounts what the charts show.
  const soldN = useMemo(() => {
    const pb = an?.priceBuckets;
    if (pb?.length) return pb.reduce((s, b) => s + b.count, 0);
    return allLots.filter(l => l.status === 'sold' && l.priceUsd).length;
  }, [an, allLots]);

  return (
    <section className="ray-distributions rail" data-open={open}>
      <style>{`
        .ray-distributions { padding-block: 40px 48px; }
        .ray-dist-tab {
          font-family: var(--font-sans), sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: -0.01em;
          padding: 6px 16px;
          border-radius: 100px;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
          transition: border-color var(--duration-fast) var(--ease-signature), color var(--duration-fast) var(--ease-signature), background var(--duration-fast) var(--ease-signature);
        }
        .ray-dist-tab:hover {
          border-color: var(--color-border-mid);
          color: var(--color-fg);
        }
        /* Quote-free selector on purpose - quotes in server-rendered style
           text get HTML-escaped and break hydration. */
        .ray-dist-tab[data-active=true] {
          background: var(--color-fg);
          border-color: var(--color-fg);
          color: var(--color-bg);
        }
        .ray-chart-skel {
          width: 100%;
          border-radius: 10px;
          background: linear-gradient(90deg, var(--color-surface) 0%, var(--color-surface-hover, var(--color-surface)) 50%, var(--color-surface) 100%);
          opacity: 0.6;
        }
        /* the mobile disclosure — TopSales' exact grammar (its .ray-disc
           ruleset is page-global once TopSales mounts, but declare the core
           here too so Distributions stands alone) */
        .ray-dist-disc {
          display: none;
          width: 100%;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 2px;
          border-top: 1px solid var(--hairline);
          border-bottom: 1px solid var(--hairline);
          background: none; border-left: none; border-right: none;
          font-family: var(--font-sans), sans-serif;
          color: var(--color-fg);
          cursor: pointer;
          text-align: left;
        }
        .ray-dist-disc-t { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
        .ray-dist-disc-stat {
          font-family: var(--font-mono), monospace;
          font-size: 11.5px; color: var(--color-text-muted);
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .ray-dist-chev { flex-shrink: 0; align-self: center; color: var(--color-text-faint); transition: transform var(--duration-fast) var(--ease-signature); }
        .ray-dist-disc[aria-expanded=true] .ray-dist-chev { transform: rotate(180deg); }
        @media (max-width: 768px) {
          .ray-distributions { padding-block: 18px 18px; }
          .ray-distributions[data-open=true] { padding-block: 18px 32px; }
          .ray-dist-disc { display: flex; }
          .ray-dist-body[data-open=false] { display: none; }
          /* the disclosure header owns the title on mobile */
          .ray-dist-body h2 { display: none; }
          .ray-dist-body { margin-top: 16px; }
        }
      `}</style>

      <button
        type="button"
        className="ray-dist-disc"
        aria-expanded={open}
        aria-controls="ray-dist-body"
        onClick={() => setOpen(o => !o)}
      >
        <span className="ray-dist-disc-t">Distributions</span>
        <span className="ray-dist-disc-stat">{soldN.toLocaleString()} sold lots counted</span>
        <svg className="ray-dist-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="ray-dist-body" id="ray-dist-body" data-open={open}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-sans), sans-serif',
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}>
            Distri<span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>butions</span>
          </h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>{active.sub}</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }} role="tablist" aria-label="Distribution view">
          {tabs.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className="ray-dist-tab"
              data-active={tab === t.key ? 'true' : 'false'}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'category' && <CategoryBreakdown allLots={allLots} data={an?.categoryBreakdown} />}
      {tab === 'house' && <AuctionHouseDistribution statsByArtist={statsByArtist} />}
      {tab === 'price' && <PriceDistribution allLots={allLots} buckets={an?.priceBuckets} />}
      {tab === 'sport' && <SportBreakdown allLots={allLots} data={an?.sportBreakdown} />}
      </div>
    </section>
  );
}
