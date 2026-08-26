'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AuctionLot } from '../types';
import { ARTIST_LABEL, Market } from '../constants';
import { craftTitle, formatDate, formatPrice, httpsImg, localToday, fmtSignedPct, isLiveUpcoming, trueSaleDay } from '../utils';
import { lotSignal, confidenceMeter, formatEstimate } from './LotCard';
import { lotFitsMarket, signalMagnitude } from '../lib/comps';
import { safeHref } from '../lib/safe-href';
import Flick from './Flick';
import CloseClock from './CloseClock';

/**
 * Ray Terminal — what survived the restructure: the call the product stands
 * behind (pickCall + CallPlate, now living in the board's right rail) and the
 * colophon. One seam grammar: 1px hairlines, no radii inside the terminal bands.
 */

export function daysWord(dateStr: string): string {
  // CALENDAR-DAY arithmetic against the reader's LOCAL day. The old
  // `new Date(dateStr) - Date.now()` parsed the date as UTC MIDNIGHT, so a
  // sale happening TODAY read "hammered 1d ago" for any US viewer after
  // ~8pm — both day-strings must be compared in the same frame.
  const day = (dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'scheduled';
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${localToday()}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return `hammered ${-days}d ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

/** Whole calendar days from the reader's LOCAL today to a sale day-string
 *  (negative = already past). Shares daysWord's same-frame arithmetic so a
 *  lot closing tonight can never read as tomorrow for a late-evening viewer. */
export function daysUntil(dateStr: string): number | null {
  const day = (dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${localToday()}T00:00:00Z`)) / 86_400_000);
}

/* ── today's call, as a matted catalogue plate ──────────────────────── */
const CONF_RANK: Record<string, number> = { 'very-high': 3, high: 2, medium: 1, low: 0 };

/** The call the product stands behind: highest-confidence tier first, never
    low — a headline pick backed by one thin comp would burn trust. Inside a
    vertical the call must also be that vertical's kind of object (a ring
    never headlines watches) — lotFitsMarket gates by form class. */
