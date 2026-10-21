'use client';
/**
 * THE STORY (Oct 20 audit) — tapping a Tonight photo opens tonight's lots as
 * full-screen stories: the house photo full-bleed, the clock to the hammer,
 * the estimate, the market's pill, and the three actions every live row
 * carries (My max · Bid at the house · Open the lot). ← / → or a tap on either
 * side walks; a swipe walks on touch; Esc or the close button returns focus.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../../types';
import PlateImg from '../../components/PlateImg';
import CloseClock from '../../components/CloseClock';
import { formatEstimate } from '../../components/LotCard';
import { displayMakerOf } from '../../lib/maker-subjects';
import { safeHref } from '../../lib/safe-href';
import { craftTitle, httpsImg, sizedImg } from '../../utils';
import { MyMax } from './mymax';

export interface Story { lot: AuctionLot; when: React.ReactNode; pill?: React.ReactNode }

export function StoryViewer({ stories, start, onClose }: { stories: readonly Story[]; start: number; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const box = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const go = useCallback((d: number) => setAt(i => Math.max(0, Math.min(stories.length - 1, i + d))), [stories.length]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey, true); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [go, onClose]);
  const s = stories[at];
  if (!s) return null;
  const lot = s.lot;
  const maker = displayMakerOf(lot)?.name;
  const title = craftTitle(lot.title, lot.auctionHouse);
  const bid = safeHref(lot.url);
  const src = lot.imageUrl ? sizedImg(httpsImg(lot.imageUrl), 1200) : undefined;
  return (
    <div className="ck-storyview" role="dialog" aria-modal="true" aria-label={`Tonight, ${at + 1} of ${stories.length}: ${title}`}
      ref={box} tabIndex={-1}
      onTouchStart={e => { touch.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={e => { const x0 = touch.current; touch.current = null; const x1 = e.changedTouches[0]?.clientX; if (x0 == null || x1 == null) return; if (x1 - x0 > 50) go(-1); else if (x0 - x1 > 50) go(1); }}>
      <div className="ck-storyview-bars" aria-hidden="true">
        {stories.map((_, i) => <i key={i} data-on={i <= at || undefined} />)}
      </div>
      <button type="button" className="ck-storyview-x" onClick={onClose} aria-label="Close">×</button>
      <div className="ck-storyview-ph">
        <span className="ck-storyview-l" aria-hidden="true">{(maker || title).match(/[A-Za-zÀ-ÿ]/)?.[0]?.toUpperCase() ?? '·'}</span>
        <PlateImg key={lot.id} src={src} alt={title} decoding="async" referrerPolicy="no-referrer" />
        <button type="button" className="ck-storyview-nav" data-side="prev" onClick={() => go(-1)} aria-label="Previous lot" disabled={at === 0} />
        <button type="button" className="ck-storyview-nav" data-side="next" onClick={() => go(1)} aria-label="Next lot" disabled={at === stories.length - 1} />
      </div>
      <div className="ck-storyview-body">
        <div className="ck-storyview-when">
          <span className="ck-storyview-clock">{s.when}</span>
          {lot.saleDateTime && <CloseClock iso={lot.saleDateTime} windowHours={24} prefix=" · " />}
          {s.pill}
        </div>
        <div className="ck-storyview-t">{title}</div>
        <div className="ck-storyview-s">{[maker, lot.auctionHouse, formatEstimate(lot)].filter(Boolean).join(' · ')}</div>
        <div className="ck-storyview-acts">
          <MyMax lot={lot} />
          {bid && <a className="ck-storyview-btn" href={bid} target="_blank" rel="noopener noreferrer">Bid at {lot.auctionHouse} ↗</a>}
          <Link className="ck-storyview-btn" data-solid href={`/lot?id=${encodeURIComponent(lot.id)}`}>Open the lot</Link>
        </div>
      </div>
    </div>
  );
}
