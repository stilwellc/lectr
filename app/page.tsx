'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ARTIST_LABEL, MARKETS, marketArtists } from './constants';
import { useMarket } from './lib/market';
import { useRayData, useSoldArchive, retryArchiveLoad } from './hooks/useRayData';
import { useSavedLots } from './hooks/useSavedLots';
import { formatDate, formatPrice, getUpcomingCounts, craftTitle, sportOf, httpsImg, fmtSignedPct } from './utils';
import ArtistNav from './components/ArtistNav';
import LotCard, { lotSignal, confidenceMeter } from './components/LotCard';
import { dealScore, signalMagnitude } from './lib/comps';
import ComparableModal from './components/ComparableModal';
import type { AuctionLot } from './types';
import PastResults from './components/PastResults';
import RayEntrance, { RayLoading } from './components/RayEntrance';
import CountUp from './components/CountUp';
import BoardDemand from './components/BoardDemand';
import ApprBarometer from './components/ApprBarometer';
import SettlementSlip from './components/SettlementSlip';
import MarketSwitch from './components/MarketSwitch';
import FeedToolbar, { FeedFilters, FEED_DEFAULTS } from './components/FeedToolbar';
import { weekDaysFor } from './components/HammerWeek';
import { CallPlate, Colophon, daysWord } from './components/Terminal';
import Flick from './components/Flick';
import Greeting from './components/Greeting';

// W13 contract: useSavedLots grows a savedMeta record (hook agent's edit).
// Read it defensively — a stable empty fallback keeps memo deps quiet.
type SavedMeta = Record<string, { savedAt: string; estMid: number | null; signalPct: number | null; bidCount: number | null }>;
const EMPTY_SAVED_META: SavedMeta = {};

// The eager recentSold slice (from upcoming.json) — lightweight Goldin closes
// so the sports/science Recent-results row paints without the 10MB archive.
type RecentSoldRow = { id: string; title: string; artist: string; priceUsd?: number; house?: string; saleDate?: string; url?: string; priceBasis?: string; category?: string; objectType?: string; eventKey?: string };

// SAME-SALE RUN COLLAPSE — a consecutive run of >= RUN_MIN signal-less cards
// from one house + sale day (fossil/meteorite runs) folds behind one ruled
// header row, default-collapsed. Lots WITH a below/above signal never fold.
const RUN_MIN = 8;
type FeedEntry =
  | { type: 'lot'; lot: AuctionLot }
  | { type: 'run'; key: string; house: string; day: string; lots: AuctionLot[] };

// The ledger line's cells — typed once so optional lens/week flags don't
// splinter the array into incompatible object literals.
type StripItem = {
  k: string;
  to: number;
  format: (n: number) => string;
  s: string;
  tone?: 'up';
  /** the flagged cell — clicking opens the below-market lens at the feed */
  lens?: boolean;
};

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