export function pickCall(lots: AuctionLot[], allLots: AuctionLot[], market: Market = 'all') {
  // the reader's LOCAL day — a UTC "today" drops lots that hammer tonight
  const today = localToday();
  // Today's call must be ACTIONABLE — only lots still open (saleDate today or
  // later). Results-pending lots have already hammered; they belong in the feed,
  // never headlining the call as if you could still bid.
  const deals = lots
    // isLiveUpcoming judges the TRUE sale day (saleDateTime-aware), the same
    // predicate the feed uses — a lot whose crawl-string saleDate is today but
    // whose true day already passed can no longer headline as the call.
    .filter(l => isLiveUpcoming(l, today) && !l.resultsPending
      // ACTIONABLE means the clock hasn't run out: a timed lot that closed
      // earlier TODAY still carries saleDate == today and slips day-level
      // guards — when we know the close time, the call requires it to be
      // in the future.
      && (!l.saleDateTime || Date.parse(l.saleDateTime) > Date.now()))
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

/* The catalogue-plate layout, scoped to this component. Two ideas:
   — STACKED (mobile everywhere + the 396px board rail): the display:contents
     wrappers dissolve, so the DOM flows exactly as the pre-plate layout did
     (head, mat, maker, title, estimate, sigrow, CTA, countersign) and the
     rail's flex-fill CSS in globals keeps working untouched.
   — WIDE (the full-width .ray-board-belowrow panel at ≥900px): a two-column
     instrument — matted photograph (or monogram plate) left, the call as a
     ruled certificate with dotted-leader rows right. No dead ground.
   Injected via dangerouslySetInnerHTML: raw-text <style> children with
   quotes break hydration (see ray-site notes); innerHTML bypasses escaping. */
const CALLPLATE_CSS = `
.lectr-cp-body,.lectr-cp-fig,.lectr-cp-cert{display:contents}
.lectr-cp-leaders{display:none}
.lectr-cp-mono{display:flex;align-items:center;justify-content:center;background:var(--color-bg-elevated)}
.lectr-cp-monorules{position:absolute;top:10px;left:12px;right:12px;height:5px;background:linear-gradient(to bottom,var(--color-fg) 0,var(--color-fg) 2px,transparent 2px,transparent 4px,rgba(242,238,227,0.28) 4px,rgba(242,238,227,0.28) 5px)}
.lectr-cp-monoglyph{font-size:40px;font-weight:700;color:var(--color-text-faint);letter-spacing:0.02em;line-height:1}
/* COMPACT density — no image plate: microcap head, maker/title, the dotted-
   leader certificate rows (always visible, every width), band slot, CTA. */
.lectr-cp-compact{display:block;padding:22px 24px 20px}
.lectr-cp-compact .lectr-cp-head{position:relative;margin-bottom:12px;padding-top:9px;border-top:2px solid var(--color-fg);font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-beige-text)}
.lectr-cp-compact .lectr-cp-head::before{content:"";position:absolute;top:2px;left:0;right:0;border-top:1px solid var(--hairline)}
.lectr-cp-compact .lectr-cp-band{margin:2px -10px 0}
.lectr-cp-compact .lectr-cp-leaders{display:block;margin-top:14px;border-top:2px dotted var(--hairline);padding-top:4px}
.lectr-cp-compact .lectr-cp-row{display:flex;align-items:baseline;gap:10px;padding:10px 0;font-size:13.5px}
.lectr-cp-compact .lectr-cp-k{color:var(--color-text-muted)}
.lectr-cp-compact .lectr-cp-fill{flex:1;border-bottom:2px dotted rgba(242,238,227,0.28);transform:translateY(-3px)}
.lectr-cp-compact .lectr-cp-v{font-weight:700;font-variant-numeric:tabular-nums;color:var(--color-fg);white-space:nowrap}
.lectr-cp-compact .lectr-cp-v.up{color:var(--color-up)}
.lectr-cp-compact .lectr-cp-sub{font-size:11.5px;font-weight:500;color:var(--color-text-muted);margin-right:2px;white-space:nowrap}
.lectr-cp-compact .lectr-cp-dots{font-size:10px;letter-spacing:1px;color:var(--color-beige);margin-right:7px}
/* the compact plate's photograph — an elevated mat beside the certificate.
   Mobile: mat above the leaders; ≥900px: a right column. No image → the
   grid collapses to the single text column (never a dominant empty frame). */
.lectr-cpc-grid{display:flex;flex-direction:column}
/* phone: the photograph leads, as on the full plate — head, mat, certificate */
.lectr-cpc-fig{order:-1;margin:2px 0 16px}
.lectr-cpc-mat{background:var(--color-bg-elevated);border:1px solid var(--hairline);border-radius:12px;padding:14px}
.lectr-cpc-img{height:200px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:6px}
.lectr-cpc-img img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.lectr-cpc-cap{margin-top:10px;border-top:2px dotted var(--hairline);padding-top:8px;font-size:11.5px;color:var(--color-text-muted)}
@media (min-width:900px){
  .lectr-cp-compact .lectr-cpc-grid{display:grid;grid-template-columns:minmax(0,1fr) 36%;column-gap:34px;align-items:stretch}
  .lectr-cp-compact .lectr-cpc-grid.lectr-cpc-noimg{display:block}
  .lectr-cpc-main{grid-column:1;grid-row:1;min-width:0}
  .lectr-cpc-fig{grid-column:2;grid-row:1;margin:0;min-width:0;display:flex}
  .lectr-cpc-mat{flex:1;display:flex;flex-direction:column}
  .lectr-cpc-img{flex:1;height:auto;min-height:280px}
}
/* FULL density, image failed: never a dominant empty frame — the monogram
   plate shrinks to a modest square at every presentation. */
.lectr-cp.lectr-cp-noimg .ray-plate-img{height:140px}
@media (min-width:900px){
  .ray-board-belowrow .lectr-cp{padding:20px 24px 18px}
  .ray-board-belowrow .lectr-cp .lectr-cp-body{display:grid;grid-template-columns:42% minmax(0,1fr);grid-template-rows:auto 1fr;column-gap:36px}
  .ray-board-belowrow .lectr-cp .lectr-cp-fig{display:block;grid-column:1;grid-row:1/span 2;min-width:0}
  .ray-board-belowrow .lectr-cp .lectr-cp-cert{display:flex;flex-direction:column;grid-column:2;grid-row:2;min-width:0}
  .ray-board-belowrow .lectr-cp .lectr-cp-head{grid-column:2;grid-row:1;position:relative;margin-bottom:12px;padding-top:9px;border-top:2px solid var(--color-fg);font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-beige-text)}
  .ray-board-belowrow .lectr-cp .lectr-cp-head::before{content:"";position:absolute;top:2px;left:0;right:0;border-top:1px solid var(--hairline)}
  .ray-board-belowrow .lectr-cp .ray-plate-mat{padding:18px;margin-bottom:0}
  .ray-board-belowrow .lectr-cp .ray-plate-img{height:320px;background:var(--color-bg-elevated)}
  .ray-board-belowrow .lectr-cp .ray-plate-img img{object-fit:contain}
  .ray-board-belowrow .lectr-cp .ray-plate-cap{margin-top:12px;border-top:2px dotted var(--hairline);padding-top:9px;font-size:11.5px;color:var(--color-text-muted)}
  .ray-board-belowrow .lectr-cp .lectr-cp-monoglyph{font-size:64px}
  .ray-board-belowrow .lectr-cp .lectr-cp-est{display:none}
  .ray-board-belowrow .lectr-cp .ray-sigrow{display:none}
  .ray-board-belowrow .lectr-cp .lectr-cp-leaders{display:block;margin-top:14px;border-top:2px dotted var(--hairline);padding-top:4px}
  .ray-board-belowrow .lectr-cp .lectr-cp-row{display:flex;align-items:baseline;gap:10px;padding:10px 0;font-size:13.5px}
  .ray-board-belowrow .lectr-cp .lectr-cp-k{color:var(--color-text-muted)}
  .ray-board-belowrow .lectr-cp .lectr-cp-fill{flex:1;border-bottom:2px dotted rgba(242,238,227,0.28);transform:translateY(-3px)}
  .ray-board-belowrow .lectr-cp .lectr-cp-v{font-weight:700;font-variant-numeric:tabular-nums;color:var(--color-fg);white-space:nowrap}
  .ray-board-belowrow .lectr-cp .lectr-cp-v.up{color:var(--color-up)}
  .ray-board-belowrow .lectr-cp .lectr-cp-sub{font-size:11.5px;font-weight:500;color:var(--color-text-muted);margin-right:2px;white-space:nowrap}
  .ray-board-belowrow .lectr-cp .lectr-cp-dots{font-size:10px;letter-spacing:1px;color:var(--color-beige);margin-right:7px}
  .ray-board-belowrow .lectr-cp .ray-deckcall-cta{margin-top:auto;padding-top:14px;border-top:2px dotted var(--hairline)}
  /* wide plate, image failed: reflow text-first — the monogram becomes a
     ~140px side square and the certificate column takes the width */
  .ray-board-belowrow .lectr-cp.lectr-cp-noimg .lectr-cp-body{grid-template-columns:176px minmax(0,1fr)}
  .ray-board-belowrow .lectr-cp.lectr-cp-noimg .ray-plate-img{height:140px}
  .ray-board-belowrow .lectr-cp.lectr-cp-noimg .lectr-cp-monoglyph{font-size:40px}
}
`;

/** One dotted-leader certificate row: label — dotted fill — value. */
function LeaderRow({ k, v, up, sub, children }: {
  k: string; v?: string; up?: boolean; sub?: string; children?: ReactNode;
}) {
  return (
    <div className="lectr-cp-row">
      <span className="lectr-cp-k">{k}</span>
      <span className="lectr-cp-fill" aria-hidden />
      {sub && <span className="lectr-cp-sub">{sub}</span>}
      <span className={`lectr-cp-v${up ? ' up' : ''}`}>{children ?? v}</span>
    </div>
  );
}

export function CallPlate({
  lots,
  allLots,
  market = 'all',
  isSaved,
  onToggleSave,
  density = 'full',
  band,
  onSeeComps,
}: {
  lots: AuctionLot[];
  allLots: AuctionLot[];
  market?: Market;
  isSaved?: (id: string) => boolean;
  onToggleSave?: (id: string, lot?: AuctionLot) => void;
  /** 'compact' drops the image plate: microcap head, maker/title, the
      dotted-leader rows, an optional band slot, and the CTA row. */
  density?: 'full' | 'compact';
  /** compact only — a PriceBand (or similar) strip slotted under the title */
  band?: ReactNode;
  /** compact only — when provided, the primary CTA reads "See the comps"
      and opens the caller's modal instead of linking to /value */
  onSeeComps?: (lot: AuctionLot) => void;
}) {
  const call = useMemo(() => pickCall(lots, allLots, market), [lots, allLots, market]);
  // a hotlink-blocked photograph must never unmount the column — the fallback
  // flips this state and the monogram plate takes the mat instead
  const [failedImgId, setFailedImgId] = useState<string | null>(null);

  if (!call) return null;
  const { lot, signal } = call;
  const meter = confidenceMeter(signal!.confidence);
  const saved = isSaved ? isSaved(lot.id) : false;
  const imgOk = !!lot.imageUrl && failedImgId !== lot.id;
  const makerName = ARTIST_LABEL[lot.artist] || lot.artist;
  const monogram = makerName.trim().charAt(0).toUpperCase();
  const saleDay = trueSaleDay(lot) || lot.saleDate;
  // CLOSING-TIME SALIENCE — a call that closes today/tonight names the urgency
  // instead of a bare date. Same LOCAL-day arithmetic daysWord uses; the call
  // is already gated ACTIONABLE (pickCall drops closed lots), so ≤0 means it
  // hammers today. "tonight" when the house's own close time is this evening.
  const closeD = daysUntil(saleDay);
  const closesTonight = !!lot.saleDateTime && new Date(lot.saleDateTime).getHours() >= 17;
  const closingWord = closeD != null && closeD <= 0 ? (closesTonight ? 'closes tonight' : 'closes today') : null;
  const caption = `${lot.lotNumber ? `Lot ${lot.lotNumber} · ` : ''}${lot.auctionHouse} · ${closingWord ? closingWord : `hammers ${formatDate(saleDay)}`}`;
  // the comps median in dollars: the deep signal carries the pool median;
  // crawl-time signals don't, but pct IS med/estMid − 1, so it derives exactly
  const estMid = lot.estimateLow && lot.estimateHigh
    ? (lot.estimateLow + lot.estimateHigh) / 2
    : (lot.estimateLow || lot.estimateHigh || null);
  const sigMed = (signal as NonNullable<typeof signal> & { med?: number }).med;
  const compsMed = sigMed ?? (estMid != null && signal!.label === 'Below Market'
    ? Math.round(estMid * (1 + signal!.pct / 100))
    : null);

  const saveBtn = onToggleSave && (
    <button
      className="ray-save-btn"
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleSave(lot.id, lot); }}
      aria-label={saved ? 'Remove from saved' : 'Save lot'}
      // position/zIndex: on the full-density plate the button must ride ABOVE
      // the stretched /value link overlay (a sibling, never a descendant —
      // button-inside-link is invalid interactive nesting)
      style={{ position: 'relative', zIndex: 2, width: 44, height: 44, margin: '-14px -12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 100, cursor: 'pointer', padding: 0 }}
    >
      <span style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: saved ? 'var(--color-fg)' : 'var(--color-bg-elevated)', borderRadius: 100 }}>
        <svg width="10" height="12" viewBox="0 0 12 14" fill="none" aria-hidden="true">
          <path d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z" fill={saved ? 'var(--color-bg)' : 'var(--color-text-faint)'} />
        </svg>
      </span>
    </button>
  );

  // COMPACT — /value's call hero: same pickCall, same numbers, one component.
  // The photograph rides an elevated mat beside the certificate (right column
  // ≥900px, above the leaders on a phone); a hotlink-blocked house drops the
  // mat and the plate reflows to the single text column — never an empty frame.
  if (density === 'compact') {
    return (
      <div className="glass lit lectr-cp lectr-cp-compact">
        <style dangerouslySetInnerHTML={{ __html: CALLPLATE_CSS }} />
        <div className="ray-panel-k lectr-cp-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>Today&rsquo;s call · highest confidence, deepest gap</span>
          {saveBtn}
        </div>
        <div className={`lectr-cpc-grid${imgOk ? '' : ' lectr-cpc-noimg'}`}>
          <div className="lectr-cpc-main">
            <div className="ray-call-artist">{makerName}</div>
            <div className="ray-call-title">{craftTitle(lot.title)}</div>
            {band && <div className="lectr-cp-band">{band}</div>}
            <div className="lectr-cp-leaders">
              <LeaderRow k="Ask" v={formatEstimate(lot)} />
              <LeaderRow k="Comps median" v={compsMed != null ? formatPrice(compsMed) : '—'} sub={`${signal!.basis ?? '—'} sales`} />
              <LeaderRow k="The gap" v={signalMagnitude(signal!.label, signal!.pct)} up sub="comps over ask" />
              <LeaderRow k="Confidence">
                <span className="lectr-cp-dots" aria-hidden>{meter.dots}</span>{meter.word}
              </LeaderRow>
              <LeaderRow k={closingWord ? 'Closing' : 'Hammers'} sub={lot.auctionHouse}>
                {closingWord
                  ? <span style={{ color: 'var(--color-up)' }}>
                      {closingWord}
                      {lot.saleDateTime && <> · <CloseClock iso={lot.saleDateTime} windowHours={24} /></>}
                    </span>
                  : `${formatDate(saleDay)} · ${daysWord(saleDay)}`}
              </LeaderRow>
            </div>
            <div className="ray-call-ctas" style={{ marginTop: 16 }}>
              {onSeeComps ? (
                <button className="ray-call-btn ray-call-btn-primary" onClick={() => onSeeComps(lot)}>
                  See the comps
                </button>
              ) : (
                <Link className="ray-call-btn ray-call-btn-primary" href="/value">See how we called it</Link>
              )}
              {/* the in-app certificate before the house exit — the app's transport
                  form (/lot self-canonicalizes to /lot/<id>), mirroring the modal */}
              <Link className="ray-call-btn ray-call-btn-quiet" href={`/lot?id=${encodeURIComponent(lot.id)}`}>
                Open the lot page <Flick size={10} style={{ marginLeft: 5 }} />
              </Link>
              {/* scheme-allowlisted (safe-href) — a faulted URL drops the house
                  exit; the lot-page CTA above still carries the journey */}
              {safeHref(lot.url) && (
                <a className="ray-call-btn ray-call-btn-quiet" href={safeHref(lot.url)} target="_blank" rel="noopener noreferrer">
                  View lot <Flick size={10} style={{ marginLeft: 5 }} />
                </a>
              )}
            </div>
          </div>
          {imgOk && (
            <div className="lectr-cpc-fig">
              <div className="lectr-cpc-mat">
                <div className="lectr-cpc-img">
                  <img
                    src={httpsImg(lot.imageUrl)}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => setFailedImgId(lot.id)}
                    // cache hits never fire onError — complete with zero
                    // naturalWidth at attach is a cached failure
                    ref={el => { if (el && el.complete && el.naturalWidth === 0) setFailedImgId(lot.id); }}
                  />
                </div>
                <div className="lectr-cpc-cap">{caption}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    // LotCard's stretched-action pattern: the panel is a positioned <div>,
    // the /value navigation is a stretched sibling <Link> overlay (z1), and
    // the save <button> floats above it (z2) — interactive controls are
    // siblings, never nested (B4-5: button-inside-link is invalid HTML and
    // undefined for keyboard/AT).
    <div className={`ray-board-panel ray-deckcall lectr-cp${imgOk ? '' : ' lectr-cp-noimg'}`} style={{ position: 'relative' }}>
      <Link
        href="/value"
        aria-label="Today's call — see how we called it"
        style={{ position: 'absolute', inset: 0, zIndex: 1, borderRadius: 'inherit' }}
      />
      <style dangerouslySetInnerHTML={{ __html: CALLPLATE_CSS }} />
      <div className="lectr-cp-body">
        <div className="ray-panel-k lectr-cp-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>Today&rsquo;s call · highest confidence, deepest gap</span>
          {saveBtn}
        </div>

        {/* the plate: photograph on the elevated mat — or, when the house
            blocks the hotlink, the maker's monogram on the same ground */}
        <div className="lectr-cp-fig">
          <div className="ray-plate-mat">
            {imgOk ? (
              <div className="ray-plate-img">
                <img
                  src={httpsImg(lot.imageUrl)}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setFailedImgId(lot.id)}
                  // cache hits never fire onError — complete with zero
                  // naturalWidth at attach is a cached failure
                  ref={el => { if (el && el.complete && el.naturalWidth === 0) setFailedImgId(lot.id); }}
                />
              </div>
            ) : (
              <div className="ray-plate-img lectr-cp-mono">
                <span className="lectr-cp-monorules" aria-hidden />
                <span className="lectr-cp-monoglyph">{monogram}</span>
              </div>
            )}
            <div className="ray-plate-cap">{caption}</div>
          </div>
        </div>

        {/* the certificate */}
        <div className="lectr-cp-cert">
          <div className="ray-deckcall-maker">{makerName}</div>
          <div className="ray-deckcall-title">{craftTitle(lot.title)}</div>

          {/* wide plate: the call as dotted-leader rows */}
          <div className="lectr-cp-leaders">
            <LeaderRow k="Ask" v={formatEstimate(lot)} />
            <LeaderRow k="Comps median" v={compsMed != null ? formatPrice(compsMed) : '—'} sub={`${signal!.basis ?? '—'} sales`} />
            <LeaderRow k="The gap" v={signalMagnitude(signal!.label, signal!.pct)} up sub="comps over ask" />
            <LeaderRow k="Confidence">
              <span className="lectr-cp-dots" aria-hidden>{meter.dots}</span>{meter.word}
            </LeaderRow>
            <LeaderRow k={closingWord ? 'Closing' : 'Hammers'}>
              {closingWord
                ? <span style={{ color: 'var(--color-up)' }}>{closingWord}</span>
                : `${formatDate(saleDay)} · ${daysWord(saleDay)}`}
            </LeaderRow>
          </div>

          {/* stacked plate (mobile + rail): the current lines, untouched */}
          <div className="lectr-cp-est" style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 4 }}>{formatEstimate(lot)}</div>
          <div className="ray-sigrow" data-tone="up" style={{ marginTop: 9 }}>
            <span className="ray-sigrow-pct" style={{ fontSize: 26 }}>{signalMagnitude(signal!.label, signal!.pct)}</span>
            <span className="ray-sigrow-ctx">
              comps over ask · {signal!.basis} sales
              <span className="ray-sigrow-dots" title={`${meter.word} confidence`}>{meter.dots}</span>
            </span>
          </div>

          <div className="ray-deckcall-cta">See how we called it <Flick size={13} /></div>
          <img
            src="/brand/lectr-nav.png"
            alt=""
            style={{ height: 18, width: 'auto', opacity: 0.55, display: 'block', marginLeft: 'auto', marginTop: 10 }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── the colophon ───────────────────────────────────────────────────── */
/**
 * THE FLOOR AT CLOSE — the footer is the identity's closing statement. The
 * sign gets its one display-scale moment: the mark writes itself in its own
 * light when the reader arrives, over the provenance the whole product
 * stands on. One gesture, then quiet.
 */
/** meta.json is tiny (~2KB) — the colophon self-serves its provenance so the
 *  facts print on EVERY page, not only the ones that thread props. Module-
 *  cached: one fetch per session. */
let colophonMetaCache: { lots: number; lastCrawl: string } | null = null;
function useColophonMeta(): { lots: number; lastCrawl: string } | null {
  const [meta, setMeta] = useState(colophonMetaCache);
  useEffect(() => {
    if (colophonMetaCache) return;
    let dead = false;
    fetch('/data/ray/meta.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j || dead) return;
        colophonMetaCache = { lots: j.totalLots || 0, lastCrawl: j.lastCrawl || '' };
        setMeta(colophonMetaCache);
      })
      .catch(() => { /* the spec line simply prints fewer segments */ });
    return () => { dead = true; };
  }, []);
  return meta;
}

