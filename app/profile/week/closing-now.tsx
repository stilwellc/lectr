'use client';
/**
 * CLOSING NOW (THE DESK v3, Oct 11 2026) — the ≤24h closers among the
 * reader's watches as a live strip above the Watching ledger: the close on
 * the reader's clock with the countdown under it (minutes never seconds),
 * the bids, the decision line, and the way to act. The page mounts it on
 * its own; the membership (inside 24 hours or not) AND the countdown read
 * the page's clock (desk.now, ./week closingNowOf), never a clock of its own.
 *
 * (THE DESK v4) each closer is the desk's one row (../desk/row DeskRow): a
 * list item the j/k walk lands on (its title is the focus target; Enter
 * opens the lot), "Bid at <house>" in the action slot — on a phone a 36px
 * pill.
 *
 * With live watches but none inside 24h it says so in one line and names
 * the next close; with no live watch it prints nothing (the Watching room
 * is not on the page either).
 */
import React, { useMemo } from 'react';
import Link from 'next/link';
import type { SectionProps } from '../desk/types';
import DecisionLine from '../../components/DecisionLine';
import { DeskRow } from '../desk/row';
import Flick from '../../components/Flick';
import { formatEstimate } from '../../lib/estimate-text';
import { displayMakerOf } from '../../lib/maker-subjects';
import { safeHref } from '../../lib/safe-href';
import { craftTitle } from '../../utils';
import { closingNowOf, countdownText, localClock, dayWords, offsetWord, dayOffsetOf, bidsText, velocityText, cityOf } from './week';
import { houseTzOf } from '../../lib/house-tz';
import './week.css';

export function ClosingNow({ desk }: SectionProps) {
  const read = useMemo(() => closingNowOf(desk.saved, desk.now), [desk.saved, desk.now]);
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
      <ul className="dk-list" aria-label="Closing in the next 24 hours">
        {read.rows.map(r => {
          const { lot } = r;
          const href = safeHref(lot.url);
          const est = formatEstimate(lot);
          const bids = /\bbids?\b/.test(est) ? null : bidsText(lot);
          const vel = velocityText(lot);
          const timed = r.timed && !!lot.saleDateTime;
          const tbc = `The house published the sale day, not a close time — the day ends in ${cityOf(houseTzOf(lot))}`;
          return (
            <DeskRow key={lot.id} lot={lot} as="li" attrs={{ 'aria-label': `Closing: ${craftTitle(lot.title, lot.auctionHouse)}` }}
              sub={<>{displayMakerOf(lot)?.name ? <>{displayMakerOf(lot)!.name} · </> : null}{lot.auctionHouse}{est ? <> · {est}</> : null}{bids ? <> · <b>{bids}</b></> : null}{vel ? <> · <span className="ck-week-vel"><i aria-hidden>↑</i>{vel.replace(/^\+/, '')}</span></> : null}</>}
              figure={timed
                ? <span className="dk-clock" data-soon>{localClock(r.closeMs)}</span>
                : <span className="dk-clock" data-quiet title={tbc}>time TBC</span>}
              figureSub={timed ? countdownText(r.closeMs, desk.now) : <span title={tbc}>day ends {countdownText(r.closeMs, desk.now)} · {cityOf(houseTzOf(lot))}</span>}
              decision={<DecisionLine lot={lot} estimate={false} when={false} abstain="quiet" nowMs={desk.now} />}
              action={href ? <a className="ck-week-act" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Bid at ${lot.auctionHouse} (opens the house’s page)`}>Bid at {lot.auctionHouse} <Flick size={10} /></a> : undefined} />
          );
        })}
      </ul>
    </div>
  );
}

export default ClosingNow;
