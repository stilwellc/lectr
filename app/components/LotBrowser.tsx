'use client';

/* ============================================================
   LOT BROWSER — the home feed's live-lot machinery, scoped to any
   pool of live lots: the "What matters" / "All lots" tabs, the
   FeedToolbar (search, sort pills, triage, Narrow facets, phone
   sheet), the ledger table / card grid / phone rows, folded
   near-duplicates, Show more, and the empty states.

   Lifted verbatim out of app/preview/terminal/TerminalHome.tsx
   (Oct 9) so the maker page browses its book with the exact same
   instrument the home feed uses. The CALLER owns the section and
   its heading, and the filter state (URL-synced via useUrlState);
   this component owns the view (table/grid), the page size and
   the pagination.
   ============================================================ */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Market } from '../constants';
import type { AuctionLot } from '../types';
import { formatDate, formatPrice, craftTitle, httpsImg, sizedImg, localToday, trueSaleDay } from '../utils';
import LotCard, { lotSignal, confidenceMeter } from './LotCard';
import { signalMagnitude } from '../lib/comps';
import ComparableModal from './ComparableModal';
import FeedToolbar, { FeedFilters, FEED_DEFAULTS } from './FeedToolbar';
import { houseBaselines, type HouseBaselines } from '../lib/feed-filters';
import { shortlist, reasonOf, forYou } from '../lib/priority';
import { makerLineOf, subColumnOf } from '../lib/lot-labels';
import { foldVariants, foldNote, foldQuery, crossSibs, crossNote } from '../lib/fold';
import { affinityOf, type Follow } from '../lib/follows';
import { feedPass } from '../lib/lot-browser';
import { useLotModal } from '../lib/use-lot-modal';
import Flick from './Flick';

const NOOP = () => {};

export type BelowSignal = { ids: Set<string>; pct: Map<string, number>; hasSig: Set<string> };

/** One shared below-market pass over a live pool. */
export function belowSignalOf(upcoming: AuctionLot[], compLots: AuctionLot[]): BelowSignal {
  const ids = new Set<string>();
  const pct = new Map<string, number>();
  const hasSig = new Set<string>();
  upcoming.forEach(l => {
    const s = lotSignal(l, compLots);
    if (s) hasSig.add(l.id);
    if (s && s.label === 'Below Market') { ids.add(l.id); pct.set(l.id, s.pct); }
  });
  return { ids, pct, hasSig };
}

// Ledger-table dressing: the days-to-hammer count (whole days from the reader's local day to the true
// sale day — "In 2d" is a promise to the user, so it runs on the user's clock,
// the same one the feed filter uses).
function daysToHammer(l: AuctionLot, todayDay: string): number | null {
  const day = trueSaleDay(l);
  if (!day) return null;
  const d = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayDay}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(d) ? d : null;
}

// The mobile feed's compact row — signal-less lots fold to one ruled line
// (thumb · maker · title · est/bid · date) instead of a full-bleed card.
// Tapping opens the same comps context the card offers.
// The row glow's verdict, from EVERY signal tier the engine publishes:
// 1. the comp signal (Below/Above Market), 2. the engine's value read vs
// estimate (below/above comparable market), 3. the live-bid read (bid below/
// above recent comps — the Goldin book, where most of the coverage lives).
// 'at market' / 'in line' stay quiet on purpose.
function feedTone(lot: AuctionLot, belowIds: Set<string>, hasSig: Set<string>): 'up' | 'down' | undefined {
  if (belowIds.has(lot.id)) return 'up';
  if (hasSig.has(lot.id)) return 'down';
  const vs = lot.value?.signal?.label;
  if (vs === 'below comparable market') return 'up';
  if (vs === 'above comparable market') return 'down';
  const vb = lot.value?.vsBid?.label;
  if (vb === 'below recent comps') return 'up';
  if (vb === 'above recent comps') return 'down';
  return undefined;
}

