'use client';

import Link from 'next/link';
import type { AuctionLot } from '../types';
import { ARTIST_LABEL } from '../constants';
import { craftTitle, formatDate, formatPrice, trueSaleDay } from '../utils';
import { confidenceMeter } from './LotCard';
import { daysUntil, daysWord } from './Terminal';
import LotPlate from './LotPlate';
import styles from './CallHero.module.css';

/**
 * THE CALL HERO — home's (and every vertical's) above-the-fold, in the social
 * desk's call-card layout (scripts/social/render.tsx): the lot on a matted
 * plate left; right, the second opinion as one sentence —
 *
 *     "<House> says $A–B. The record says $X."
 *
 * X is the engine's expected hammer (value.compValueUsd — the blended
 * prediction; the comps median when an older build carries no value block),
 * printed as the ONE large numeral in Inter 300. Beneath it a dotted ledger
 * and a receipt stub with the replayed track record. The call itself comes
 * from pickCall (the caller passes it) — this component never selects.
 *
 * Colour: none. A forecast is not a market move (lamp law).
 */

export interface HeroCall {
  lot: AuctionLot;
  signal: { label: string; pct: number; basis?: number; confidence?: string; med?: number } | null;
}

export interface HeroRecord {
  /** replayed calls */
  n: number;
  /** median result vs estimate where the record read above the house */
  flaggedPct: number;
  /** the rest */
  restPct: number;
  /** 'hammer' | 'all-in' — the basis the two medians are on */
  basis: 'hammer' | 'all-in';
}

/** the expected hammer the hero prints — exported so OG/share code and the
 *  hero can never disagree */
export function expectedHammer(lot: AuctionLot, signal: HeroCall['signal']): number | null {
  const v = lot.value?.compValueUsd;
  if (typeof v === 'number' && v > 0) return v;
  if (signal?.med && signal.med > 0) return signal.med;
  const estMid = lot.estimateLow && lot.estimateHigh
    ? (lot.estimateLow + lot.estimateHigh) / 2
    : (lot.estimateLow || lot.estimateHigh || null);
  if (estMid != null && signal && signal.label === 'Below Market') return Math.round(estMid * (1 + signal.pct / 100));
  return null;
}

/** "$8K–$12K" — the house's printed range, or null when it printed none */
export function houseRange(lot: AuctionLot): string | null {
  const lo = lot.estimateLow, hi = lot.estimateHigh;
  if (lo && hi) {
    const a = formatPrice(lo), b = formatPrice(hi);
    return a === b ? a : `${a}–${b}`;
  }
  if (lo) return `from ${formatPrice(lo)}`;
  if (hi) return `up to ${formatPrice(hi)}`;
  return null;
}

