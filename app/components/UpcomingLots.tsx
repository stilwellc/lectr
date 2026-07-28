'use client';

import React, { useMemo, useState } from 'react';
import { AuctionLot, MarketStats } from '../types';
import { marketOf } from '../constants';
import LotCard from './LotCard';
import SectionMark from './SectionMark';

const COLLAPSED_CARDS = 12;

/** a lot's asking level for the price sort — estimate mid, else any bound,
 *  else the tracked bid */
function askOf(l: AuctionLot): number {
  if (l.estimateLow && l.estimateHigh) return (l.estimateLow + l.estimateHigh) / 2;
  return l.estimateLow || l.estimateHigh || l.priceUsd || 0;
}

export default function UpcomingLots({
  lots,
  showArtist = false,
  allLots = [],
  stats,
  savedIds = [],
  onToggleSave,
  mark,
  enterDelay = 0,
  lastCrawl,
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
  /** the last crawl's ISO date — lets cards mark lots first seen today */
  lastCrawl?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'price'>('date');
  const [sportFilter, setSportFilter] = useState<string>('all');

  // SPORT chips — derived from the data, so they appear automatically when it
  // supports them: every lot is a sports-vertical lot AND >=2 distinct sports
  // exist (a null sport files under "Other"). [sport, count] pairs, biggest
  // sport first, Other pinned last.
  const sportGroups = useMemo(() => {
    if (!lots.length || !lots.every(l => marketOf(l.artist) === 'sports')) return null;
    const counts = new Map<string, number>();
    for (const l of lots) counts.set(l.sport || 'Other', (counts.get(l.sport || 'Other') || 0) + 1);
    if (counts.size < 2) return null;
    return Array.from(counts.entries()).sort((a, b) =>
      a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : b[1] - a[1]);
  }, [lots]);

  const bySport = useMemo(
    () => (sportGroups && sportFilter !== 'all' ? lots.filter(l => (l.sport || 'Other') === sportFilter) : lots),
    [lots, sportGroups, sportFilter]
  );

  // 'date' keeps the caller's order (the page already sorts by sale date);
  // 'price' ranks by estimate mid, highest ask first
  const sorted = useMemo(
    () => (sortBy === 'price' ? [...bySport].sort((a, b) => askOf(b) - askOf(a)) : bySport),
    [bySport, sortBy]
  );
  const shown = expanded ? sorted : sorted.slice(0, COLLAPSED_CARDS);

  return (
    <section className="ray-upcoming rail">
      {/* __html, not a text child: this CSS carries a '>' child combinator,
          which React entity-escapes in SSR text while the browser leaves
          <style> raw text undecoded — a hydration mismatch whenever this
          ships in prerendered HTML. RecordBand's pattern. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .ray-upcoming { padding-block: var(--sect-t) var(--sect-b); }
        .ray-upcoming-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }
        /* grid children must be allowed to shrink below their content's
           intrinsic width — without this, one long nowrap line inflates the
           whole page past the viewport on mobile */
        .ray-upcoming-grid > * { min-width: 0; }
        .ray-upcoming .ray-sort-pill {
          font-family: var(--font-sans), sans-serif;
          font-size: 12.5px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 6px 16px;
          border-radius: 100px;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
          transition: border-color var(--duration-fast) var(--ease-signature), color var(--duration-fast) var(--ease-signature), background var(--duration-fast) var(--ease-signature);
        }
        .ray-upcoming .ray-sort-pill:hover {
          border-color: var(--color-border-mid);
          color: var(--color-fg);
        }
        /* Quote-free selector on purpose - quotes in server-rendered style
           text get HTML-escaped and break hydration. */
        .ray-upcoming .ray-sort-pill[data-active=true] {
          background: var(--color-fg);
          border-color: var(--color-fg);
          color: var(--color-bg);
        }
        .ray-upcoming .ray-sport-chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin: -2px 0 20px;
        }
        /* chip counts — the toolbar-pill count grammar (mono, faint, upright) */
        .ray-upcoming .ray-sport-chips .ray-sort-pill i {
          font-style: normal;
          font-family: var(--font-mono), monospace;
          font-size: 10px;
          color: var(--color-text-faint);
          letter-spacing: 0;
        }
        .ray-upcoming .ray-sport-chips .ray-sort-pill[data-active=true] i {
          color: color-mix(in srgb, var(--color-bg) 72%, transparent);
        }
        @media (max-width: 768px) {
          .ray-upcoming { padding-block: var(--sect-t) var(--sect-b); }
          .ray-upcoming-grid {
            grid-template-columns: 1fr;
            gap: 14px;
          }
        }
      ` }} />

      {/* Ghost ordinal clipped to the header band — never under the cards */}
      <div style={{ position: 'relative', overflow: 'hidden', marginBottom: 16 }}>
        {mark && <SectionMark n={mark} style={{ fontSize: 'clamp(96px, 12vw, 150px)' }} />}
        <div
          className="ray-enter"
          style={{
            '--enter-delay': `${enterDelay}ms`,
            position: 'relative',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            padding: '16px 0 12px',
          } as React.CSSProperties}
        >
          <h2 style={{
            fontFamily: 'var(--font-serif), serif',
            fontSize: 24,
            fontWeight: 400,
            letterSpacing: '-0.015em',
          }}>
            Upcoming <span style={{ fontStyle: 'normal' }}>lots</span>
          </h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="ray-sort-pill"
              data-active={sortBy === 'date' ? 'true' : 'false'}
              onClick={() => setSortBy('date')}
            >
              Date
            </button>
            <button
              className="ray-sort-pill"
              data-active={sortBy === 'price' ? 'true' : 'false'}
              onClick={() => setSortBy('price')}
            >
              Price
            </button>
          </div>
        </div>
      </div>

      {sportGroups && (
        <div className="ray-sport-chips" role="radiogroup" aria-label="Filter by sport">
          <button
            className="ray-sort-pill"
            role="radio"
            aria-checked={sportFilter === 'all'}
            data-active={sportFilter === 'all' ? 'true' : 'false'}
            onClick={() => setSportFilter('all')}
          >
            All
          </button>
          {sportGroups.map(([sport, n]) => (
            <button
              key={sport}
              className="ray-sort-pill"
              role="radio"
              aria-checked={sportFilter === sport}
              data-active={sportFilter === sport ? 'true' : 'false'}
              onClick={() => setSportFilter(sport)}
            >
              {sport} <i>{n}</i>
            </button>
          ))}
        </div>
      )}

      <div className="ray-upcoming-grid">
        {shown.map((lot, i) => (
          <div
            key={lot.id}
            className="ray-enter-card"
            style={{ '--enter-delay': `${enterDelay + Math.min(i, 8) * 60}ms` } as React.CSSProperties}
          >
            <LotCard
              lot={lot}
              showArtist={showArtist}
              allLots={allLots}
              saved={savedIds.includes(lot.id)}
              onToggleSave={onToggleSave}
              lastCrawl={lastCrawl}
            />
          </div>
        ))}
      </div>

      {!expanded && sorted.length > COLLAPSED_CARDS && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
          <button
            onClick={() => setExpanded(true)}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 100,
              padding: '10px 32px',
              fontSize: 12.5,
              letterSpacing: '-0.01em',
              textTransform: 'none',
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans), sans-serif',
              transition: 'border-color var(--duration-fast) var(--ease-signature)',
            }}
          >
            Show all {sorted.length}
          </button>
        </div>
      )}
    </section>
  );
}
