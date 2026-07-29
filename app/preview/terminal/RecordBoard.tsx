'use client';

import { MARKETS, type Market } from '../../constants';
import { RECORD_BOARD, type RecordEntry } from './records';
import { fmtMoneyCompact } from './hooks';
import styles from './style.module.css';

/* ============================================================
   ROOM B — "THE RECORD BOARD" · the ledger
   ------------------------------------------------------------
   A plain ranked 1–10 list of all-time hammer records, two
   columns (01–05 left, 06–10 right). No #1 showcase plate — the
   whole board is the tape: rank, title — maker, category chip,
   the price in Inter Semibold tabular NEUTRAL ink (a record is a
   level — never green, never mono), house · year. Rows are
   anchors out to the sale (the ↗ dialect). Closes on a dated
   colophon register.
   ============================================================ */

const CAT_MARKET: Record<RecordEntry['category'], Market> = {
  Art: 'art', Watches: 'watches', Design: 'design',
  Sports: 'sports', Science: 'science', Culture: 'culture',
};

function auctionHref(r: RecordEntry): string {
  return r.url ?? `https://www.google.com/search?q=${encodeURIComponent(`${r.title} ${r.house.replace(/·/g, ' ')} auction`)}`;
}

interface Props {
  variant?: 'desktop' | 'mobile';
  market?: Market;
  /** data-as-of date for the colophon register (from market.generatedAt) */
  asOf?: string | null;
}

export default function RecordBoard({ market = 'all', asOf = null }: Props) {
  const scoped = market !== 'all';
  const marketLabel = MARKETS.find((mk) => mk.key === market)?.label ?? '';
  const ranked = [...RECORD_BOARD]
    .filter((r) => !scoped || CAT_MARKET[r.category] === market)
    .sort((a, b) => b.usd - a.usd);

  return (
    <div className={styles.roomB}>
      {/* the altar */}
      <div className={styles.altar}>
        <div className={styles.eyebrow}>
          <img src="/brand/lectr-ink.png" alt="" className={styles.eyebrowMark} aria-hidden />
          <span>All-time records</span>
        </div>
        <h2 className={styles.altarHead}>The record <em>board</em></h2>
        <p className={styles.altarSub}>
          {ranked.length === 0
            ? `No all-time record curated for ${marketLabel.toLowerCase()} yet.`
            : scoped
              ? `All-time ${marketLabel.toLowerCase()} hammer records — all-in prices, every figure flagged to its source.`
              : 'All-time hammer records in every category we cover — all-in prices, every figure flagged to its source.'}
        </p>
      </div>

      {ranked.length > 0 && (
        <>
          {/* the ledger — records 01–10, two columns (first half left, rest right) */}
          <div className={styles.tape}>
            {[ranked.slice(0, Math.ceil(ranked.length / 2)), ranked.slice(Math.ceil(ranked.length / 2))].map((col, ci) => (
              <div key={ci} className={styles.tapeCol}>
                {col.map((r, j) => {
                  const idx = ci === 0 ? j : Math.ceil(ranked.length / 2) + j; // 0-based rank
                  return (
                    <a
                      key={r.title}
                      className={`${styles.tapeRow} ${styles.tapeRowB}`}
                      href={auctionHref(r)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`No. ${idx + 1}: ${r.title} — ${fmtMoneyCompact(r.usd)} at ${r.house}. Open the sale.`}
                    >
                      <span className={styles.tapeRank}>{String(idx + 1).padStart(2, '0')}</span>
                      <span className={styles.tapeLabelBlock}>
                        <span className={styles.tapeTitleB}>
                          {r.title}
                          <span className={styles.tapeMakerB}> — {r.maker}</span>
                        </span>
                      </span>
                      <span className={styles.catChip}>{r.category}</span>
                      <span className={styles.tapeRight}>
                        <span className={styles.tapePrice}>{fmtMoneyCompact(r.usd)}</span>
                        <span className={styles.tapeSub}>
                          {r.house}
                          {r.url && <span className={styles.srcDiamondSm} aria-hidden />}
                        </span>
                      </span>
                      <span className={styles.tapeOut} aria-hidden>↗</span>
                    </a>
                  );
                })}
              </div>
            ))}
          </div>

          {/* the colophon register */}
          <div className={styles.register}>
            Records as reported by the houses · USD at sale date · unsourced entries flagged, not hidden
            {asOf ? ` · data as of ${asOf}` : ''}.
          </div>
        </>
      )}
    </div>
  );
}
