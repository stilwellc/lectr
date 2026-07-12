'use client';

import React, { useMemo, useState } from 'react';
import { ARTISTS, ARTIST_LABEL, MARKETS, marketArtists } from './constants';
import { useMarket } from './lib/market';
import { useRayData } from './hooks/useRayData';
import { useSavedLots } from './hooks/useSavedLots';
import { formatDate, formatPrice, getUpcomingCounts } from './utils';
import ArtistNav from './components/ArtistNav';
import LotCard, { lotSignal, confidenceMeter } from './components/LotCard';
import ComparableModal from './components/ComparableModal';
import type { AuctionLot } from './types';
import PastResults from './components/PastResults';
import RayEntrance, { RayLoading } from './components/RayEntrance';
import CountUp from './components/CountUp';
import MarketHero from './components/MarketHero';
import MarketTape from './components/MarketTape';
import MarketBlock from './components/MarketBlock';
import MarketSwitch from './components/MarketSwitch';
import FeedToolbar, { FeedFilters, FEED_DEFAULTS } from './components/FeedToolbar';

const PAGE_SIZE = 48;

export default function RayPage() {
  const { allLots, statsByArtist, tape, demand, lastCrawl, loading, fullLoaded, error, fromCache } = useRayData();
  const { market, setMarket } = useMarket();
  const marketMeta = MARKETS.find(m => m.key === market)!;
  // Coming-soon markets preview over the Art dataset structure; live ones filter.
  const activeKey = marketMeta.live ? market : 'art';
  const mktSet = useMemo(() => marketArtists(activeKey as 'art' | 'design'), [activeKey]);
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

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return marketLots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
      .sort((a, b) => {
        if (!a.saleDate) return 1;
        if (!b.saleDate) return -1;
        return new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime();
      });
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
    if (f.house) arr = arr.filter(l => l.auctionHouse === f.house);
    if (f.category) arr = arr.filter(l => l.category === f.category);
    if (f.belowOnly) arr = arr.filter(l => belowIds.has(l.id));
    if (q) {
      arr = arr.filter(l =>
        `${ARTIST_LABEL[l.artist] || l.artist} ${l.title} ${l.auctionHouse} ${l.saleName} ${l.medium || ''}`
          .toLowerCase()
          .includes(q)
      );
    }
    const est = (l: typeof arr[number]) => l.estimateHigh || l.estimateLow || 0;
    if (f.sort === 'est-desc') arr = [...arr].sort((a, b) => est(b) - est(a));
    else if (f.sort === 'est-asc') arr = [...arr].sort((a, b) => est(a) - est(b));
    return arr; // 'soonest' keeps the date order upcoming already has
  }, [upcoming, feedFilters, belowIds]);

  // Any lens change restarts pagination and re-runs the card entrance.
  const feedKey = useMemo(() => {
    const f = feedFilters;
    return `${f.query}|${f.house}|${f.category}|${f.belowOnly}|${f.sort}`;
  }, [feedFilters]);
  const handleFilters = (next: FeedFilters) => {
    setFeedFilters(next);
    setVisibleUpcoming(PAGE_SIZE);
  };

  const sold = useMemo(() =>
    marketLots
      .filter(l => l.status === 'sold' && l.priceUsd)
      .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()),
    [marketLots]
  );

  // All-time realized — the hero numeral (the "portfolio" of the market).
  const totalRealized = useMemo(
    () => Object.values(marketStats).reduce((s, x) => s + (x.totalAuctionRevenue || 0), 0),
    [marketStats]
  );

  // The live strip: active lots only, so it agrees with everything below it.
  const strip = useMemo(() => {
    const active = upcoming;
    const withEst = active.filter(l => (l.estimateLow || 0) > 0 || (l.estimateHigh || 0) > 0);
    const estValue = withEst.reduce((sum, l) => {
      const lo = l.estimateLow || l.estimateHigh || 0;
      const hi = l.estimateHigh || l.estimateLow || 0;
      return sum + (lo + hi) / 2;
    }, 0);
    const liveArtists = new Set(active.map(l => l.artist)).size;
    const liveHouses = new Set(active.map(l => l.auctionHouse)).size;
    const next = active[0]?.saleDate ? formatDate(active[0].saleDate) : '—';
    const asComma = (n: number) => Math.round(n).toLocaleString();
    return [
      { k: 'Active lots', to: active.length, format: asComma, s: `across ${liveHouses} houses` },
      { k: 'On the block', to: estValue, format: formatPrice, s: 'aggregate mid-estimates' },
      { k: 'Below estimate', to: belowIds.size, format: asComma, s: 'flagged against comps', tone: 'up' },
      { k: 'Artists live', to: liveArtists, format: asComma, s: `of ${mktSet.size} tracked · next ${next}` },
    ];
  }, [upcoming, belowIds, mktSet]);

  // A living read on the market — one derived, honest line (revenue-weighted
  // appreciation matching the analytics page, the top house by revenue, this
  // week's hammers, and how many upcoming lots the buy-signal flags as cheap).
  const pulse = useMemo(() => {
    const stats = Object.values(marketStats);
    const totalRevenue = stats.reduce((s, x) => s + (x.totalAuctionRevenue || 0), 0);
    const weightedAppreciation = totalRevenue > 0
      ? stats.reduce((s, x) => s + (x.appreciationRate || 0) * (x.totalAuctionRevenue || 0), 0) / totalRevenue
      : 0;
    const topEntry = Object.entries(marketStats)
      .sort((a, b) => (b[1].totalAuctionRevenue || 0) - (a[1].totalAuctionRevenue || 0))[0];
    const topArtist = topEntry ? (ARTIST_LABEL[topEntry[0]] || topEntry[0]) : '';
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
    const thisWeekLots = upcoming.filter(l => {
      const d = new Date(l.saleDate);
      return !isNaN(d.getTime()) && d >= now && d <= weekAhead;
    });
    // Flagged count is among *this week's* lots so the sentence stays honest.
    const belowFlagged = thisWeekLots.filter(l => {
      const sig = lotSignal(l, marketLots);
      return sig && sig.label === 'Below Market';
    }).length;
    return { weightedAppreciation, topArtist, thisWeek: thisWeekLots.length, belowFlagged };
  }, [marketStats, upcoming, marketLots]);

  // The tape ships precomputed in upcoming.json (instant); compute it only as
  // a fallback for deploys that predate the split.
  const marketLabels = useMemo(() => new Set(ARTISTS.filter(a => mktSet.has(a.slug)).map(a => a.label as string)), [mktSet]);
  const tapeItems = useMemo(() => {
    if (tape.length) return tape.filter(t => marketLabels.has(t.artist));
    return sold.slice(0, 90)
      .filter(l => l.priceUsd && l.title)
      .sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0))
      .slice(0, 18)
      .map(l => ({
        artist: ARTIST_LABEL[l.artist] || l.artist,
        title: l.title.length > 44 ? l.title.slice(0, 42) + '…' : l.title,
        price: formatPrice(l.priceUsd!),
        house: l.auctionHouse,
      }));
  }, [tape, sold, marketLabels]);

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
          .ray-upcoming-section { padding-block: 32px; }
        }
      `}</style>

      <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {/* The verticals — the first choice on the lander */}
      <div className="rail" style={{ paddingTop: 22 }}>
        <MarketSwitch />
      </div>

      {!marketMeta.live ? (
        <div className="rail">
          <section className="ray-soon">
            <div className="ray-soon-k">Coming to Ray</div>
            <h2>{marketMeta.label}</h2>
            <p>
              {marketMeta.tagline.charAt(0).toUpperCase() + marketMeta.tagline.slice(1)} — read the
              same way Ray reads art and design: <b>every estimate against every hammer</b>, true
              comparables only, demand measured against the ask, and a point-in-time record for
              every call. The engine generalizes; the crawl is being built.
            </p>
            <button className="ray-call-btn ray-call-btn-primary" onClick={() => setMarket('art')}>
              Explore Art in the meantime
            </button>
          </section>
        </div>
      ) : error ? (
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
          {/* The market as a portfolio: giant numeral, green performance line */}
          <div className="ray-enter">
            <MarketHero
              allLots={marketLots}
              demand={demand[activeKey] || []}
              marketLabel={marketMeta.label.toLowerCase()}
              totalValue={totalRealized}
              pulse={pulse}
            />
          </div>

          {/* The live strip: today's market in four figures */}
          <section className="rail ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
            <div className="ray-strip">
              {strip.map(item => (
                <div key={item.k}>
                  <div className="ray-strip-k">{item.k}</div>
                  <CountUp
                    to={item.to}
                    format={item.format}
                    className="ray-strip-v"
                    style={item.tone === 'up' ? { color: 'var(--color-up)', display: 'block' } : { display: 'block' }}
                  />
                  <div className="ray-strip-s">{item.s}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Recent hammers, rolling by */}
          {tapeItems.length > 0 && (
            <div className="ray-enter" style={{ '--enter-delay': '90ms', marginTop: 28 } as React.CSSProperties}>
              <MarketTape items={tapeItems} />
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="ray-enter" style={{ '--enter-delay': '120ms' } as React.CSSProperties}>
              <MarketBlock upcoming={upcoming} allLots={marketLots} />
            </div>
          )}

          {upcoming.length > 0 && (
            <section className="ray-upcoming-section rail">
              <div
                className="ray-enter"
                style={{
                  '--enter-delay': '150ms',
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                  padding: '0 0 14px',
                } as React.CSSProperties}
              >
                <h2 className="ray-h2">Upcoming lots</h2>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
                  {lastCrawl && (
                    <span style={{ fontSize: 13, color: 'var(--color-text-faint)' }}>
                      Updated {formatDate(lastCrawl)}
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
              />

              {feedView === 'table' && feed.length > 0 ? (
                <div key={feedKey} className="ray-feed-rekey" style={{ overflowX: 'auto' }}>
                  <table className="ray-feedtable">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Artist / work</th>
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
                              {lot.imageUrl
                                ? <img className="thumb" src={lot.imageUrl} alt="" referrerPolicy="no-referrer" onError={e => { e.currentTarget.outerHTML = `<span class="thumb-plate">${(lot.title || '?').charAt(0)}</span>`; }} />
                                : <span className="thumb-plate">{(lot.title || '?').charAt(0)}</span>}
                            </td>
                            <td>
                              <div className="t-artist">{ARTIST_LABEL[lot.artist] || lot.artist}</div>
                              <div className="t-title">{lot.title}</div>
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
                        stats={statsByArtist[lot.artist]}
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

          {sold.length > 0 && (
            <div className="ray-enter" style={{ '--enter-delay': '180ms' } as React.CSSProperties}>
              <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} mark="02" />
            </div>
          )}
        </RayEntrance>
      )}
    </div>
  );
}
