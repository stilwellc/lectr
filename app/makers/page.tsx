'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ARTISTS, MARKETS, marketArtists, rosterNoun } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { useFullLots, retryFullLoad } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import { formatDate, getUpcomingCounts } from '../utils';
import { formatDemand } from '../lib/demand';
import CountUp from '../components/CountUp';
import Masthead, { Accent } from '../components/Masthead';
import { Colophon } from '../components/Terminal';
import VerifiedMovers from '../components/analytics/VerifiedMovers';
import SubMarketDirectory from '../components/SubMarketDirectory';

const ArtistSparklines = dynamic(() => import('../components/analytics/ArtistSparklines'), { ssr: false });

/**
 * Makers — the roster as a wall of market curves. Every tracked name (artist,
 * designer, watch maker, science collection, or sports category), each a live
 * market read, one click to its page. The noun follows the market — they are
 * not all artists, and not every curve is a demand read (sports/science
 * curves are realized-$ series; only estimate markets read vs estimate).
 */
export default function MakersPage() {
  // useFullLots: the sparklines gate on fullLoaded, so trigger phase 2 — but
  // FIRST PAINT gates only on phase 1 (~1 MB): the masthead, taxonomy and
  // verified movers derive entirely from stats.json/market.json/upcoming.json,
  // so gating them behind the 32 MB corpus was a 31-second mobile skeleton
  // (audit C3 blocker 1). Only the sparkline wall — whose curves are sold-
  // history reads — waits for the corpus, behind a stable-height placeholder.
  // Honesty gate: nothing painted early may change when the corpus lands
  // (the live-lot count is the eager upcoming set, which IS the corpus's
  // live-upcoming set — the shards only add non-live/sold history).
  const { allLots, statsByArtist, lastCrawl, loading, fullLoaded, fullError, fromCache, market: marketData, demand } = useFullLots();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  // initialisms keep their case in prose ("the TCG market")
  const activeLabel = activeKey === 'all' ? 'full' : activeKey === 'tcg' ? 'TCG' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const rosterCount = useMemo(() => ARTISTS.filter(a => mktSet.has(a.slug)).length, [mktSet]);
  const { savedIds } = useSavedLots();

  // the roster noun follows the market — 'all' has no noun, so name it
  const noun = activeKey === 'all' ? (rosterCount === 1 ? 'tracked name' : 'tracked names') : rosterNoun(activeKey, rosterCount);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  const summary = useMemo(() => {
    // served demand (build-time, coverage/staleness-gated) — never recompute
    // the market curve client-side from a partially-loaded corpus
    const ds = demand?.[activeKey] || [];
    const marketNow = ds.length ? ds[ds.length - 1].value : null;
    const liveMkt = ARTISTS.filter(a => mktSet.has(a.slug)).reduce((s, a) => s + (upcomingCounts[a.slug] || 0), 0);
    return { live: liveMkt, marketNow };
  }, [demand, activeKey, upcomingCounts, mktSet]);

  // sub-market row count for the masthead (all markets when scope is 'all')
  const subMarketCount = useMemo(() => {
    const d = marketData?.drills;
    if (!d) return 0;
    return activeKey === 'all'
      ? Object.values(d).reduce((s, rows) => s + rows.length, 0)
      : (d[activeKey] || []).length;
  }, [marketData, activeKey]);

  return (
    <div className="terminal-shell" style={{
      minHeight: '100vh',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <ArtistNav activeSlug="artists" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="rail ray-enter" style={{ paddingTop: 24, paddingBottom: 8 }}>
            <div style={{ marginBottom: 22 }}><MarketSwitch compact /></div>
            {/* the certificate masthead — roster count rides the serial slot */}
            <Masthead
              kicker={`The roster · ${activeLabel} market`}
              datum={<CountUp to={rosterCount} format={n => `${Math.round(n)} ${noun}`} duration={900} animate={!fromCache} />}
              title={<>Every maker, read as a live <Accent>market curve</Accent>.</>}
              sub={
                <>
                  <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {summary.live} live lots
                  </b>{' '}
                  on the block
                  {subMarketCount > 0 && <> · {subMarketCount} tracked sub-markets</>}
                  {summary.marketNow !== null && (
                    <>
                      {' '}· market demand{' '}
                      <b style={{ color: summary.marketNow >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatDemand(summary.marketNow)}
                      </b>
                    </>
                  )}
                </>
              }
            />
          </section>

          {/* THE TAXONOMY — the market's sub-category tree, each split with the
              strongest honest read it supports (the new centerpiece) */}
          <section className="rail ray-enter" style={{ '--enter-delay': '40ms', paddingTop: 8, paddingBottom: 4 } as React.CSSProperties}>
            <SubMarketDirectory marketData={marketData} scope={activeKey} />
          </section>

          {/* the defensible reads alongside the demand curves — the only price
              movement that clears a 95% CI; honest empty state per market */}
          <section className="rail ray-enter" style={{ '--enter-delay': '60ms', paddingTop: 4, paddingBottom: 4 } as React.CSSProperties}>
            <VerifiedMovers marketData={marketData} scope={activeKey} variant="card" />
          </section>

          {/* the sparkline wall is the one corpus-derived surface: its curves
              are sold-history reads, so it waits for phase 2 behind a stable-
              height placeholder (never a partial-corpus curve that silently
              redraws when the shards land). */}
          {fullLoaded ? (
            <div className="ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
              <ArtistSparklines statsByArtist={statsByArtist} allLots={allLots} limit={ARTISTS.length} market={activeKey} marketData={marketData} upcomingCounts={upcomingCounts} />
            </div>
          ) : (
            <div className="rail" style={{ minHeight: '100vh', paddingTop: 24 }} role="status" aria-label="Loading the full sold history">
              {fullError ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: '24px 0' }}>
                  <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: 0 }}>
                    The full sold history didn&rsquo;t load, so the market curves are missing.
                  </p>
                  <button className="ray-call-btn ray-call-btn-primary" onClick={() => retryFullLoad()}>
                    Try again
                  </button>
                </div>
              ) : (
                <>
                  {/* The CURVES need sold history, but the ROSTER does not: the
                      names come from ARTISTS and the links are static routes.
                      The old placeholder was six anonymous grey cards, so the
                      page's whole navigational payload — every maker link —
                      waited on the 32MB corpus (measured 29.3s on Fast-4G,
                      audit A6 item 6). Now every tracked name is a real link
                      from first paint, in its final grid slot, with the curve
                      well reserved above it so nothing moves when phase 2
                      lands. Deliberately NO sold-derived figure here: printing
                      one from the phase-1 set would be a number that silently
                      changes when the shards arrive. */}
                  <div className="ray-sk" style={{ width: 220, height: 16, marginBottom: 18 }} />
                  <div className="ray-sk-cards">
                    {ARTISTS.filter(a => mktSet.has(a.slug)).map(a => (
                      <div key={a.slug}>
                        <div className="ray-sk" style={{ width: '100%', height: 150, borderRadius: 14, marginBottom: 12 }} />
                        <a
                          href={`/makers/${a.slug}`}
                          style={{
                            display: 'block', fontSize: 14, fontWeight: 600,
                            color: 'var(--color-text-secondary)', textDecoration: 'none',
                            marginBottom: 8, lineHeight: 1.15,
                          }}
                        >
                          {a.label}
                        </a>
                        <div className="ray-sk" style={{ width: '80%', height: 12 }} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </RayEntrance>
      )}

      {/* the closing colophon — OUTSIDE the data gates so the prerendered HTML
          carries the full crawlable route map (audit C4 pre-GA-5: /makers
          shipped zero internal links in first HTML). */}
      <Colophon record={null} />
    </div>
  );
}
