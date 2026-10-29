'use client';
/**
 * PickFeedback — "More like this" / "Not for me" under a pick (Oct 11 2026).
 * The profile's "Lots you may like" and home's For you. A mark is written
 * to this device only (app/lib/recs-signals) and the list re-reads at once;
 * "Not for me" leaves an Undo in the pick's seat, a second press of
 * "More like this" takes it back. Existing pill + reset styles only.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { markLot, unmarkLot, clearSignals, type MarkKind, type SignalMark } from '../lib/recs-signals';
import { useSignals } from '../lib/use-recs';
import { craftTitle } from '../utils';
import type { AuctionLot } from '../types';
import { track } from '../lib/analytics';

export interface PickUndo { id: string; kind: MarkKind; prev: SignalMark | null; lot: AuctionLot; at: number }

/** the list-level state: the marks on this device + the one undo in hand */
export function usePickFeedback() {
  const store = useSignals();
  const marks = useMemo(() => new Map((store?.marks ?? []).map(m => [m.id, m.k])), [store]);
  const [undo, setUndo] = useState<PickUndo | null>(null);
  const mark = useCallback((kind: MarkKind, lot: AuctionLot, at: number) => {
    if (marks.get(lot.id) === kind) {
      // pressing the lit mark again takes it back
      unmarkLot(lot.id);
      setUndo(null);
      return;
    }
    const prev = markLot(kind, lot);
    track(kind === 'more' ? 'pick_more' : 'pick_less');
    setUndo({ id: lot.id, kind, prev, lot, at });
  }, [marks]);
  const undoIt = useCallback(() => {
    if (!undo) return;
    unmarkLot(undo.id, undo.prev);
    setUndo(null);
  }, [undo]);
  return { marks, mark, undo, undoIt };
}

/** splice the "Not for me" seat back into the list where the pick stood,
 *  so its Undo sits under the reader's finger */
export function withUndoSeat<T extends { lot: { id: string } }>(list: T[], undo: PickUndo | null): (T | { undoSeat: PickUndo })[] {
  if (!undo || undo.kind !== 'less' || list.some(r => r.lot.id === undo.id)) return list;
  const out: (T | { undoSeat: PickUndo })[] = list.slice();
  out.splice(Math.min(undo.at, out.length), 0, { undoSeat: undo });
  return out;
}

const pill: React.CSSProperties = { fontSize: 12.5, padding: '5px 12px' };

export function PickFeedback({ lot, mark, onMark, at, inset, tight, bare }: {
  lot: AuctionLot;
  mark: MarkKind | null | undefined;
  onMark: (kind: MarkKind, lot: AuctionLot, at: number) => void;
  at: number;
  /** a phone row: indent under the row's text, not its thumb */
  inset?: boolean;
  /** a table row: closer to the line above */
  tight?: boolean;
  /** (THE DESK v4) the two pills alone, no wrapper — a DeskRow's action slot lays them out */
  bare?: boolean;
}) {
  const t = craftTitle(lot.title, lot.auctionHouse);
  const pills = (
    <>
      <button type="button" className="ray-toolbar-pill" style={pill} data-active={mark === 'more'} aria-pressed={mark === 'more'}
        aria-label={`More like this: ${t}`} title="Lean your picks toward lots like this one (kept on this device)"
        onClick={e => { e.stopPropagation(); onMark('more', lot, at); }}>
        More like this
      </button>
      <button type="button" className="ray-toolbar-pill" style={pill}
        aria-label={`Not for me: ${t}`} title="Hide this pick and show its kind less (kept on this device)"
        onClick={e => { e.stopPropagation(); onMark('less', lot, at); }}>
        Not for me
      </button>
    </>
  );
  if (bare) return pills;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: inset ? 0 : tight ? 6 : 10, ...(inset ? { padding: '0 2px 10px calc(56px + var(--space-3) + 2px)' } : null) }}>
      {pills}
    </div>
  );
}

/** the seat a "Not for me" pick leaves: what happened + Undo */
export function UndoSeat({ undo, onUndo, row }: { undo: PickUndo; onUndo: () => void; row?: boolean }) {
  const t = craftTitle(undo.lot.title, undo.lot.auctionHouse);
  return (
    <div role="status" style={{
      fontSize: 13.5, color: 'var(--color-text-muted)', lineHeight: 1.5,
      ...(row ? { padding: '14px 2px', borderBottom: '1px solid var(--hairline-soft)' } : { padding: '18px 0' }),
    }}>
      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: row ? 'nowrap' : undefined }}>
        Hidden: {t}
      </span>
      <span>Lots like it show less here. </span>
      <button type="button" className="ray-toolbar-reset" onClick={onUndo}>Undo</button>
    </div>
  );
}

/**
 * What this device learned — the one-line privacy note and its erase
 * control, as one composable section (the profile places it under the
 * picks). Shows only when something was learned, or just after a clear.
 */
export function LearnedOnDevice({ learned, style }: { learned: boolean; style?: React.CSSProperties }) {
  const [cleared, setCleared] = useState(false);
  if (!learned && !cleared) return null;
  return (
    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '24px 0 0', maxWidth: 640, lineHeight: 1.55, ...style }}>
      {cleared && !learned
        ? <>Cleared. Picks now read only what you save, own, follow and search.</>
        : <>
            The lots and pages you open here, what you search, and your More like this / Not for me marks shape
            these picks. That record is kept in this browser and never uploaded — opening a page or running a search
            is still an ordinary request to lectr, like any page view.{' '}
            <button type="button" className="ray-toolbar-reset" onClick={() => { clearSignals(); setCleared(true); }}>
              Clear what lectr learned on this device
            </button>
          </>}
    </p>
  );
}
