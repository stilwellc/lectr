'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AuctionLot } from '../types';
import { ARTIST_LABEL, Market } from '../constants';
import { craftTitle, formatDate } from '../utils';
import { lotSignal, confidenceMeter, formatEstimate } from './LotCard';
import { lotFitsMarket } from '../lib/comps';
import Flick from './Flick';

/**
 * Ray Terminal — what survived the restructure: the call the product stands
 * behind (pickCall + CallPlate, now living in the board's right rail) and the
 * colophon. One seam grammar: 1px hairlines, no radii inside the terminal bands.
 */

export function daysWord(dateStr: string): string {
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

/* ── today's call, as a matted catalogue plate ──────────────────────── */
const CONF_RANK: Record<string, number> = { 'very-high': 3, high: 2, medium: 1, low: 0 };

/** The call the product stands behind: highest-confidence tier first, never
    low — a headline pick backed by one thin comp would burn trust. Inside a
    vertical the call must also be that vertical's kind of object (a ring
    never headlines watches) — lotFitsMarket gates by form class. */
export function pickCall(lots: AuctionLot[], allLots: AuctionLot[], market: Market = 'all') {
  const today = new Date().toISOString().split('T')[0];
  const deals = lots
    .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
    .filter(l => market === 'all' || lotFitsMarket(l, market))
    .map(l => ({ lot: l, signal: lotSignal(l, allLots) }))
    .filter(d => d.signal && d.signal.label === 'Below Market' && CONF_RANK[d.signal.confidence || 'low'] >= 1)
    .sort((a, b) =>
      (CONF_RANK[b.signal!.confidence || 'low'] - CONF_RANK[a.signal!.confidence || 'low'])
      || (b.signal!.pct - a.signal!.pct));
  // stay within the top confidence tier when choosing for the photograph
  const topRank = deals.length ? CONF_RANK[deals[0].signal!.confidence || 'low'] : 0;
  const tier = deals.filter(d => CONF_RANK[d.signal!.confidence || 'low'] === topRank);
  return tier.slice(0, 8).find(d => d.lot.imageUrl) || tier[0] || null;
}

export function CallPlate({
  lots,
  allLots,
  market = 'all',
  isSaved,
  onToggleSave,
}: {
  lots: AuctionLot[];
  allLots: AuctionLot[];
  market?: Market;
  isSaved?: (id: string) => boolean;
  onToggleSave?: (id: string) => void;
}) {
  const call = useMemo(() => pickCall(lots, allLots, market), [lots, allLots, market]);
  // the mat unmounts (real conditional render) when its photograph fails —
  // no empty image cell on desktop
  const [failedImgId, setFailedImgId] = useState<string | null>(null);

  if (!call) return null;
  const { lot, signal } = call;
  const meter = confidenceMeter(signal!.confidence);
  const saved = isSaved ? isSaved(lot.id) : false;

  return (
    <Link href="/value" className="ray-board-panel ray-deckcall" aria-label="Today's call — see how we called it">
      <div className="ray-panel-k" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>Today&rsquo;s call · ranked by comps gap</span>
        {onToggleSave && (
          <button
            className="ray-save-btn"
            onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleSave(lot.id); }}
            aria-label={saved ? 'Remove from saved' : 'Save lot'}
            style={{ width: 44, height: 44, margin: '-14px -12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 100, cursor: 'pointer', padding: 0 }}
          >
            <span style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: saved ? 'var(--color-fg)' : 'var(--color-bg-elevated)', borderRadius: 100 }}>
              <svg width="10" height="12" viewBox="0 0 12 14" fill="none" aria-hidden="true">
                <path d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z" fill={saved ? 'var(--color-bg)' : 'var(--color-text-faint)'} />
              </svg>
            </span>
          </button>
        )}
      </div>
      {lot.imageUrl && failedImgId !== lot.id && (
        <div className="ray-plate-mat">
          <div className="ray-plate-img">
            <img
              src={lot.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setFailedImgId(lot.id)}
              // cache hits never fire onError — complete with zero
              // naturalWidth at attach is a cached failure
              ref={el => { if (el && el.complete && el.naturalWidth === 0) setFailedImgId(lot.id); }}
            />
          </div>
          <div className="ray-plate-cap">
            {lot.lotNumber ? `Lot ${lot.lotNumber} · ` : ''}{lot.auctionHouse} · {formatDate(lot.saleDate)}
          </div>
        </div>
      )}
      <div className="ray-deckcall-maker">{ARTIST_LABEL[lot.artist] || lot.artist}</div>
      <div className="ray-deckcall-title">{craftTitle(lot.title)}</div>
      <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 4 }}>{formatEstimate(lot)}</div>
      <div className="ray-sigrow" data-tone="up" style={{ marginTop: 9 }}>
        <span className="ray-sigrow-pct" style={{ fontSize: 26 }}>+{signal!.pct}%</span>
        <span className="ray-sigrow-ctx">
          comps over ask · {signal!.basis} sales
          <span className="ray-sigrow-dots" title={`${meter.word} confidence`}>{meter.dots}</span>
        </span>
      </div>
      <div className="ray-deckcall-cta">See how we called it <Flick size={13} /></div>
      <img
        src="/brand/lectr-nav.png"
        alt=""
        style={{ height: 18, width: 'auto', opacity: 0.55, alignSelf: 'flex-end', marginTop: 10 }}
      />
    </Link>
  );
}

