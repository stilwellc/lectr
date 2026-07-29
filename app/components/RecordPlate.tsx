'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { formatPrice, formatDate, httpsImg } from '../utils';

/**
 * M8 — THE RECORD PLATE. The dossier hero's right quadrant: the page's
 * headline sale as a framed object. The ENGRAVED MINI-CERTIFICATE (figure ·
 * date · house, in the certificate voice) is the base layer — layout never
 * depends on a photograph. When the loaded data carries the sale's image it
 * hangs above the certificate on the warm mat (object-fit contain, never
 * cropped); a dead hotlink simply drops the photo and the certificate stands.
 */
export default function RecordPlate({
  label,
  figure,
  date,
  house,
  title,
  imageUrl,
  href,
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
}) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = !!imageUrl && imgOk;

  const body: ReactNode = (
    <>
      {showImg && (
        <span className="lectr-recplate-img" aria-hidden>
          <img
            src={httpsImg(imageUrl!)}
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
        <span>{label}</span>
        {date && (
          <span style={{ color: 'var(--color-text-faint)', fontWeight: 600, letterSpacing: '0.08em' }}>
            {formatDate(date, { month: 'short', year: 'numeric' })}
          </span>
        )}
      </span>
      <span className="lectr-recplate-cert" style={{ display: 'block' }}>
        <span className="lectr-recplate-fig" style={{ display: 'block' }}>{formatPrice(figure)}</span>
        {(house || date) && (
          <span className="lectr-recplate-sub" style={{ display: 'block' }}>
            {house}
            {house && date ? ' · ' : ''}
            {date ? formatDate(date) : ''}
          </span>
        )}
        {title && <span className="lectr-recplate-title">{title}</span>}
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="lectr-recplate" aria-label={`${label} — ${formatPrice(figure)}`}>
        {body}
      </Link>
    );
  }
  return <div className="lectr-recplate">{body}</div>;
}