// The full sports/science results table — mounted ONLY when the reader opens
// "Show the archive". Mounting is what triggers useSoldArchive()'s phase-3
// fetch, so a first paint on any market never pulls the 10MB sold-archive.
function ArchiveResults({
  mktSet,
  savedIds,
  onToggleSave,
}: {
  mktSet: Set<string>;
  savedIds: string[];
  onToggleSave: (id: string) => void;
}) {
  const { allLotsWithArchive, archiveLoaded, archiveError } = useSoldArchive();
  const archiveSold = useMemo(
    () =>
      allLotsWithArchive
        .filter(l => l.status === 'sold' && l.priceUsd && mktSet.has(l.artist))
        .sort((a, b) => (a.saleDate > b.saleDate ? -1 : a.saleDate < b.saleDate ? 1 : 0)),
    [allLotsWithArchive, mktSet]
  );

  if (archiveError) {
    return (
      <div className="ray-recordband" style={{ marginTop: 24, textAlign: 'center', padding: '48px 20px' }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
          The sold archive didn&rsquo;t load. Check your connection and try again.
        </p>
        <button className="ray-call-btn ray-call-btn-primary" onClick={() => retryArchiveLoad()}>
          Retry
        </button>
      </div>
    );
  }
  if (!archiveLoaded) {
    return <div className="ray-recordband" style={{ marginTop: 24 }}><RayLoading /></div>;
  }
  return (
    <div className="ray-recordband" style={{ marginTop: 24 }}>
      <PastResults lots={archiveSold} showArtist savedIds={savedIds} onToggleSave={onToggleSave} />
    </div>
  );
}

export default function RayPage() {
  const ray = useRayData();
  const { allLots, statsByArtist, demand, realized, recentSold, backtest, market: marketData, lastCrawl, loading, fullLoaded, error, fromCache } = ray;
  const { market, setMarket } = useMarket();
  const marketMeta = MARKETS.find(m => m.key === market)!;
  // ONE TODAY, ONE SERIAL — the crawl day is the data's "today" and the whole
  // page prints one edition date from it: the ledger footer, the barometer's
  // serial, the settlement slip, the HammerWeek beige lift, the week window.
  const crawlDay = (lastCrawl || new Date().toISOString()).slice(0, 10);
  const editionSerial = crawlDay.replace(/-/g, '');
  // Every market on the board is live — the picked market filters directly.
  const activeKey = market;
  // The lander hero IS the Market demand chart: typical sale vs its estimate,
  // trailing 12 months, full history (demand[activeKey], reaching back to the
  // early 2000s for the majors). No rebased index, no composite — the % demand
  // curve, exactly as it reads on /analytics.

  // Sales-weighted appreciation across the active market's artists — the same
  // stat /analytics leads its portfolio header with, shown beside the demand
  // numeral as a second read (price appreciation vs the demand read).
  const appreciation = useMemo(() => {
    const set = marketArtists(activeKey);
    const stats = Object.entries(statsByArtist)
      .filter(([slug]) => activeKey === 'all' || set.has(slug))
      .map(([, s]) => s);
    const totalRev = stats.reduce((a, s) => a + (s.totalAuctionRevenue || 0), 0);
    if (!totalRev) return null;
    return stats.reduce((a, s) => a + (s.appreciationRate || 0) * (s.totalAuctionRevenue || 0), 0) / totalRev;
  }, [statsByArtist, activeKey]);
  // Full-corpus counts precomputed at build time (meta.json) so the aggregate
  // reads honest totals without the 10MB Goldin sold-archive on the wire.
  const meta = ray as unknown as { totalLots?: number; totalSold?: number };
  const totalLots = meta.totalLots ?? allLots.length;
  // sports/science verticals are Goldin sold-archive lots — never in the eager
  // payload. isSportsScience gates every archive-aware branch below.
  const isSportsScience = activeKey === 'sports' || activeKey === 'science';
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
  // Below 640px the table view is thumb+name with unhinted side-scroll — not
  // a real choice. Hide the toggle and force the card view (the persisted
  // preference survives untouched for desktop).
  const [narrowView, setNarrowView] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => setNarrowView(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  const effectiveView: 'grid' | 'table' = narrowView ? 'grid' : feedView;

  // Lenses are scoped to the market they were picked in — a sport chosen in
  // Sports (or a maker in Watches) must not silently empty another market's
  // feed with no visible pill. Market switches drop the scoped lenses;
  // query, sort and the below-market lens travel with the reader.
  useEffect(() => {
    setFeedFilters(f =>
      f.vertical === null && f.maker === null && f.sport === null && f.category === null && f.saleDay == null
        ? f
        : { ...f, vertical: null, maker: null, sport: null, category: null, saleDay: null }
    );
  }, [activeKey]);

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return marketLots
      // resultsPending lots are held visible (live/just-closed) even though the
      // parsed sale date can read as past — a timed auction closes lots per-day
      // and the sale-level date lags, so a live lot must not be filtered out.
      .filter(l => l.status === 'upcoming' && l.saleDate && (l.saleDate >= today || (l.resultsPending && l.saleDate.slice(0, 10) >= today)))
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
    const hasSig = new Set<string>(); // any signal, either direction — run-collapse reads this
    upcoming.forEach(l => {
      const s = lotSignal(l, marketLots);
      if (s) hasSig.add(l.id);
      if (s && s.label === 'Below Market') { ids.add(l.id); pct.set(l.id, s.pct); }
    });
    return { ids, pct, hasSig };
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
    if (f.saleDay) arr = arr.filter(l => l.saleDate?.slice(0, 10) === f.saleDay);
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
      // biggest-gap lens ranks by dealScore (calibrated odds first, gap capped
      // at 400%) — a +5976% data fault can never lead the lens. Reuses the
      // belowSignal pass; unflagged lots sink.
      const pct = belowSignal.pct;
      const score = (l: AuctionLot) => {
        const p = pct.get(l.id);
        return p == null ? -Infinity : dealScore(l, p);
      };
      arr = [...arr].sort((a, b) => score(b) - score(a));
    } else if (f.sort === 'newest') {
      // firstSeen is crawl-stamped and may be absent on older data — unseen sinks
      const seen = (l: AuctionLot) => l.firstSeen || '';
      arr = [...arr].sort((a, b) => (seen(a) < seen(b) ? 1 : seen(a) > seen(b) ? -1 : 0));
    } else {
      // 'soonest' — already-hammered lots (past sale date, results lagging)
      // must not outrank genuinely-upcoming lots: stable-partition them to the
      // bottom, date order preserved within each half.
      const past = (l: AuctionLot) => !!l.resultsPending && !!l.saleDate && l.saleDate.slice(0, 10) < crawlDay;
      arr = [...arr.filter(l => !past(l)), ...arr.filter(past)];
      if (!q && !f.vertical && !f.maker && !f.sport && !f.category && !f.belowOnly && !f.saleDay) {
        // the default view ('soonest', no lenses) gets the maker diversity cap
        arr = diversifyFeed(arr, pageSize);
      }
    }
    return arr; // 'soonest' under a lens keeps the date order upcoming already has
  }, [upcoming, feedFilters, belowSignal, belowIds, pageSize, crawlDay]);

  // SAME-SALE RUN COLLAPSE — walk the feed once, folding consecutive runs of
  // >= RUN_MIN signal-less lots that share a house + sale day into one entry.
  // The card grid paginates over THESE entries, so a collapsed run counts
  // once toward the page window.
  const feedItems = useMemo<FeedEntry[]>(() => {
    const hasSig = belowSignal.hasSig;
    const items: FeedEntry[] = [];
    let i = 0;
    while (i < feed.length) {
      const l = feed[i];
      const day = l.saleDate?.slice(0, 10) || '';
      let j = i;
      while (
        j < feed.length &&
        feed[j].auctionHouse === l.auctionHouse &&
        (feed[j].saleDate?.slice(0, 10) || '') === day &&
        !hasSig.has(feed[j].id)
      ) j++;
      if (j - i >= RUN_MIN) {
        items.push({ type: 'run', key: `${l.auctionHouse}|${day}|${l.id}`, house: l.auctionHouse, day, lots: feed.slice(i, j) });
        i = j;
      } else {
        items.push({ type: 'lot', lot: l });
        i++;
      }
    }
    return items;
  }, [feed, belowSignal]);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});

  // Lens changes re-run the card entrance. Search typing is deliberately NOT
  // in the key: rekeying per keystroke would remount all visible cards per
  // character — keyed reconciliation by lot.id handles search narrowing.
  const feedKey = useMemo(() => {
    const f = feedFilters;
    return `${f.vertical}|${f.maker}|${f.sport}|${f.category}|${f.belowOnly}|${f.sort}|${f.saleDay ?? ''}`;
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

  // Companions for the appreciation column (typical 12-month sale + record) —
  // the lone floating numeral read as a void beside the chart.
  const soldMedian12 = useMemo(() => {
    const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const px = sold.filter(l => l.saleDate >= cutoff).map(l => l.priceUsd!).sort((a, b) => a - b);
    if (px.length < 5) return null;
    return px.length % 2 ? px[px.length >> 1] : (px[px.length / 2 - 1] + px[px.length / 2]) / 2;
  }, [sold]);
  const recordSale = useMemo(() => (sold.length ? sold.reduce((b, l) => ((l.priceUsd || 0) > (b.priceUsd || 0) ? l : b), sold[0]) : null), [sold]);

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

  // Sports/science Recent-results ROW paints from the eager recentSold slice —
  // the last ~40 Goldin closes precomputed into upcoming.json — so the row
  // renders without the 10MB sold-archive. The full table lazy-loads it.
  const recentRows = useMemo(
    () => (isSportsScience ? ((recentSold[activeKey] as RecentSoldRow[] | undefined) || []) : []),
    [isSportsScience, recentSold, activeKey]
  );
  // The recent-slice median realized price — an honest $ line, never a % vs
  // estimate (Goldin publishes no estimates).
  const recentMedian = useMemo(() => {
    const prices = recentRows.map(r => r.priceUsd).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
    return prices.length ? prices[Math.floor(prices.length / 2)] : null;
  }, [recentRows]);
  const recentLatest = useMemo(() => {
    let latest = '';
    for (const r of recentRows) if (r.saleDate && r.saleDate > latest) latest = r.saleDate;
    return latest;
  }, [recentRows]);

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

  // ONE WEEK — the ledger's "Hammers this week" counts against the Mon–Sun
  // UTC window of the crawl day's week, and the "across N houses" sub is
  // scoped to that week's lots, not the whole pool.
  const hammerWeek = useMemo(() => {
    const days = new Set(weekDaysFor(crawlDay));
    const weekLots = upcoming.filter(l => days.has(l.saleDate?.slice(0, 10) || ''));
    return { count: weekLots.length, houses: new Set(weekLots.map(l => l.auctionHouse)).size };
  }, [upcoming, crawlDay]);

  // "Next hammer" must be a lot that hasn't hammered: soonest saleDate on or
  // after the crawl day (upcoming is date-sorted; past resultsPending lots
  // held visible in the pool must never lead this line). Worded against the
  // crawl day — the edition's clock — in whole UTC days, so it can never
  // slip into the past tense (daysWord reads the client clock, which drifts
  // past-tense on UTC evenings).
  const nextHammer = useMemo(() => {
    const lot = upcoming.find(l => l.saleDate && l.saleDate.slice(0, 10) >= crawlDay) || null;
    if (!lot) return null;
    const d = Math.round((Date.parse(`${lot.saleDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${crawlDay}T00:00:00Z`)) / 86_400_000);
    const word = d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`;
    return { lot, word };
  }, [upcoming, crawlDay]);

  const strip = useMemo<StripItem[]>(() => {
    const active = upcoming;
    const withEst = active.filter(l => (l.estimateLow || 0) > 0 || (l.estimateHigh || 0) > 0);
    const estValue = withEst.reduce((sum, l) => {
      const lo = l.estimateLow || l.estimateHigh || 0;
      const hi = l.estimateHigh || l.estimateLow || 0;
      return sum + (lo + hi) / 2;
    }, 0);
    const liveHouses = new Set(active.map(l => l.auctionHouse)).size;
    const asComma = (n: number) => Math.round(n).toLocaleString();
    // ONE WEEK: the crawl day's Mon–Sun window
    const thisWeek = hammerWeek.count;
    const priceOrDash = (n: number) => (n > 0 ? formatPrice(n) : '—');
    // "across 1 houses" reads like a bug; a 0-count week says so in words.
    const hammersSub = thisWeek === 0
      ? 'none scheduled this week'
      : `across ${hammerWeek.houses} ${hammerWeek.houses === 1 ? 'house' : 'houses'}`;
    // Estimate-less verticals (sports = Goldin bid sales) have no mid-estimate
    // total and nothing to flag — show real figures instead of a dead "—" / "0".
    if (estValue === 0 && active.length > 0) {
      return [
        { k: 'Realized all-time', to: totalRealized, format: priceOrDash, s: topArtist ? `led by ${topArtist}` : 'across the market' },
        { k: 'On the block', to: active.length, format: asComma, s: 'live lots — bid sales, no estimates' },
        { k: 'Hammers this week', to: thisWeek, format: asComma, s: hammersSub },
        { k: 'Live houses', to: liveHouses, format: asComma, s: 'sourcing this market' },
      ];
    }
    return [
      { k: 'Realized all-time', to: totalRealized, format: priceOrDash, s: topArtist ? `led by ${topArtist}` : 'across the market' },
      { k: 'On the block', to: estValue, format: priceOrDash, s: estValue > 0 ? `${asComma(active.length)} lots, mid-estimates` : `${asComma(active.length)} lots — bid sales, no estimates` },
      { k: 'Hammers this week', to: thisWeek, format: asComma, s: hammersSub },
      { k: 'Flagged below market', to: belowIds.size, format: asComma, s: 'against true comps', tone: 'up', lens: true },
    ];
  }, [upcoming, belowIds, totalRealized, topArtist, hammerWeek]);

  // The board rail's watchlist strip — what changed since you saved.
  const watchStrip = useMemo(() => {
    if (savedIds.length === 0) return null;
    const idSet = new Set(savedIds);
    const mine = allLots.filter(l => idSet.has(l.id));
    if (mine.length === 0) return null;
    const today = new Date().toISOString().split('T')[0];
    const live = mine
      // resultsPending lots are held visible (live/just-closed) even though the
      // parsed sale date can read as past — a timed auction closes lots per-day
      // and the sale-level date lags, so a live lot must not be filtered out.
      .filter(l => l.status === 'upcoming' && l.saleDate && (l.saleDate >= today || (l.resultsPending && l.saleDate.slice(0, 10) >= today)))
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
    // "next hammer" must be genuinely future — a past-dated resultsPending lot
    // stays visible in the list but can never be "next" (it already hammered)
    const future = live.filter(l => l.saleDate >= today);
    return { count: mine.length, next: future[0] || null, bestMove };
  }, [savedIds, savedMeta, allLots]);

  // The call plate + watchlist strip, extracted so they can live either in the
  // right rail (markets with no appreciation stat) or full-width below the
  // board (markets that show the Appreciation panel to the right of the graph).
  const callPlateEl = (
    <CallPlate lots={marketLots} allLots={marketLots} market={activeKey} isSaved={isSaved} onToggleSave={toggle} />
  );
  const watchStripEl = watchStrip ? (
    <Link href="/saved" className="ray-watchstrip" aria-label={`Your watchlist — ${watchStrip.count} saved`}>
      <span className="ray-watchstrip-k">Your watchlist</span>
      <span className="ray-watchstrip-line">
        {watchStrip.count} saved
        {watchStrip.next && <> · next hammer {daysWord(watchStrip.next.saleDate)}</>}
        {watchStrip.bestMove && (
          <> · best move <b className="up">+{Math.round(watchStrip.bestMove.from)}% → +{Math.round(watchStrip.bestMove.to)}%</b></>
        )}
      </span>
      <span className="ray-watchstrip-cta">Open saved <Flick size={12} /></span>
    </Link>
  ) : null;
  const marketName = activeKey === 'all' ? 'The total market' : marketMeta.label;
  const hasAppr = appreciation != null;
  const apprValue = hasAppr ? `${appreciation >= 0 ? '+' : ''}${appreciation.toFixed(1)}%` : '';
  const apprTone = hasAppr && appreciation >= 0 ? 'up' : 'down';

  return (
    <>
    <Greeting />
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

      {/* R2 · the category nav — the six-pill row folded into one dropdown.
          No category: a lit "Choose a category" control. Category chosen: a
          chip + quiet "Change category" — the feed toolbar's filters lead. */}
      <div className="rail" style={{ paddingTop: 14 }}>
        <MarketSwitch compact lit />
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
                {(demand[activeKey] && demand[activeKey].length >= 4) ? (
                  /* THE MARKET DEMAND CHART — typical sale vs its estimate,
                     trailing 12 months, full history. The lander hero. */
                  <BoardDemand
                    allLots={marketLots}
                    demand={demand[activeKey]}
                    marketLabel={activeKey === 'all' ? 'total' : marketMeta.label.toLowerCase()}
                  />
                ) : activeKey === 'sports' ? (
                  /* Goldin publishes no estimates → realized cohort median */
                  <BoardDemand
                    allLots={marketLots}
                    demand={realized['sports'] || []}
                    marketLabel={marketMeta.label.toLowerCase()}
                    mode="realized"
                    cohortLabel="tickets & passes"
                  />
                ) : (
                  <BoardDemand
                    allLots={marketLots}
                    demand={demand[activeKey] || []}
                    marketLabel={activeKey === 'all' ? 'total' : marketMeta.label.toLowerCase()}
                  />
                )}
              </div>
              {hasAppr ? (
                /* Desktop: the Appreciation instrument sits to the right of the
                   graph. Mobile: the same component shows its landscape POCKET
                   BAROMETER face under the chart — the barometer's internal
                   media classes pick the face, the aside just supplies paper. */
                <aside className="ray-appr ray-paper" aria-label={`${marketName} appreciation`}>
                  {/* the printed instrument card — an ink barometer on the paper */}
                  <ApprBarometer
                    value={appreciation}
                    marketName={marketName}
                    serial={editionSerial}
                    /* bid markets (sports/science) carry no eager sold archive —
                       fall back to the precomputed recent-slice median so the
                       dotted-leader row prints a real figure, not a dash */
                    typical={soldMedian12 ?? recentMedian}
                    typicalLabel={soldMedian12 == null && recentMedian != null ? 'Typical sale, recent' : undefined}
                    record={recordSale ? { priceUsd: recordSale.priceUsd || 0, maker: ARTIST_LABEL[recordSale.artist] || recordSale.artist } : null}
                  />
                </aside>
              ) : (
                <aside aria-label="Today's call and your watchlist" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                  {callPlateEl}
                  {watchStripEl}
                </aside>
              )}
            </div>
            {hasAppr && (
              /* Today's call bumped below both the graph and the appreciation
                 panel, full width. */
              <div className="ray-board-belowrow">
                {callPlateEl}
                {watchStripEl}
              </div>
            )}
            {backtest && backtest.flagged.n > 500 && (
              <a href="/value" className="ray-proofstrip">
                Flagged calls hammered <b className="up">+{backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct}%</b> over
                their estimates — unflagged hammered {(backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct) >= 0 ? '+' : ''}{backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct}% — across {backtest.flagged.n.toLocaleString()} replayed
                sales{activeKey !== 'all' ? ' · all markets' : ''} · the record <Flick size={12} />
              </a>
            )}
          </div>

          {/* The market in four figures — the flagged figure IS the lens */}
          {/* the numbers layer rides the paper band — THE LEDGER LINE, ruled
              and centered like a catalogue's front-matter table, in the same
              certificate language as the barometer beside the chart */}
          <div className="ray-band" style={{ marginTop: 30, paddingBlock: '22px 18px' }}>
          <section className="rail ray-enter" style={{ paddingTop: 0 }}>
            {/* certificate double rule + title line */}
            <div style={{ borderTop: '2px solid currentColor', marginBottom: 2 }} />
            <div style={{ borderTop: '1px solid var(--paper-line)', marginBottom: 10 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>
              <span>The ledger</span>
              <span style={{ color: 'var(--paper-muted)', fontWeight: 600 }}>{marketName}</span>
            </div>
            <div className="ray-ledger" style={{ margin: 0 }}>
              {strip.map(item => item.lens && item.to > 0 ? (
                <button
                  key={item.k}
                  type="button"
                  onClick={openBelowLens}
                  aria-label="See flagged lots on the block, biggest gap first"
                  style={{ background: 'none', border: 'none', margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
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
            {/* microtype footer, dated like the barometer's certificate */}
            <div style={{ borderTop: '1px solid var(--paper-line)', marginTop: 2, paddingTop: 7, display: 'flex', justifyContent: 'space-between', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--paper-muted)' }}>
              <span>every estimate, read against every hammer</span>
              <span>no. {editionSerial}</span>
            </div>
          </section>
          </div>

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
                {/* only a lot that hasn't hammered yet may claim "next" —
                    past-dated resultsPending lots never lead this line */}
                {nextHammer && (
                  <span style={{ fontSize: 13, color: 'var(--color-text-faint)' }}>
                    Next hammer: {nextHammer.word} · {nextHammer.lot.auctionHouse}
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
                view={effectiveView}
                onViewChange={handleView}
                pageSize={pageSize}
                showToggle={!narrowView}
              />

              {effectiveView === 'table' && feed.length > 0 ? (
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
                          <tr
                            key={lot.id}
                            onClick={() => setTableLot(lot)}
                            onKeyDown={e => { if (e.key === 'Enter') setTableLot(lot); }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Comps for ${craftTitle(lot.title)}`}
                            style={{ cursor: 'pointer' }}
                          >
                            <td style={{ width: 56 }}>
                              {/* the plate paints behind the img — the honest fallback
                                  when a house hotlink-blocks; hide, never outerHTML
                                  (React must keep owning this node) */}
                              <span className="thumb-plate" style={{ position: 'relative' }}>
                                {(lot.title || '?').charAt(0)}
                                {lot.imageUrl && (
                                  <img
                                    className="thumb"
                                    src={httpsImg(lot.imageUrl)}
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
                              {lot.estimateLow && lot.estimateHigh
                                ? (formatPrice(lot.estimateLow) === formatPrice(lot.estimateHigh)
                                    ? formatPrice(lot.estimateLow)
                                    : `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)}`)
                                : '—'}
                            </td>
                            <td>
                              {sig
                                ? <span className={sig.label === 'Below Market' ? 't-sig-up' : 't-sig-down'}>
                                    {signalMagnitude(sig.label, sig.pct)}<span style={{ color: 'var(--color-text-faint)', marginLeft: 5 }}>{sig.label === 'Below Market' ? 'under comps' : 'over comps'}</span>
                                    <span title={`${confidenceMeter(sig.confidence).word} confidence`} style={{ marginLeft: 6, fontSize: 8.5, letterSpacing: 1, opacity: 0.8 }}>
                                      {confidenceMeter(sig.confidence).dots}
                                    </span>
                                  </span>
                                : <span style={{ color: 'var(--color-text-faint)' }}>—</span>}
                            </td>
                            <td style={{ width: 44 }}>
                              <button
                                className="ray-save-btn ray-tbl-save"
                                onClick={e => { e.stopPropagation(); toggle(lot.id, lot); }}
                                aria-label={isSaved(lot.id) ? 'Remove from saved' : 'Save lot'}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: isSaved(lot.id) ? 'var(--color-fg)' : 'var(--color-bg-elevated)', border: 'none', borderRadius: 100, cursor: 'pointer', padding: 0 }}
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
                  feedItems.slice(0, visibleUpcoming).map((item, i) =>
                    item.type === 'lot' ? (
                      <div
                        key={item.lot.id}
                        className="ray-feed-rekey"
                        // minWidth 0 zeroes the grid item's automatic minimum —
                        // the compact row's nowrap lines must ellipsize, not
                        // stretch the track past the viewport
                        style={{ animationDelay: `${Math.min(i, 10) * 40}ms`, minWidth: 0 }}
                      >
                        <LotCard
                          lot={item.lot}
                          showArtist
                          allLots={marketLots}
                          saved={isSaved(item.lot.id)}
                          onToggleSave={toggle}
                          lastCrawl={lastCrawl || undefined}
                        />
                      </div>
                    ) : (
                      /* a folded same-sale run — one ruled header row for the
                         whole house+day block; one tap expands it in place */
                      <div
                        key={item.key}
                        className="ray-feed-rekey"
                        style={{ gridColumn: '1 / -1', animationDelay: `${Math.min(i, 10) * 40}ms`, minWidth: 0 }}
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedRuns(r => ({ ...r, [item.key]: !r[item.key] }))}
                          aria-expanded={!!expandedRuns[item.key]}
                          aria-label={`${item.house}, ${formatDate(item.day)} — ${item.lots.length} lots without a market signal. ${expandedRuns[item.key] ? 'Collapse' : 'Expand'} the run.`}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 8,
                            background: 'none',
                            border: 'none',
                            borderTop: '1px solid var(--color-border)',
                            borderBottom: '1px solid var(--color-border)',
                            margin: 0,
                            padding: '12px 2px',
                            cursor: 'pointer',
                            textAlign: 'left',
                            color: 'var(--color-text-muted)',
                            fontFamily: 'var(--font-sans), sans-serif',
                          }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-fg)', whiteSpace: 'nowrap' }}>
                            {item.house} · {formatDate(item.day)}
                          </span>
                          <span style={{ fontSize: 12.5, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            — {item.lots.length}{(() => {
                              const a = item.lots[0].artist;
                              return item.lots.every(l => l.artist === a) ? ` ${(ARTIST_LABEL[a] || a).toLowerCase()}` : '';
                            })()} lots
                          </span>
                          <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                            {expandedRuns[item.key] ? 'hide' : 'show'} <Flick size={10} />
                          </span>
                        </button>
                        {expandedRuns[item.key] && (
                          <div className="ray-upcoming-grid" style={{ marginTop: 24 }}>
                            {item.lots.map(lot => (
                              <LotCard
                                key={lot.id}
                                lot={lot}
                                showArtist
                                allLots={marketLots}
                                saved={isSaved(lot.id)}
                                onToggleSave={toggle}
                                lastCrawl={lastCrawl || undefined}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  )
                )}
              </div>
              )}

              {tableLot && (
                <ComparableModal lot={tableLot} allLots={marketLots} onClose={() => setTableLot(null)} />
              )}

              {visibleUpcoming < (effectiveView === 'table' ? feed.length : feedItems.length) && (
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
                    Show more ({((effectiveView === 'table' ? feed.length : feedItems.length) - visibleUpcoming).toLocaleString()} remaining)
                  </button>
                </div>
              )}
            </section>
          )}

          {/* R7 · THE RECORD — sports/science verticals are Goldin sold-archive
              lots (split out of the eager payload): the row paints from the
              lightweight recentSold slice, and only opening the archive mounts
              ArchiveResults → useSoldArchive() → the 10MB fetch. */}
          {isSportsScience ? (
            recentRows.length > 0 && (
              <div className="ray-enter" style={{ '--enter-delay': '180ms' } as React.CSSProperties}>
                <SettlementSlip
                  marketName={marketName}
                  serial={editionSerial}
                  archiveOpen={showArchive}
                  onToggleArchive={() => setShowArchive(s => !s)}
                  lines={[
                    { k: 'Sold lots on the book', v: (meta.totalSold ?? recentRows.length).toLocaleString() },
                    ...(recentMedian !== null ? [{ k: 'Recent median, realized', v: formatPrice(recentMedian) }] : []),
                    ...(recentLatest ? [{ k: 'Latest hammer', v: formatDate(recentLatest) }] : []),
                  ]}
                />
                {/* the archive is a dark table — it renders BELOW the paper, never on it */}
                {showArchive && (
                  <section className="rail" style={{ paddingBlock: '8px 40px' }}>
                    <ArchiveResults mktSet={mktSet} savedIds={savedIds} onToggleSave={toggle} />
                  </section>
                )}
              </div>
            )
          ) : sold.length > 0 && (activeKey === 'all' ? (
            <div className="ray-enter" style={{ '--enter-delay': '180ms' } as React.CSSProperties}>
              <SettlementSlip
                marketName={marketName}
                serial={editionSerial}
                archiveOpen={showArchive}
                onToggleArchive={() => setShowArchive(s => !s)}
                lines={[
                  { k: 'Sold lots on the book', v: sold.length.toLocaleString() },
                  ...(soldMedianPct !== null ? [{ k: 'Median hammer vs estimate', v: fmtSignedPct(soldMedianPct), signed: soldMedianPct }] : []),
                  ...(sold[0].saleDate ? [{ k: 'Latest hammer', v: formatDate(sold[0].saleDate) }] : []),
                ]}
              />
              {showArchive && (
                <section className="rail" style={{ paddingBlock: '8px 40px' }}>
                  <div className="ray-recordband" style={{ marginTop: 0 }}>
                    <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="ray-recordband ray-enter" style={{ '--enter-delay': '180ms' } as React.CSSProperties}>
              <div className="rail">
                <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
              </div>
            </div>
          ))}

          {/* R8 · THE COLOPHON — the provenance ring's closing clasp */}
          <Colophon
            lotCount={totalLots}
            houseCount={new Set(allLots.map(l => l.auctionHouse)).size}
            record={backtest?.flagged ? { n: backtest.flagged.n, medianPerfPct: backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct } : null}
          />
        </RayEntrance>
      )}
    </div>
    </>
  );
}
