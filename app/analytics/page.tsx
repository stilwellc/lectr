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
import Masthead from '../components/Masthead';
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
import MarketCockpit from '../components/analytics/MarketCockpit';
import { CellGrid, FigureCell, FigGate, FigCalib, FigTape } from '../components/cells';
import PortfolioHeader from '../components/analytics/PortfolioHeader';
import ArtistRankingsTable from '../components/analytics/ArtistRankingsTable';
import TopSales from '../components/analytics/TopSales';
import { Colophon } from '../components/Terminal';
import meta from '../../public/data/ray/meta.json';

const Distributions = dynamic(() => import('../components/analytics/Distributions'), { ssr: false });
const CalibrationCurve = dynamic(() => import('../components/analytics/CalibrationCurve'), { ssr: false });
const RecordByYear = dynamic(() => import('../components/RecordByYear'), { ssr: false });
const LabFiguresP = {
  CloseCurve: dynamic(() => import('../components/analytics/LabFigures').then(m => m.CloseCurveFigure), { ssr: false }),
  Funnel: dynamic(() => import('../components/analytics/LabFigures').then(m => m.CoverageFunnel), { ssr: false }),
  Venue: dynamic(() => import('../components/analytics/LabFigures').then(m => m.VenueStrip), { ssr: false }),
  Field: dynamic(() => import('../components/analytics/LabFigures').then(m => m.DepthField), { ssr: false }),
  Repeat: dynamic(() => import('../components/analytics/LabFigures').then(m => m.RepeatSaleRoom), { ssr: false }),
  Styles: dynamic(() => import('../components/analytics/LabFigures').then(m => m.LabFiguresStyles), { ssr: false }),
};

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
    // LabFiguresStyles is hoisted below the sections' host (not in here):
    // a wrapper carrying only a <style> would defeat the empty-plate guard
    ['field', <LabFiguresP.Field key="field" lots={allLots} scope={activeKey} />],
    ['micro', (
      <div key="micro" className="ray-desk-microgrid">
        {/* the cockpit — sell-through, depth and the calendar's hottest
            month merged into ONE dashboard-grammar card (stat tabs over a
            hairline); it takes the full rail like a dashboard hero */}
        <MarketCockpit marketData={marketData} scope={activeKey} />
        <SeasonalityStrip marketData={marketData} scope={activeKey} />
        <HouseMatrix marketData={marketData} scope={activeKey} />
      </div>
    )],
    // the flow trio are CROSS-MARKET fits (bid histories, conformal bands,
    // venue factors) — they render on the all view only; a scoped market
    // must never print a global fit dressed as its own
    ...(activeKey === 'all' ? [['flow', (
      <div key="flow" className="ray-lf-grid3">
        <LabFiguresP.CloseCurve marketData={marketData} />
        <LabFiguresP.Funnel backtest={backtest} />
        <LabFiguresP.Venue marketData={marketData} />
      </div>
    )] as [string, React.ReactNode]] : []),
    ['repeat', <LabFiguresP.Repeat key="repeat" marketData={marketData} scope={activeKey} />],
    ['engine', (
      <div key="engine">
        {backtest && activeKey === 'all' && (
          /* the north-star split head: huge light headline left, the record
             prose right — the room's intro copy IS the split's right column */
          <div className="ns-split" style={{ marginBottom: 18 }}>
            <div>
              <span className="ns-kicker">Engine science</span>
              <h2 className="ray-room-h"><span className="ray-sect-mark" aria-hidden><RecordMark size={18} /></span>The engine&rsquo;s record</h2>
              <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--color-text-muted)' }}>point-in-time replay of the live engine · dual basis</div>
            </div>
            <p>
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
        {backtest && <CalibrationCurve backtest={backtest} scope={activeKey} />}
        {/* the by-year replay — 27 years of flagged-vs-unflagged, previously
            unplotted on the research desk; the edge band figure */}
        {backtest && activeKey === 'all' && <div className="ray-rby-host">{<RecordByYear backtest={backtest} />}</div>}
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
        /* the desk byline — the abstract's headline facts as a provenance
           ledger (north-star byline grammar): gray label over ink value,
           closed by the dotted rule. Cells always render (— before phase-1
           lands) so the row never reflows (CLS). */
        .ray-desk-byline { margin-top: 24px; }
        .ray-desk-byline > div { min-height: 62px; }
        .ray-desk-byline .v { font-size: 18px; font-weight: 450; letter-spacing: -0.01em; }
        .ray-desk-byline .s { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }
        .ray-desk-microgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
        /* min-width:0 — a 1fr track's minimum is otherwise the item's CONTENT
           width, and HeroChart's ResizeObserver-sized svg then feeds back into
           the track (svg width → track min-content → bigger measure → wider
           svg): on a 390px viewport the panels ran away to ~600px and bled
           off-screen. Capping the items breaks the loop. */
        .ray-desk-microgrid > * { min-width: 0; }
        /* the house matrix needs the full rail on the all view (8 markets of
           columns) — it spans the grid row instead of scrolling in a half cell */
        .ray-desk-microgrid > .ray-hm { grid-column: 1 / -1; }
        /* the cockpit is the room's dashboard hero — full rail, like their
           Calls/Latency/CSAT panel */
        .ray-desk-microgrid > .ray-mc { grid-column: 1 / -1; }
        .ray-abstract { max-width: 760px; margin-top: 26px; padding: 4px 0 0 18px; border-left: 2px solid var(--color-fg); }
        .ray-abstract .ns-kicker { margin-bottom: 2px; }
        .ray-abstract p { margin: 6px 0 0; font-size: 14px; line-height: 1.7; color: var(--color-text-secondary); }
        .ray-abstract b { color: var(--color-fg); font-variant-numeric: tabular-nums; }
        /* the methods colophon as a dotted spec ledger (north-star grammar) */
        .ray-methods { max-width: 820px; padding-block: 34px 8px; }
        .ray-methods .ns-ledger-row { align-items: baseline; }
        .ray-methods .ns-ledger-row .k { flex: 0 0 122px; font-size: 12.5px; color: var(--color-text-muted); }
        .ray-methods .ns-ledger-row .val { flex: 1; font-size: 12.5px; line-height: 1.65; color: var(--color-text-secondary); }
        /* the room headline — big and LIGHT (authority through lightness) */
        .ray-room-h { margin: 0; font-family: var(--font-sans), sans-serif; font-size: 30px; font-weight: 340; letter-spacing: -0.02em; line-height: 1.12; color: var(--color-fg); }
        /* a room whose instrument abstained (rendered null) must not print
           a stray plate rule — an empty plate erases itself. (Kept as its
           own rule: a selector list sharing :has would drop :empty too on
           engines without :has.) */
        .ns-plate:empty { border-top: none; padding-top: 0 !important; }
        .ns-plate:empty::before, .ns-plate:empty::after { display: none; }
        /* RecordByYear ships as a .rail section for /value — hosted inside
           the engine cell (already inside a rail) it must not double-gutter */
        .ray-rby-host .rail { padding-inline: 0; max-width: none; }
        @media (max-width: 900px) { .ray-desk-microgrid { grid-template-columns: 1fr; } }
      ` }} />
      <ArtistNav activeSlug="analytics" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      <section className="rail" style={{ paddingTop: 28 }}>
        <Masthead
          kicker="The research desk"
          serial={lastCrawl || meta.lastCrawl}
          title={<>Every market, read as one book.</>}
          sub={<>Indexes, relative strength, microstructure and the engine&rsquo;s own science —{' '}
            <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{bookLots.toLocaleString()} lots</b>,{' '}
            <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{drillCount} tracked sub-markets</b>
            {lastCrawl ? <>, read {formatDate(lastCrawl)}</> : null}.</>}
        />
        <DeskNote market={activeKey} style={{ marginTop: 12 }} />

        {/* THE ABSTRACT — the lab-report opening: what this desk measured and
            what it found, three claims with their bases. Prose, not tiles. */}
        {backtest && activeKey === 'all' && (
          <div className="ray-abstract ray-enter">
            <span className="ns-kicker">Abstract</span>
            <p>
              Nightly, this desk replays every settled sale against the engine&rsquo;s point-in-time calls and refits
              its indexes with like-for-like controls. Across <b>{backtest.flagged.n.toLocaleString()}</b> replayed
              flags, below-market calls realized{' '}
              <b className="pct-data" style={{ color: backtest.flagged.medianPerfPct >= 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                {fmtSignedPct(backtest.flagged.medianPerfPct)}
              </b>{' '}
              vs estimate all-in against {fmtSignedPct(backtest.unflagged.medianPerfPct)} unflagged — an edge that
              holds in every hammer year since 2000 (FIG. below). Indexes publish only where their 95% interval
              resolves the sign; everything else abstains, and the abstentions are printed.
            </p>
          </div>
        )}

        {/* the desk byline — the eager headline facts as provenance columns */}
        <div className="ns-byline ray-desk-byline">
          <div>
            <div className="k">On the book</div>
            <div className="v">{bookLots.toLocaleString()}</div>
            <div className="s">{bookSold.toLocaleString()} sold · {bookHouses} houses</div>
          </div>
          <div>
            <div className="k">Sub-markets tracked</div>
            <div className="v">{drillCount || '—'}</div>
            <div className="s">{activeKey === 'all' ? 'across every vertical' : `in ${activeKey}`}</div>
          </div>
          {/* always rendered: this column arriving LATE would shift every
              sibling sideways (CLS). Until backtest lands it abstains with
              an ink '—', never a made-up %. */}
          <div>
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
          <div>
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
        {/* the LabFigures ruleset serves the field, flow and repeat rooms —
            mounted once here so no plate has to host a bare <style> */}
        <LabFiguresP.Styles />
        <RayEntrance animate={!fromCache}>
          {sections.map(([k, node], i) => (
            <div key={k} className="rail ray-enter" style={{ paddingTop: i === 0 ? 20 : 20, '--enter-delay': `${Math.min(i, 3) * 90}ms` } as React.CSSProperties}>
              {/* the registration frame: each room is a plate — top rule with
                  crop-mark dots landing on the rail's edges */}
              <div className="ns-plate" style={{ paddingTop: 18 }}>
                {node}
              </div>
            </div>
          ))}
        </RayEntrance>
      </div>

      {/* ── DEEP POOLS — corpus-scale panels, mounted on approach ── */}
      <DeepPools activeKey={activeKey} mktSet={mktSet} marketStats={marketStats} />

      {/* HONESTY, BUILT IN — the doctrine room: the ElevenLabs "Safety,
          built in" grammar drawn for OUR laws. Three of the engine's real
          gates as patent-figure cells; every claim below matches measured
          behavior elsewhere on this page. */}
      <section className="rail" style={{ paddingTop: 26 }}>
        <div className="ns-plate" style={{ paddingTop: 18 }}>
          <div className="ns-split" style={{ marginBottom: 18 }}>
            <div>
              <span className="ns-kicker">The doctrine</span>
              <h2 className="ray-room-h">Honesty, built in</h2>
            </div>
            <p>
              Every figure on this desk names its method and base, and the same laws bind the
              engine underneath: where the data cannot clear its own bar, the desk abstains —
              and the abstention is printed. Three of the gates, drawn.
            </p>
          </div>
          <CellGrid min={260}>
            <FigureCell
              figure={<FigGate />}
              label="The abstention"
              body={<>Below the floors — too few sales in a cell, a confidence interval that will not
                resolve the sign — the engine prints a dash rather than dress up a number it
                cannot back. Suppressed cells are the method working.</>}
            />
            <FigureCell
              figure={<FigCalib />}
              label="The calibration"
              body={<>What a flag is worth is refit from every nightly replay, recency-weighted and
                shrunk. The 10&times;+ bucket drops on purpose: extreme comp gaps under-deliver,
                and the curve says so instead of extrapolating.</>}
            />
            <FigureCell
              figure={<FigTape />}
              label="The printed-bid gate"
              body={<>A bidding read rides only a bid that was actually printed on an exposed book —
                never inferred from an ask. Where a house shows no live bidding, the desk prints
                the ask and says so.</>}
            />
          </CellGrid>
        </div>
      </section>

      {/* THE METHODS — the lab colophon: how every figure on this page is
          made, set as a dotted spec ledger (north-star grammar) */}
      <section className="rail ray-methods">
        <div className="ns-plate" style={{ paddingTop: 18 }}>
          <span className="ns-kicker">Methods</span>
          <div>
            <div className="ns-ledger-row">
              <span className="k">Price movement</span>
              <span className="val">hedonic log-price regression per market (reference/form/size/house controls,
                IRLS-weighted, quarterly time coefficients) and same-object repeat-sale fits where pairs allow; both
                abstain below density, dominance and CI gates, and a ±plausibility ceiling drops implied compound moves
                the controls cannot defend.</span>
            </div>
            <div className="ns-ledger-row">
              <span className="k">The record</span>
              <span className="val">every flag replayed against realized results at both hammer and all-in bases — never backfilled.</span>
            </div>
            <div className="ns-ledger-row">
              <span className="k">Calibration</span>
              <span className="val">beat-rates refit nightly, recency-weighted and shrunk.</span>
            </div>
            <div className="ns-ledger-row">
              <span className="k">Figures</span>
              <span className="val">print their n and basis; suppressed cells mean the data did not clear the bar.</span>
            </div>
            <div className="ns-ledger-row">
              <span className="k">Data</span>
              <span className="val">public auction results across 16 houses.</span>
            </div>
          </div>
        </div>
      </section>
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
        <div className="ns-plate" style={{ paddingTop: 18 }}>
          <span className="ns-kicker">Every lot on the book</span>
          <h2 className="ray-room-h">The deep pools</h2>
        </div>
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