/* ── the colophon ───────────────────────────────────────────────────── */
/**
 * THE FLOOR AT CLOSE — the footer is the identity's closing statement. The
 * sign gets its one display-scale moment: the mark writes itself in its own
 * light when the reader arrives, over the provenance the whole product
 * stands on. One gesture, then quiet.
 */
export function Colophon({ lotCount, houseCount, record }: {
  lotCount: number;
  houseCount: number;
  /** the backtest's flagged record — the strongest true sentence */
  record?: { n: number; medianPerfPct: number } | null;
}) {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) { setInView(true); io.disconnect(); } },
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <footer className={`ray-close${inView ? ' ray-close-on' : ''}`} ref={ref}>
      <div className="rail ray-close-in">
        {/* the sign, lit over the closed floor */}
        <div className="ray-close-sign">
          <img src="/brand/lectr.png" alt="lectr" className="ray-close-mark" />
        </div>
        <p className="ray-close-thesis">Every estimate, read against every hammer.</p>

        {/* provenance numerals */}
        <div className="ray-close-ledger" role="list">
          <div role="listitem"><b>{lotCount.toLocaleString()}</b><span>lots on the book</span></div>
          <div role="listitem"><b>{houseCount}</b><span>auction houses</span></div>
          <div role="listitem"><b>2000</b><span>archive reaches back to</span></div>
        </div>

        {/* the map of the house */}
        <div className="ray-close-map">
          <div className="ray-close-col">
            <span className="ray-close-k">Markets</span>
            <Link href="/">Total market</Link>
            <Link href="/art">Art</Link>
            <Link href="/design">Design</Link>
            <Link href="/watches">Watches</Link>
            <Link href="/sports">Sports</Link>
            <Link href="/science">Science</Link>
          </div>
          <div className="ray-close-col">
            <span className="ray-close-k">The desk</span>
            <Link href="/value">Value</Link>
            <Link href="/artists">Makers</Link>
            <Link href="/analytics">Analytics</Link>
            <Link href="/saved">Saved</Link>
          </div>
          <div className="ray-close-col ray-close-record">
            <span className="ray-close-k">The record</span>
            {record && record.n > 500 ? (
              <p>
                Flagged calls beat their estimates by <b className="up">+{record.medianPerfPct}% median</b> across {record.n.toLocaleString()} replayed sales.
              </p>
            ) : (
              <p>Every call is replayed against what the lot really hammered for.</p>
            )}
            <Link href="/value" className="ray-close-cta">See the record <Flick size={12} /></Link>
          </div>
        </div>

        {/* baseline */}
        <div className="ray-close-base">
          <span>© {new Date().getFullYear()} lectr · auction intelligence</span>
          <span>Comps: same maker, same form, size-banded — medians, never means.</span>
          <span>Data from public auction results.</span>
        </div>
      </div>
    </footer>
  );
}
