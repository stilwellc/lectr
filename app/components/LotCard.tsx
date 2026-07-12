'use client';

import { useState, useMemo } from 'react';
import { AuctionLot, MarketStats } from '../types';
import { ARTIST_LABEL } from '../constants';
import { houseColors, categoryLabels, formatDate, makeAuctionIcs } from '../utils';
import ComparableModal from './ComparableModal';
import { computeDeepSignal, FORM_LABEL } from '../lib/comps';

function formatEstimate(lot: AuctionLot): string {
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

export default function LotCard({
  lot,
  showArtist = false,
  allLots = [],
  stats,
  saved = false,
  onToggleSave,
}: {
  lot: AuctionLot;
  showArtist?: boolean;
  allLots?: AuctionLot[];
  stats?: MarketStats;
  saved?: boolean;
  onToggleSave?: (lotId: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const color = houseColors[lot.auctionHouse] || 'var(--color-text-secondary)';

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
  }
  const catLabel = categoryLabels[lot.category] || null;
  const isUpcoming = lot.status === 'upcoming';

  const buySignal = useMemo(() => {
    if (!isUpcoming) return null;
    return lotSignal(lot, allLots);
  }, [lot, allLots, isUpcoming]);

  const cardContent = (
    <div className="ray-lot-card glass glass-quiet glass-noblur" style={{
      overflow: 'hidden',
      cursor: 'pointer',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <style>{`
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
        @media (max-width: 768px) {
          .ray-lot-img { height: 170px; }
        }
      `}</style>
      {/* Stretched primary action — keeps save/remind as sibling controls, not descendants */}
      {isUpcoming ? (
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
      )}
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
            src={lot.imageUrl}
            alt={lot.title}
            // cache hits never fire onLoad/onError — check complete at
            // attach; complete with zero naturalWidth is a cached failure
            ref={(el) => {
              if (!el || !el.complete) return;
              if (el.naturalWidth > 0) {
                el.setAttribute('data-loaded', 'true');
              } else {
                el.removeAttribute('data-loaded');
                el.setAttribute('data-error', 'true');
              }
            }}
            onLoad={(e) => e.currentTarget.setAttribute('data-loaded', 'true')}
            onError={(e) => {
              e.currentTarget.removeAttribute('data-loaded');
              e.currentTarget.setAttribute('data-error', 'true');
            }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        {buySignal && (
          <div style={{
            position: 'absolute',
            top: 10,
            left: 10,
            padding: '4px 11px',
            borderRadius: 100,
            background: buySignal.label === 'Below Market' ? 'var(--color-up)' : 'rgba(0,0,0,0.55)',
            fontSize: 12.5,
            letterSpacing: '-0.01em',
            color: buySignal.label === 'Below Market' ? '#fff' : 'var(--color-down)',
            fontWeight: 600,
          }}>
            {buySignal.label === 'Below Market' ? 'Below market' : 'Above market'}
          </div>
        )}
        {onToggleSave && (
          <button
            className="ray-save-btn"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSave(lot.id); }}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: saved ? 'var(--color-accent-wine)' : 'rgba(0,0,0,0.45)',
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
                fill={saved ? 'var(--color-bg)' : '#F0EDE8'}
                stroke={saved ? 'var(--color-bg)' : '#F0EDE8'}
                strokeWidth="0.8"
              />
            </svg>
          </button>
        )}
      </div>

      <div style={{ padding: '13px 2px 4px', flex: 1, display: 'flex', flexDirection: 'column', zIndex: 'auto' }}>

        {showArtist && lot.artist && (
          <div style={{
            fontSize: 15,
            letterSpacing: '-0.01em',
            color: 'var(--color-fg)',
            fontWeight: 600,
            marginBottom: 2,
          }}>
            {ARTIST_LABEL[lot.artist] || lot.artist}
          </div>
        )}
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
          {lot.title}
        </h3>
        <div style={{ fontSize: 13, color: 'var(--color-text-faint)', letterSpacing: '-0.01em', marginBottom: 10 }}>
          {lot.auctionHouse}
          {catLabel && lot.category !== 'unknown' ? ` · ${catLabel}` : ''}
          {` · ${formatDate(lot.saleDate)}`}
        </div>
        <div style={{ marginTop: 'auto' }}>
          <span className="ray-lot-est">{formatEstimate(lot)}</span>
          {/* The intelligence, made precise: where the artist's comps sit
              against this estimate. Green = headroom, red = rich. */}
          {buySignal && (
            <div
              className="ray-lot-signal-line"
              data-tone={buySignal.label === 'Below Market' ? 'up' : 'down'}
            >
              {(() => {
                const dir = buySignal.label === 'Below Market' ? `+${buySignal.pct}% above` : `−${buySignal.pct}% below`;
                const meter = confidenceMeter(buySignal.confidence);
                const text = buySignal.kind === 'edition'
                  ? `Same edition sold ${dir} this estimate (${buySignal.basis} sales)`
                  : `${buySignal.basis || ''} comparable ${(buySignal.form ? (FORM_LABEL as Record<string, string>)[buySignal.form] : null) || 'comps'}: median ${dir} est.`;
                return (
                  <>
                    {text}
                    <span title={`${meter.word} confidence`} aria-label={`${meter.word} confidence`} style={{ marginLeft: 7, letterSpacing: 1, fontSize: 9, opacity: 0.85 }}>
                      {meter.dots}
                    </span>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {isUpcoming && (
          <div className="ray-lot-footer">
            <button
              onClick={handleAddToCalendar}
              className="ray-lot-remind"
              aria-label={`Add ${lot.title} auction to calendar`}
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <rect x="1" y="2" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.25" fill="none"/>
                <line x1="4" y1="1" x2="4" y2="4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                <line x1="10" y1="1" x2="10" y2="4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                <line x1="1" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.25"/>
              </svg>
              Remind me
            </button>
            <span className="ray-lot-comps" aria-hidden="true">
              Comps <span style={{ fontSize: 12 }}>→</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {cardContent}
      {modalOpen && (
        <ComparableModal
          lot={lot}
          allLots={allLots}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
