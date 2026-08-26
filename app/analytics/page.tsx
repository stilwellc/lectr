'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { MARKETS, marketArtists } from '../constants';
import type { Market } from '../constants';
import type { MarketStats } from '../types';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { useRayData, useFullLots, useSoldArchive, retryArchiveLoad, retryFullLoad } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import { formatDate, getUpcomingCounts, fmtSignedPct } from '../utils';
import Masthead, { Underscore } from '../components/Masthead';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import DeskNote from '../components/analytics/DeskNote';
import { RecordMark } from '../components/marks';
import VerifiedMovers from '../components/analytics/VerifiedMovers';
import SubMarketDrills from '../components/analytics/SubMarketDrills';
import IndexLab from '../components/analytics/IndexLab';
import RelativeStrength from '../components/analytics/RelativeStrength';
import LongHorizon from '../components/analytics/LongHorizon';
import HouseMatrix from '../components/analytics/HouseMatrix';
import GradeLadderPanel from '../components/analytics/GradeLadderPanel';
import SeasonalityStrip from '../components/analytics/SeasonalityStrip';
import { SellThroughPanel, DepthPanel } from '../components/analytics/MicroSeries';
import PortfolioHeader from '../components/analytics/PortfolioHeader';
import ArtistRankingsTable from '../components/analytics/ArtistRankingsTable';
import TopSales from '../components/analytics/TopSales';
import { Colophon } from '../components/Terminal';
import meta from '../../public/data/ray/meta.json';

const Distributions = dynamic(() => import('../components/analytics/Distributions'), { ssr: false });
const CalibrationCurve = dynamic(() => import('../components/analytics/CalibrationCurve'), { ssr: false });

/* ============================================================
   THE RESEARCH DESK — /analytics rebuilt as the data-science
   home. Two tiers:

   EAGER DESK (paints from phase-1 market.json + backtest —
   instantly, no 12MB wait): the index laboratory, relative
   strength, verified movers, market microstructure (sell-
   through / depth / seasonality / house calibration), engine
   science (the record, the calibration curve, the measured
   grade ladder), the long-horizon reads, and the full
   sub-market book.

   DEEP POOLS (phase-2 corpus, mounted only when the reader
   scrolls to them): maker rankings, top sales, distributions —
   the panels that genuinely need every lot.

   Honesty holds everywhere: every figure names its method and
   base; green/red only on measured deltas; counts are never
   dressed as price movement.
   ============================================================ */

