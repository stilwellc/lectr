'use client';

import { LazyMotion, domAnimation, m } from 'framer-motion';
import { MARKETS, type Market } from '../../constants';
import { RECORD_BOARD, type RecordEntry } from './records';
import { fmtMoneyCompact, useInView, useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   ROOM B — "THE RECORD BOARD" · Plate & Tape
   ------------------------------------------------------------
   Two elements:

     · THE MONUMENT — record №01 as an engraved plate: rank,
       Fraunces title, maker, the price at ~200px in NEUTRAL ink
       (a record is a level — never green, never mono), stamped
       whole from the baseline, then the HAMMER-STRIKE RULE —
       a 2px ink rule that strikes in beneath it, the gavel's
       full stop. Provenance beneath with a source diamond ✦
       (or an ARCHIVAL chip — flagged, not hidden).
     · THE TAPE — records 02–10 as full-bleed broadsheet rows:
       rank, title — maker, category chip, the price in Inter
       Semibold tabular neutral ink, house · year. Rows are
       anchors out to the sale (the ↗ dialect; Room A's rows
       are buttons with chevrons — different glyph, different
       role).

   Behind the plate: a diagonal hatch field (Room A rains
   vertical ticks; Room B hatches at 45° — same drafting system,
   different mood). The room closes on a dated colophon register
   and THE PLATE MARK: the script wordmark as a letterpress
   plate half-sunk into the closing seam.
   ============================================================ */

const EASE = [0.22, 1, 0.36, 1] as const;

const CAT_MARKET: Record<RecordEntry['category'], Market> = {
  Art: 'art', Watches: 'watches', Design: 'design',
  Sports: 'sports', Science: 'science', Culture: 'culture',
};

function auctionHref(r: RecordEntry): string {
  return r.url ?? `https://www.google.com/search?q=${encodeURIComponent(`${r.title} ${r.house.replace(/·/g, ' ')} auction`)}`;
}

/** the price, split so $ and the magnitude letter demote to 0.5em */
function PlatePrice({ usd }: { usd: number }) {
  const text = fmtMoneyCompact(usd); // e.g. "$195.0M"
  const match = text.match(/^\$([\d,.]+)([A-Z]*)$/);
  if (!match) return <>{text}</>;
  return (
    <>
      <sup>$</sup>
      {match[1]}
      {match[2] && <sup>{match[2]}</sup>}
    </>
  );
}

interface Props {
  variant?: 'desktop' | 'mobile';
  market?: Market;
  /** data-as-of date for the colophon register (from market.generatedAt) */
  asOf?: string | null;
}

export default function RecordBoard({ market = 'all', asOf = null }: Props) {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();

  const scoped = market !== 'all';
  const marketLabel = MARKETS.find((mk) => mk.key === market)?.label ?? '';
  const ranked = [...RECORD_BOARD]
    .filter((r) => !scoped || CAT_MARKET[r.category] === market)
    .sort((a, b) => b.usd - a.usd);

  if (ranked.length === 0) {
    return (
      <div className={styles.roomB}>
        <div className={styles.altar}>
          <div className={styles.eyebrow}>
            <img src="/brand/lectr-ink.png" alt="" className={styles.eyebrowMark} aria-hidden />
            <span>All-time records</span>
          </div>
          <h2 className={styles.altarHead}>The record <em>board</em></h2>
          <p className={styles.altarSub}>No all-time record curated for {marketLabel.toLowerCase()} yet.</p>
        </div>
      </div>
    );
  }

  const top = ranked[0];
  const tape = ranked.slice(1);
  const play = seen && !reduce;
  const stamp = {
    initial: play ? { clipPath: 'inset(100% 0 0 0)', opacity: 0.6 } : false,
    animate: { clipPath: 'inset(0% 0 0 0)', opacity: 1 },
    transition: { duration: 0.8, ease: EASE, delay: 0.2 },
  } as const;

  return (
    <LazyMotion features={domAnimation} strict>
      <div className={styles.roomB} ref={ref}>
        {/* the altar */}
        <div className={styles.altar}>
          <div className={styles.eyebrow}>
            <img src="/brand/lectr-ink.png" alt="" className={styles.eyebrowMark} aria-hidden />
            <span>All-time records</span>
          </div>
          <h2 className={styles.altarHead}>The record <em>board</em></h2>
          <p className={styles.altarSub}>
            {scoped
              ? `All-time ${marketLabel.toLowerCase()} hammer records — all-in prices, every figure flagged to its source.`
              : 'All-time hammer records in every category we cover — all-in prices, every figure flagged to its source.'}
          </p>
        </div>

        {/* the monument — record №01 as a plate */}
        <div className={styles.plateZone}>
          <div className={styles.hatchField} aria-hidden />
          <div className={styles.plate}>
            <span className={styles.plateRank}>01</span>
            <a className={styles.plateTitle} href={auctionHref(top)} target="_blank" rel="noopener noreferrer">
              {top.title}
            </a>
            <span className={styles.plateMaker}>{top.maker}</span>
            <m.div className={styles.plateFigure} {...stamp}>
              <PlatePrice usd={top.usd} />
            </m.div>
            <m.div
              className={styles.strikeRule}
              initial={play ? { scaleX: 0 } : false}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.24, ease: 'easeOut', delay: play ? 1.05 : 0 }}
              aria-hidden
            />
            <span className={styles.plateProv}>
              {top.house}
              {top.url ? (
                <>
                  <span className={styles.srcDiamond} aria-hidden />
                  <a href={top.url} target="_blank" rel="noopener noreferrer" className={styles.srcLink}>source</a>
                </>
              ) : !top.source.trim().toLowerCase().startsWith(top.house.split(/[·,]/)[0].trim().toLowerCase()) ? (
                <span className={styles.provSource}>{top.source}</span>
              ) : null}
            </span>
          </div>
        </div>

        {/* the tape — records 02–10 */}
        <div className={styles.tape}>
          {tape.map((r, i) => (
            <a
              key={r.title}
              className={`${styles.tapeRow} ${styles.tapeRowB}`}
              href={auctionHref(r)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`No. ${i + 2}: ${r.title} — ${fmtMoneyCompact(r.usd)} at ${r.house}. Open the sale.`}
            >
              <span className={styles.tapeRank}>{String(i + 2).padStart(2, '0')}</span>
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
          ))}
        </div>

        {/* the colophon register */}
        <div className={styles.register}>
          Records as reported by the houses · USD at sale date · unsourced entries flagged, not hidden
          {asOf ? ` · data as of ${asOf}` : ''}.
        </div>

        {/* the finale — the plate mark, half-sunk into the closing seam */}
        <div className={styles.plateMark} aria-hidden>
          <img src="/brand/lectr-ink.png" alt="" />
        </div>
        <h2 className={styles.srOnly}>lectr</h2>
      </div>
    </LazyMotion>
  );
}
