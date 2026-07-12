'use client';

import { useMemo } from 'react';
import { AuctionLot } from '../types';
import { categoryLabels } from '../utils';

export type FeedSort = 'soonest' | 'est-desc' | 'est-asc';

export interface FeedFilters {
  query: string;
  house: string | null;
  category: string | null;
  belowOnly: boolean;
  sort: FeedSort;
}

export const FEED_DEFAULTS: FeedFilters = {
  query: '',
  house: null,
  category: null,
  belowOnly: false,
  sort: 'soonest',
};

/**
 * FeedToolbar — the command bar for the lot feed. Search, one-tap house and
 * category filters (only values actually present, with live counts), a
 * below-market lens, and sort. Sticky under the site nav so the tools travel
 * with the reader. Styling lives in globals.css (.ray-toolbar*).
 */
export default function FeedToolbar({
  lots,
  belowIds,
  filters,
  onChange,
  shown,
  total,
}: {
  lots: AuctionLot[];          // the unfiltered upcoming pool (for counts)
  belowIds: Set<string>;
  filters: FeedFilters;
  onChange: (next: FeedFilters) => void;
  shown: number;
  total: number;
}) {
  const houses = useMemo(() => {
    const c: Record<string, number> = {};
    lots.forEach(l => { c[l.auctionHouse] = (c[l.auctionHouse] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [lots]);

  const categories = useMemo(() => {
    const c: Record<string, number> = {};
    lots.forEach(l => { if (l.category !== 'unknown') c[l.category] = (c[l.category] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [lots]);

  const belowCount = useMemo(
    () => lots.filter(l => belowIds.has(l.id)).length,
    [lots, belowIds]
  );

  const set = (patch: Partial<FeedFilters>) => onChange({ ...filters, ...patch });
  const isFiltered =
    filters.query !== '' || filters.house !== null || filters.category !== null || filters.belowOnly;

  return (
    <div className="ray-toolbar" role="search" aria-label="Find lots">
      <div className="ray-toolbar-row">
        <div className="ray-toolbar-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.8-3.8" />
          </svg>
          <input
            type="search"
            value={filters.query}
            onChange={e => set({ query: e.target.value })}
            placeholder="Search artist, work, house…"
            aria-label="Search lots"
          />
          {filters.query && (
            <button className="ray-toolbar-clearq" onClick={() => set({ query: '' })} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        <div className="ray-toolbar-sorts" role="radiogroup" aria-label="Sort lots">
          {([
            ['soonest', 'Soonest'],
            ['est-desc', 'Estimate ↓'],
            ['est-asc', 'Estimate ↑'],
          ] as [FeedSort, string][]).map(([key, label]) => (
            <button
              key={key}
              role="radio"
              aria-checked={filters.sort === key}
              className="ray-toolbar-pill"
              data-active={filters.sort === key}
              onClick={() => set({ sort: key })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ray-toolbar-row ray-toolbar-row-filters">
        {houses.map(([house, n]) => (
          <button
            key={house}
            className="ray-toolbar-pill"
            data-active={filters.house === house}
            onClick={() => set({ house: filters.house === house ? null : house })}
          >
            {house} <i>{n}</i>
          </button>
        ))}

        {categories.length > 1 && <span className="ray-toolbar-divider" aria-hidden="true" />}

        {categories.map(([cat, n]) => (
          <button
            key={cat}
            className="ray-toolbar-pill"
            data-active={filters.category === cat}
            onClick={() => set({ category: filters.category === cat ? null : cat })}
          >
            {categoryLabels[cat] || cat} <i>{n}</i>
          </button>
        ))}

        {belowCount > 0 && (
          <>
            <span className="ray-toolbar-divider" aria-hidden="true" />
            <button
              className="ray-toolbar-pill ray-toolbar-pill-signal"
              data-active={filters.belowOnly}
              onClick={() => set({ belowOnly: !filters.belowOnly })}
            >
              ● Below market <i>{belowCount}</i>
            </button>
          </>
        )}

        <span className="ray-toolbar-count">
          {isFiltered ? (
            <>
              {shown.toLocaleString()} of {total.toLocaleString()}
              <button className="ray-toolbar-reset" onClick={() => onChange({ ...FEED_DEFAULTS, sort: filters.sort })}>
                Clear
              </button>
            </>
          ) : (
            <>{total.toLocaleString()} lots</>
          )}
        </span>
      </div>
    </div>
  );
}
