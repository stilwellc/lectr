'use client';

import { useState, useMemo, useInsertionEffect, memo } from 'react';
import Link from 'next/link';
import { AuctionLot, MarketStats } from '../types';
import { ARTIST_LABEL } from '../constants';
import { houseColors, categoryLabels, formatDate, makeAuctionIcs, craftTitle, formatPrice, httpsImg } from '../utils';
import ComparableModal from './ComparableModal';
import Flick from './Flick';
import { computeDeepSignal, FORM_LABEL, signalMagnitude } from '../lib/comps';

// stable empty-array identity — a fresh `[]` default each render would defeat
// the buySignal useMemo and the memo() wrapper below.
const EMPTY_LOTS: AuctionLot[] = [];

export function formatEstimate(lot: AuctionLot): string {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };
  if (lot.estimateLow && lot.estimateHigh) {
    const lo = fmt(lot.estimateLow);
    const hi = fmt(lot.estimateHigh);
    // K-rounding often collapses low and high into the same string — a
    // "$49K–$49K" range reads as a bug on the most repeated line in the
    // product. One value, and the app is USD-denominated: no suffix noise.
    return lo === hi ? `${lo} est.` : `${lo}–${hi} est.`;
  }
  // Goldin runs bid auctions with no estimates — the live bid is the honest
  // number, and it's real money on the lot right now.
  if (lot.currentBid && lot.currentBid > 0) {
    return `${fmt(lot.currentBid)} bid${lot.bidCount ? ` · ${lot.bidCount} bids` : ''}`;
  }
  // "No reserve" is a Goldin fact, not a fallback — traditional houses run
  // reserves and merely keep some estimates private. Don't assert an auction
  // condition we can't stand behind on anyone else's lot.
  if (lot.auctionHouse === 'Goldin') return 'No reserve · opening bid';
  return 'Estimate on request';
}

/** Prefer the crawl-time signal when present; else compute from history. */
export type LotSignal = { label: string; pct: number; basis?: number; kind?: 'edition' | 'form'; form?: string; confidence?: 'very-high' | 'high' | 'medium' | 'low' } | null;
export function lotSignal(lot: AuctionLot, allLots: AuctionLot[]): LotSignal {
  if (lot.signal !== undefined) return lot.signal;
  return computeBuySignal(lot, allLots);
}

/** Confidence as a compact meter: filled dots out of four. */
export function confidenceMeter(c?: string): { dots: string; word: string } {
  switch (c) {
    case 'very-high': return { dots: '●●●●', word: 'very high' };
    case 'high': return { dots: '●●●○', word: 'high' };
    case 'medium': return { dots: '●●○○', word: 'medium' };
    default: return { dots: '●○○○', word: 'low' };
  }
}

/** The deep comps engine decides what counts as a comp (see app/lib/comps). */
export function computeBuySignal(lot: AuctionLot, allLots: AuctionLot[]) {
  return computeDeepSignal(lot, allLots);
}

