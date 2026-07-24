'use client';

import { m } from 'framer-motion';
import { MARKETS, type Market } from '../../constants';
import { RECORD_BOARD, type RecordEntry } from './records';
import { fmtMoneyCompact, useInView, useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE RECORD BOARD — the signature artifact. A ranked, cross-
   category leaderboard of all-time hammer records. Curated +
   source-flagged (these live in the full/stats tier, not the
   eager corpus). Bars are normalized to the top record; rows
   stagger in on scroll. Desktop = table; mobile = card list.

   Market-scoped: it reads the active category from the top
   selector and filters to it ('all' shows every category). Each
   row links out to its sale.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

// record category → the market key the top selector uses
const CAT_MARKET: Record<RecordEntry['category'], Market> = {
  Art: 'art', Watches: 'watches', Design: 'design',
  Sports: 'sports', Science: 'science', Culture: 'culture',
};

// every record is clickable — a direct sale link when we have one, otherwise a
// title+house search that reliably resolves to the sale (these are curated
// historical records, not live corpus lots with permalinks).
function auctionHref(r: RecordEntry): string {
  return r.url ?? `https://www.google.com/search?q=${encodeURIComponent(`${r.title} ${r.house.replace(/·/g, ' ')} auction`)}`;
}

interface Props {
  variant?: 'desktop' | 'mobile';
  /** the active market from the top selector — the board filters to it */
  market?: Market;
}

export default function RecordBoard({ variant = 'desktop', market = 'all' }: Props) {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();

  const scoped = market !== 'all';
  const marketLabel = MARKETS.find((m) => m.key === market)?.label ?? '';
  const ranked = [...RECORD_BOARD]
    .filter((r) => !scoped || CAT_MARKET[r.category] === market)
    .sort((a, b) => b.usd - a.usd);
  const top = ranked.length ? ranked[0].usd : 1;

  return (
    <div className={styles.recordBoard} ref={ref}>
      <div className={styles.recordHead}>
        <div>
          <span className={styles.sectionKicker}>The Record Board</span>
          <h2 className={styles.recordTitle}>
            {scoped ? `All-time ${marketLabel.toLowerCase()} hammer records.` : 'All-time hammer records, every category.'}
          </h2>
        </div>
        <span className={styles.recordCaption}>
          {scoped ? 'Curated highs · source-flagged, all-in' : 'Curated cross-category highs · source-flagged, all-in'}
        </span>
      </div>

      {ranked.length === 0 ? (
        <p className={styles.recordEmpty}>
          No all-time record curated for {marketLabel.toLowerCase()} yet.
        </p>
      ) : (
        /* rows are ALWAYS visible (content must never hide behind a scroll
           observer). Only the bar fill animates in on scroll — decorative. */
        <ol className={variant === 'mobile' ? styles.recordListMobile : styles.recordList}>
          {ranked.map((r, i) => {
            const w = Math.max(6, (r.usd / top) * 100);
            return (
              <li key={r.title} className={styles.recordRow}>
                <span className={styles.recordRank}>{String(i + 1).padStart(2, '0')}</span>
                <span className={styles.recordCat} data-cat={r.category}>
                  {r.category}
                </span>
                <span className={styles.recordMain}>
                  <a
                    className={styles.recordObj}
                    href={auctionHref(r)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${r.title} — ${fmtMoneyCompact(r.usd)} at ${r.house}. Open the sale.`}
                  >
                    {r.title}
                  </a>
                  <span className={styles.recordMaker}>{r.maker}</span>
                </span>
                <span className={styles.recordBarCell}>
                  <span className={styles.recordBarTrack}>
                    <m.span
                      className={styles.recordBar}
                      initial={reduce ? false : { scaleX: 0 }}
                      animate={{ scaleX: (seen ? w : w) / 100 }}
                      transition={{ duration: reduce ? 0 : 0.9, ease: EASE, delay: reduce || !seen ? 0 : 0.12 + i * 0.04 }}
                    />
                  </span>
                </span>
                <span className={styles.recordPrice}>{fmtMoneyCompact(r.usd)}</span>
                <span className={styles.recordSource}>{r.source}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
