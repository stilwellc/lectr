'use client';
/**
 * THE COCKPIT MASTHEAD (THE DESK v3 §0, Oct 11 2026) — under the Masthead's
 * statement, three registration cells and the 14-day hammer strip:
 *
 *   Watching      $ at estimate midpoint to the hammer · lots · below market
 *   Next hammer   the soonest closing watch: live CloseClock inside 24h,
 *                 else the day word; the lot; its decision line
 *   Your edge     the record's median vs estimate (signed, the lamp), calls
 *                 graded, the current streak
 *
 * Every number is the provider's (summary / record — the same figures the
 * sub-line, Watching and Your record print; nothing is re-derived here).
 * A cold desk keeps the three cells with honest dashes and says what fills
 * each one — the page reads as a product before it has data, not a ghost.
 *
 * The strip: one tiny bar per day for the next 14, the reader's lots closing
 * that day (closeDayOf — the reader's day); today marked; tap → #week once
 * Your week registers, #watching until then. Phone: cells stack, strip stays.
 */
import React, { useMemo } from 'react';
import Link from 'next/link';
import CloseClock from '../../components/CloseClock';
import DecisionLine from '../../components/DecisionLine';
import { formatEstimate } from '../../components/LotCard';
import { displayMakerOf } from '../../lib/maker-subjects';
import { closeDayOf, craftTitle, formatPrice, fmtSignedPct, localToday } from '../../utils';
import { closeDays, hammerWord } from './derive';
import { useDesk, useDeskInternals } from './provider';
import { jump } from '../rail';
import { dayLabel, estMidOf, hammerStrip, streakOf, stripCaption } from './cockpit-logic';

const lamp = (v: number) => (v > 0 ? 'var(--color-up)' : v < 0 ? 'var(--color-down-text)' : 'var(--color-fg)');

function Cell({ k, v, note, body, href, tone, children }: {
  k: string; v: React.ReactNode; note?: React.ReactNode; body: React.ReactNode; href?: string;
  /** the value's ink — a signed read only (lamp law) */
  tone?: string; children?: React.ReactNode;
}) {
  const inner = (
    <>
      <span className="ck-ccell-k">{k}</span>
      <span className="ck-ccell-v" style={tone ? { color: tone } : undefined}>{v}{note != null && <small>{note}</small>}</span>
      <span className="ck-ccell-b">{body}</span>
      {children}
    </>
  );
  return href
    ? (href.startsWith('#')
        ? <a className="ck-ccell" href={href} onClick={e => { e.preventDefault(); jump(href.slice(1)); }}>{inner}</a>
        : <Link className="ck-ccell" href={href}>{inner}</Link>)
    : <div className="ck-ccell">{inner}</div>;
}

