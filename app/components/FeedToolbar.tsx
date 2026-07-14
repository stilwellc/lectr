'use client';

import { useEffect, useMemo, useState } from 'react';
import { AuctionLot } from '../types';
import { categoryLabels, sportOf } from '../utils';
import { ARTIST_LABEL, MARKETS, marketArtists, Market } from '../constants';

export type FeedSort = 'soonest' | 'gap-desc' | 'newest' | 'est-desc' | 'est-asc';

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
  view,
  onViewChange,
  pageSize = 24,
}: {
  lots: AuctionLot[];          // the unfiltered upcoming pool (for counts)
  belowIds: Set<string>;
  filters: FeedFilters;
  onChange: (next: FeedFilters) => void;
  shown: number;
  total: number;
  market?: Market;
  onMarketReset?: () => void;
  view: 'grid' | 'table';
  onViewChange: (v: 'grid' | 'table') => void;
  pageSize?: number;
}) {
  // Collapse-on-scroll: scrolling down folds the toolbar to one compact row
  // (styled by .ray-toolbar-collapsed); any scroll up re-expands it.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY;
        // small jitters (rubber-banding, sticky reflow) don't flip the state
        if (Math.abs(dy) > 8) {
          setCollapsed(dy > 0 && y > 160);
          lastY = y;
        }
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // total market → the verticals, with live counts
  const verticals = useMemo(() => {
    if (market !== 'all') return [];
    return MARKETS.filter(m => m.live && m.key !== 'all').map(m => {
      const set = marketArtists(m.key);
      return { key: m.key, label: m.label, n: lots.filter(l => set.has(l.artist)).length };
    }).filter(v => v.n > 0);
  }, [lots, market]);

  // inside a vertical → its full roster of makers (art keeps mediums instead:
  // 17 makers is a wall). Zero-count makers stay visible as disabled pills —
  // coverage honesty: "Rolex 0" tells the truth "vanished Rolex" hides.
  const makers = useMemo(() => {
    if (market === 'all' || market === 'art') return [] as [string, number][];
    const c: Record<string, number> = {};
    lots.forEach(l => { c[l.artist] = (c[l.artist] || 0) + 1; });
    return Array.from(marketArtists(market))
      .map(slug => [slug, c[slug] || 0] as [string, number])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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

  // "Newest" only earns a pill once the crawler stamps firstSeen — a sort
  // that can't rank anything is chrome. Read defensively: older data files
  // (and mid-migration types) simply don't carry the field.
  const hasFirstSeen = useMemo(
    () => lots.some(l => Boolean((l as AuctionLot & { firstSeen?: string }).firstSeen)),
    [lots]
  );

  const set = (patch: Partial<FeedFilters>) => onChange({ ...filters, ...patch });
  const isFiltered =
    filters.query !== '' || filters.vertical !== null || filters.maker !== null || filters.sport !== null || filters.category !== null || filters.belowOnly;

  // Chrome earns its keep: a single-page feed (watches' 21 lots) doesn't
  // need sort pills or a view toggle — search + the below-market lens only.
  const showSortChrome = total > pageSize;

  const estActive = filters.sort === 'est-desc' || filters.sort === 'est-asc';

  return (
    <div className={`ray-toolbar${collapsed ? ' ray-toolbar-collapsed' : ''}`} role="search" aria-label="Find lots">
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

        {showSortChrome && (
          <div className="ray-toolbar-sorts" role="radiogroup" aria-label="Sort lots">
            {([
              ['soonest', 'Soonest'],
              ['gap-desc', 'Biggest gap'],
              ...(hasFirstSeen ? ([['newest', 'Newest']] as [FeedSort, string][]) : []),
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
            {/* One Estimate pill: tap to sort by estimate, tap again to flip */}
            <button
              role="radio"
              aria-checked={estActive}
              className="ray-toolbar-pill"
              data-active={estActive}
              onClick={() => set({ sort: estActive ? (filters.sort === 'est-desc' ? 'est-asc' : 'est-desc') : 'est-desc' })}
              aria-label={`Sort by estimate, ${filters.sort === 'est-asc' ? 'lowest' : 'highest'} first`}
            >
              Estimate {filters.sort === 'est-asc' ? '↑' : '↓'}
            </button>
          </div>
        )}

        {showSortChrome && (
          <span className="ray-viewtoggle" role="radiogroup" aria-label="Feed layout">
            <button role="radio" aria-checked={view === 'grid'} aria-label="Card view" data-active={view === 'grid'} onClick={() => onViewChange('grid')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>
            </button>
            <button role="radio" aria-checked={view === 'table'} aria-label="Table view" data-active={view === 'table'} onClick={() => onViewChange('table')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
          </span>
        )}
      </div>

      <div className="ray-toolbar-row ray-toolbar-row-filters ray-markets-fade">
        {/* The signal leads — the one lens that carries the product's claim.
            Toggling it on also ranks by the gap (the old FilmStrip's job);
            toggling it off restores the calendar. */}
        {belowCount > 0 && (
          <>
            <button
              className="ray-toolbar-pill ray-toolbar-pill-signal"
              data-active={filters.belowOnly}
              onClick={() => {
                const on = !filters.belowOnly;
                set({ belowOnly: on, sort: on ? 'gap-desc' : 'soonest' });
              }}
            >
              ● Below market <i>{belowCount}</i>
            </button>
            <span className="ray-toolbar-divider" aria-hidden="true" />
          </>
        )}

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
            disabled={n === 0}
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
