'use client';
/**
 * CLOSING NOW (THE DESK v3, Oct 11 2026) — the ≤24h closers among the
 * reader's watches as a live ticker row above the Watching ledger: a
 * countdown that ticks (CloseClock, minutes never seconds), the bids, the
 * decision line, and the way to act. The page mounts it on its own; the
 * membership (inside 24 hours or not) is read on the page's clock
 * (desk.now, ./week closingNowOf), never a clock of its own.
 *
 * A card is a list item the j/k walk can land on (tabIndex −1 — never a
 * second Tab stop); Enter / Space on a walked card opens the lot. Its Tab
 * stops are the title (a link) and "Bid at <house>" — on a phone both are
 * 40px targets.
 *
 * With live watches but none inside 24h it says so in one line and names
 * the next close; with no live watch it prints nothing (the Watching room
 * is not on the page either).
 */
import React, { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AuctionLot } from '../../types';
import type { SectionProps } from '../desk/types';
import CloseClock from '../../components/CloseClock';
import DecisionLine from '../../components/DecisionLine';
import Flick from '../../components/Flick';
import { formatEstimate } from '../../lib/estimate-text';
import { safeHref } from '../../lib/safe-href';
import { craftTitle } from '../../utils';
import { closingNowOf, countdownText, localClock, dayWords, offsetWord, dayOffsetOf, bidsText, velocityText, cityOf } from './week';
import { houseTzOf } from '../../lib/house-tz';
import './week.css';

export function ClosingNow({ desk }: SectionProps) {
  const router = useRouter();
  const read = useMemo(() => closingNowOf(desk.saved, desk.now), [desk.saved, desk.now]);
  const onOpen = useCallback((lot: AuctionLot) => router.push(`/lot?id=${encodeURIComponent(lot.id)}`), [router]);
  if (read.live === 0) return null;
  if (read.rows.length === 0) {
    const n = read.next;
    return (
      <p className="ck-week-cn-quiet" role="status">
        None of your watches close in the next 24 hours
        {n ? <> · next: <Link href={`/lot?id=${encodeURIComponent(n.lot.id)}`} className="ck-away-link">{craftTitle(n.lot.title, n.lot.auctionHouse)}</Link>, {offsetWord(dayOffsetOf(n.day, desk.now)) ?? `${dayWords(n.day).wd}, ${dayWords(n.day).md}`}{n.timed ? ` at ${localClock(n.closeMs)}` : ''}</> : null}.
      </p>
    );
  }
  return (
    <div className="ck-week-cn">
      <div className="ck-reads-head">
        <span className="kicker">Closing now · {read.rows.length} of your {read.rows.length === 1 ? 'watch closes' : 'watches close'} in the next 24h</span>
        <i className="ck-reads-rule" />
      </div>
      <ul className="ck-week-cn-track" aria-label="Closing in the next 24 hours">
        {read.rows.map(r => {
          const { lot } = r;
          const href = safeHref(lot.url);
          const est = formatEstimate(lot);
          const bids = /\bbids?\b/.test(est) ? null : bidsText(lot);
          const vel = velocityText(lot);
          const title = craftTitle(lot.title, lot.auctionHouse);
          const onKey = (e: React.KeyboardEvent<HTMLLIElement>) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(lot); }
          };
          return (
            <li key={lot.id} className="ck-week-cn-card" data-nav-row tabIndex={-1} onKeyDown={onKey} aria-label={`Closing: ${title}`}>
              <div className="ck-week-cn-clock">
                {r.timed && lot.saleDateTime
                  ? <CloseClock iso={lot.saleDateTime} windowHours={24} />
                  : <span title={`The house published the sale day, not a close time — the day ends in ${cityOf(houseTzOf(lot))}`}>day ends {countdownText(r.closeMs, desk.now)} · time TBC</span>}
              </div>
              <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} className="ck-week-cn-title">{title}</Link>
              <div className="ck-week-fact">
                {lot.auctionHouse}{est ? <> · {est}</> : null}{bids ? <> · <b>{bids}</b></> : null}{vel ? <> · <span className="ck-week-vel"><i aria-hidden>↑</i>{vel.replace(/^\+/, '')}</span></> : null}
              </div>
              <DecisionLine lot={lot} estimate={false} when={false} abstain="quiet" nowMs={desk.now} className="ck-week-decision" />
              {href && (
                <div className="ck-week-acts">
                  <a className="ck-week-act" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Bid at ${lot.auctionHouse} (opens the house’s page)`}>Bid at {lot.auctionHouse} <Flick size={10} /></a>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ClosingNow;
