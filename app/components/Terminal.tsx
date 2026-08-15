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
  if (density === 'compact') {
    return (
      <div className="glass lit lectr-cp lectr-cp-compact">
        <style dangerouslySetInnerHTML={{ __html: CALLPLATE_CSS }} />
        <div className="ray-panel-k lectr-cp-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>Today&rsquo;s call · highest confidence, deepest gap</span>
          {saveBtn}
        </div>
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
              ? <span style={{ color: 'var(--color-up)' }}>{closingWord}</span>
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
export function Colophon({ record }: {
  // lotCount/houseCount are legacy contract — the slim colophon never prints
  // them; optional so call sites can drop their stale meta.json imports.
  lotCount?: number;
  houseCount?: number;
  /** the backtest's flagged record — rendered only when passed; pages with a
      proofstrip/settlement pass null and get the slim "See the record" line */
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
            <Link href="/culture">Pop Culture</Link>
          </div>
          <div className="ray-close-col">
            <span className="ray-close-k">The desk</span>
            <Link href="/value">Value</Link>
            <Link href="/makers">Makers</Link>
            <Link href="/analytics">Analytics</Link>
            <Link href="/profile">My profile</Link>
            <Link href="/about">How it works</Link>
            <Link href="/blog">Notes from the desk</Link>
          </div>
          <div className="ray-close-col ray-close-record">
            <span className="ray-close-k">The record</span>
            {/* the sentence renders only WHEN PASSED — pages that already show
                the settlement/proofstrip pass record={null} and get one line */}
            {record && record.n > 500 && (
              <p>
                Flagged calls hammered <b className="up">{fmtSignedPct(record.medianPerfPct)} median</b> over their estimates across {record.n.toLocaleString()} replayed sales.
              </p>
            )}
            <Link href="/value" className="ray-close-cta">See the record <Flick size={12} /></Link>
          </div>
          <div className="ray-close-col ray-close-buyside">
            <span className="ray-close-k">The buy side</span>
            <p>This book, pointed at eBay Buy It Now — deep-value deals, risk-graded.</p>
            <a
              href="https://starling-6s1.pages.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="ray-close-cta"
            >
              Open Starling <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        {/* baseline */}
        <div className="ray-close-base">
          <span suppressHydrationWarning>© {new Date().getFullYear()} lectr · auction intelligence</span>
          <span>Comps: same maker, same form, size-banded — medians, never means.</span>
          <span>Data from public auction results.</span>
        </div>
      </div>
    </footer>
  );
}
