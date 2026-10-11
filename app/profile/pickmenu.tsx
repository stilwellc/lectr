'use client';
/**
 * The phone pick's ⋯ (Oct 11 2026, /profile redesign): a pick row keeps
 * its full width for the work and its reason, and "More like this / Not for
 * me" sit one tap away in the feed toolbar's bottom sheet, 44px targets.
 * Same marks, same Undo seat as the desktop pills (components/PickFeedback).
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuctionLot } from '../types';
import type { MarkKind } from '../lib/recs-signals';
import { FEEDSHEET_CSS } from '../components/FeedToolbar';
import { useDialogFocus } from '../components/useDialogFocus';
import { useBackClose } from '../lib/use-lot-modal';
import { craftTitle } from '../utils';

export default function PickMenu({ lot, mark, onMark, at }: {
  lot: AuctionLot;
  mark: MarkKind | null | undefined;
  onMark: (kind: MarkKind, lot: AuctionLot, at: number) => void;
  at: number;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const t = craftTitle(lot.title, lot.auctionHouse);
  return (
    <>
      <button ref={btn} type="button" className="ck-pick-more" aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Tune picks from ${t}${mark === 'more' ? ' — More like this is on' : ''}`}
        title={mark === 'more' ? 'More like this is on' : undefined} data-on={mark === 'more' || undefined}
        onClick={e => { e.stopPropagation(); setOpen(true); }}>
        <span aria-hidden>⋯</span>
      </button>
      {open && <Sheet title={t} mark={mark} onClose={() => { setOpen(false); btn.current?.focus(); }}
        onPick={k => { onMark(k, lot, at); setOpen(false); }} />}
    </>
  );
}

function Sheet({ title, mark, onClose, onPick }: { title: string; mark: MarkKind | null | undefined; onClose: () => void; onPick: (k: MarkKind) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const id = useId();
  useDialogFocus(true, ref, { initial: 'first' });
  // Back closes the sheet, never the page (R4 P2-3)
  useBackClose(onClose);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="ray-feedsheet-scrim" role="presentation" onClick={onClose}>
      <style dangerouslySetInnerHTML={{ __html: FEEDSHEET_CSS }} />
      <div ref={ref} className="ray-feedsheet" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="ray-feedsheet-grip" aria-hidden="true" />
        <div className="ray-feedsheet-body">
          <div id={id} className="ck-pick-sheet-title">{title}</div>
          <div className="ck-pick-sheet-actions">
            <button type="button" className="ray-toolbar-pill" data-active={mark === 'more'} aria-pressed={mark === 'more'} onClick={() => onPick('more')}>
              {mark === 'more' ? 'More like this · on' : 'More like this'}
            </button>
            <button type="button" className="ray-toolbar-pill" onClick={() => onPick('less')}>Not for me</button>
          </div>
          <p className="ck-sig-note" style={{ margin: '12px 0 0' }}>Kept in this browser — never uploaded to lectr.</p>
        </div>
        <div className="ray-feedsheet-foot">
          <button type="button" className="ray-feedsheet-clear" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
