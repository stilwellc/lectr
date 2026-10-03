'use client';

import { useMemo, useState, useEffect } from 'react';
import type { AuctionLot } from '../../types';
import { ARTIST_LABEL } from '../../constants';
import { formatPrice, craftTitle } from '../../utils';
import { closeMs, closeWord } from '../../lib/closing';
import { lotVerdict, fmtUsd } from '../../lib/verdict';
import { useInView } from './hooks';
import styles from './style.module.css';
import LotPlate from '../../components/LotPlate';

/* ============================================================
   TONIGHT'S WALL (M6) — the gallery's front row. Five
   photographed upcoming lots (Today's-Call lot first, then the
   next best by signal-with-image), each hung on the shared LotPlate
   (#1C1A14, object-fit: contain — never crop artwork). Flagged
   lots wear the verdict ring the feed already speaks. Clicking a
   plate opens the same comps modal as the feed (setTableLot).

   HONESTY RULE: only lots whose image actually LOADS hang here —
   onError drops the plate and the next candidate backfills. A
   monogram wall is never shown; under 3 live plates the row
   stands down entirely.

   Desktop: full-width row under the movers band, plates rising
   12px in an 80ms stagger from T+1200 on the open. Mobile: a
   horizontal snap-scroll strip (132px plates) under the hero
   card, plates rising as the strip enters view, rings lighting
   left→right.
   ============================================================ */

export interface WallItem {
  lot: AuctionLot;
  /** below-market flag — wears the verdict ring */
  flagged: boolean;
  /** the flag's real gap %, for the R18 signal grammar */
  pct?: number;
  /** marks the Today's-Call lot (leads the wall) */
  call?: boolean;
}

// R18 — the ONE signal grammar for home's gap text: comps sell at {X}× this
// ask. Below Market caps at the honest 5×+ floor (extreme ratios are where
// data faults live); Above Market reads as a sub-1× multiple, never a bare −%.
// gapMultiple is exported so the platform cells' Today's-Call ColorCell
// prints the exact figure the wall speaks — one formatter, one cap.
export function gapMultiple(pct: number): string {
  return pct > 400 ? '5×+' : `${(pct / 100 + 1).toFixed(1)}×`;
}
/** A flagged plate's one line (Oct 3 2026 framing): the engine's expected
    hammer against the estimate when it made a value call, else the comps
    multiple in the one × grammar — never "priced under" language. */
function flagLine(lot: AuctionLot, pct: number): string {
  const v = lotVerdict(lot);
  if (v && v.vsEstPct != null && v.vsEstPct > 0) return `expected ${fmtUsd(v.expected)} · +${v.vsEstPct}% over est.`;
  return `comps ${gapMultiple(pct)} the estimate`;
}

function estLine(lot: AuctionLot): string {
  if (lot.estimateLow || lot.estimateHigh) {
    const lo = lot.estimateLow || lot.estimateHigh!;
    const hi = lot.estimateHigh || lot.estimateLow!;
    return formatPrice(lo) === formatPrice(hi) ? `est ${formatPrice(lo)}` : `est ${formatPrice(lo)}–${formatPrice(hi)}`;
  }
  if (lot.currentBid) return `bid ${formatPrice(lot.currentBid)}`;
  return '';
}

export default function TonightsWall({
  items,
  onOpen,
  variant,
  play,
  now,
}: {
  /** ranked candidates (call lot first) — MORE than 5, so failures backfill */
  items: WallItem[];
  onOpen: (lot: AuctionLot) => void;
  variant: 'desktop' | 'mobile';
  play: boolean;
  /** the reader's clock (closing.useNow) — close labels are computed from it */
  now: number | null;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // #6 · AUCTION-NIGHT MODE — after 6pm LOCAL the wall re-ranks by soonest to
  // close (the room tonight). Clock is read post-mount so the static prerender
  // and hydration agree (a Date() in render would mismatch).
  const [evening, setEvening] = useState(false);
  useEffect(() => { setEvening(new Date().getHours() >= 18); }, []);
  const shown = useMemo(() => {
    const live = items.filter((it) => it.lot.imageUrl && !failed.has(it.lot.id));
    if (evening) {
      // soonest-closing first, but keep today's call in the lead
      return [...live].sort((a, b) => {
        if (a.call !== b.call) return a.call ? -1 : 1;
        return (closeMs(a.lot) ?? Infinity) - (closeMs(b.lot) ?? Infinity);
      }).slice(0, 5);
    }
    return live.slice(0, 5);
  }, [items, failed, evening]);
  // every plate says when it closes, on the READER's clock at render time
  // (closing.closeWord: 'closes in 5h' · 'today' · 'tomorrow') — null before
  // mount, so the SSR path stays inert.
  const closeLabel = (it: WallItem) => (now == null ? null : closeWord(it.lot, now));
  const [stripRef, seen] = useInView<HTMLDivElement>();

  // plates rise shortly after arrival (no entrance-clock coupling)
  const base = 0;

  if (shown.length < 3) return null;

  const drop = (id: string) =>
    setFailed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const mobile = variant === 'mobile';
  return (
    <div
      ref={stripRef}
      className={mobile ? styles.wallStrip : styles.wall}
      data-anim={play ? 'true' : undefined}
      data-seen={seen ? 'true' : undefined}
    >
      <div className={`ns-split ${styles.wallHead}`}>
        <div>
          <span className="ns-kicker">The front row</span>
          <h2 className={styles.roomTitle}>Tonight&rsquo;s wall</h2>
        </div>
        <p>{evening
            ? 'The room tonight — closing soonest first. Flagged lots are the ones lectr expects to hammer over the house estimate.'
            : 'Closing in the next 48 hours — flagged lots first: lectr expects them to hammer over the house estimate.'}</p>
      </div>
      <div className={styles.wallRow}>
        {shown.map((it, i) => (
          <button
            key={it.lot.id}
            type="button"
            className={styles.wallPlate}
            data-tone={it.flagged ? 'up' : undefined}
            style={{ ['--wall-i' as string]: i, ['--wall-base' as string]: `${base}ms` }}
            onClick={() => onOpen(it.lot)}
            aria-label={`Comps for ${craftTitle(it.lot.title)}`}
          >
            {/* the shared plate (NORTHSTAR §0.4), in its span form — valid
                inside the button; a dead photograph drops the lot and the
                next candidate backfills (a monogram wall is never shown) */}
            <LotPlate
              inline
              src={it.lot.imageUrl}
              monogram={ARTIST_LABEL[it.lot.artist] || it.lot.artist}
              fig={i + 1}
              caption={it.lot.auctionHouse}
              size={480}
              onFail={() => drop(it.lot.id)}
            />
            <span className={styles.wallMeta}>
              <span className={styles.wallMaker}>{ARTIST_LABEL[it.lot.artist] || it.lot.artist}</span>
              <span className={styles.wallEst}>
                {estLine(it.lot)}
                {it.call && <em className={styles.wallCallTag}>today&rsquo;s call</em>}
              </span>
              {it.flagged && it.pct != null && (
                <span className={styles.wallSignal}>{flagLine(it.lot, it.pct)}</span>
              )}
              {closeLabel(it) && (
                <span className={styles.wallCloses}>{closeLabel(it)}{it.lot.bidVelocity && it.lot.bidVelocity.delta > 0 ? ` · +${it.lot.bidVelocity.delta} ${it.lot.bidVelocity.delta === 1 ? 'bid' : 'bids'}` : ''}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
