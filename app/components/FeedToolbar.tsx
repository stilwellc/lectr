'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { AuctionLot } from '../types';
import { categoryLabels, sportOf } from '../utils';
import { ARTIST_LABEL, MARKETS, marketArtists, Market } from '../constants';
import Flick from './Flick';
import SaveSearch from './SaveSearch';

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
  /** the Hammer Week strip's lens: one hammer day (YYYY-MM-DD) */
  saleDay?: string | null;
}

export const FEED_DEFAULTS: FeedFilters = {
  query: '',
  vertical: null,
  maker: null,
  sport: null,
  category: null,
  belowOnly: false,
  sort: 'soonest',
  saleDay: null,
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
  showToggle = true,
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
  /** false hides the card/table toggle (sub-640px: the table is thumb+name
   *  with unhinted side-scroll — not a real choice on a phone) */
  showToggle?: boolean;
}) {
  // The below-market lens auto-ranks by gap (its smart default) — but it must
  // hand back whatever sort the reader had picked when the lens comes off,
  // not force-reset to 'soonest'.
  const preLensSort = useRef<FeedSort>(FEED_DEFAULTS.sort);

  // A vertical chosen via the feed chooser must behave exactly like one
  // chosen via the top pills — the refine memos key off this, not `market`.
  const effectiveMarket = market !== 'all' ? market : (filters.vertical ?? 'all');

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
    if (effectiveMarket === 'all' || effectiveMarket === 'art') return [] as [string, number][];
    const c: Record<string, number> = {};
    lots.forEach(l => { c[l.artist] = (c[l.artist] || 0) + 1; });
    return Array.from(marketArtists(effectiveMarket))
      .map(slug => [slug, c[slug] || 0] as [string, number])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [lots, effectiveMarket]);

  // sports → which sport (the cut collectors actually shop by)
  const sports = useMemo(() => {
    if (effectiveMarket !== 'sports') return [] as [string, number][];
    const c: Record<string, number> = {};
    lots.forEach(l => { const s = sportOf(l.title) || 'Other'; c[s] = (c[s] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [lots, effectiveMarket]);

  // art → its mediums (the meaningful cut for that market)
  const categories = useMemo(() => {
    if (effectiveMarket !== 'art') return [] as [string, number][];
    const c: Record<string, number> = {};
    lots.forEach(l => { if (l.category !== 'unknown' && l.category !== 'object') c[l.category] = (c[l.category] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [lots, effectiveMarket]);

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

  // MOBILE (<768px): the desktop pill spread is honest work on a wide row and
  // pure noise on a phone. Under 768 the toolbar collapses to search + ONE
  // lead row (lens · category · "Sort & filter") and everything else moves
  // into a bottom sheet. matchMedia lives in an effect, never a useState
  // initializer — the SSR pass must render the desktop markup both sides.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetReturnRef = useRef<HTMLElement | null>(null);
  const openSheet = (e: ReactMouseEvent<HTMLButtonElement>) => {
    sheetReturnRef.current = e.currentTarget;
    setSheetOpen(true);
  };
  const closeSheet = () => {
    setSheetOpen(false);
    sheetReturnRef.current?.focus();
  };
  useEffect(() => {
    if (!sheetOpen) return;
    sheetRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSheetOpen(false);
        sheetReturnRef.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    // lock the page behind the sheet (same discipline as the nav sheet)
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  const [catOpen, setCatOpen] = useState(false);
  const catTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [catPos, setCatPos] = useState<{ top: number; left: number } | null>(null);
  const openCat = () => {
    const r = catTriggerRef.current?.getBoundingClientRect();
    if (r) setCatPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 240) });
    setCatOpen(true);
  };
  useEffect(() => {
    if (!catOpen) return;
    const close = () => setCatOpen(false);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // NO scroll-close: it killed the menu the instant anything scrolled an
    // item into view (keyboard nav, tap-scroll, automation) — the menu is
    // position:fixed, so a page scroll just leaves it anchored. Escape,
    // outside-click and resize are the honest dismissals.
    document.addEventListener('keydown', key);
    document.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('click', close);
      window.removeEventListener('resize', close);
    };
  }, [catOpen]);
  // PORTALED to <body>: the toolbar rows scroll and carry a fade mask — an
  // absolute child in there gets clipped/masked (the original sin of v1).
  const catMenu = catOpen && catPos && typeof document !== 'undefined' ? createPortal(
    <div
      role="menu"
      aria-label="Categories"
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: catPos.top, left: catPos.left, zIndex: 60, minWidth: 224,
        background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)',
        borderRadius: 10, padding: 6, boxShadow: '0 14px 34px -18px rgba(8,6,3,0.85)',
      }}
    >
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--color-text-muted)', padding: '6px 10px 7px', borderBottom: '1px solid var(--hairline)', marginBottom: 4 }}>
        The categories
      </div>
      {verticals.map(v => (
        <button
          key={v.key}
          role="menuitem"
          className="ray-toolbar-pill"
          data-active={filters.vertical === v.key}
          style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: 2 }}
          onClick={() => { set({ vertical: filters.vertical === v.key ? null : v.key, maker: null, sport: null, category: null }); setCatOpen(false); }}
        >
          {v.label} <i>{v.n}</i>
        </button>
      ))}
      {filters.vertical != null && (
        <button
          role="menuitem"
          className="ray-toolbar-pill"
          style={{ display: 'flex', width: '100%', justifyContent: 'flex-start', marginTop: 2, color: 'var(--color-text-muted)' }}
          onClick={() => { set({ vertical: null, maker: null, sport: null, category: null }); setCatOpen(false); }}
        >
          All categories
        </button>
      )}
    </div>,
    document.body
  ) : null;
  const isFiltered =
    filters.query !== '' || filters.vertical !== null || filters.maker !== null || filters.sport !== null || filters.category !== null || filters.belowOnly || filters.saleDay != null;

  // Chrome earns its keep: a single-page feed (watches' 21 lots) doesn't
  // need sort pills or a view toggle — search + the below-market lens only.
  const showSortChrome = total > pageSize;

  const estActive = filters.sort === 'est-desc' || filters.sort === 'est-asc';

  // The sheet trigger's badge counts what the sheet itself changed: a
  // non-default sort + any refine facet. The lens's auto gap-sort does NOT
  // count — the green pill already announces that state; double-lighting
  // the badge for it would be noise. The vertical doesn't count either: the
  // category chip in the lead row is its own announcement.
  const sortTouched =
    filters.sort !== FEED_DEFAULTS.sort && !(filters.belowOnly && filters.sort === 'gap-desc');
  const sheetActiveCount =
    (sortTouched ? 1 : 0) +
    (filters.sport !== null ? 1 : 0) +
    (filters.maker !== null ? 1 : 0) +
    (filters.category !== null ? 1 : 0);
  const sheetHasContent =
    showSortChrome ||
    sports.length > 0 || makers.length > 0 || categories.length > 0 ||
    (market === 'all' && verticals.length > 0);

  // THE SHEET — everything the desktop pill rows say, said once, at thumb
  // height. Same state, same handlers: nothing here duplicates `filters`.
  // Certificate language: microcap section heads, wrapping chip rows, a
  // butter "Done". Portaled to body (toolbar rows mask/scroll; ancestors
  // with backdrop-filter would trap position:fixed).
  const sheet = sheetOpen && typeof document !== 'undefined' ? createPortal(
    <div className="ray-feedsheet-scrim" role="presentation" onClick={closeSheet}>
      <div
        ref={sheetRef}
        className="ray-feedsheet"
        role="dialog"
        aria-modal="true"
        aria-label="Sort and filter"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="ray-feedsheet-grip" aria-hidden="true" />
        <div className="ray-feedsheet-body">
          {showSortChrome && (
            <>
              <div className="ray-feedsheet-head">Sort</div>
              <div className="ray-feedsheet-chips" role="radiogroup" aria-label="Sort lots">
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
                <button
                  role="radio"
                  aria-checked={estActive}
                  className="ray-toolbar-pill"
                  data-active={estActive}
                  onClick={() => set({ sort: estActive ? (filters.sort === 'est-desc' ? 'est-asc' : 'est-desc') : 'est-desc' })}
                  aria-label={`Sort by estimate, ${filters.sort === 'est-asc' ? 'lowest' : 'highest'} first`}
                >
                  Estimate {filters.sort === 'est-asc' ? <Flick size={10} /> : <Flick size={10} style={{ transform: 'scaleY(-1)' }} />}
                </button>
              </div>
            </>
          )}
          {market === 'all' && verticals.length > 0 && (
            <>
              <div className="ray-feedsheet-head">Category</div>
              <div className="ray-feedsheet-chips">
                {verticals.map(v => (
                  <button
                    key={v.key}
                    className="ray-toolbar-pill ray-feedsheet-catpill"
                    data-active={filters.vertical === v.key}
                    aria-pressed={filters.vertical === v.key}
                    // selecting does NOT close the sheet — pick a category,
                    // watch Refine fill in below, keep composing
                    onClick={() => set({ vertical: filters.vertical === v.key ? null : v.key, maker: null, sport: null, category: null })}
                  >
                    {v.label} <i>{v.n}</i>
                  </button>
                ))}
                {filters.vertical != null && (
                  <button
                    className="ray-toolbar-pill"
                    style={{ color: 'var(--color-text-muted)' }}
                    onClick={() => set({ vertical: null, maker: null, sport: null, category: null })}
                  >
                    All categories
                  </button>
                )}
              </div>
            </>
          )}
          {(sports.length > 0 || makers.length > 0 || categories.length > 0) && (
            <>
              <div className="ray-feedsheet-head">Refine</div>
              <div className="ray-feedsheet-chips">
                {sports.map(([sport, n]) => (
                  <button
                    key={sport}
                    className="ray-toolbar-pill"
                    data-active={filters.sport === sport}
                    aria-pressed={filters.sport === sport}
                    onClick={() => set({ sport: filters.sport === sport ? null : sport })}
                  >
                    {sport} <i>{n}</i>
                  </button>
                ))}
                {makers.map(([slug, n]) => (
                  <button
                    key={slug}
                    className="ray-toolbar-pill"
                    data-active={filters.maker === slug}
                    aria-pressed={filters.maker === slug}
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
                    aria-pressed={filters.category === cat}
                    onClick={() => set({ category: filters.category === cat ? null : cat })}
                  >
                    {categoryLabels[cat] || cat} <i>{n}</i>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="ray-feedsheet-foot">
          <button
            className="ray-feedsheet-clear"
            // the exact Clear behavior the count line uses: back to defaults,
            // the reader's sort survives
            onClick={() => onChange({ ...FEED_DEFAULTS, sort: filters.sort })}
          >
            Clear all
          </button>
          <button className="ray-feedsheet-done" onClick={closeSheet}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="ray-toolbar" role="search" aria-label="Find lots">
      {/* hydration-safe scoped styles — NEVER a raw-text style child */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes rayFeedScrimIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rayFeedSheetUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
        .ray-feedsheet-scrim {
          position: fixed; inset: 0; z-index: 300;
          background: rgba(15, 14, 10, 0.62);
          -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
          animation: rayFeedScrimIn 160ms var(--ease-signature) both;
        }
        .ray-feedsheet {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 301;
          display: flex; flex-direction: column;
          max-height: 76dvh;
          background: var(--color-bg-elevated);
          border: 1px solid var(--color-border); border-bottom: none;
          border-radius: 18px 18px 0 0;
          animation: rayFeedSheetUp 240ms var(--ease-signature) both;
          outline: none;
        }
        .ray-feedsheet-grip {
          width: 36px; height: 4px; border-radius: 2px; flex: none;
          background: var(--color-border-mid);
          margin: 10px auto 2px;
        }
        .ray-feedsheet-body {
          flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          padding: 4px 18px 16px;
        }
        .ray-feedsheet-head {
          font-family: var(--font-sans), sans-serif;
          font-size: 10.5px; font-weight: 700;
          letter-spacing: 0.16em; text-transform: uppercase;
          color: var(--color-text-muted);
          padding: 16px 2px 10px;
        }
        .ray-feedsheet-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .ray-feedsheet-chips .ray-toolbar-pill { min-height: 38px; }
        .ray-feedsheet-catpill[data-active=true] {
          background: var(--color-butter);
          border-color: var(--color-butter);
          color: var(--color-butter-ink, #1C1712);
        }
        .ray-feedsheet-catpill[data-active=true] i { color: color-mix(in srgb, var(--color-butter-ink, #1C1712) 62%, transparent); }
        .ray-feedsheet-foot {
          flex: none; display: flex; align-items: center; gap: 12px;
          padding: 12px 18px calc(14px + env(safe-area-inset-bottom, 0px));
          border-top: 1px solid var(--color-border);
        }
        .ray-feedsheet-clear {
          border: none; background: none; cursor: pointer;
          font-family: var(--font-sans), sans-serif;
          font-size: 14px; font-weight: 600;
          color: var(--color-text-muted);
          padding: 12px 10px; min-height: 44px;
        }
        .ray-feedsheet-clear:hover { color: var(--color-fg); }
        .ray-feedsheet-done {
          flex: 1; border: none; cursor: pointer;
          background: var(--color-butter);
          color: var(--color-butter-ink, #1C1712);
          font-family: var(--font-sans), sans-serif;
          font-size: 15px; font-weight: 700;
          border-radius: 12px; padding: 13px 16px; min-height: 46px;
        }
        .ray-feedsheet-done:active { filter: brightness(0.96); }
        @media (max-width: 767px) {
          /* the one lead row breathes a little tighter so lens + category +
             sort-and-filter sit on a single line at 390px */
          .ray-toolbar-row-lead { gap: 5px !important; }
          .ray-toolbar-row-lead > .ray-toolbar-pill { padding-left: 10px; padding-right: 10px; font-size: 12.5px; gap: 5px; }
          .ray-toolbar-row-lead .ray-toolbar-divider { display: none; }
        }
      ` }} />
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
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {showSortChrome && !isMobile && (
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
              Estimate {filters.sort === 'est-asc' ? <Flick size={10} /> : <Flick size={10} style={{ transform: 'scaleY(-1)' }} />}
            </button>
          </div>
        )}

        {showSortChrome && showToggle && !isMobile && (
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

      {/* LEAD ROW — never scrolled, never masked: the signal lens + the
          category control live here so they are always visible and the
          portal menu can never be clipped (v1 rendered it inside the masked
          scroll row — invisible; the trigger also scrolled away on mobile). */}
      <div className="ray-toolbar-row ray-toolbar-row-lead" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {belowCount > 0 && (
          <>
            <button
              className="ray-toolbar-pill ray-toolbar-pill-signal"
              data-active={filters.belowOnly}
              onClick={() => {
                const on = !filters.belowOnly;
                if (on) {
                  // remember what the reader had, then rank by the gap
                  preLensSort.current = filters.sort;
                  set({ belowOnly: true, sort: 'gap-desc' });
                } else {
                  // lens off: restore the pre-lens sort — unless the reader
                  // explicitly re-sorted while inside the lens (keep that)
                  set({ belowOnly: false, sort: filters.sort === 'gap-desc' ? preLensSort.current : filters.sort });
                }
              }}
            >
              ● Below market <i>{belowCount}</i>
            </button>
            <span className="ray-toolbar-divider" aria-hidden="true" />
          </>
        )}

        {market === 'all' && verticals.length > 0 && filters.vertical == null && (
          <button
            ref={catTriggerRef}
            className="ray-toolbar-pill ray-cat-pill-primary"
            aria-haspopup={isMobile ? 'dialog' : 'menu'}
            aria-expanded={isMobile ? sheetOpen : catOpen}
            // ONE coherent mobile behavior: every category tap opens the
            // SHEET (its Category section) — the little floating menu is a
            // pointer instrument; on a phone all composing happens in one
            // place, thumb-height.
            onClick={e => { e.stopPropagation(); if (isMobile) { openSheet(e); return; } catOpen ? setCatOpen(false) : openCat(); }}
          >
            {isMobile ? 'Category' : 'Choose a category'} <Flick size={10} style={{ transform: 'rotate(90deg)' }} />
          </button>
        )}
        {market === 'all' && filters.vertical != null && (() => {
          const v = verticals.find(x => x.key === filters.vertical);
          return (
            <>
              <button
                className="ray-toolbar-pill"
                data-active
                // mobile: the chip opens the sheet like every other category
                // tap (clearing lives in the sheet — All categories / Clear
                // all); desktop keeps its one-tap clear
                aria-haspopup={isMobile ? 'dialog' : undefined}
                aria-expanded={isMobile ? sheetOpen : undefined}
                title={isMobile ? 'Change category' : 'Clear category'}
                onClick={e => { if (isMobile) { e.stopPropagation(); openSheet(e); return; } set({ vertical: null, maker: null, sport: null, category: null }); }}
              >
                {v ? v.label : filters.vertical} {v && <i>{v.n}</i>}
              </button>
              {!isMobile && (
                <button ref={catTriggerRef} className="ray-toolbar-pill ray-cat-pill" aria-haspopup="menu" aria-expanded={catOpen} onClick={e => { e.stopPropagation(); catOpen ? setCatOpen(false) : openCat(); }}>
                  Change category
                </button>
              )}
            </>
          );
        })()}
        {market !== 'all' && onMarketReset && (
          <button className="ray-toolbar-pill" onClick={onMarketReset}>
            <Flick size={10} style={{ transform: 'scaleX(-1)', marginLeft: 0, marginRight: 5 }} /> Total market
          </button>
        )}
        {isMobile && sheetHasContent && (
          <button
            className="ray-toolbar-pill ray-feedsheet-trigger"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={openSheet}
          >
            Sort &amp; filter{sheetActiveCount > 0 && <i>{sheetActiveCount}</i>} <Flick size={10} style={{ transform: 'rotate(90deg)' }} />
          </button>
        )}
        {catMenu}
        {sheet}
      </div>

      {/* REFINE ROW — only once a category exists (top pills or the chooser):
          sports / makers / mediums scroll behind the fade as before. */}
      {!isMobile && (sports.length > 0 || makers.length > 0 || categories.length > 0) && (
        <div className="ray-toolbar-row ray-toolbar-row-filters ray-markets-fade">
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
        </div>
      )}

      {/* Count + Clear live OUTSIDE the masked scroll row — the fade mask
          must never dissolve the one control that undoes a filter. */}
      <span className="ray-toolbar-count">
        {isFiltered ? (
          <>
            {shown.toLocaleString()} of {total.toLocaleString()}
            <button className="ray-toolbar-reset" onClick={() => onChange({ ...FEED_DEFAULTS, sort: filters.sort })}>
              Clear
            </button>
            <SaveSearch filters={filters} market={effectiveMarket} />
          </>
        ) : (
          <>{total.toLocaleString()} lots</>
        )}
      </span>
    </div>
  );
}
