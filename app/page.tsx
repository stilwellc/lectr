'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ARTIST_LABEL, MARKETS, marketArtists } from './constants';
import { useMarket } from './lib/market';
import { useRayData } from './hooks/useRayData';
import { useSavedLots } from './hooks/useSavedLots';
import { formatDate, formatPrice, getUpcomingCounts, craftTitle, sportOf } from './utils';
import ArtistNav from './components/ArtistNav';
import LotCard, { lotSignal, confidenceMeter } from './components/LotCard';
import ComparableModal from './components/ComparableModal';
import type { AuctionLot } from './types';
import PastResults from './components/PastResults';
import RayEntrance, { RayLoading } from './components/RayEntrance';
import CountUp from './components/CountUp';
import BoardDemand from './components/BoardDemand';
import MarketSwitch from './components/MarketSwitch';
import FeedToolbar, { FeedFilters, FEED_DEFAULTS } from './components/FeedToolbar';
import { CallPlate, Colophon, daysWord } from './components/Terminal';
import Flick from './components/Flick';

// W13 contract: useSavedLots grows a savedMeta record (hook agent's edit).
// Read it defensively — a stable empty fallback keeps memo deps quiet.
type SavedMeta = Record<string, { savedAt: string; estMid: number | null; signalPct: number | null; bidCount: number | null }>;
const EMPTY_SAVED_META: SavedMeta = {};

// The default view's diversity cap: max 8 lots per maker per page window —
// a greedy pass preserving date order, capped/overflow lots requeued in
// order for the next window (deterministic; no random).
const MAKER_CAP = 8;
function diversifyFeed(arr: AuctionLot[], windowSize: number): AuctionLot[] {
  if (arr.length <= MAKER_CAP || windowSize <= 0) return arr;
  const out: AuctionLot[] = [];
  let pool = arr;
  while (pool.length) {
    const counts: Record<string, number> = {};
    const taken: AuctionLot[] = [];
    const deferred: AuctionLot[] = [];
    for (const l of pool) {
      if (taken.length < windowSize && (counts[l.artist] || 0) < MAKER_CAP) {
        taken.push(l);
        counts[l.artist] = (counts[l.artist] || 0) + 1;
      } else {
        deferred.push(l); // keeps date order for the next window
      }
    }
    if (taken.length === 0) { out.push(...deferred); break; } // safety — never loop
    out.push(...taken);
    pool = deferred;
  }
  return out;
}