export default function AnalyticsPage() {
  // EAGER tier only — useRayData does NOT trigger the 12MB phase-2 pull.
  const { allLots, statsByArtist, lastCrawl, fromCache, market: marketData, backtest, totalLots, totalSold, sources } = useRayData();
  // fetched meta.json wins; the build-time import is a first-paint fallback
  // only (build-time counts go stale between deploys; the crawl is nightly)
  const bookLots = totalLots ?? meta.totalLots;
  const bookSold = totalSold ?? meta.totalSold;
  const bookHouses = sources.length || meta.sources.length;
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketStats = useMemo(() => {
    const out: typeof statsByArtist = {};
    for (const [k, v] of Object.entries(statsByArtist)) if (mktSet.has(k)) out[k] = v;
    return out;
  }, [statsByArtist, mktSet]);
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  const drillCount = useMemo(() => {
    const d = marketData?.drills;
    if (!d) return 0;
    return activeKey === 'all'
      ? Object.values(d).reduce((s, rows) => s + rows.length, 0)
      : (d[activeKey] || []).length;
  }, [marketData, activeKey]);

  const sections: [string, React.ReactNode][] = [
    ['lab', <IndexLab key="lab" marketData={marketData} scope={activeKey} />],
    ['strength', <RelativeStrength key="strength" marketData={marketData} scope={activeKey} />],
    ['verified', <VerifiedMovers key="verified" marketData={marketData} scope={activeKey} variant="card" />],
    ['micro', (
      <div key="micro" className="ray-desk-microgrid">
        <SellThroughPanel marketData={marketData} scope={activeKey} />
        <DepthPanel marketData={marketData} scope={activeKey} />
        <SeasonalityStrip marketData={marketData} scope={activeKey} />
        <HouseMatrix marketData={marketData} scope={activeKey} />
      </div>
    )],
    ['engine', (
      <div key="engine">
        {backtest && (
          <div className="ray-vm ray-vm-card glass glass-quiet" style={{ marginBottom: 14 }}>
            <div className="ray-vm-head">
              <span className="ray-vm-title"><span className="ray-sect-mark" aria-hidden><RecordMark size={16} /></span>The engine&rsquo;s record</span>
              <span className="ray-vm-method">point-in-time replay of the live engine · dual basis</span>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--color-text-muted)', lineHeight: 1.65 }}>
              Across <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{backtest.flagged.n.toLocaleString()}</b> flagged
              lots replayed against history, our below-market calls went{' '}
              <b className="pct-data" style={{ color: backtest.flagged.medianPerfPct >= 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontFamily: 'var(--font-mono), monospace' }}>
                {fmtSignedPct(backtest.flagged.medianPerfPct)}
              </b>{' '}
              vs estimate all-in ({fmtSignedPct(backtest.flagged.hammerMedianPct ?? 0)} at hammer, the honest basis) with{' '}
              <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{backtest.flagged.failToSellPct}%</b> failing to sell —
              unflagged lots went {fmtSignedPct(backtest.unflagged.medianPerfPct)} on {backtest.unflagged.n.toLocaleString()}.
            </p>
          </div>
        )}
        {(activeKey === 'all' || activeKey === 'sports') && <div style={{ marginBottom: 14 }}><GradeLadderPanel marketData={marketData} /></div>}
        {backtest && <CalibrationCurve backtest={backtest} />}
      </div>
    )],
    ['horizon', <LongHorizon key="horizon" marketData={marketData} scope={activeKey} />],
    ['book', <SubMarketDrills key="book" marketData={marketData} scope={activeKey} limit={Infinity} title="The full book" method="every tracked sub-market · strongest honest read" />],
  ];

  return (
    <div className="terminal-shell" style={{
      minHeight: '100vh',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .ray-desk-strip2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 20px; }
        /* min-height ≈ the settled k+v+s stack — cells paint with '—' before
           phase-1 lands and must not grow (CLS) when the figures arrive */
        .ray-desk-cell2 { border: 2px dotted color-mix(in srgb, var(--color-fg) 13%, transparent); border-radius: 16px; padding: 12px 15px 11px; min-height: 78px; box-sizing: border-box; }
        .ray-desk-cell2 .k { font-size: 10px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--color-text-faint); }
        .ray-desk-cell2 .v { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 3px; }
        .ray-desk-cell2 .s { font-size: 11px; color: var(--color-text-muted); margin-top: 1px; }
        .ray-desk-microgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
        /* min-width:0 — a 1fr track's minimum is otherwise the item's CONTENT
           width, and HeroChart's ResizeObserver-sized svg then feeds back into
           the track (svg width → track min-content → bigger measure → wider
           svg): on a 390px viewport the panels ran away to ~600px and bled
           off-screen. Capping the items breaks the loop. */
        .ray-desk-microgrid > * { min-width: 0; }
        @media (max-width: 900px) { .ray-desk-microgrid { grid-template-columns: 1fr; } }
      ` }} />
      <ArtistNav activeSlug="analytics" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      <section className="rail" style={{ paddingTop: 28 }}>
        <Masthead
          kicker="The research desk"
          serial={lastCrawl || meta.lastCrawl}
          title={<>Every market, read as <Underscore>one book</Underscore>.</>}
          sub={<>Indexes, relative strength, microstructure and the engine&rsquo;s own science —{' '}
            <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{bookLots.toLocaleString()} lots</b>,{' '}
            <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{drillCount} tracked sub-markets</b>
            {lastCrawl ? <>, read {formatDate(lastCrawl)}</> : null}.</>}
        />
        <DeskNote market={activeKey} style={{ marginTop: 12 }} />

        {/* the desk strip — the eager headline facts */}
        <div className="ray-desk-strip2">
          <div className="ray-desk-cell2">
            <div className="k">On the book</div>
            <div className="v">{bookLots.toLocaleString()}</div>
            <div className="s">{bookSold.toLocaleString()} sold · {bookHouses} houses</div>
          </div>
          <div className="ray-desk-cell2">
            <div className="k">Sub-markets tracked</div>
            <div className="v">{drillCount || '—'}</div>
            <div className="s">{activeKey === 'all' ? 'across every vertical' : `in ${activeKey}`}</div>
          </div>
          {/* always rendered: this cell arriving LATE inserted itself into the
              auto-fit grid and shifted every sibling sideways (CLS). Until
              backtest lands it abstains with an ink '—', never a made-up %. */}
          <div className="ray-desk-cell2">
            <div className="k">The record</div>
            {backtest ? (
              <div className="v" style={{ color: backtest.flagged.medianPerfPct >= 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontFamily: 'var(--font-mono), monospace' }}>
                {fmtSignedPct(backtest.flagged.medianPerfPct)}
              </div>
            ) : (
              <div className="v">&mdash;</div>
            )}
            <div className="s">{backtest ? `${backtest.flagged.n.toLocaleString()} flagged calls, replayed · median vs estimate` : 'flagged calls, replayed · median vs estimate'}</div>
          </div>
          <div className="ray-desk-cell2">
            <div className="k">Makers ranked</div>
            <div className="v">{Object.keys(marketStats).length || '—'}</div>
            <div className="s">{activeKey === 'all' ? 'every roster name' : `${activeKey} roster`}</div>
          </div>
        </div>
      </section>

      <div className="rail" style={{ paddingTop: 16 }}><MarketSwitch compact /></div>

      {/* ── THE EAGER DESK — paints from phase-1, no corpus wait ──
          The wrapper reserves well over a viewport: before market.json lands
          most panels render nothing, which used to pull the deep-pools kicker
          and the colophon into the first viewport and then shove them ~5
          screens down (the site's worst CLS, 0.53–0.65). The settled desk is
          far taller than the reservation, so it never adds whitespace. */}
      <div style={{ minHeight: '160vh' }}>
        <RayEntrance animate={!fromCache}>
          {sections.map(([k, node], i) => (
            <div key={k} className="rail ray-enter" style={{ paddingTop: i === 0 ? 20 : 20, '--enter-delay': `${Math.min(i, 3) * 90}ms` } as React.CSSProperties}>
              {node}
            </div>
          ))}
        </RayEntrance>
      </div>

      {/* ── DEEP POOLS — corpus-scale panels, mounted on approach ── */}
      <DeepPools activeKey={activeKey} mktSet={mktSet} marketStats={marketStats} />

      <Colophon record={null} />
    </div>
  );
}

/* Mounts the phase-2 (and, for sports/science, phase-3) corpus panels only
   when the reader nears them — the desk above never waits on the 12MB pull. */
function DeepPools({ activeKey, mktSet, marketStats }: {
  activeKey: Market;
  mktSet: Set<string>;
  marketStats: Record<string, MarketStats>;
}) {
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || armed) return;
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setArmed(true); io.disconnect(); }
    }, { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [armed]);

  return (
    <div ref={ref} style={{ minHeight: armed ? undefined : 400 }}>
      <div className="rail" style={{ paddingTop: 26 }}>
        {/* no mark here — BookMark belongs to "The full book" head below;
            one glyph, one room (the mark system's premise) */}
        <div className="kicker" style={{ color: 'var(--color-text-faint)' }}>The deep pools · every lot on the book</div>
      </div>
      {armed ? <DeepPoolsBody activeKey={activeKey} mktSet={mktSet} marketStats={marketStats} /> : (
        <div className="rail" style={{ paddingTop: 14, paddingBottom: 40 }}>
          <div style={{ height: 260, borderRadius: 16, background: 'var(--color-surface)', opacity: 0.45 }} aria-hidden />
        </div>
      )}
    </div>
  );
}

function DeepPoolsBody(props: {
  activeKey: Market;
  mktSet: Set<string>;
  marketStats: Record<string, MarketStats>;
}) {
  // sports/science aggregate over the Goldin sold-archive — ONLY those
  // markets may mount useSoldArchive (its mount triggers the phase-3 fetch)
  const isArchiveMarket = props.activeKey === 'sports' || props.activeKey === 'science';
  return isArchiveMarket ? <ArchivePoolsBody {...props} /> : <PlainPoolsBody {...props} />;
}

function PlainPoolsBody({ activeKey, mktSet, marketStats }: {
  activeKey: Market;
  mktSet: Set<string>;
  marketStats: Record<string, MarketStats>;
}) {
  // mounting THIS component triggers phase 2
  const { allLots, fullLoaded, fullError, fromCache, market: marketData } = useFullLots();
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  if (fullError) return <PoolsError />;
  if (!fullLoaded) return <div className="rail" style={{ paddingTop: 14, paddingBottom: 40 }}><RayLoading /></div>;
  return <PoolsGrid activeKey={activeKey} marketLots={marketLots} marketStats={marketStats} marketData={marketData} fromCache={fromCache} />;
}

function ArchivePoolsBody({ activeKey, mktSet, marketStats }: {
  activeKey: Market;
  mktSet: Set<string>;
  marketStats: Record<string, MarketStats>;
}) {
  const { fullLoaded, fullError, fromCache, market: marketData } = useFullLots();
  const { allLotsWithArchive, archiveLoaded, archiveError } = useSoldArchive();
  const marketLots = useMemo(() => allLotsWithArchive.filter(l => mktSet.has(l.artist)), [allLotsWithArchive, mktSet]);
  const ready = fullLoaded && archiveLoaded;
  const errored = fullError || archiveError;
  if (errored) return <PoolsError />;
  if (!ready) return <div className="rail" style={{ paddingTop: 14, paddingBottom: 40 }}><RayLoading /></div>;
  return <PoolsGrid activeKey={activeKey} marketLots={marketLots} marketStats={marketStats} marketData={marketData} fromCache={fromCache} />;
}

function PoolsError() {
  return (
    <div style={{ padding: '60px 24px 100px', textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20 }}>
        The sold archive didn&rsquo;t load. Check your connection and try again.
      </p>
      <button className="ray-call-btn ray-call-btn-primary" onClick={() => { retryFullLoad(); retryArchiveLoad(); }}>
        Retry
      </button>
    </div>
  );
}

function PoolsGrid({ activeKey, marketLots, marketStats, marketData, fromCache }: {
  activeKey: Market;
  marketLots: import('../types').AuctionLot[];
  marketStats: Record<string, MarketStats>;
  marketData: import('../hooks/useRayData').MarketData | null;
  fromCache: boolean;
}) {
  const marketSeries = marketData?.markets?.[activeKey] || null;
  const nodes = [
    <PortfolioHeader key="header" statsByArtist={marketStats} allLots={marketLots} />,
    <ArtistRankingsTable key="rank" statsByArtist={marketStats} allLots={marketLots} market={activeKey} />,
    <TopSales key="top" allLots={marketLots} market={activeKey} series={marketSeries} />,
    <Distributions key="dist" allLots={marketLots} statsByArtist={marketStats} market={activeKey} series={marketSeries} />,
  ];
  return (
    <RayEntrance animate={!fromCache}>
      {nodes.map((node, i) => (
        <div key={node.key} className="ray-enter" style={{ '--enter-delay': `${Math.min(i, 3) * 90}ms` } as React.CSSProperties}>
          {node}
        </div>
      ))}
    </RayEntrance>
  );
}