const fmtSigned = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))}%`;

export default function CallHero({
  call,
  headline,
  dek,
  record,
  marketWord,
  onOpen,
  quiet,
}: {
  call: HeroCall | null;
  /** the page statement — a specific claim with a live number */
  headline: string;
  dek: string;
  record: HeroRecord | null;
  /** 'the book' | 'the watch book' — used in the no-call line */
  marketWord: string;
  /** opens the comps modal in place (falls back to the lot page link) */
  onOpen?: (lot: AuctionLot) => void;
  /** no-call state facts (lots on the block, next close) */
  quiet?: { onBlock: number; next?: { house: string; word: string } | null };
}) {
  const stub = record && record.n > 0 ? (
    <p className={styles.stub}>
      <span className={styles.stubK}>The record</span>
      <span className={styles.stubV}>
        {record.n.toLocaleString()} calls replayed against the hammer. Where the record read above
        the house, lots {record.basis === 'hammer' ? 'hammered' : 'sold'} a median{' '}
        <b>{fmtSigned(record.flaggedPct)}</b> against estimate; the rest {fmtSigned(record.restPct)}
        {record.basis === 'all-in' ? ' (all-in)' : ''}.
      </span>
      <Link href="/receipts" className={styles.stubLink}>See the receipts</Link>
    </p>
  ) : null;

  const head = (
    <header className={styles.head}>
      <h1 className={styles.h1}>{headline}</h1>
      <p className={styles.dek}>{dek}</p>
    </header>
  );

  if (!call) {
    return (
      <section className={styles.hero} aria-label="Tonight">
        {head}
        <div className={styles.quiet}>
          <p className={styles.quietLine}>
            No call clears the bar on {marketWord} tonight — we only print a second opinion when
            the record is deep enough to stand behind it.
          </p>
          {quiet && (
            <div className={styles.ledger}>
              <div className={styles.row}><span>On the block</span><i aria-hidden /><b>{quiet.onBlock.toLocaleString()} lots</b></div>
              {quiet.next && <div className={styles.row}><span>Next hammer</span><i aria-hidden /><b>{quiet.next.word} · {quiet.next.house}</b></div>}
            </div>
          )}
          <div className={styles.ctas}>
            <a href="#on-the-block" className="ray-call-btn ray-call-btn-primary">See what&rsquo;s on the block</a>
          </div>
          {stub}
        </div>
      </section>
    );
  }

  const { lot, signal } = call;
  const maker = ARTIST_LABEL[lot.artist] || lot.artist;
  const title = craftTitle(lot.title);
  const x = expectedHammer(lot, signal);
  const range = houseRange(lot);
  const day = trueSaleDay(lot) || lot.saleDate;
  const d = daysUntil(day);
  const tonight = !!lot.saleDateTime && new Date(lot.saleDateTime).getHours() >= 17;
  const when = d != null && d <= 0 ? (tonight ? 'closes tonight' : 'closes today') : `hammers ${daysWord(day)}`;
  const meter = confidenceMeter(signal?.confidence);
  const houseLine = range
    ? `${lot.auctionHouse} says ${range}.`
    : lot.currentBid
      ? `${lot.auctionHouse}'s room is at ${formatPrice(lot.currentBid)}.`
      : `${lot.auctionHouse} printed no estimate.`;
  const lotHref = `/lot?id=${encodeURIComponent(lot.id)}`;

  return (
    <section className={styles.hero} aria-label="Tonight's call">
      {head}
      <div className={styles.card}>
        <Link href={lotHref} className={styles.plateLink} aria-label={`${maker}, ${title} — open the lot`}>
          <LotPlate
            src={lot.imageUrl}
            monogram={maker}
            fig={1}
            caption={`${lot.lotNumber ? `Lot ${lot.lotNumber} · ` : ''}${lot.auctionHouse} · ${when}`}
            eager
          />
        </Link>
        <div className={styles.read}>
          <p className={styles.kicker}>Tonight&rsquo;s call · {when}</p>
          <p className={styles.object}>
            <span className={styles.maker}>{maker}</span>
            <span className={styles.title}>{title}</span>
          </p>
          {/* one sentence for AT; the numeral is its visual climax */}
          <p className={styles.claim} aria-label={`${houseLine} The record says ${x != null ? formatPrice(x) : 'more'}.`}>
            <span className={styles.house} aria-hidden>{houseLine}</span>
            <span className={styles.recordSays} aria-hidden>The record says</span>
            <span className={styles.numeral} aria-hidden>{x != null ? formatPrice(x) : '—'}</span>
          </p>
          <div className={styles.ledger}>
            {range && <div className={styles.row}><span>House estimate</span><i aria-hidden /><b>{range}</b></div>}
            {x != null && <div className={styles.row}><span>Expected hammer</span><i aria-hidden /><b>{formatPrice(x)}</b></div>}
            {signal?.basis ? <div className={styles.row}><span>Comparable sales</span><i aria-hidden /><b>{signal.basis.toLocaleString()}</b></div> : null}
            <div className={styles.row}><span>Confidence</span><i aria-hidden /><b><span className={styles.dots} aria-hidden>{meter.dots}</span> {meter.word}</b></div>
            <div className={styles.row}><span>Hammers</span><i aria-hidden /><b>{formatDate(day)} · {lot.auctionHouse}</b></div>
          </div>
          <div className={styles.ctas}>
            {onOpen ? (
              <button type="button" className="ray-call-btn ray-call-btn-primary" onClick={() => onOpen(lot)}>See the comparables</button>
            ) : (
              <Link href={lotHref} className="ray-call-btn ray-call-btn-primary">Open the lot</Link>
            )}
            <Link href="/value" className="ray-call-btn ray-call-btn-quiet">All of tonight&rsquo;s calls</Link>
          </div>
          {stub}
        </div>
      </div>
    </section>
  );
}
