'use client';

import { useState } from 'react';
import { AuctionLot, MarketStats } from '../../types';
import CategoryBreakdown from './CategoryBreakdown';
import AuctionHouseDistribution from './AuctionHouseDistribution';
import PriceDistribution from './PriceDistribution';

type Tab = 'category' | 'house' | 'price';

const TAB_META: { key: Tab; label: string; sub: string }[] = [
  { key: 'category', label: 'Category', sub: 'Bars = total sales value · dots below = share of lots' },
  { key: 'house', label: 'House', sub: 'Ranked by total sales value' },
  { key: 'price', label: 'Price', sub: 'Sold lots by price bracket' },
];

/**
 * Distributions — the three how-the-market-splits charts (category, auction
 * house, price bracket) folded into one section: a small tab row renders one
 * chart at a time instead of stacking three full-height sections.
 */
export default function Distributions({ allLots, statsByArtist }: {
  allLots: AuctionLot[];
  statsByArtist: Record<string, MarketStats>;
}) {
  const [tab, setTab] = useState<Tab>('category');
  const active = TAB_META.find(t => t.key === tab)!;

  return (
    <section className="ray-distributions rail">
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
        @media (max-width: 768px) {
          .ray-distributions { padding-block: 32px 32px; }
        }
      `}</style>

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
          {TAB_META.map(t => (
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

      {tab === 'category' && <CategoryBreakdown allLots={allLots} embedded />}
      {tab === 'house' && <AuctionHouseDistribution statsByArtist={statsByArtist} embedded />}
      {tab === 'price' && <PriceDistribution allLots={allLots} embedded />}
    </section>
  );
}
