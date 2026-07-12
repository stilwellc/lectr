'use client';

import React, { useState } from 'react';
import { AuctionLot, MarketStats } from '../types';
import LotCard from './LotCard';
import SectionMark from './SectionMark';

export default function UpcomingLots({
  lots,
  showArtist = false,
  allLots = [],
  stats,
  savedIds = [],
  onToggleSave,
  mark,
  enterDelay = 0,
}: {
  lots: AuctionLot[];
  showArtist?: boolean;
  allLots?: AuctionLot[];
  stats?: MarketStats;
  savedIds?: string[];
  onToggleSave?: (lotId: string) => void;
  /** ghost ordinal behind the h2 band (headers only) */
  mark?: string;
  /** base transition-delay (ms) for the arrival choreography */
  enterDelay?: number;
}) {
  const [visible, setVisible] = useState(48);
  return (
    <section className="ray-upcoming rail">
      <style>{`
        .ray-upcoming { padding-block: 40px 48px; }
        .ray-upcoming-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }
        @media (max-width: 768px) {
          .ray-upcoming { padding-block: 32px 32px; }
          .ray-upcoming-grid {
            grid-template-columns: 1fr;
            gap: 14px;
          }
        }
      `}</style>

      {/* Ghost ordinal clipped to the header band — never under the cards */}
      <div style={{ position: 'relative', overflow: 'hidden', marginBottom: 16 }}>
        {mark && <SectionMark n={mark} style={{ fontSize: 'clamp(96px, 12vw, 150px)' }} />}
        <h2
          className="ray-enter"
          style={{
            '--enter-delay': `${enterDelay}ms`,
            position: 'relative',
            fontFamily: 'var(--font-sans), sans-serif',
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            padding: '16px 0 12px',
          } as React.CSSProperties}
        >
          Upcoming <span style={{ fontStyle: 'normal' }}>lots</span>
        </h2>
      </div>

      <div className="ray-upcoming-grid">
        {lots.slice(0, visible).map((lot, i) => (
          <div
            key={lot.id}
            className="ray-enter-card"
            style={{ '--enter-delay': `${enterDelay + Math.min(i, 8) * 60}ms` } as React.CSSProperties}
          >
            <LotCard
              lot={lot}
              showArtist={showArtist}
              allLots={allLots}
              stats={stats}
              saved={savedIds.includes(lot.id)}
              onToggleSave={onToggleSave}
            />
          </div>
        ))}
      </div>

      {visible < lots.length && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
          <button
            onClick={() => setVisible(v => v + 48)}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 100,
              padding: '10px 32px',
              fontSize: 12,
              letterSpacing: '-0.01em',
              textTransform: 'none',
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans), sans-serif',
              transition: 'border-color var(--duration-fast) var(--ease-signature)',
            }}
          >
            Show more
          </button>
        </div>
      )}
    </section>
  );
}