// The card's static CSS, injected into <head> exactly once — the home grid
// mounts 48+ cards (and remounts them all on every feedKey rekey), so a
// per-instance <style> multiplies into dozens of identical nodes and repeats
// the style recalc each time. useInsertionEffect runs before paint, so the
// first card still lays out at the right height with no flash.
const LOT_CARD_STYLE_ID = 'ray-lot-card-style';
const LOT_CARD_CSS = `
  .ray-lot-img { height: 200px; }
  .ray-lot-img img {
    opacity: 0;
    transition: opacity 400ms var(--ease-signature);
  }
  .ray-lot-img img[data-loaded=true] { opacity: 1; }
  /* hotlink-blocked or dead images stay invisible — the serif
     initial sits in flow behind and reads instead */
  .ray-lot-img img[data-error=true] { opacity: 0; }
  .ray-save-btn:hover { opacity: 0.85; }
  .ray-lot-card .ray-save-btn { width: 32px; height: 32px; }
  .ray-lot-maker { position: relative; z-index: 2; }
  .ray-lot-maker:hover { text-decoration: underline; }
  @media (max-width: 900px) {
    /* compact mobile card: shorter image, 44px touch target on save */
    .ray-lot-img { height: 140px; }
    .ray-lot-card .ray-save-btn { width: 44px; height: 44px; }
  }
`;
function useLotCardStyles() {
  useInsertionEffect(() => {
    if (document.getElementById(LOT_CARD_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = LOT_CARD_STYLE_ID;
    el.textContent = LOT_CARD_CSS;
    document.head.appendChild(el);
  }, []);
}

function LotCard({
  lot,
  showArtist = false,
  allLots = EMPTY_LOTS,
  saved = false,
  onToggleSave,
  lastCrawl,
}: {
  lot: AuctionLot;
  showArtist?: boolean;
  allLots?: AuctionLot[];
  saved?: boolean;
  onToggleSave?: (lotId: string, lot?: AuctionLot) => void;
  /** the last crawl's ISO date — lets the card mark lots first seen today */
  lastCrawl?: string;
}) {
  useLotCardStyles();
  const [modalOpen, setModalOpen] = useState(false);
  const [reminded, setReminded] = useState(false);
  // hotlink-blocked/dead images flip the card into the compact row layout —
  // a 140-200px well showing a monogram letter is burned space, not a photo
  const [imgFailed, setImgFailed] = useState(false);
  const color = houseColors[lot.auctionHouse] || 'var(--color-text-secondary)';

  // firstSeen ships from the crawler diff — read defensively: older data
  // files (and lots crawled before the stamp existed) don't carry it.
  const firstSeen = (lot as AuctionLot & { firstSeen?: string }).firstSeen;
  const isNewToday = Boolean(
    firstSeen && lastCrawl && firstSeen.slice(0, 10) === lastCrawl.slice(0, 10)
  );

  function handleAddToCalendar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ics = makeAuctionIcs(lot);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    // window.open preserves the user-gesture context on iOS Safari so the
    // system intercepts the .ics MIME type and offers to add it to Calendar.
    const opened = window.open(url, '_blank');
    if (!opened) {
      // Popup blocked (desktop) — fall back to hidden anchor
      const a = document.createElement('a');
      a.href = url;
      a.download = `auction-${lot.id}.ics`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // brief confirmation so the user knows the .ics fired (esp. desktop download)
    setReminded(true);
    setTimeout(() => setReminded(false), 2500);
  }
  const catLabel = categoryLabels[lot.category] || null;
  const isUpcoming = lot.status === 'upcoming';
  // A concluded lot that never sold — bought_in (failed to meet reserve) or an
  // unresolved result. It must NOT speak formatEstimate() in the price slot
  // (a stale range reads as a live ask) nor a bare date in the meta. Mirrors
  // LotPage's "bought in" wording.
  const isNoSale = lot.status === 'bought_in' || lot.status === 'unknown-result';

  // A resultsPending lot with a PAST sale date must not speak in the future
  // tense ("hammers Jul 7" on a Jul 17 page) or offer a reminder for an
  // auction that already happened. "Today" is the crawl day — the data's
  // clock — falling back to the client clock when no crawl stamp is passed.
  const todayIso = (lastCrawl || new Date().toISOString()).slice(0, 10);
  const isPastPending = isUpcoming && !!lot.resultsPending && !!lot.saleDate && lot.saleDate.slice(0, 10) < todayIso;

  // "Pablo Picasso / Pablo Picasso" — when the crafted title IS the maker
  // label and the maker line already renders, the title says nothing twice.
  const makerLabel = lot.artist ? (ARTIST_LABEL[lot.artist] || lot.artist) : '';
  const titleText = craftTitle(lot.title);
  const titleDupesMaker = showArtist && !!lot.artist && titleText === makerLabel;

  const buySignal = useMemo(() => {
    if (!isUpcoming) return null;
    return lotSignal(lot, allLots);
  }, [lot, allLots, isUpcoming]);

  // The realized band precomputed at build time (soldCompBand over the full
  // corpus). It rides on the lot like `signal` does, so the card grid never
  // has to touch the 10MB sold-archive. It carries NO label and NO pct — it is
  // descriptive only, and never lights the red/green call row.
  const soldComp = lot.soldComp ?? null;

  // Stretched primary action — keeps save/remind as sibling controls, not
  // descendants. Shared by both faces (photo card / compact row).
  const primaryAction = isUpcoming ? (
    <button
      onClick={() => setModalOpen(true)}
      aria-label={`View comparable sales for ${lot.title}`}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        borderRadius: 18,
      }}
    />
  ) : (
    <a
      href={lot.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${lot.title} at ${lot.auctionHouse}`}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        borderRadius: 18,
      }}
    />
  );

  // No photograph (or the house hotlink-blocked it) → the card renders as a
  // COMPACT ROW: no image well, title/maker/est/signal in ~72px. Photographed
  // lots keep the full card.
  const noImage = !lot.imageUrl || imgFailed;

  const rowContent = (
    <div className="ray-lot-card glass glass-quiet glass-noblur" style={{
      overflow: 'hidden',
      cursor: 'pointer',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      minHeight: 72,
      minWidth: 0, // when the card is itself a grid item (expanded runs)
    }}>
      {primaryAction}
      <div style={{ flex: 1, minWidth: 0, zIndex: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          {showArtist && lot.artist && (
            <Link
              href={`/${lot.artist}`}
              className="ray-lot-maker"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 14, letterSpacing: '-0.01em', color: 'var(--color-fg)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              {makerLabel}
            </Link>
          )}
          {!titleDupesMaker && (
            <span className="ray-lot-title" style={{
              fontFamily: 'var(--font-sans), sans-serif',
              fontSize: showArtist ? 13 : 14,
              fontWeight: showArtist ? 400 : 600,
              color: showArtist ? 'var(--color-text-muted)' : 'var(--color-fg)',
              letterSpacing: '-0.01em',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}>
              {titleText}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-faint)', letterSpacing: '-0.01em', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isNewToday && <span className="ray-newchip" style={{ marginRight: 6 }}>New today</span>}
          {lot.auctionHouse}
          {catLabel && lot.category !== 'unknown' && lot.category !== 'object' ? ` · ${catLabel}` : ''}
          {isPastPending
            ? ` · hammered ${formatDate(lot.saleDate)} · results pending`
            : isNoSale
            ? ` · bought in`
            : ` · ${isUpcoming ? 'hammers ' : ''}${formatDate(lot.saleDate)}`}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right', zIndex: 'auto' }}>
        {buySignal && (
          <div className="ray-sigrow" data-tone={buySignal.label === 'Below Market' ? 'up' : 'down'} style={{ margin: 0, justifyContent: 'flex-end' }}>
            <span className="ray-sigrow-pct">
              {signalMagnitude(buySignal.label, buySignal.pct)}
            </span>
          </div>
        )}
        <span className="ray-lot-est" style={{ display: 'block' }}>{isNoSale ? 'Bought in' : formatEstimate(lot)}</span>
      </div>
      {onToggleSave && (
        <button
          className="ray-save-btn"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSave(lot.id, lot); }}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: saved ? 'var(--color-fg)' : 'var(--color-bg-elevated)',
            border: 'none',
            borderRadius: 100,
            cursor: 'pointer',
            padding: 0,
            zIndex: 2,
          }}
          aria-label={saved ? 'Remove from saved' : 'Save lot'}
        >
          <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
            <path
              d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z"
              fill={saved ? 'var(--color-bg)' : 'var(--color-text-faint)'}
              stroke={saved ? 'var(--color-bg)' : 'var(--color-text-faint)'}
              strokeWidth="0.8"
            />
          </svg>
        </button>
      )}
    </div>
  );

  const cardContent = (
    <div className="ray-lot-card ray-card-compact glass glass-quiet glass-noblur" style={{
      overflow: 'hidden',
      cursor: 'pointer',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {primaryAction}
      {/* zIndex auto keeps the stretched link (z1) clickable above this
          content while save/remind buttons (z2) stay above the link —
          overrides the .glass > * z-index:2 rule. */}
      <div className="ray-lot-img" style={{
        position: 'relative',
        zIndex: 'auto',
        width: '100%',
        background: `linear-gradient(135deg, var(--color-bg-elevated) 0%, var(--color-bg) 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {/* the matted plate — the honest fallback while the image loads,
            and the permanent face when it never arrives (many houses
            hotlink-block via CORP/ORB). The img paints over it. */}
        <div
          className="ray-lot-plate"
          aria-hidden={lot.imageUrl ? 'true' : undefined}
          style={{ '--plate-ink': color } as React.CSSProperties}
        >
          <span className="ray-lot-plate-letter">{lot.title.charAt(0)}</span>
          <span className="ray-lot-plate-rule" />
        </div>
        {lot.imageUrl && (
          <img
            src={httpsImg(lot.imageUrl)}
            alt={lot.title}
            // the grid mounts 48 cards a page — lazy-load so below-fold house
            // photography doesn't race the phase-2 data stream at first paint
            loading="lazy"
            decoding="async"
            // cache hits never fire onLoad/onError — check complete at
            // attach; complete with zero naturalWidth is a cached failure.
            // A failure flips the whole card into the compact row layout.
            ref={(el) => {
              if (!el || !el.complete) return;
              if (el.naturalWidth > 0) {
                el.setAttribute('data-loaded', 'true');
              } else {
                setImgFailed(true);
              }
            }}
            onLoad={(e) => e.currentTarget.setAttribute('data-loaded', 'true')}
            onError={() => setImgFailed(true)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        {/* freshness, on the lot itself: stamped by the crawler diff, shown
            only on the day it first appeared */}
        {isNewToday && (
          <span className="ray-newchip" style={{ position: 'absolute', top: 6, left: 6, zIndex: 2 }}>
            New today
          </span>
        )}
        {/* the old corner pill died in the committee review — the signal row
            below leads with the number itself, once, unmissably */}
        {onToggleSave && (
          <button
            className="ray-save-btn"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSave(lot.id, lot); }}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: saved ? 'var(--color-fg)' : 'rgba(12,10,6,0.5)',
              border: 'none',
              borderRadius: 100,
              cursor: 'pointer',
              padding: 0,
              zIndex: 2,
            }}
            aria-label={saved ? 'Remove from saved' : 'Save lot'}
          >
            <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
              <path
                d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z"
                fill={saved ? 'var(--color-bg)' : 'var(--color-fg)'}
                stroke={saved ? 'var(--color-bg)' : 'var(--color-fg)'}
                strokeWidth="0.8"
              />
            </svg>
          </button>
        )}
      </div>

      <div style={{ padding: '13px 2px 4px', flex: 1, display: 'flex', flexDirection: 'column', zIndex: 'auto' }}>

        {showArtist && lot.artist && (
          <div style={{ marginBottom: 2 }}>
            {/* the maker's own book — an internal link, above the stretched
                card action (the house URL stays on the card's primary action
                only, never on the name) */}
            <Link
              href={`/${lot.artist}`}
              className="ray-lot-maker"
              onClick={e => e.stopPropagation()}
              style={{
                fontSize: 15,
                letterSpacing: '-0.01em',
                color: 'var(--color-fg)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {makerLabel}
            </Link>
          </div>
        )}
        {!titleDupesMaker && (
          <h3 className="ray-lot-title" style={{
            fontFamily: 'var(--font-sans), sans-serif',
            fontSize: showArtist ? 14 : 15,
            fontWeight: showArtist ? 400 : 600,
            color: showArtist ? 'var(--color-text-muted)' : 'var(--color-fg)',
            letterSpacing: '-0.01em',
            margin: '0 0 3px',
            lineHeight: 1.4,
            flex: 1,
          }}>
            {titleText}
          </h3>
        )}
        <div style={{ fontSize: 13, color: 'var(--color-text-faint)', letterSpacing: '-0.01em', marginBottom: 10 }}>
          {lot.auctionHouse}
          {catLabel && lot.category !== 'unknown' && lot.category !== 'object' ? ` · ${catLabel}` : ''}
          {isPastPending
            ? ` · hammered ${formatDate(lot.saleDate)} · results pending`
            : isNoSale
            ? ` · bought in`
            : ` · ${isUpcoming ? 'hammers ' : ''}${formatDate(lot.saleDate)}`}
        </div>
        <div style={{ marginTop: 'auto' }}>
          {/* The intelligence leads — the number IS the card's rank. */}
          {buySignal && (
            <div className="ray-sigrow" data-tone={buySignal.label === 'Below Market' ? 'up' : 'down'}>
              <span className="ray-sigrow-pct">
                {signalMagnitude(buySignal.label, buySignal.pct)}
              </span>
              <span className="ray-sigrow-ctx">
                {buySignal.kind === 'edition'
                  ? <>this edition&rsquo;s sales run {buySignal.label === 'Below Market' ? 'over' : 'under'} the ask · {buySignal.basis} sales</>
                  : <>comps median vs ask · {buySignal.basis} {(buySignal.form ? (FORM_LABEL as Record<string, string>)[buySignal.form] : null) || 'comps'}</>}
                <span
                  className="ray-sigrow-dots"
                  title={`${confidenceMeter(buySignal.confidence).word} confidence`}
                  aria-label={`${confidenceMeter(buySignal.confidence).word} confidence`}
                >
                  {confidenceMeter(buySignal.confidence).dots}
                </span>
              </span>
            </div>
          )}
          {/* Goldin sports/science lots carry no estimate and no signal — no
              red/green call is possible or honest. When a realized band exists
              (>=3 comparable sold), show it as a NEUTRAL row: a description of
              what similar objects have fetched, never a directional call. */}
          {isUpcoming && !buySignal && soldComp && soldComp.n >= 3 && (
            <div
              className="ray-comprow"
              style={{
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: 6,
                fontSize: 12,
                letterSpacing: '-0.01em',
                color: 'var(--color-text-muted)',
                marginBottom: 6,
              }}
            >
              <span>
                Similar sold {formatPrice(soldComp.low)}–{formatPrice(soldComp.high)} · median {formatPrice(soldComp.median)} · {soldComp.n} sales
              </span>
              <span
                style={{ color: 'var(--color-text-faint)', letterSpacing: '0.06em' }}
                title={`${confidenceMeter(soldComp.confidence).word} confidence`}
                aria-label={`${confidenceMeter(soldComp.confidence).word} confidence`}
              >
                {confidenceMeter(soldComp.confidence).dots}
              </span>
            </div>
          )}
          <span className="ray-lot-est">{isNoSale ? 'Bought in' : formatEstimate(lot)}</span>
        </div>

        {isUpcoming && (
          <div className="ray-lot-footer">
            {/* no reminder for a hammer that already fell */}
            {!isPastPending && (
            <button
              onClick={handleAddToCalendar}
              className="ray-lot-remind"
              aria-label={`Add ${lot.title} auction to calendar`}
            >
              {reminded ? (
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="1" y="2" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.25" fill="none"/>
                  <line x1="4" y1="1" x2="4" y2="4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                  <line x1="10" y1="1" x2="10" y2="4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                  <line x1="1" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.25"/>
                </svg>
              )}
              {reminded ? 'Added to calendar' : 'Remind me'}
            </button>
            )}
            <span className="ray-lot-comps" aria-hidden="true" style={isPastPending ? { marginLeft: 'auto' } : undefined}>
              Comps <Flick size={10} />
            </span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {noImage ? rowContent : cardContent}
      {modalOpen && (
        <ComparableModal
          lot={lot}
          allLots={allLots}
          onClose={() => setModalOpen(false)}
          saved={saved}
          onToggleSave={onToggleSave}
        />
      )}
    </>
  );
}

// memo pays off on the save-toggle and pagination re-renders (lot/allLots/
// stats are memoized upstream, onToggleSave is useCallback'd). It does NOT
// fix typing in the feed search: the grid is keyed by feedKey, which includes
// the query, so every keystroke remounts the cards outright — that's the
// parent's key strategy, not reconciliation.
export default memo(LotCard);
