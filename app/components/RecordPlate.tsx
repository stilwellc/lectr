'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { formatPrice, formatDate, httpsImg } from '../utils';
import { useReducedMotion } from '../preview/terminal/hooks';

/** one sale the plate can show — the vitrine rotates through up to three */
export interface PlateSale {
  figure: number;
  date?: string | null;
  house?: string | null;
  title?: string | null;
  imageUrl?: string | null;
  href?: string | null;
}

/**
 * M8 — THE RECORD PLATE. The dossier hero's right quadrant: the page's
 * headline sale as a framed object. The ENGRAVED MINI-CERTIFICATE (figure ·
 * date · house, in the certificate voice) is the base layer — layout never
 * depends on a photograph. When the loaded data carries the sale's image it
 * hangs above the certificate on the warm mat (object-fit contain, never
 * cropped); a dead hotlink simply drops the photo and the certificate stands.
 *
 * ROTATING VITRINE (#33): pass `sales` (top-N by price) and the plate cycles
 * them — a gentle auto-advance under motion, prev/next dots either way. The
 * label re-numbers as it turns ("Record sale" → "2nd highest" → "3rd
 * highest"). Reduced-motion suppresses the auto-rotate (dots still work).
 * Backward-compatible: the single-sale prop API is unchanged; when no `sales`
 * array is passed the plate renders exactly one certificate as before.
 */
export default function RecordPlate({
  label,
  figure,
  date,
  house,
  title,
  imageUrl,
  href,
  sales,
}: {
  /** the certificate head — honest to the data ("Record sale", "Top recent sale"…) */
  label: string;
  figure: number;
  date?: string | null;
  house?: string | null;
  title?: string | null;
  imageUrl?: string | null;
  /** when the sale has a lot page, the whole plate is its door */
  href?: string | null;
  /** the top-N sales to cycle through (record first). When present and length
      ≥ 2 the plate becomes a vitrine; the top-level figure/date/… props are
      ignored in favor of sales[0..N]. Ranks re-label per position. */
  sales?: PlateSale[];
}) {
  // the deck: an explicit `sales` array (vitrine) or the single-sale props
  const deck: PlateSale[] =
    sales && sales.length > 0 ? sales : [{ figure, date, house, title, imageUrl, href }];
  const rotates = deck.length >= 2;

  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [imgOk, setImgOk] = useState(true);
  const pausedRef = useRef(false);

  // re-clamp when the deck shrinks (e.g. lens switch upstream)
  useEffect(() => { setIdx(i => (i >= deck.length ? 0 : i)); }, [deck.length]);
  // reset the image-ok flag whenever the shown sale changes — a dead hotlink on
  // one card must not blank the next
  useEffect(() => { setImgOk(true); }, [idx]);

  // gentle auto-advance — only when it rotates, motion is allowed, and the
  // reader isn't hovering. 6s dwell reads as a vitrine, not a carousel.
  useEffect(() => {
    if (!rotates || reduce) return;
    const t = setInterval(() => {
      if (!pausedRef.current) setIdx(i => (i + 1) % deck.length);
    }, 6000);
    return () => clearInterval(t);
  }, [rotates, reduce, deck.length]);

  const cur = deck[Math.min(idx, deck.length - 1)];
  const showImg = !!cur.imageUrl && imgOk;
  // the head re-numbers as the vitrine turns; single-sale keeps the given label
  const headLabel = rotates
    ? idx === 0
      ? label
      : idx === 1
        ? '2nd highest'
        : idx === 2
          ? '3rd highest'
          : `#${idx + 1} sale`
    : label;

  const body: ReactNode = (
    <>
      {showImg && (
        <span className="lectr-recplate-img" aria-hidden>
          <img
            key={cur.imageUrl}
            src={httpsImg(cur.imageUrl!)}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImgOk(false)}
            // cache hits never fire onError — complete with zero naturalWidth
            // at attach is a cached failure
            ref={el => { if (el && el.complete && el.naturalWidth === 0) setImgOk(false); }}
          />
        </span>
      )}
      <span className="lectr-recplate-k" style={showImg ? undefined : { marginTop: 2 }}>
        <span>{headLabel}</span>
        {cur.date && (
          <span style={{ color: 'var(--color-text-faint)', fontWeight: 600, letterSpacing: '0.08em' }}>
            {formatDate(cur.date, { month: 'short', year: 'numeric' })}
          </span>
        )}
      </span>
      <span className="lectr-recplate-cert" style={{ display: 'block' }}>
        <span className="lectr-recplate-fig" style={{ display: 'block' }}>{formatPrice(cur.figure)}</span>
        {(cur.house || cur.date) && (
          <span className="lectr-recplate-sub" style={{ display: 'block' }}>
            {cur.house}
            {cur.house && cur.date ? ' · ' : ''}
            {cur.date ? formatDate(cur.date) : ''}
          </span>
        )}
        {cur.title && <span className="lectr-recplate-title">{cur.title}</span>}
      </span>
    </>
  );

  // the vitrine's prev/next — tiny dots, keyboard-reachable, no auto-focus
  const dots = rotates ? (
    <span
      className="lectr-recplate-dots"
      role="tablist"
      aria-label="Top sales"
      style={{ display: 'inline-flex', gap: 6, marginTop: 10, alignItems: 'center' }}
    >
      {deck.map((_, i) => (
        <button
          key={i}
          role="tab"
          aria-selected={i === idx}
          aria-label={`Sale ${i + 1} of ${deck.length}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(i); }}
          style={{
            width: i === idx ? 16 : 6,
            height: 6,
            padding: 0,
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            background: i === idx ? 'var(--paper-edge, rgba(255,255,255,0.5))' : 'var(--color-border-mid, rgba(255,255,255,0.18))',
            transition: 'width 0.2s ease, background 0.2s ease',
          }}
        />
      ))}
    </span>
  ) : null;

  const onEnter = () => { pausedRef.current = true; };
  const onLeave = () => { pausedRef.current = false; };

  // the plate frame — a link when the shown sale has a door, else a div. The
  // dots sit OUTSIDE the door so tapping a dot never navigates.
  const plate = cur.href ? (
    <Link href={cur.href} className="lectr-recplate" aria-label={`${headLabel} — ${formatPrice(cur.figure)}`}>
      {body}
    </Link>
  ) : (
    <div className="lectr-recplate">{body}</div>
  );

  if (!rotates) return plate;

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocusCapture={onEnter}
      onBlurCapture={onLeave}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
    >
      {plate}
      {dots}
    </div>
  );
}
