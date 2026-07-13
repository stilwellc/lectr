'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ARTISTS, ARTIST_LABEL, MARKETS, marketArtists } from './constants';
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
import MarketTape from './components/MarketTape';
import BoardDemand from './components/BoardDemand';
import FeedToolbar, { FeedFilters, FEED_DEFAULTS } from './components/FeedToolbar';
import { MarketTiles, CallPlate, HammersPanel, DeskMatrix, FilmStrip, Monument, Colophon } from './components/Terminal';

const PAGE_SIZE = 48;

export default function RayPage() {
  const { allLots, statsByArtist, tape, demand, backtest, lastCrawl, loading, fullLoaded, error, fromCache } = useRayData();
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
  const { toggle, isSaved, savedIds } = useSavedLots();
  const [visibleUpcoming, setVisibleUpcoming] = useState(PAGE_SIZE);
  const [feedFilters, setFeedFilters] = useState<FeedFilters>(FEED_DEFAULTS);
  const [feedView, setFeedView] = useState<'grid' | 'table'>('grid');
  const [tableLot, setTableLot] = useState<AuctionLot | null>(null);

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

  // One shared below-market id set — the toolbar lens, its count, and the
  // cards all read the same signal (computed once, not per keystroke).
  const belowIds = useMemo(() => {
    const ids = new Set<string>();
    upcoming.forEach(l => {
      const s = lotSignal(l, marketLots);
      if (s && s.label === 'Below Market') ids.add(l.id);
    });
    return ids;
  }, [upcoming, marketLots]);

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
    return arr; // 'soonest' keeps the date order upcoming already has
  }, [upcoming, feedFilters, belowIds]);

  // Lens changes re-run the card entrance. Search typing is deliberately NOT
  // in the key: rekeying per keystroke would remount all 48 cards per
  // character — keyed reconciliation by lot.id handles search narrowing.
  const feedKey = useMemo(() => {
    const f = feedFilters;
    return `${f.vertical}|${f.maker}|${f.sport}|${f.category}|${f.belowOnly}|${f.sort}`;
  }, [feedFilters]);
  const handleFilters = (next: FeedFilters) => {
    setFeedFilters(next);
    setVisibleUpcoming(PAGE_SIZE);
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

  // All-time realized — the hero numeral (the "portfolio" of the market).
  const totalRealized = useMemo(
    () => Object.values(marketStats).reduce((s, x) => s + (x.totalAuctionRevenue || 0), 0),
    [marketStats]
  );

  // The hero strip's lead line: the top maker by all-time realized revenue.
  // (The old pulse sentence computed appreciation / week / flagged figures
  // here too — the strip derives its own week count and reads belowIds for
  // flags, so this stays the one figure the strip actually consumes.)
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
      { k: 'Flagged below market', to: belowIds.size, format: asComma, s: 'against true comps', tone: 'up' },
    ];
  }, [upcoming, belowIds, totalRealized, topArtist]);

  // The tape ships precomputed PER MARKET in upcoming.json (instant); compute
  // it only as a fallback for deploys that predate the per-market split.
  const tapeItems = useMemo(() => {
    const pre = tape[activeKey];
    if (pre && pre.length) return pre;
    return sold.slice(0, 160)
      .filter(l => l.priceUsd && l.title)
      .sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0))
      .slice(0, 18)
      .map(l => ({
        artist: ARTIST_LABEL[l.artist] || l.artist,
        title: l.title.length > 44 ? l.title.slice(0, 42) + '…' : l.title,
        price: formatPrice(l.priceUsd!),
        house: l.auctionHouse,
      }));
  }, [tape, activeKey, sold]);

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

      {/* R2 · the tape — the terminal's signature slot, first proof of life */}
      {tapeItems.length > 0 && (
        <div className="ray-tapeband" aria-label="Recent hammers across the market">
          <MarketTape items={tapeItems} />
        </div>
      )}

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
          {/* THE HERO PANE — the star is the areas we cover: six big market
              tiles people click FIRST, fused to the demand curve in one pane.
              Everything data-heavy waits below. */}
          <div className={`rail ray-board-wrap${fromCache ? '' : ' ray-choreo'}`}>
            <div className="ray-pane">
              <MarketTiles demand={demand} active={market} onPick={setMarket} lots={allLots} />
              <BoardDemand
                allLots={marketLots}
                demand={demand[activeKey] || []}
                marketLabel={activeKey === 'all' ? 'total' : marketMeta.label.toLowerCase()}
              />
            </div>
            {backtest && backtest.flagged.n > 500 && (
              <a href="/value" className="ray-proofstrip">
                Flagged calls beat their estimates by <b className="up">+{backtest.flagged.medianPerfPct}%</b> median
                — vs +{backtest.unflagged.medianPerfPct}% unflagged — across {backtest.flagged.n.toLocaleString()} replayed
                sales · the record →
              </a>
            )}
          </div>

          {/* Now the data: the market in four figures, then the call + hammers */}
          <section className="rail ray-enter" style={{ paddingTop: 26 }}>
            <div className="ray-ledger" style={{ margin: 0 }}>
              {strip.map(item => (
                <div key={item.k}>
                  <div className="ray-ledger-k">{item.k}</div>
                  <CountUp to={item.to} format={item.format} className={`ray-ledger-v${item.tone === 'up' ? ' up' : ''}`} style={{ display: 'block' }} />
                  <div className="ray-ledger-s">{item.s}</div>
                </div>
              ))}
            </div>
            <div className="ray-subdeck">
              <CallPlate lots={marketLots} allLots={marketLots} />
              <HammersPanel lots={marketLots} allLots={marketLots} />
            </div>
          </section>

          {/* R5 · THE DESK — every maker as a bookable row */}
          {fullLoaded && (
            <div className="ray-enter">
              <DeskMatrix lots={marketLots} market={activeKey} ready={fullLoaded} />
            </div>
          )}

          {upcoming.length > 0 && (
            <section className="ray-upcoming-section rail">
              {/* R6 · the eye — flagged lots, photographed by the houses */}
              <FilmStrip lots={marketLots} allLots={marketLots} />
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
                  {lastCrawl && (
                    <span style={{ fontSize: 13, color: 'var(--color-text-faint)' }}>
                      {upcoming.length.toLocaleString()} lots · updated {formatDate(lastCrawl)}
                    </span>
                  )}
                  <span className="ray-viewtoggle" role="radiogroup" aria-label="Feed layout">
                    <button role="radio" aria-checked={feedView === 'grid'} aria-label="Card view" data-active={feedView === 'grid'} onClick={() => setFeedView('grid')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>
                    </button>
                    <button role="radio" aria-checked={feedView === 'table'} aria-label="Table view" data-active={feedView === 'table'} onClick={() => setFeedView('table')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round"/></svg>
                    </button>
                  </span>
                </span>
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
                                style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isSaved(lot.id) ? 'var(--color-accent-gold)' : 'var(--color-bg-elevated)', border: 'none', borderRadius: 100, cursor: 'pointer', padding: 0 }}
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
                    onClick={() => setVisibleUpcoming(v => v + PAGE_SIZE)}
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

          {/* R7 · THE RECORD — what hammered against what was asked, beside
              the backtest monument: proof under the promise at poster scale. */}
          {sold.length > 0 && (
            <div className="ray-recordband ray-enter" style={{ '--enter-delay': '180ms' } as React.CSSProperties}>
              <div className="rail">
                <div className="ray-record-grid">
                  <div className="ray-record-left">
                    <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
                  </div>
                  {backtest && backtest.flagged.n > 500 && <Monument backtest={backtest} />}
                </div>
              </div>
            </div>
          )}

          {/* R8 · THE COLOPHON — the provenance ring's closing clasp */}
          <Colophon
            lotCount={allLots.length}
            houseCount={new Set(allLots.map(l => l.auctionHouse)).size}
            lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined}
          />
        </RayEntrance>
      )}
    </div>
  );
}
