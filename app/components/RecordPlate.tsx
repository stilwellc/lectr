'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { formatPrice, formatDate, httpsImg, sizedImg } from '../utils';
import { useReducedMotion } from '../preview/terminal/hooks';

/** The plate's framed well renders ≤ ~300 CSS px, so ask the Bonhams resizer
 *  for 640 (2× retina). See `sizedImg` in app/utils. */
const PLATE_IMG_W = 640;

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
  imagePending = false,
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
  /** the caller knows a photo is still in flight (phase-2 corpus): hold the
      well's height so the plate can't grow under the reader. Ignored once a
      real image is showing. */
  imagePending?: boolean;
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
  // holding the well's space for a photo that hasn't arrived yet
  const holdImg = !showImg && imagePending && idx === 0;
  // the head re-numbers as the vitrine turns; single-sale keeps the given label
  const headLabel = rotates
    ? idx === 0
      ? label
      : idx === 1
        ? 'Second-highest'
        : idx === 2
          ? 'Third-highest'
          : `Sale ${idx + 1} of the vitrine`
    : label;

  const body: ReactNode = (
    <>
      {/* space held, frame not drawn: the reserved well is transparent and
          outline-free, so a pending photo costs no visible empty frame — it
          just stops the certificate below it from jumping when the photo
          lands. Only the first card reserves; later vitrine cards turn after
          the corpus is in, so their images are already known. */}
      {holdImg && <span className="lectr-recplate-img lectr-recplate-img-hold" aria-hidden />}
      {showImg && (
        <span className="lectr-recplate-img" aria-hidden>
          <img
            key={cur.imageUrl}
            src={sizedImg(httpsImg(cur.imageUrl!)!, PLATE_IMG_W)}
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
      <span className="lectr-recplate-k" style={showImg || holdImg ? undefined : { marginTop: 2 }}>
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

  // the vitrine's pager — the VISUAL stays a tiny dot, but each button is a
  // ≥40×40px hit box (A6: the bare 6×6px dots were untappable on a phone).
  // Padding provides the target; negative margins keep the visual rhythm so
  // the row doesn't read as a 40px-tall control strip.
  const dots = rotates ? (
    <span
      className="lectr-recplate-dots"
      role="tablist"
      aria-label="Top sales"
      style={{ display: 'inline-flex', marginTop: 10, marginBottom: -12, marginLeft: -17, alignItems: 'center' }}
    >
      {deck.map((_, i) => (
        <button
          key={i}
          role="tab"
          aria-selected={i === idx}
          aria-label={`Sale ${i + 1} of ${deck.length}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(i); }}
          style={{
            // the true tap target: 40×40 minimum, dot centered inside
            minWidth: 40,
            minHeight: 40,
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            style={{
              width: i === idx ? 16 : 6,
              height: 6,
              borderRadius: 3,
              background: i === idx ? 'var(--paper-edge, rgba(255,255,255,0.5))' : 'var(--color-border-mid, rgba(255,255,255,0.18))',
              transition: 'width 0.2s ease, background 0.2s ease',
            }}
          />
        </button>
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