const SPEC_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function specDate(iso: string): string | null {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  return `${SPEC_MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

/**
 * Colophon — THE MAKER'S PLATE (Aug 2026 redesign; "HIGH HIGH end").
 *
 * The footer as one engraved object: the thesis set once at monument scale
 * (the site's ONE earned Fraunces display moment), the provenance CUT beneath
 * it as an engraved mono spec line — the corpus facts finally printed, with
 * the record as the line's own citation — then the links flattened into
 * labeled machined channels, and the signature reduced from billboard to
 * maker's stamp: small, bottom-left, signed after the work. Chosen from a
 * three-concept exploration (plate / floor-closes / colophon-page); the
 * tape's figure-over-word ink and the earned mint delta grafted in.
 *
 * Butter appears exactly once — the Starling channel (the one outbound
 * product link). The footer carries no lamp.
 */
export function Colophon({ lotCount, houseCount, record }: {
  /** corpus facts — optional; the colophon self-serves meta.json when absent */
  lotCount?: number;
  houseCount?: number;
  /** the backtest's flagged record — the spec line prints it when passed;
      otherwise the line ends in a quiet SEE THE RECORD citation */
  record?: { n: number; medianPerfPct: number } | null;
}) {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  const meta = useColophonMeta();
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) { setInView(true); io.disconnect(); } },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const lots = lotCount || meta?.lots || null;
  const read = meta?.lastCrawl ? specDate(meta.lastCrawl) : null;

  return (
    <footer className={`ray-close${inView ? ' ray-close-on' : ''}`} ref={ref}>
      <div className="rail ray-close-in">
        {/* the monument — the argument, set once, at the close */}
        <p className="ray-close-thesis">Every estimate, read against every hammer.</p>

        {/* the engraved spec line — provenance printed, the record cited */}
        <p className="ray-close-spec">
          {lots && <span><b>{lots.toLocaleString()}</b> lots</span>}
          {houseCount ? <span><b>{houseCount}</b> houses</span> : null}
          {read && <span>last read <b>{read}</b></span>}
          {record && record.n > 500 ? (
            <span>
              flagged <Link href="/receipts"><b className="up">{fmtSignedPct(record.medianPerfPct)}</b> median over <b>{record.n.toLocaleString()}</b> replays</Link>
            </span>
          ) : (
            <span><Link href="/receipts">see the record</Link></span>
          )}
        </p>

        {/* the machined channels — the map as engraved lines, never columns */}
        <div className="ray-close-lines">
          <div className="ray-close-line" style={{ '--row-i': 0 } as React.CSSProperties}>
            <span className="ray-close-line-k">Markets</span>
            <span className="ray-close-line-links">
              <Link href="/">Total market</Link>
              <Link href="/art">Art</Link>
              <Link href="/design">Design</Link>
              <Link href="/watches">Watches</Link>
              <Link href="/sports">Sports</Link>
              <Link href="/tcg">TCG</Link>
              <Link href="/science">Science</Link>
              <Link href="/culture">Pop Culture</Link>
            </span>
          </div>
          <div className="ray-close-line" style={{ '--row-i': 1 } as React.CSSProperties}>
            <span className="ray-close-line-k">The desk</span>
            <span className="ray-close-line-links">
              <Link href="/value">Value</Link>
              <Link href="/receipts">The record</Link>
              <Link href="/makers">Makers</Link>
              <Link href="/analytics">Analytics</Link>
              <Link href="/profile">My profile</Link>
              <Link href="/about">How it works</Link>
              <Link href="/blog">Notes from the desk</Link>
            </span>
          </div>
          <div className="ray-close-line" style={{ '--row-i': 2 } as React.CSSProperties}>
            <span className="ray-close-line-k">Partner site</span>
            <span className="ray-close-line-links">
              <a
                href="https://starling-6s1.pages.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="ray-close-starling"
              >
                Starling — the same book on eBay <span aria-hidden="true">↗</span>
              </a>
            </span>
          </div>
        </div>

        {/* the imprint — the maker signs last, small, next to the edition line */}
        <div className="ray-close-base">
          <span className="ray-close-stamp">
            <img src="/brand/lectr.png" alt="lectr" className="ray-close-mark" />
            <span suppressHydrationWarning>© {new Date().getFullYear()} lectr · auction intelligence</span>
          </span>
          <span className="ray-close-method">
            <span>Comps: same maker, same form, size-banded — medians, never means.</span>
            <span>Data from public auction results.</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
