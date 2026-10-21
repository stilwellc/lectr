'use client';
/**
 * THE DESK'S PHOTOS (Oct 20 2026) — the desk read like a book: rows of black
 * text on paper. Every lot row now leads with its house photo, the way a
 * feed leads with the picture. The lot IS the product art (NORTHSTAR lamp law).
 *
 *   <Thumb>   a square (or round, for the Tonight strip) photo tile over a
 *             quiet monogram; a dead or ORB-blocked hotlink falls back to the
 *             letter (PlateImg). `tone` rings it in the market's own ink —
 *             the only color a photo frame may borrow.
 *   <SigPill> the signal as a filled pill (green under the market, red over):
 *             the ticker chip a trading screen prints beside a price.
 */
import React from 'react';
import PlateImg from '../../components/PlateImg';
import { httpsImg, sizedImg } from '../../utils';

export function Thumb({ src, label, size = 56, round = false, wide = false, tone }: {
  src?: string | null;
  /** the lot's title or maker — its first letter is the fallback */
  label?: string | null;
  size?: number;
  round?: boolean;
  /** a full-width 16:10 photo atop a card (the feed post) */
  wide?: boolean;
  tone?: 'up' | 'down' | 'ink';
}) {
  const letter = ((label || '').match(/[A-Za-zÀ-ÿ]/)?.[0] ?? '·').toUpperCase();   // a year or lot number never stands for the lot
  const u = src ? sizedImg(httpsImg(src), wide ? 400 : Math.max(160, size * 3)) : undefined;
  return (
    <span className="ck-thumb" data-round={round || undefined} data-wide={wide || undefined} data-tone={tone}
      style={{ '--th': `${size}px` } as React.CSSProperties} aria-hidden="true">
      <span className="ck-thumb-l">{letter}</span>
      <PlateImg src={u} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    </span>
  );
}

export function SigPill({ dir, children, title }: { dir: 'up' | 'down' | 'flat'; children: React.ReactNode; title?: string }) {
  return <span className="ck-sigpill" data-dir={dir} title={title}>{children}</span>;
}