// #5 · bid-velocity marker — the crawl-measured "moving now" read for live
// Goldin lots (delta bids added over the trailing window). Descriptive count,
// butter accent (attention, NOT up/down), never green/red.
function bidVel(lot: AuctionLot): { delta: number; hours: number } | null {
  const v = lot.bidVelocity;
  return v && v.delta > 0 && lot.status === 'upcoming' ? { delta: v.delta, hours: Math.round(v.hours) } : null;
}
// A blank Bids cell means one of two very different things, and the table used
// to print the same em-dash for both: this house publishes a live bid book and
// nobody has bid yet (→ 0), or the house never publishes one at all (→ not
// tracked). `housesWithBids` is derived from the pool itself, so a house that
// starts publishing is picked up on the next crawl with no code change.
// "Oct 14, 2026" is not enough for a timed online sale — the hour decides
// whether you are bidding or reading results. When the crawl parsed a real
// timestamp, the cell carries the exact close in the READER's zone, named.
function saleWhenTitle(lot: AuctionLot): string | undefined {
  const t = lot.saleDateTime ? Date.parse(lot.saleDateTime) : NaN;
  if (!Number.isFinite(t)) return lot.saleDate ? `Sale date ${lot.saleDate} — the house did not publish a close time` : undefined;
  return `Hammers ${new Date(t).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })} · your local time`;
}
function housePublishesBids(lot: AuctionLot, houses: Set<string>): boolean {
  return houses.has(String(lot.auctionHouse || ''));
}
function bidCellFace(lot: AuctionLot, houses: Set<string>): string {
  if (typeof lot.bidCount === 'number') return lot.bidCount.toLocaleString();
  if (bidVel(lot)) return '';                       // velocity carries the read
  return housePublishesBids(lot, houses) ? '0' : '—';
}
function bidCellTitle(lot: AuctionLot, houses: Set<string>): string {
  if (typeof lot.bidCount === 'number') {
    const v = bidVel(lot);
    const bw = lot.bidCount === 1 ? 'bid' : 'bids';
    return v ? `${lot.bidCount} ${bw} · ${v.delta} added in the last ${v.hours}h` : `${lot.bidCount} ${bw}`;
  }
  if (bidVel(lot)) return `${lot.auctionHouse} posts bid activity but not a running count`;
  return housePublishesBids(lot, houses)
    ? 'No bids yet'
    : `${lot.auctionHouse} does not publish a live bid count`;
}
function BidVelChip({ lot }: { lot: AuctionLot }) {
  const v = bidVel(lot);
  if (!v) return null;
  return (
    <span className="ray-bidvel" title={`${v.delta} ${v.delta === 1 ? 'bid' : 'bids'} added in the last ${v.hours}h`}>
      <span className="ray-bidvel-dot" aria-hidden />+{v.delta} {v.delta === 1 ? 'bid' : 'bids'} · {v.hours}h
    </span>
  );
}