export default function RayPage() {
  const { allLots, statsByArtist, demand, backtest, lastCrawl, loading, fullLoaded, error, fromCache } = useRayData();
  const { market, setMarket } = useMarket();
  const marketMeta = MARKETS.find(m => m.key === market)!;
  // Every market on the board is live — the picked market filters directly.
  const activeKey = market;
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const marketStats = useMemo(() => {
    const out: typeof statsByArtist = {};
    for (const [k, v] of Object.entries(statsByArtist)) if (mktSet.has(k)) out[k] = v;
    return out;
  }, [statsByArtist, mktSet]);
  const savedApi = useSavedLots();
  const { toggle, isSaved, savedIds } = savedApi;
  const savedMeta = (savedApi as unknown as { savedMeta?: SavedMeta }).savedMeta ?? EMPTY_SAVED_META;

  // 24-card pages on desktop, 12 under 900px — matchMedia, SSR-safe default.
  const [pageSize, setPageSize] = useState(24);
  const [visibleUpcoming, setVisibleUpcoming] = useState(24);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const apply = () => {
      const size = mq.matches ? 12 : 24;
      setPageSize(size);
      // page 1 tracks the breakpoint; a reader who already expanded keeps their place
      setVisibleUpcoming(v => (v === 12 || v === 24 ? size : v));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const [feedFilters, setFeedFilters] = useState<FeedFilters>(FEED_DEFAULTS);
  const [tableLot, setTableLot] = useState<AuctionLot | null>(null);
  const [showArchive, setShowArchive] = useState(false);

  // The layout choice persists — read after mount (SSR renders the default).
  const [feedView, setFeedView] = useState<'grid' | 'table'>('grid');
  useEffect(() => {
    try {
      const v = localStorage.getItem('ray-feedview');
      if (v === 'grid' || v === 'table') setFeedView(v);
    } catch { /* storage blocked — session default */ }
  }, []);
  const handleView = (v: 'grid' | 'table') => {
    setFeedView(v);
    try { localStorage.setItem('ray-feedview', v); } catch { /* storage blocked */ }
  };

  // Lenses are scoped to the market they were picked in — a sport chosen in
  // Sports (or a maker in Watches) must not silently empty another market's
  // feed with no visible pill. Market switches drop the scoped lenses;
  // query, sort and the below-market lens travel with the reader.
  useEffect(() => {
    setFeedFilters(f =>
      f.vertical === null && f.maker === null && f.sport === null && f.category === null
        ? f
        : { ...f, vertical: null, maker: null, sport: null, category: null }
    );
  }, [activeKey]);

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return marketLots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
      // ISO date strings order lexicographically — no Date per comparison
      .sort((a, b) => (a.saleDate < b.saleDate ? -1 : a.saleDate > b.saleDate ? 1 : 0));
  }, [marketLots]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  // One shared below-market pass — the toolbar lens, its count, the ledger
  // button, the cards AND the biggest-gap sort all read the same signal
  // (computed once, not per keystroke).
  const belowSignal = useMemo(() => {
    const ids = new Set<string>();
    const pct = new Map<string, number>();
    upcoming.forEach(l => {
      const s = lotSignal(l, marketLots);
      if (s && s.label === 'Below Market') { ids.add(l.id); pct.set(l.id, s.pct); }
    });
    return { ids, pct };
  }, [upcoming, marketLots]);
  const belowIds = belowSignal.ids;

  // The feed the reader actually sees — search + lenses + sort applied.
  const feed = useMemo(() => {
    const f = feedFilters;
    const q = f.query.trim().toLowerCase();
    let arr = upcoming;
    if (f.vertical) {
      const vset = marketArtists(f.vertical);
      arr = arr.filter(l => vset.has(l.artist));
    }
    if (f.maker) arr = arr.filter(l => l.artist === f.maker);
    if (f.sport) arr = arr.filter(l => (sportOf(l.title) || 'Other') === f.sport);
    if (f.category) arr = arr.filter(l => l.category === f.category);
    if (f.belowOnly) arr = arr.filter(l => belowIds.has(l.id));
    if (q) {
      arr = arr.filter(l =>
        `${ARTIST_LABEL[l.artist] || l.artist} ${l.title} ${l.auctionHouse} ${l.saleName} ${l.medium || ''}`
          .toLowerCase()
          .includes(q)
      );
    }
    const est = (l: typeof arr[number]) => l.estimateHigh || l.estimateLow || l.currentBid || 0;
    if (f.sort === 'est-desc') arr = [...arr].sort((a, b) => est(b) - est(a));
    else if (f.sort === 'est-asc') arr = [...arr].sort((a, b) => est(a) - est(b));
    else if (f.sort === 'gap-desc') {
      // biggest comps gap first — reuses the belowSignal pass, no second sweep
      const pct = belowSignal.pct;
      arr = [...arr].sort((a, b) => (pct.get(b.id) ?? -Infinity) - (pct.get(a.id) ?? -Infinity));
    } else if (f.sort === 'newest') {
      // firstSeen is crawl-stamped and may be absent on older data — unseen sinks
      const seen = (l: AuctionLot) => l.firstSeen || '';
      arr = [...arr].sort((a, b) => (seen(a) < seen(b) ? 1 : seen(a) > seen(b) ? -1 : 0));
    } else if (!q && !f.vertical && !f.maker && !f.sport && !f.category && !f.belowOnly) {
      // the default view ('soonest', no lenses) gets the maker diversity cap
      arr = diversifyFeed(arr, pageSize);
    }
    return arr; // 'soonest' under a lens keeps the date order upcoming already has
  }, [upcoming, feedFilters, belowSignal, belowIds, pageSize]);

  // Lens changes re-run the card entrance. Search typing is deliberately NOT
  // in the key: rekeying per keystroke would remount all visible cards per
  // character — keyed reconciliation by lot.id handles search narrowing.
  const feedKey = useMemo(() => {
    const f = feedFilters;
    return `${f.vertical}|${f.maker}|${f.sport}|${f.category}|${f.belowOnly}|${f.sort}`;
  }, [feedFilters]);
  const handleFilters = (next: FeedFilters) => {
    setFeedFilters(next);
    setVisibleUpcoming(pageSize);
  };

  // The ledger's flagged figure, the proofstrip flag stat and the toolbar
  // pill all fire this one lens: below-market, biggest gap first, at the feed.
  const openBelowLens = () => {
    setFeedFilters(f => ({ ...f, belowOnly: true, sort: 'gap-desc' }));
    setVisibleUpcoming(pageSize);
    document.getElementById('on-the-block')?.scrollIntoView({ behavior: 'smooth' });
  };

  // Recent Results (PastResults) round-robins these across houses itself so
  // every house surfaces; here we just want the market's sold lots by recency.
  const sold = useMemo(() =>
    marketLots
      .filter(l => l.status === 'sold' && l.priceUsd)
      // ISO strings compare lexicographically (~25k archive lots — no Date
      // allocations per comparison; empty saleDates sink to the end)
      .sort((a, b) => (a.saleDate > b.saleDate ? -1 : a.saleDate < b.saleDate ? 1 : 0)),
    [marketLots]
  );

  // The results row's one honest sentence: median hammer vs mid-estimate.
  const soldMedianPct = useMemo(() => {
    const perf: number[] = [];
    for (const l of sold) {
      const lo = l.estimateLow || 0;
      const hi = l.estimateHigh || 0;
      const mid = lo && hi ? (lo + hi) / 2 : lo || hi;
      if (mid > 0 && l.priceUsd) perf.push(((l.priceUsd - mid) / mid) * 100);
    }
    if (!perf.length) return null;
    perf.sort((a, b) => a - b);
    return perf[Math.floor(perf.length / 2)];
  }, [sold]);

  // All-time realized — the hero numeral (the "portfolio" of the market).
  const totalRealized = useMemo(
    () => Object.values(marketStats).reduce((s, x) => s + (x.totalAuctionRevenue || 0), 0),
    [marketStats]
  );

  // The hero strip's lead line: the top maker by all-time realized revenue.
  const topArtist = useMemo(() => {
    const topEntry = Object.entries(marketStats)
      .sort((a, b) => (b[1].totalAuctionRevenue || 0) - (a[1].totalAuctionRevenue || 0))[0];
    return topEntry ? (ARTIST_LABEL[topEntry[0]] || topEntry[0]) : '';
  }, [marketStats]);

  const strip = useMemo(() => {
    const active = upcoming;
    const withEst = active.filter(l => (l.estimateLow || 0) > 0 || (l.estimateHigh || 0) > 0);
    const estValue = withEst.reduce((sum, l) => {
      const lo = l.estimateLow || l.estimateHigh || 0;
      const hi = l.estimateHigh || l.estimateLow || 0;
      return sum + (lo + hi) / 2;
    }, 0);
    const liveHouses = new Set(active.map(l => l.auctionHouse)).size;
    const asComma = (n: number) => Math.round(n).toLocaleString();
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
    const thisWeek = active.filter(l => {
      const d = new Date(l.saleDate);
      return !isNaN(d.getTime()) && d >= now && d <= weekAhead;
    }).length;
    const priceOrDash = (n: number) => (n > 0 ? formatPrice(n) : '—');
    return [
      { k: 'Realized all-time', to: totalRealized, format: priceOrDash, s: topArtist ? `led by ${topArtist}` : 'across the market' },
      { k: 'On the block', to: estValue, format: priceOrDash, s: estValue > 0 ? `${asComma(active.length)} lots, mid-estimates` : `${asComma(active.length)} lots — bid sales, no estimates` },
      { k: 'Hammers this week', to: thisWeek, format: asComma, s: `across ${liveHouses} houses` },
      { k: 'Flagged below market', to: belowIds.size, format: asComma, s: 'against true comps', tone: 'up', lens: true },
    ];
  }, [upcoming, belowIds, totalRealized, topArtist]);

  // The board rail's watchlist strip — what changed since you saved.
  const watchStrip = useMemo(() => {
    if (savedIds.length === 0) return null;
    const idSet = new Set(savedIds);
    const mine = allLots.filter(l => idSet.has(l.id));
    if (mine.length === 0) return null;
    const today = new Date().toISOString().split('T')[0];
    const live = mine
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
      .sort((a, b) => (a.saleDate < b.saleDate ? -1 : a.saleDate > b.saleDate ? 1 : 0));
    let bestMove: { from: number; to: number } | null = null;
    for (const l of live) {
      const meta = savedMeta[l.id];
      if (!meta || meta.signalPct == null) continue;
      const s = lotSignal(l, allLots);
      if (!s || s.label !== 'Below Market') continue;
      const delta = s.pct - meta.signalPct;
      if (delta > 0 && (!bestMove || delta > bestMove.to - bestMove.from)) bestMove = { from: meta.signalPct, to: s.pct };
    }
    return { count: mine.length, next: live[0] || null, bestMove };
  }, [savedIds, savedMeta, allLots]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <style>{`
        .ray-upcoming-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
          gap: 30px 20px;
        }
        .ray-upcoming-section { padding-block: 44px 48px; }
        @media (max-width: 768px) {
          .ray-upcoming-grid { grid-template-columns: 1fr; gap: 26px; }
          .ray-upcoming-section { padding-block: 38px 32px; }
        }
      `}</style>

      <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {/* R2 · the one market switcher — a pill rail directly under the nav,
          above the board it controls. The active pill is the lit element. */}
      <div className="rail" style={{ paddingTop: 14 }}>
        <div className="ray-markets-fade">
          <MarketSwitch compact lit />
        </div>
      </div>

      {error ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '120px 20px', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
              padding: '8px 20px', borderRadius: 100, border: '1px solid var(--color-border)',
              background: 'none', color: 'var(--color-text-muted)', cursor: 'pointer',
              fontFamily: 'var(--font-sans), sans-serif',
            }}
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          {/* THE BOARD OWNS VIEWPORT 1 — demand numeral + curve on the left,
              today's call and the watchlist strip in the right rail. */}
          <div className={`rail ray-board-wrap${fromCache ? '' : ' ray-choreo'}`}>
            <div className="ray-board-rail">
              <div className="ray-pane">
                <BoardDemand
                  allLots={marketLots}
                  demand={demand[activeKey] || []}
                  marketLabel={activeKey === 'all' ? 'total' : marketMeta.label.toLowerCase()}
                />
              </div>
              <aside aria-label="Today's call and your watchlist" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                <CallPlate
                  lots={marketLots}
                  allLots={marketLots}
                  market={activeKey}
                  isSaved={isSaved}
                  onToggleSave={toggle}
                />
                {watchStrip && (
                  <Link href="/saved" className="ray-watchstrip" aria-label={`Your watchlist — ${watchStrip.count} saved`}>
                    <span className="ray-panel-k">Your watchlist</span>
                    <span>
                      {watchStrip.count} saved
                      {watchStrip.next && <> · next hammer {daysWord(watchStrip.next.saleDate)}</>}
                      {watchStrip.bestMove && (
                        <> · best move <b className="up">+{Math.round(watchStrip.bestMove.from)}% → +{Math.round(watchStrip.bestMove.to)}%</b></>
                      )}
                    </span>
                    <span>Open saved <Flick size={12} /></span>
                  </Link>
                )}
              </aside>
            </div>
            {backtest && backtest.flagged.n > 500 && (
              <a href="/value" className="ray-proofstrip">
                Flagged calls beat their estimates by <b className="up">+{backtest.flagged.medianPerfPct}%</b> median
                — vs +{backtest.unflagged.medianPerfPct}% unflagged — across {backtest.flagged.n.toLocaleString()} replayed
                sales{activeKey !== 'all' ? ' · all markets' : ''} · the record <Flick size={12} />
              </a>
            )}
          </div>

          {/* The market in four figures — the flagged figure IS the lens */}
          <section className="rail ray-enter" style={{ paddingTop: 26 }}>
            <div className="ray-ledger" style={{ margin: 0 }}>
              {strip.map(item => item.lens ? (
                <button
                  key={item.k}
                  type="button"
                  onClick={openBelowLens}
                  aria-label="See flagged lots on the block, biggest gap first"
                  style={{ background: 'none', border: 'none', padding: 0, margin: 0, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
                >
                  <div className="ray-ledger-k">{item.k}</div>
                  <CountUp to={item.to} format={item.format} className={`ray-ledger-v${item.tone === 'up' ? ' up' : ''}`} style={{ display: 'block' }} />
                  <div className="ray-ledger-s">{item.s} <Flick size={10} /></div>
                </button>
              ) : (
                <div key={item.k}>
                  <div className="ray-ledger-k">{item.k}</div>
                  <CountUp to={item.to} format={item.format} className={`ray-ledger-v${item.tone === 'up' ? ' up' : ''}`} style={{ display: 'block' }} />
                  <div className="ray-ledger-s">{item.s}</div>
                </div>
              ))}
            </div>
          </section>

          {upcoming.length > 0 && (
            <section id="on-the-block" className="ray-upcoming-section rail">
              <div
                className="ray-enter"
                style={{
                  '--enter-delay': '150ms',
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                  padding: '10px 0 14px',
                } as React.CSSProperties}
              >
                <h2 className="ray-h2">On the block</h2>
                {upcoming[0] && (
                  <span style={{ fontSize: 13, color: 'var(--color-text-faint)' }}>
                    Next hammer: {daysWord(upcoming[0].saleDate)} · {upcoming[0].auctionHouse}
                  </span>
                )}
              </div>

              <FeedToolbar
                lots={upcoming}
                belowIds={belowIds}
                filters={feedFilters}
                onChange={handleFilters}
                shown={feed.length}
                total={upcoming.length}
                market={activeKey}
                onMarketReset={() => setMarket('all')}
                view={feedView}
                onViewChange={handleView}
                pageSize={pageSize}
              />

              {feedView === 'table' && feed.length > 0 ? (
                <div key={feedKey} className="ray-feed-rekey" style={{ overflowX: 'auto' }}>
                  <table className="ray-feedtable">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Maker / work</th>
                        <th>House</th>
                        <th>Hammers</th>
                        <th className="num">Estimate</th>
                        <th>Signal</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {feed.slice(0, visibleUpcoming).map(lot => {
                        const sig = lotSignal(lot, marketLots);
                        return (
                          <tr key={lot.id} onClick={() => setTableLot(lot)}>
                            <td style={{ width: 56 }}>
                              {/* the plate paints behind the img — the honest fallback
                                  when a house hotlink-blocks; hide, never outerHTML
                                  (React must keep owning this node) */}
                              <span className="thumb-plate" style={{ position: 'relative' }}>
                                {(lot.title || '?').charAt(0)}
                                {lot.imageUrl && (
                                  <img
                                    className="thumb"
                                    src={lot.imageUrl}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    referrerPolicy="no-referrer"
                                    style={{ position: 'absolute', inset: 0 }}
                                    // cache hits never fire onError — complete with zero
                                    // naturalWidth at attach is a cached failure
                                    ref={el => { if (el && el.complete && el.naturalWidth === 0) el.style.display = 'none'; }}
                                    onError={e => { e.currentTarget.style.display = 'none'; }}
                                  />
                                )}
                              </span>
                            </td>
                            <td>
                              <div className="t-artist">{ARTIST_LABEL[lot.artist] || lot.artist}</div>
                              <div className="t-title">{craftTitle(lot.title)}</div>
                            </td>
                            <td>{lot.auctionHouse}</td>
                            <td>{formatDate(lot.saleDate)}</td>
                            <td className="num t-est">
                              {lot.estimateLow && lot.estimateHigh ? `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)}` : '—'}
                            </td>
                            <td>
                              {sig
                                ? <span className={sig.label === 'Below Market' ? 't-sig-up' : 't-sig-down'}>
                                    {sig.label === 'Below Market' ? `+${sig.pct}% under comps` : `${sig.pct}% over comps`}
                                    <span title={`${confidenceMeter(sig.confidence).word} confidence`} style={{ marginLeft: 6, fontSize: 8.5, letterSpacing: 1, opacity: 0.8 }}>
                                      {confidenceMeter(sig.confidence).dots}
                                    </span>
                                  </span>
                                : <span style={{ color: 'var(--color-text-faint)' }}>—</span>}
                            </td>
                            <td style={{ width: 44 }}>
                              <button
                                className="ray-save-btn"
                                onClick={e => { e.stopPropagation(); toggle(lot.id); }}
                                aria-label={isSaved(lot.id) ? 'Remove from saved' : 'Save lot'}
                                style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isSaved(lot.id) ? 'var(--color-fg)' : 'var(--color-bg-elevated)', border: 'none', borderRadius: 100, cursor: 'pointer', padding: 0 }}
                              >
                                <svg width="10" height="12" viewBox="0 0 12 14" fill="none" aria-hidden="true">
                                  <path d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z" fill={isSaved(lot.id) ? 'var(--color-bg)' : 'var(--color-text-faint)'} />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
              <div className="ray-upcoming-grid" key={feedKey}>
                {feed.length === 0 ? (
                  <div className="ray-feed-empty">
                    <Flick size={28} draw style={{ color: 'var(--color-text-faint)' }} />
                    <p>Nothing on the block matches that.</p>
                    <button className="ray-toolbar-reset" onClick={() => handleFilters(FEED_DEFAULTS)}>
                      Clear the lenses
                    </button>
                  </div>
                ) : (
                  feed.slice(0, visibleUpcoming).map((lot, i) => (
                    <div
                      key={lot.id}
                      className="ray-feed-rekey"
                      style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                    >
                      <LotCard
                        lot={lot}
                        showArtist
                        allLots={marketLots}
                        saved={isSaved(lot.id)}
                        onToggleSave={toggle}
                        lastCrawl={lastCrawl || undefined}
                      />
                    </div>
                  ))
                )}
              </div>
              )}

              {tableLot && (
                <ComparableModal lot={tableLot} allLots={marketLots} onClose={() => setTableLot(null)} />
              )}

              {visibleUpcoming < feed.length && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
                  <button
                    onClick={() => setVisibleUpcoming(v => v + pageSize)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--color-border)',
                      borderRadius: 100,
                      padding: '10px 32px',
                      fontSize: 12,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-muted)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans), sans-serif',
                      transition: 'border-color var(--duration-fast) var(--ease-signature)',
                    }}
                  >
                    Show more ({(feed.length - visibleUpcoming).toLocaleString()} remaining)
                  </button>
                </div>
              )}
            </section>
          )}

          {/* R7 · THE RECORD — one summary row on the total market (the full
              archive mounts on demand); vertical landers keep the full,
              scoped section where it earns its weight. */}
          {sold.length > 0 && (activeKey === 'all' ? (
            <section className="rail ray-enter" style={{ paddingBlock: '8px 40px', '--enter-delay': '180ms' } as React.CSSProperties}>
              <div className="ray-results-row">
                <span>
                  {sold.length.toLocaleString()} sold lots
                  {soldMedianPct !== null && (
                    <> · median <b className={soldMedianPct >= 0 ? 'up' : 'down'}>
                      {soldMedianPct >= 0 ? '+' : '−'}{Math.abs(Math.round(soldMedianPct))}%
                    </b> vs estimate</>
                  )}
                  {sold[0].saleDate && <> · latest {formatDate(sold[0].saleDate)}</>}
                </span>
                <button
                  type="button"
                  onClick={() => setShowArchive(s => !s)}
                  style={{
                    background: 'none', border: '1px solid var(--color-border)', borderRadius: 100,
                    padding: '7px 18px', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: 'var(--color-text-muted)', fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'var(--font-sans), sans-serif',
                  }}
                >
                  {showArchive ? 'Hide the archive' : 'Show the archive'}
                </button>
              </div>
              {showArchive && (
                <div className="ray-recordband" style={{ marginTop: 24 }}>
                  <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
                </div>
              )}
            </section>
          ) : (
            <div className="ray-recordband ray-enter" style={{ '--enter-delay': '180ms' } as React.CSSProperties}>
              <div className="rail">
                <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
              </div>
            </div>
          ))}

          {/* R8 · THE COLOPHON — the provenance ring's closing clasp */}
          <Colophon
            lotCount={allLots.length}
            houseCount={new Set(allLots.map(l => l.auctionHouse)).size}
          />
        </RayEntrance>
      )}
    </div>
  );
}
