'use client';

import { useMemo } from 'react';
import { AuctionLot } from '../types';
import { categoryLabels, sportOf } from '../utils';
import { ARTIST_LABEL, MARKETS, marketArtists, Market } from '../constants';

export type FeedSort = 'soonest' | 'est-desc' | 'est-asc';

export interface FeedFilters {
  query: string;
  /** on the total market: narrow to one vertical */
  vertical: Market | null;
  /** inside a vertical: narrow to one maker */
  maker: string | null;
  /** sports: narrow to one sport (Soccer, Basketball, …) */
  sport: string | null;
  category: string | null;
  belowOnly: boolean;
  sort: FeedSort;
}

export const FEED_DEFAULTS: FeedFilters = {
  query: '',
  vertical: null,
  maker: null,
  sport: null,
  category: null,
  belowOnly: false,
  sort: 'soonest',
};

/**
 * FeedToolbar — the command bar for the lot book. Search, the below-market
 * lens, sort — and facet pills that mean something for where you're standing:
 * on the total market the pills are the VERTICALS; inside a vertical they're
 * that market's makers (watches/design/science) or its mediums (art), with a
 * one-tap way back to the whole market. Houses were never how anyone shops —
 * they're gone from the pills (search still finds them).
 */
export default function FeedToolbar({
  lots,
  belowIds,
  filters,
  onChange,
  shown,
  total,
  market = 'all',
  onMarketReset,
}: {
  lots: AuctionLot[];          // the unfiltered upcoming pool (for counts)
  belowIds: Set<string>;
  filters: FeedFilters;
  onChange: (next: FeedFilters) => void;
  shown: number;
  total: number;
  market?: Market;
  onMarketReset?: () => void;
}) {
  // total market → the verticals, with live counts
  const verticals = useMemo(() => {
    if (market !== 'all') return [];
    return MARKETS.filter(m => m.live && m.key !== 'all').map(m => {
      const set = marketArtists(m.key);
      return { key: m.key, label: m.label, n: lots.filter(l => set.has(l.artist)).length };
    }).filter(v => v.n > 0);
  }, [lots, market]);

  // inside a vertical → its makers (art keeps mediums instead: 17 makers is a wall)
  const makers = useMemo(() => {
    if (market === 'all' || market === 'art') return [] as [string, number][];
    const c: Record<string, number> = {};
    lots.forEach(l => { c[l.artist] = (c[l.artist] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [lots, market]);

  // sports → which sport (the cut collectors actually shop by)
  const sports = useMemo(() => {
    if (market !== 'sports') return [] as [string, number][];
    const c: Record<string, number> = {};
    lots.forEach(l => { const s = sportOf(l.title) || 'Other'; c[s] = (c[s] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [lots, market]);

  // art → its mediums (the meaningful cut for that market)
  const categories = useMemo(() => {
    if (market !== 'art') return [] as [string, number][];
    const c: Record<string, number> = {};
    lots.forEach(l => { if (l.category !== 'unknown' && l.category !== 'object') c[l.category] = (c[l.category] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [lots, market]);

  const belowCount = useMemo(
    () => lots.filter(l => belowIds.has(l.id)).length,
    [lots, belowIds]
  );

  const set = (patch: Partial<FeedFilters>) => onChange({ ...filters, ...patch });
  const isFiltered =
    filters.query !== '' || filters.vertical !== null || filters.maker !== null || filters.sport !== null || filters.category !== null || filters.belowOnly;

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
            placeholder="Search maker, work, reference…"
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
        {market !== 'all' && onMarketReset && (
          <>
            <button className="ray-toolbar-pill" onClick={onMarketReset}>
              ‹ Total market
            </button>
            <span className="ray-toolbar-divider" aria-hidden="true" />
          </>
        )}

        {verticals.map(v => (
          <button
            key={v.key}
            className="ray-toolbar-pill"
            data-active={filters.vertical === v.key}
            onClick={() => set({ vertical: filters.vertical === v.key ? null : v.key })}
          >
            {v.label} <i>{v.n}</i>
          </button>
        ))}

        {sports.map(([sport, n]) => (
          <button
            key={sport}
            className="ray-toolbar-pill"
            data-active={filters.sport === sport}
            onClick={() => set({ sport: filters.sport === sport ? null : sport })}
          >
            {sport} <i>{n}</i>
          </button>
        ))}

        {sports.length > 0 && makers.length > 0 && <span className="ray-toolbar-divider" aria-hidden="true" />}

        {makers.map(([slug, n]) => (
          <button
            key={slug}
            className="ray-toolbar-pill"
            data-active={filters.maker === slug}
            onClick={() => set({ maker: filters.maker === slug ? null : slug })}
          >
            {ARTIST_LABEL[slug] || slug} <i>{n}</i>
          </button>
        ))}

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