function FeedRow({ lot, onOpen, tone, note, onNote }: { lot: AuctionLot; onOpen: () => void; tone?: 'up' | 'down'; note?: string | null; onNote?: () => void }) {
  const est =
    lot.estimateLow || lot.estimateHigh
      ? (lot.estimateLow && lot.estimateHigh && formatPrice(lot.estimateLow) !== formatPrice(lot.estimateHigh)
          ? `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)}`
          : formatPrice(lot.estimateLow || lot.estimateHigh!))
      : lot.currentBid
        ? `bid ${formatPrice(lot.currentBid)}`
        : '—';
  return (
    <button type="button" className="ray-feedrow" onClick={onOpen} aria-label={`Comps for ${craftTitle(lot.title, lot.auctionHouse)}`}>
      <span className="ray-feedrow-thumb" data-tone={tone} aria-hidden>
        {(lot.title || '?').charAt(0)}
        {lot.imageUrl && (
          <img
            // the resizer rung, not the 2880px master (Bonhams ships 600KB+
            // per lot; twenty of them painted white squares for seconds).
            // Transparent until it paints so the monogram behind shows.
            src={sizedImg(httpsImg(lot.imageUrl), 120)}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            style={{ background: 'transparent' }}
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </span>
      <span className="ray-feedrow-main">
        <span className="ray-feedrow-maker">{makerLineOf(lot).name}</span>
        <span className="ray-feedrow-title">{craftTitle(lot.title, lot.auctionHouse)}</span>
        {note && (onNote ? (
          // the row is itself a button: the folded note presses as a link
          // inside it (same type as the plain note — no new chrome)
          <span
            className="ray-feedrow-title"
            role="link"
            tabIndex={0}
            style={{ color: 'var(--color-text-secondary)', fontSize: '0.86em', cursor: 'pointer' }}
            onClick={e => { e.preventDefault(); e.stopPropagation(); onNote(); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onNote(); } }}
          >
            {note}
          </span>
        ) : <span className="ray-feedrow-title" style={{ color: 'var(--color-text-secondary)', fontSize: '0.86em' }}>{note}</span>)}
      </span>
      <span className="ray-feedrow-right">
        <b>{est}</b>
        <span>{formatDate(lot.saleDate)}</span>
        <BidVelChip lot={lot} />
      </span>
    </button>
  );
}

// the feed grid — global ray-* classes the reused LotCard renders into
// (page.tsx carried these in an inline style block; then TerminalHome).
// __html, not a text child: '+' / '>' combinators must not be escaped in SSR.
const GRID_CSS = `
  .terminal-shell .ray-upcoming-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(288px, 1fr));
    gap: 30px 20px;
  }
  @media (max-width: 768px) {
    .terminal-shell .ray-upcoming-grid { grid-template-columns: 1fr; gap: 24px; }
  }
  /* ≤640px the feed reads as a ledger: compact rows stack flush on their
     shared hairlines; the earned full cards keep their air around them */
  @media (max-width: 640px) {
    .terminal-shell .ray-upcoming-grid { gap: 0; }
    .terminal-shell .ray-feeditem-card { margin-bottom: 24px; /* the old grid gap */ }
    .terminal-shell .ray-feeditem-row + .ray-feeditem-card,
    .terminal-shell .ray-feeditem-card + .ray-feeditem-row { margin-top: var(--space-2); }
  }
`;

export interface LotBrowserProps {
  /** the live pool, in hammer order (isLiveUpcoming, sorted by trueSaleDay) */
  lots: AuctionLot[];
  /** the comps pool the signals, cards and modal read */
  compLots: AuctionLot[];
  filters: FeedFilters;
  /** a filter change; `reader` = the reader composed it (pages remember
   *  those), `fold` = a folded note opened its group */
  onFiltersChange: (next: FeedFilters, source: 'reader' | 'fold') => void;
  /** the toolbar's market (its refine rows key off it) */
  market: Market;
  onMarketReset?: () => void;
  /** precomputed below-market pass (home shares it with the wall/hero) */
  belowSignal?: BelowSignal;
  /** the reader's follows — enables the "For you" tab (home) */
  follows?: Follow[];
  /** scoped to one maker's book: the maker lens hides, a saved search
   *  carries the maker; `named` = a real maker (art/design/watches), whose
   *  shortlist can't diversify across makers */
  scope?: { maker: string; named: boolean } | null;
  savedIds?: string[];
  isSaved?: (id: string) => boolean;
  onToggleSave?: (id: string, lot?: AuctionLot) => void;
  lastCrawl?: string | null;
  fromCache?: boolean;
  prevVisitDay?: string | null;
  baselines?: HouseBaselines;
  onResetView?: () => void;
  /** open a lot in the caller's modal; absent → the browser owns one */
  onOpenLot?: (lot: AuctionLot) => void;
  /** the section id a folded note scrolls back to */
  anchorId: string;
  /** remember how far the reader paged (Show more) for this view, per tab
   *  session — Back from a lot reopens the same rows (sessionStorage) */
  persistKey?: string;
}

export default function LotBrowser({
  lots: upcoming,
  compLots,
  filters: feedFilters,
  onFiltersChange,
  market,
  onMarketReset,
  belowSignal: belowSignalProp,
  follows = [],
  scope = null,
  savedIds,
  isSaved: isSavedProp,
  onToggleSave,
  lastCrawl,
  fromCache = false,
  prevVisitDay = null,
  baselines: baselinesProp,
  onResetView,
  onOpenLot,
  anchorId,
  persistKey,
}: LotBrowserProps) {
  const crawlDay = (lastCrawl || new Date().toISOString()).slice(0, 10);
  const savedSet = useMemo(() => new Set(savedIds ?? []), [savedIds]);
  const isSaved = isSavedProp ?? ((id: string) => savedSet.has(id));
  // passed through as-is: a stable callback keeps the memoized cards still
  const toggle = onToggleSave ?? NOOP;
  const baselines = useMemo(() => baselinesProp ?? houseBaselines(upcoming), [baselinesProp, upcoming]);

  // the comps modal: the caller's (home shares one with the wall + board),
  // or this browser's own, joined to history the same way
  const [ownLot, setOwnLot] = useLotModal<AuctionLot>();
  const setTableLot = onOpenLot ?? setOwnLot;

  // 24-card pages on desktop, 12 under 900px — matchMedia, SSR-safe default.
  // The visible count belongs to one filter state: any filter change starts
  // the reader back on one page (keyed, so no effect round-trip).
  const filterSig = useMemo(() => JSON.stringify(feedFilters), [feedFilters]);
  const [pageSize, setPageSize] = useState(24);
  const [vis, setVis] = useState<{ sig: string; n: number }>({ sig: '', n: 24 });
  const visibleUpcoming = vis.sig === filterSig ? vis.n : pageSize;
  const visKey = persistKey ? `lectr-lb-vis:${persistKey}` : null;
  useEffect(() => {
    if (!visKey) return;
    try {
      const v = JSON.parse(sessionStorage.getItem(visKey) || 'null');
      if (v && typeof v.sig === 'string' && typeof v.n === 'number') setVis(v);
    } catch { /* storage blocked */ }
  }, [visKey]);
  const showMore = () => {
    const next = { sig: filterSig, n: visibleUpcoming + pageSize };
    setVis(next);
    if (visKey) try { sessionStorage.setItem(visKey, JSON.stringify(next)); } catch { /* storage blocked */ }
  };
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const apply = () => {
      const size = mq.matches ? 12 : 24;
      setPageSize(size);
      setVis(v => (v.n === 12 || v.n === 24 ? { ...v, n: size } : v));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // The layout choice persists — read after mount (SSR renders the default).
  // A stored preference always wins; with none, desktop (≥900px) earns the
  // ledger table by default while mobile keeps the cards.
  const [feedView, setFeedView] = useState<'grid' | 'table'>('grid');
  useEffect(() => {
    try {
      const v = localStorage.getItem('ray-feedview');
      if (v === 'grid' || v === 'table') { setFeedView(v); return; }
    } catch { /* storage blocked — fall through to the width default */ }
    if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 900px)').matches) {
      setFeedView('table');
    }
  }, []);
  const handleView = (v: 'grid' | 'table') => {
    setFeedView(v);
    try { localStorage.setItem('ray-feedview', v); } catch { /* storage blocked */ }
  };
  // Below 640px force the card view (persisted preference survives for desktop).
  const [narrowView, setNarrowView] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => setNarrowView(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  const effectiveView: 'grid' | 'table' = narrowView ? 'grid' : feedView;

  // Which houses publish a live bid book at all — measured, not hardcoded.
  const housesWithBids = useMemo(() => {
    const s = new Set<string>();
    for (const l of upcoming) if (typeof l.bidCount === 'number') s.add(String(l.auctionHouse || ''));
    return s;
  }, [upcoming]);

  const ownBelow = useMemo(
    () => (belowSignalProp ? null : belowSignalOf(upcoming, compLots)),
    [belowSignalProp, upcoming, compLots]
  );
  const belowSignal = belowSignalProp ?? ownBelow!;
  const belowIds = belowSignal.ids;

  // Every lot passing search + lenses + triage, in the chosen order.
  const scoped = !!scope;
  const feedAll = useMemo(
    () => feedPass(upcoming, feedFilters, {
      belowIds, belowPct: belowSignal.pct, prevVisitDay, baselines, crawlDay, pageSize, scoped,
    }),
    [upcoming, feedFilters, belowSignal, belowIds, pageSize, crawlDay, prevVisitDay, baselines, scoped]
  );

  // The feed the reader sees. "What matters" (the default tab, Matters-most
  // order only) is the capped shortlist of whatever is filtered: ≥$2.5K,
  // closes ≤7d, has evidence; ≤5/category, ≤3/sale, ≤2/maker (a named
  // maker's own page lifts the maker cap — the whole pool is one maker).
  // "For you" (Oct 8): only once the reader follows something (maker,
  // player, category, house) — signed in or not (app/lib/follows)
  const whoCap = scope?.named ? Infinity : undefined;
  const youTab = follows.length > 0 && feedFilters.tab === 'you';
  const wantTop = !youTab && feedFilters.sort === 'priority' && (feedFilters.tab ?? 'top') !== 'all';
  const top = useMemo(
    () => (wantTop || scoped ? shortlist(feedAll, Date.now(), 20, { who: whoCap }) : null),
    [wantTop, scoped, feedAll, whoCap]
  );
  // a scoped book with nothing that clears the shortlist bar opens on every
  // lot instead of an empty "What matters" (and that tab steps aside)
  const topAvailable = !scoped || (top?.length ?? 0) > 0;
  const topTab = wantTop && topAvailable;
  // Oct 9 — near-duplicates FOLD: the same card in several grades at one
  // house (the Munson rookie ×11 at REA), or the same lot title at one house
  // (wax packs ×5), shows once — its best-priority copy — with the others
  // named on the reason line; pressing that line searches the feed for the
  // whole group (app/lib/fold). Off when the reader asked for something by
  // name (a text query or a maker): then every copy is the answer.
  const foldOn = !feedFilters.query.trim() && (scoped || !feedFilters.maker);
  const fold = useMemo(() => (foldOn ? foldVariants(feedAll) : null), [feedAll, foldOn]);
  const feed = useMemo(
    () => (youTab
      ? forYou(feedAll, l => affinityOf(l, follows), Date.now(), 20)
      : topTab ? (top ?? []) : fold ? fold.reps : feedAll),
    [feedAll, topTab, top, youTab, follows, fold]
  );
  // the reason line: the shortlist's "why it's here", then the folded copies
  // at this house ("Also PSA 8, PSA 6"), then the same card live at another
  // house ("Also live at REA · $220 bid" — the live lot's own bid)
  const liveById = useMemo(() => new Map(upcoming.map(l => [l.id, l])), [upcoming]);
  const alsoOf = (lot: AuctionLot): string | null => {
    const g = fold?.group.get(lot.id);
    const sameHouse = g ? g.members.filter(m => m.id !== lot.id && m.auctionHouse === lot.auctionHouse) : [];
    const elsewhere = new Map<string, AuctionLot>();
    if (g) for (const m of g.members) if (m.auctionHouse !== lot.auctionHouse) elsewhere.set(m.id, m);
    for (const s of crossSibs(lot)) { const o = liveById.get(s.id); if (o) elsewhere.set(o.id, o); }
    return [
      g && sameHouse.length ? foldNote(lot, sameHouse, g.kind) : null,
      elsewhere.size ? crossNote(lot, Array.from(elsewhere.values())) : null,
    ].filter(Boolean).join(' · ') || null;
  };
  const noteOf = (lot: AuctionLot): string | null =>
    [topTab || youTab ? reasonOf(lot) : null, alsoOf(lot)].filter(Boolean).join(' · ') || null;
  // pressing a folded note → the whole group, by the feed's own search (one
  // stable callback per group member so memoized cards don't re-render)
  const filtersRef = useRef(feedFilters);
  filtersRef.current = feedFilters;
  const changeRef = useRef(onFiltersChange);
  changeRef.current = onFiltersChange;
  const foldOpeners = useMemo(() => {
    const m = new Map<string, () => void>();
    if (!fold) return m;
    fold.group.forEach((g, id) => {
      const q = foldQuery(g.members);
      if (!q) return;
      m.set(id, () => {
        changeRef.current({ ...filtersRef.current, query: q, tab: 'all' }, 'fold');
        document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth' });
      });
    });
    return m;
  }, [fold, anchorId]);
  // lots (not cards) still to come below the fold of the page — a folded
  // card carries its copies, so "remaining" stays a count of lots
  const remainingLots = useMemo(() => {
    if (!fold || topTab || youTab) return feed.length - visibleUpcoming;
    let shown = 0;
    for (const l of feed.slice(0, visibleUpcoming)) shown += fold.group.get(l.id)?.members.length ?? 1;
    return feedAll.length - shown;
  }, [fold, topTab, youTab, feed, feedAll, visibleUpcoming]);

  const feedKey = useMemo(() => {
    const f = feedFilters;
    return `${f.vertical}|${f.maker}|${f.sport}|${f.category}|${f.belowOnly}|${f.sort}|${f.saleDay ?? ''}|${f.win}|${f.cat}|${f.sub}|${f.house}|${f.minUsd}|${f.maxUsd}|${f.newOnly}|${f.fx.join(",")}|${f.tab}`;
  }, [feedFilters]);
  const handleFilters = (next: FeedFilters) => {
    // the shortlist only exists in Matters-most order: any other sort is "All lots"
    if (next.sort !== 'priority' && next.tab === 'top') next = { ...next, tab: 'all' };
    onFiltersChange(next, 'reader');
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GRID_CSS }} />
      <div className="ray-toolbar-row" role="tablist" aria-label="Feed view" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {topAvailable && (
          <button
            role="tab"
            aria-selected={topTab}
            className="ray-toolbar-pill"
            data-active={topTab}
            onClick={() => handleFilters({ ...feedFilters, sort: 'priority', tab: 'top' })}
          >
            What matters {topTab && <i>{feed.length}</i>}
          </button>
        )}
        {follows.length > 0 && (
          <button
            role="tab"
            aria-selected={youTab}
            className="ray-toolbar-pill"
            data-active={youTab}
            onClick={() => handleFilters({ ...feedFilters, sort: 'priority', tab: 'you' })}
            title={`Ranked for what you follow: ${follows.map(f => f.label).join(', ')}`}
          >
            For you {youTab && <i>{feed.length}</i>}
          </button>
        )}
        <button
          role="tab"
          aria-selected={!topTab && !youTab}
          className="ray-toolbar-pill"
          data-active={!topTab && !youTab}
          onClick={() => handleFilters({ ...feedFilters, tab: 'all' })}
        >
          All lots <i>{feedAll.length.toLocaleString()}</i>
        </button>
      </div>

      <FeedToolbar
        lots={upcoming}
        belowIds={belowIds}
        filters={feedFilters}
        onChange={handleFilters}
        shown={fold && !topTab && !youTab ? feedAll.length : feed.length}
        total={upcoming.length}
        market={market}
        onMarketReset={onMarketReset}
        view={effectiveView}
        onViewChange={handleView}
        pageSize={pageSize}
        showToggle={!narrowView}
        prevVisitDay={prevVisitDay}
        baselines={baselines}
        onResetView={onResetView}
        scopeMaker={scope?.maker ?? null}
      />

      {effectiveView === 'table' && feed.length > 0 ? (
        <div key={feedKey} className="ray-feed-rekey ray-feedtable-scroll" style={{ overflowX: 'auto' }}>
          <table className="ray-feedtable">
            <thead>
              <tr>
                <th></th>
                <th>Maker / work</th>
                <th>House</th>
                <th>Cat.</th>
                <th>Hammers</th>
                <th className="num">In</th>
                <th className="num">Bids</th>
                <th className="num">Estimate</th>
                <th>Signal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {feed.slice(0, visibleUpcoming).map(lot => {
                const sig = lotSignal(lot, compLots);
                const dth = daysToHammer(lot, localToday());
                return (
                  // the whole row stays clickable as a POINTER
                  // convenience; the accessible open-modal control is
                  // the real button on the title cell (a tr with
                  // role="button" erased the nested maker link + save
                  // button for AT and ignored Space — B3 finding 6)
                  <tr
                    key={lot.id}
                    onClick={() => setTableLot(lot)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ width: 56 }}>
                      <span className="thumb-plate" data-tone={feedTone(lot, belowIds, belowSignal.hasSig)} style={{ position: 'relative' }}>
                        {/* monogram under the photo — decoration, never a column */}
                        <span aria-hidden="true">{(lot.title || '?').charAt(0)}</span>
                        {lot.imageUrl && (
                          <img
                            className="thumb"
                            // the resizer rung, not the 2880px master — and
                            // NO opaque background: .thumb's elevated fill
                            // painted a blank square over the monogram for
                            // the seconds a 600KB Bonhams master took to land
                            // (the four white Patek squares on the block)
                            src={sizedImg(httpsImg(lot.imageUrl), 120)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            style={{ position: 'absolute', inset: 0, background: 'transparent' }}
                            ref={el => { if (el && el.complete && el.naturalWidth === 0) el.style.display = 'none'; }}
                            onError={e => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                      </span>
                    </td>
                    <td>
                      <Link
                        href={makerLineOf(lot).href}
                        className="t-artist"
                        onClick={e => e.stopPropagation()}
                      >
                        {makerLineOf(lot).name}
                      </Link>
                      {/* a REAL button (Enter + Space for free), row
                          semantics intact for AT */}
                      <button
                        type="button"
                        className="t-title"
                        onClick={e => { e.stopPropagation(); setTableLot(lot); }}
                        aria-label={`Comps for ${craftTitle(lot.title, lot.auctionHouse)}`}
                        style={{ display: 'block', width: '100%', background: 'none', border: 0, padding: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                      >
                        {craftTitle(lot.title, lot.auctionHouse)}
                      </button>
                      {(() => {
                        // folded copies — the Signal column's own sub-line type
                        const n = alsoOf(lot);
                        if (!n) return null;
                        const open = foldOpeners.get(lot.id);
                        const st = { display: 'block', color: 'var(--color-text-faint)', fontSize: 10.5 } as const;
                        return open
                          ? <button type="button" onClick={e => { e.stopPropagation(); open(); }} style={{ ...st, background: 'none', border: 0, padding: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>{n}</button>
                          : <span style={st}>{n}</span>;
                      })()}
                    </td>
                    <td>{lot.auctionHouse}</td>
                    <td className="t-cat">{subColumnOf(lot)}</td>
                    <td className="t-date" title={saleWhenTitle(lot)}>{formatDate(lot.saleDate)}</td>
                    <td className="num t-days">
                      {dth == null ? '—' : dth <= 0 ? 'today' : `${dth}d`}
                    </td>
                    <td className="num t-bids" title={bidCellTitle(lot, housesWithBids)}>
                      {bidCellFace(lot, housesWithBids)}
                      {bidVel(lot) && <span className="ray-bidvel-sub">+{bidVel(lot)!.delta}/{bidVel(lot)!.hours}h</span>}
                    </td>
                    <td className="num t-est">
                      {lot.estimateLow && lot.estimateHigh
                        ? (formatPrice(lot.estimateLow) === formatPrice(lot.estimateHigh)
                            ? formatPrice(lot.estimateLow)
                            : `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)}`)
                        // no estimate (Goldin, REA, NFL): the live bid is the only
                        // price on the lot — the same "$402 bid" face the cards print
                        : (lot.currentBid || 0) > 0 ? `${formatPrice(lot.currentBid as number)} bid` : '—'}
                    </td>
                    <td>
                      {sig
                        ? <span className={sig.label === 'Below Market' ? 't-sig-up' : 't-sig-down'}>
                            {signalMagnitude(sig.label, sig.pct)}{/* the qualifier on its own line: inline it overflowed the last column and clipped ('2.4× unde') */}<span style={{ display: 'block', color: 'var(--color-text-faint)', fontSize: 10.5 }}>{sig.label === 'Below Market' ? 'under comps' : 'over comps'}</span>
                            <span title={`${confidenceMeter(sig.confidence).word} confidence`} style={{ marginLeft: 6, fontSize: 10, letterSpacing: 1, opacity: 0.8 }}>
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
            {youTab ? (
              <>
                <p>Nothing you follow closes this week{follows.length ? ` (${follows.map(f => f.label).slice(0, 3).join(', ')}${follows.length > 3 ? '…' : ''})` : ''}.</p>
                <button className="ray-toolbar-reset" onClick={() => handleFilters({ ...feedFilters, tab: 'top' })}>
                  See what matters across the board
                </button>
              </>
            ) : topTab && feedAll.length > 0 ? (
              <>
                <p>Nothing here clears the shortlist bar ($2.5K+, closing this week, with an estimate or engine value).</p>
                <button className="ray-toolbar-reset" onClick={() => handleFilters({ ...feedFilters, tab: 'all' })}>
                  See all {feedAll.length.toLocaleString()} lots
                </button>
              </>
            ) : (
              <>
                <p>Nothing on the block matches that.</p>
                <button className="ray-toolbar-reset" onClick={() => handleFilters(FEED_DEFAULTS)}>
                  Clear the lenses
                </button>
              </>
            )}
          </div>
        ) : (
          feed.slice(0, visibleUpcoming).map((lot, i) =>
            // ≤640px: EVERY lot folds to a compact ruled row — the
            // engine's verdict shows as a quiet glow behind the
            // thumb (green = below market, red = reads rich). No
            // same-sale run folding: it applied only to Goldin runs
            // (inconsistent + fragile under re-sorts); pagination +
            // the maker-diversity cap own volume now.
            narrowView ? (
              <div
                key={lot.id}
                className={fromCache ? 'ray-feeditem-row' : 'ray-feed-rekey ray-feeditem-row'}
                style={{ animationDelay: fromCache ? undefined : `${Math.min(i, 10) * 40}ms`, minWidth: 0 }}
              >
                <FeedRow
                  lot={lot}
                  onOpen={() => setTableLot(lot)}
                  tone={feedTone(lot, belowIds, belowSignal.hasSig)}
                  note={noteOf(lot)}
                  onNote={foldOpeners.get(lot.id)}
                />
              </div>
            ) : (
              <div
                key={lot.id}
                className={fromCache ? 'ray-feeditem-card' : 'ray-feed-rekey ray-feeditem-card'}
                style={{ animationDelay: fromCache ? undefined : `${Math.min(i, 10) * 40}ms`, minWidth: 0 }}
              >
                <LotCard
                  lot={lot}
                  showArtist
                  allLots={compLots}
                  saved={isSaved(lot.id)}
                  onToggleSave={toggle}
                  lastCrawl={lastCrawl || undefined}
                  note={noteOf(lot)}
                  onNote={foldOpeners.get(lot.id)}
                />
              </div>
            )
          )
        )}
      </div>
      )}

      {!onOpenLot && ownLot && (
        <ComparableModal lot={ownLot} allLots={compLots} onClose={() => setOwnLot(null)} />
      )}

      {visibleUpcoming < feed.length && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
          <button className="ray-show-more" onClick={showMore}>
            Show more ({remainingLots.toLocaleString()} remaining)
          </button>
        </div>
      )}
    </>
  );
}
