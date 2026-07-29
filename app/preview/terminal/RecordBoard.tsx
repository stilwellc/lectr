'use client';

import { MARKETS, type Market } from '../../constants';
import { RECORD_BOARD, type RecordEntry } from './records';
import { fmtMoneyCompact } from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE RECORD BOARD — the museum wall. All-time hammer records
   as a ranked wall of plaques rather than a table:

     · №1     the hero plaque — full-width, the record record
     · №2–4   three medium plaques in a row
     · №5–10  six compact plaques, dense

   Each plaque is a designed object: double-rule mat frame,
   ghost rank numeral, tinted category chip, Fraunces title,
   the price as the centerpiece, house · source at the foot.
   Curated + source-flagged (full/stats tier). Market-scoped by
   the top selector; every plaque links out to its sale.
   ============================================================ */

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

/** One plaque. size: 'hero' | 'mid' | 'mini' */
function Plaque({ r, rank, size }: { r: RecordEntry; rank: number; size: 'hero' | 'mid' | 'mini' }) {
  const no = String(rank).padStart(2, '0');
  // the foot dedupes itself: when the source flag opens with the same house
  // ("Christie's · 2022" vs "Christie's, May 2022"), only the fuller source prints.
  const houseWord = r.house.split(/[·,]/)[0].trim().toLowerCase();
  const dupe = r.source.trim().toLowerCase().startsWith(houseWord);
  return (
    <a
      className={styles.plaque}
      data-size={size}
      href={auctionHref(r)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`No. ${rank}: ${r.title} — ${fmtMoneyCompact(r.usd)} at ${r.house}. Open the sale.`}
    >
      <span className={styles.plaqueTopRow}>
        <span className={styles.plaqueNo}>{no}</span>
        <span className={styles.plaqueCat} data-cat={r.category}>{r.category}</span>
      </span>
      <span className={styles.plaqueTitle}>{r.title}</span>
      {size !== 'mini' && <span className={styles.plaqueMaker}>{r.maker}</span>}
      <span className={styles.plaquePrice}>{fmtMoneyCompact(r.usd)}</span>
      <span className={styles.plaqueFoot}>
        {dupe ? (
          <span className={styles.plaqueHouse}>{r.source}</span>
        ) : (
          <>
            <span className={styles.plaqueHouse}>{r.house}</span>
            <span className={styles.plaqueSource}>{r.source}</span>
          </>
        )}
      </span>
    </a>
  );
}

interface Props {
  variant?: 'desktop' | 'mobile';
  /** the active market from the top selector — the board filters to it */
  market?: Market;
}

export default function RecordBoard({ market = 'all' }: Props) {
  const scoped = market !== 'all';
  const marketLabel = MARKETS.find((m) => m.key === market)?.label ?? '';
  const ranked = [...RECORD_BOARD]
    .filter((r) => !scoped || CAT_MARKET[r.category] === market)
    .sort((a, b) => b.usd - a.usd);

  // the wall's tiers — only the full board earns the 1 · 3 · 6 pyramid; a
  // scoped (smaller) board hangs everything at mid size. CSS reflows the
  // tiers per viewport (mids 3-up → 1-col, minis 3-up → 2-up).
  const pyramid = ranked.length >= 7;
  const hero = pyramid ? ranked[0] : null;
  const mids = pyramid ? ranked.slice(1, 4) : ranked;
  const minis = pyramid ? ranked.slice(4) : [];

  return (
    <div className={styles.recordBoard}>
      <div className={styles.cardRoomHead}>
        <h2 className={styles.roomTitle}>The record <em>board</em></h2>
        <p className={styles.roomSub}>
          {scoped
            ? `All-time ${marketLabel.toLowerCase()} hammer records — curated highs, source-flagged, all-in.`
            : 'All-time hammer records in every category — curated highs, source-flagged, all-in.'}
        </p>
      </div>

      {ranked.length === 0 ? (
        <p className={styles.recordEmpty}>
          No all-time record curated for {marketLabel.toLowerCase()} yet.
        </p>
      ) : (
        <div className={styles.plaqueWall}>
          {hero && <Plaque r={hero} rank={1} size="hero" />}
          <div className={styles.plaqueMidRow} data-scoped={!pyramid || undefined}>
            {mids.map((r, i) => (
              <Plaque key={r.title} r={r} rank={(pyramid ? 2 : 1) + i} size="mid" />
            ))}
          </div>
          {minis.length > 0 && (
            <div className={styles.plaqueMiniRow}>
              {minis.map((r, i) => (
                <Plaque key={r.title} r={r} rank={5 + i} size="mini" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
