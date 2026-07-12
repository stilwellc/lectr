'use client';

import React, { useMemo, useState } from 'react';
import { ARTISTS, ARTIST_LABEL } from './constants';
import { useRayData } from './hooks/useRayData';
import { useSavedLots } from './hooks/useSavedLots';
import { formatDate, formatPrice, getUpcomingCounts } from './utils';
import ArtistNav from './components/ArtistNav';
import LotCard, { computeBuySignal } from './components/LotCard';
import PastResults from './components/PastResults';
import RayEntrance, { RayLoading } from './components/RayEntrance';
import CountUp from './components/CountUp';
import MarketHero from './components/MarketHero';
import MarketTape from './components/MarketTape';
import MarketBlock from './components/MarketBlock';
import FeedToolbar, { FeedFilters, FEED_DEFAULTS } from './components/FeedToolbar';

const PAGE_SIZE = 48;

export default function RayPage() {
  const { allLots, statsByArtist, lastCrawl, loading, error, fromCache } = useRayData();
  const { toggle, isSaved, savedIds } = useSavedLots();
  const [visibleUpcoming, setVisibleUpcoming] = useState(PAGE_SIZE);
  const [feedFilters, setFeedFilters] = useState<FeedFilters>(FEED_DEFAULTS);

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return allLots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
      .sort((a, b) => {
        if (!a.saleDate) return 1;
        if (!b.saleDate) return -1;
        return new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime();
      });
  }, [allLots]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  // One shared below-market id set — the toolbar lens, its count, and the
  // cards all read the same signal (computed once, not per keystroke).
  const belowIds = useMemo(() => {
    const ids = new Set<string>();
    upcoming.forEach(l => {
      const s = computeBuySignal(l, allLots);
      if (s && s.label === 'Below Market') ids.add(l.id);
    });
    return ids;
  }, [upcoming, allLots]);

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
    allLots
      .filter(l => l.status === 'sold' && l.priceUsd)
      .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()),
    [allLots]
  );

  // All-time realized — the hero numeral (the "portfolio" of the market).
  const totalRealized = useMemo(
    () => Object.values(statsByArtist).reduce((s, x) => s + (x.totalAuctionRevenue || 0), 0),
    [statsByArtist]
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
      { k: 'Artists live', to: liveArtists, format: asComma, s: `of ${ARTISTS.length} tracked · next ${next}` },
    ];
  }, [upcoming, belowIds]);

  // A living read on the market — one derived, honest line (revenue-weighted
  // appreciation matching the analytics page, the top house by revenue, this
  // week's hammers, and how many upcoming lots the buy-signal flags as cheap).
  const pulse = useMemo(() => {
    const stats = Object.values(statsByArtist);
    const totalRevenue = stats.reduce((s, x) => s + (x.totalAuctionRevenue || 0), 0);
    const weightedAppreciation = totalRevenue > 0
      ? stats.reduce((s, x) => s + (x.appreciationRate || 0) * (x.totalAuctionRevenue || 0), 0) / totalRevenue
      : 0;
    const topEntry = Object.entries(statsByArtist)
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
      const sig = computeBuySignal(l, allLots);
      return sig && sig.label === 'Below Market';
    }).length;
    return { weightedAppreciation, topArtist, thisWeek: thisWeekLots.length, belowFlagged };
  }, [statsByArtist, upcoming, allLots]);

  // The tape: the biggest hammers among recent sales (recent-first, then by
  // value) — records the market actually just paid.
  const tapeItems = useMemo(() =>
    sold.slice(0, 90)
      .filter(l => l.priceUsd && l.title)
      .sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0))
      .slice(0, 18)
      .map(l => ({
        artist: ARTIST_LABEL[l.artist] || l.artist,
        title: l.title.length > 44 ? l.title.slice(0, 42) + '…' : l.title,
        price: formatPrice(l.priceUsd!),
        house: l.auctionHouse,
      })),
    [sold]
  );

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

      <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} />

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
          {/* The market as a portfolio: giant numeral, green performance line */}
          <div className="ray-enter">
            <MarketHero statsByArtist={statsByArtist} totalValue={totalRealized} pulse={pulse} />
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
              <MarketBlock upcoming={upcoming} allLots={allLots} />
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
                {lastCrawl && (
                  <span style={{ fontSize: 13, color: 'var(--color-text-faint)' }}>
                    Updated {formatDate(lastCrawl)}
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
              />

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
                        allLots={allLots}
                        stats={statsByArtist[lot.artist]}
                        saved={isSaved(lot.id)}
                        onToggleSave={toggle}
                      />
                    </div>
                  ))
                )}
              </div>

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
