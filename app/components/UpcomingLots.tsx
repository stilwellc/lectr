'use client';

/**
 * UpcomingLots — a maker page's live book (section 02). Oct 9: the body is the
 * shared LotBrowser (the home feed's machinery scoped to this maker's lots):
 * "What matters" / "All lots", search, sort, triage, facets, table / cards /
 * phone rows, folds and Show more — with the filter state in the URL so a
 * filtered maker view is shareable and Back restores it. The section keeps the
 * dossier's own heading (ghost ordinal + "Upcoming lots").
 */
import React, { useEffect, useMemo } from 'react';
import { AuctionLot, MarketStats } from '../types';
import { marketOf, MAKER_MARKETS, type Market } from '../constants';
import SectionMark from './SectionMark';
import LotBrowser from './LotBrowser';
import { FEED_DEFAULTS, feedFromParams, feedToParams, type FeedFilters } from './FeedToolbar';
import { useUrlState, useLastVisit, houseBaselines } from '../lib/feed-filters';
import { useBackScroll } from '../lib/use-back-scroll';

export default function UpcomingLots({
  slug,
  lots,
  allLots = [],
  savedIds = [],
  onToggleSave,
  mark,
  enterDelay = 0,
  lastCrawl,
  fromCache = false,
}: {
  /** the maker this book belongs to */
  slug: string;
  lots: AuctionLot[];
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
  fromCache?: boolean;
}) {
  // the maker's feed view lives in the URL (replaceState): a filtered maker
  // view is a shareable link, and Back from a lot reopens it as left
  const [filters, setFilters] = useUrlState<FeedFilters>(FEED_DEFAULTS, feedFromParams, feedToParams);
  const prevVisitDay = useLastVisit();
  const compLots = allLots.length ? allLots : lots;
  // a house's first-crawl flood is not "new" (feed-filters houseBaselines)
  const baselines = useMemo(() => houseBaselines(compLots), [compLots]);
  const market = marketOf(slug) as Market;
  const scope = useMemo(() => ({ maker: slug, named: MAKER_MARKETS.has(market) }), [slug, market]);
  // Back from a lot lands where the reader left the book (the filters ride
  // the URL; the rows paged in ride LotBrowser's persistKey)
  useBackScroll(true);
  // a deep link to the live book (/makers' "+N more on the block" lands on
  // #upcoming): the section mounts after the maker's rows load, long after
  // the browser's own fragment scroll gave up — land it once we exist
  useEffect(() => {
    if (window.location.hash !== '#upcoming') return;
    // clear the sticky nav (its own height, measured) so the heading shows
    const go = () => {
      const el = document.getElementById('upcoming');
      if (!el) return;
      const nav = document.querySelector('nav, header');
      const pad = Math.min(120, (nav?.getBoundingClientRect().bottom ?? 64)) + 8;
      window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - pad) });
    };
    const raf = requestAnimationFrame(go);
    const t = window.setTimeout(go, 450); // after the chart wells settle
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, []);

  return (
    <section className="ray-upcoming rail">
      {/* __html, not a text child (RecordBand's pattern) */}
      <style dangerouslySetInnerHTML={{ __html: `
        .ray-upcoming { padding-block: var(--sect-t) var(--sect-b); }
      ` }} />

      {/* Ghost ordinal clipped to the header band — never under the lots */}
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
            fontFamily: 'var(--font-sans), sans-serif',
            fontSize: 30,
            fontWeight: 350,
            letterSpacing: '-0.025em',
            lineHeight: 1.12,
          }}>
            Upcoming <span style={{ fontStyle: 'normal' }}>lots</span>
          </h2>
        </div>
      </div>

      <LotBrowser
        lots={lots}
        compLots={compLots}
        filters={filters}
        onFiltersChange={next => setFilters(next)}
        market={market}
        scope={scope}
        savedIds={savedIds}
        onToggleSave={onToggleSave}
        lastCrawl={lastCrawl}
        fromCache={fromCache}
        prevVisitDay={prevVisitDay}
        baselines={baselines}
        anchorId="upcoming"
        persistKey={`/makers/${slug}`}
      />
    </section>
  );
}