export default function Cockpit() {
  const { desk } = useDesk();
  const { upcoming, summary, record, deskView } = useDeskInternals();
  const cold = !deskView;
  const todayKey = localToday();
  const strip = useMemo(
    () => hammerStrip(upcoming.map(l => ({ day: closeDayOf(l), est: estMidOf(l) })), todayKey),
    [upcoming, todayKey],
  );
  const max = Math.max(1, ...strip.map(d => d.n));
  const total = strip.reduce((s, d) => s + d.n, 0);
  const streak = record ? streakOf(record.series) : null;
  const next = summary.next;
  const nextDays = next ? closeDays(next) : NaN;
  const nextWho = next ? displayMakerOf(next)?.name ?? null : null;
  // the strip lands on Your week once it registers; on the room until then
  const stripTarget = () => {
    const id = document.getElementById('week') ? 'week' : document.getElementById('watching') ? 'watching' : null;
    if (id) jump(id);
  };
  // `desk.now` is the one clock: the strip's day cut re-reads with it
  void desk.now;

  return (
    <div className="ck-cockpit" data-cold={cold || undefined} aria-label="Your desk at a glance">
      <div className="ck-ccells">
        {/* 1 · WATCHING — the sub-line's figures, as a cell */}
        <Cell k="Watching"
          v={summary.totalEst > 0 ? formatPrice(summary.totalEst) : upcoming.length > 0 ? upcoming.length.toLocaleString() : '—'}
          note={summary.totalEst > 0 ? 'to the hammer' : upcoming.length > 0 ? (upcoming.length === 1 ? 'lot, no estimate' : 'lots, no estimates') : null}
          body={cold
            ? 'Bookmark a lot anywhere on lectr: its estimate counts here to the hammer, with the engine’s read beside it.'
            : upcoming.length === 0
              ? 'Nothing live on the block — your settled watches are judged under Your record.'
              : <>{upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}{summary.totalEst > 0 && <> · {summary.priced} of {upcoming.length} priced, at estimate midpoint</>}{summary.flagged > 0 && <> · <b>{summary.flagged} below market</b></>}</>}
          href={upcoming.length > 0 ? '#watching' : undefined} />

        {/* 2 · NEXT HAMMER — the soonest closing watch, counting down */}
        <Cell k="Next hammer"
          v={next
            ? (nextDays === 0 && next.saleDateTime
                ? <CloseClock iso={next.saleDateTime} windowHours={24} />
                : hammerWord(nextDays))
            : '—'}
          note={next && !(nextDays === 0 && next.saleDateTime) && next.saleDateTime
            ? <CloseClock iso={next.saleDateTime} windowHours={48} />
            : null}
          body={next
            ? <>
                <span className="ck-ccell-lot">{nextWho && <>{nextWho} · </>}{craftTitle(next.title, next.auctionHouse)}</span>
                {formatEstimate(next) && <span className="ck-ccell-sub">{formatEstimate(next)}{next.auctionHouse && <> · {next.auctionHouse}</>}</span>}
              </>
            : cold
              ? 'Your soonest closing watch counts down here, with the engine’s max bid and the gap to its projected close.'
              : 'No watch is on a hammer clock right now.'}
          href={next ? `/lot?id=${encodeURIComponent(next.id)}` : undefined}>
          {next && <DecisionLine lot={next} estimate={false} when={false} abstain="quiet" className="ck-ccell-decision" />}
        </Cell>

        {/* 3 · YOUR EDGE — the record, signed */}
        <Cell k="Your edge"
          v={record && record.med != null ? fmtSignedPct(Math.round(record.med)) : '—'}
          tone={record && record.med != null ? lamp(Math.round(record.med)) : undefined}
          note={record && record.med != null ? 'vs estimate, median' : null}
          body={record
            ? <>{record.n} {record.n === 1 ? 'call' : 'calls'} graded, all-in{streak && <> · <b>{streak.n} {streak.dir === 'beat' ? 'beat' : 'missed'} in a row</b></>}</>
            : cold
              ? 'Every watch that settles is judged against its estimate — your eye, measured, call by call.'
              : 'Grades once a watch settles with a published price against an estimate.'}
          href={record ? '#record' : undefined} />
      </div>

      {/* phone (≤639): the cells fold to one ledger row each — the Next-hammer
          lot and its decision line ride as one line under them, so the Today
          band and the picks keep the first screen (CSS hides this ≥640) */}
      {next && (
        <Link className="ck-cockpit-next" href={`/lot?id=${encodeURIComponent(next.id)}`}>
          <span className="ck-ccell-lot">{nextWho && <>{nextWho} · </>}{craftTitle(next.title, next.auctionHouse)}{formatEstimate(next) && <span className="ck-ccell-sub"> · {formatEstimate(next)}</span>}</span>
          <DecisionLine lot={next} estimate={false} when={false} abstain="quiet" className="ck-ccell-decision" />
        </Link>
      )}
      {/* a cold phone: the dashes stay in one row; what fills them folds here */}
      {cold && (
        <details className="ck-cockpit-what">
          <summary>What fills these</summary>
          <ul>
            <li><b>Watching</b> — bookmark a lot anywhere on lectr: its estimate counts here to the hammer, with the engine’s read beside it.</li>
            <li><b>Next hammer</b> — your soonest closing watch counts down here, with the engine’s max bid and the gap to its projected close.</li>
            <li><b>Your edge</b> — every watch that settles is judged against its estimate: your eye, measured, call by call.</li>
            <li><b>Next 14 days</b> — your watched lots land on the strip, day by day.</li>
          </ul>
        </details>
      )}

      {/* THE 14-DAY HAMMER STRIP */}
      <button type="button" className="ck-hstrip" onClick={stripTarget} disabled={cold && total === 0}
        aria-label={`${stripCaption(strip)} — ${total ? 'open your week' : 'nothing to open yet'}`}>
        <span className="ck-hstrip-bars" aria-hidden>
          {strip.map(d => (
            <span key={d.day} className="ck-hbar" data-today={d.today || undefined} data-n={d.n || undefined}
              title={`${d.today ? 'Today' : dayLabel(d.day)} · ${d.n ? `${d.n} closing${d.est > 0 ? ` · ${formatPrice(d.est)} at estimate midpoint` : ''}` : 'nothing closing'}`}>
              <i style={{ height: d.n ? `${Math.max(14, Math.round((d.n / max) * 100))}%` : undefined }} />
              <b>{d.dow}</b>
            </span>
          ))}
        </span>
        <span className="ck-hstrip-cap">
          <span className="kicker">Next 14 days</span>
          <span>{cold && total === 0 ? 'your watched lots land here, day by day' : stripCaption(strip)}</span>
        </span>
      </button>
    </div>
  );
}
