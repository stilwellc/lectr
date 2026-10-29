'use client';
/**
 * MY MAX (Oct 20 2026 audit) — the collector's own ceiling on a watched lot.
 * The desk used to grade only the ENGINE (its signal at save, its max bid);
 * the reader was a spectator. Now every live watch carries the reader's
 * price: set here, graded against the hammer in Record, summed in Budget,
 * and flagged on Today/Watching when the live bid passes it.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { AuctionLot } from '../../types';
import { fmtFace, liveBidUsd } from '../../lib/lot-face';
import { useDesk } from './provider';

/** the reader's max on a lot (null = none set) */
export function useMyMax(lotId: string): number | null {
  const { desk } = useDesk();
  const m = desk.metaFor(lotId)?.maxUsd;
  return typeof m === 'number' && m > 0 ? m : null;
}

/** the live bid has passed the reader's max — lot-face liveBidUsd, the one
 *  read (an unconvertible bid is never read against a USD max) */
export const overMax = (lot: AuctionLot, max: number | null): boolean => {
  const usd = liveBidUsd(lot);
  return max != null && lot.priceUsd == null && usd != null && usd > max;
};

const parse = (s: string): number | null => {
  const t = s.trim().toLowerCase().replace(/[$,\s]/g, '');
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)([km]?)$/);
  if (!m) return NaN;
  return Math.round(Number(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1));
};

/** "Set my max" → an inline field (accepts 18000, 18k, $1.2m); Enter saves, Esc cancels */
export function MyMax({ lot, compact = false }: { lot: AuctionLot; compact?: boolean }) {
  const { act } = useDesk();
  const max = useMyMax(lot.id);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  const save = () => {
    const n = parse(val);
    if (Number.isNaN(n)) { setBad(true); return; }
    act.setSavedFields(lot.id, { maxUsd: n });
    setEditing(false); setBad(false);
  };
  const over = overMax(lot, max);
  if (editing) {
    return (
      <span className="ck-mymax-edit" onClick={e => e.stopPropagation()}>
        <label className="sr-only" htmlFor={`mymax-${lot.id}`}>Your max for this lot, in US dollars</label>
        <input id={`mymax-${lot.id}`} ref={input} inputMode="decimal" placeholder="e.g. 18k" value={val} data-bad={bad || undefined}
          onChange={e => { setVal(e.target.value); setBad(false); }}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
        <button type="button" className="ck-mymax-btn" data-solid onClick={save}>Save</button>
        {max != null && <button type="button" className="ck-mymax-btn" onClick={() => { act.setSavedFields(lot.id, { maxUsd: null }); setEditing(false); }}>Clear</button>}
      </span>
    );
  }
  return (
    <button type="button" className="ck-mymax" data-set={max != null || undefined} data-over={over || undefined} data-compact={compact || undefined}
      onClick={e => { e.stopPropagation(); setVal(max != null ? String(max) : ''); setEditing(true); }}
      title={max != null ? `Your max: ${fmtFace(max)}${over ? ' — the live bid has passed it' : ''}. Tap to change.` : 'Set the most you would pay (hammer, before premium) — Record grades it against the hammer'}
      aria-label={max != null ? `My max ${fmtFace(max)}${over ? ', the live bid has passed it' : ''}; change` : 'Set my max'}>
      {max != null ? <>My max <b>{fmtFace(max)}</b>{over && <span className="ck-mymax-over"> · bid passed it</span>}</> : 'Set my max'}
    </button>
  );
}
