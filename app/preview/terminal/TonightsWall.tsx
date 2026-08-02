'use client';

import { useMemo, useState } from 'react';
import type { AuctionLot } from '../../types';
import { ARTIST_LABEL } from '../../constants';
import { formatPrice, httpsImg, craftTitle } from '../../utils';
import { useInView } from './hooks';
import styles from './style.module.css';

/* ============================================================
   TONIGHT'S WALL (M6) — the gallery's front row. Five
   photographed upcoming lots (Today's-Call lot first, then the
   next best by signal-with-image), each hung on a warm mat plate
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
function gapGrammar(label: string, pct: number): string {
  if (label === 'Below Market') {
    if (pct > 400) return 'comps sell at 5×+ this ask';
    return `comps sell at ${(pct / 100 + 1).toFixed(1)}× this ask`;
  }
  return `comps sell at ${Math.max(0.1, 1 - Math.min(pct, 99) / 100).toFixed(1)}× this ask`;
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
}: {
  /** ranked candidates (call lot first) — MORE than 5, so failures backfill */
  items: WallItem[];
  onOpen: (lot: AuctionLot) => void;
  variant: 'desktop' | 'mobile';
  play: boolean;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const shown = useMemo(
    () => items.filter((it) => it.lot.imageUrl && !failed.has(it.lot.id)).slice(0, 5),
    [items, failed]
  );
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
      data-seen={!mobile || seen ? 'true' : undefined}
    >
      <div className={styles.wallHead}>
        <div>
          <h2 className={styles.roomTitle}>Tonight&rsquo;s <em>wall</em></h2>
          <p className={styles.roomSub}>Today&rsquo;s call and the strongest flagged lots on the block — priced under where their comparables sell.</p>
        </div>
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
            <span className={styles.wallMat}>
              <img
                src={httpsImg(it.lot.imageUrl!)}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => drop(it.lot.id)}
                onLoad={(e) => {
                  // some hosts return a 1px placeholder instead of erroring
                  if (e.currentTarget.naturalWidth < 4) drop(it.lot.id);
                }}
              />
            </span>
            <span className={styles.wallMeta}>
              <span className={styles.wallMaker}>{ARTIST_LABEL[it.lot.artist] || it.lot.artist}</span>
              <span className={styles.wallEst}>
                {estLine(it.lot)}
                {it.call && <em className={styles.wallCallTag}>today&rsquo;s call</em>}
              </span>
              {it.flagged && it.pct != null && (
                <span className={styles.wallSignal}>{gapGrammar('Below Market', it.pct)}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
