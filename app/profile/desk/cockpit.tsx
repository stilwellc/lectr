'use client';
/**
 * THE COCKPIT MASTHEAD (THE DESK v3 §0, Oct 11 2026; four cells on every
 * tab and every width since Oct 28) — under the Masthead's statement, the
 * registration cells and, on Today, the 14-day hammer strip:
 *
 *   Watching      the lots on the block · $ at estimate midpoint · below market
 *   Next hammer   the soonest closing watch: live CloseClock inside 24h,
 *                 else the day word; the lot; its decision line
 *   Needs you     bids past your max + your closes today + results to
 *                 confirm, counted once, linking the first one's home
 *   Your edge     YOUR CALLS graded against the hammer (edge/edge.ts
 *                 gradeDesk — imported, never re-derived) once any call has
 *                 graded; until then the cell is what it is: "Record", the
 *                 settled watches' median vs estimate (R4#2, R1#1)
 *
 * Every number is the provider's or the week's (summary / record /
 * planWeek / gradeDesk — the same figures the sub-line, Watching, Your week
 * and Your edge print; nothing is re-derived here).
 *
 * THREE DESKS (Oct 11 review, R3#1/#2):
 *   live        watches on the block — the cells above
 *   picks-only  nothing watched, but picks / follows (a quick start, a
 *               follows-only desk): Watching says "0 watched · 24 picks live",
 *               Next hammer falls back to the soonest pick (labelled) or the
 *               soonest sale of one of your names, and the strip counts the
 *               SAME rows Your week counts (planWeek — watches bold, picks and
 *               names light), so Today, the cockpit and the week never
 *               contradict each other on one screen
 *   cold        nothing at all — the three cells are the three taps that
 *               fill them (watch a lot, tonight's closers, the engine's
 *               record); no "What fills these" fold
 *
 * The strip: one tiny bar per day for the next 14, the reader's rows closing
 * that day (the week's day — the reader's day for a timed close); today
 * marked; tap → #week. Phone: cells stack, strip stays, weekday letters stay.
 */
import { Thumb } from './thumb';
import React, { useMemo } from 'react';
import Link from 'next/link';
import CloseClock from '../../components/CloseClock';
import DecisionLine from '../../components/DecisionLine';
import { formatEstimate } from '../../components/LotCard';
import { displayMakerOf } from '../../lib/maker-subjects';
import { fmtFace } from '../../lib/lot-face';
import { craftTitle, fmtSignedPct, localToday } from '../../utils';
import { closeDays, hammerWord, needsYouOf } from './derive';
import { useDesk, useDeskInternals } from './provider';
import { jump } from '../rail';
import { mountedSections, overMaxN } from './sections';
import { dayLabel, hammerStrip, streakOf, stripCaption } from './cockpit-logic';
import { closingNowOf, planWeek, localDayOf, type WeekRow } from '../week/week';
import { gradeDesk, EDGE_HIT_PCT } from '../edge/edge';
import type { AuctionLot } from '../../types';

const lamp = (v: number) => (v > 0 ? 'var(--color-up)' : v < 0 ? 'var(--color-down-text)' : 'var(--color-fg)');

function Cell({ k, v, note, body, href, tone, tap, children }: {
  k: string; v: React.ReactNode; note?: React.ReactNode; body: React.ReactNode; href?: string;
  /** the value's ink — a signed read only (lamp law) */
  tone?: string;
  /** a cold cell IS its tap: the value is the action's words, not a figure */
  tap?: boolean;
  children?: React.ReactNode;
}) {
  const inner = (
    <>
      <span className="ck-ccell-k">{k}</span>
      <span className={tap ? 'ck-ccell-v ck-ccell-tap' : 'ck-ccell-v'} style={tone ? { color: tone } : undefined}>{v}{note != null && <small>{note}</small>}</span>
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

/** the lot line a Next-hammer cell prints: who · title, the estimate / house under it.
 *  (Oct 29) on a desk the line is the cell's one block — a 40px photo, the
 *  title on one line, the estimate · house on one line — so the cell stands
 *  as tall as its neighbours; `tip` (the scope words) rides in the title's
 *  tooltip, never dropped */
function LotLine({ lot, phone = false, tip }: { lot: AuctionLot; phone?: boolean; tip?: string }) {
  const who = displayMakerOf(lot)?.name ?? null;
  const est = formatEstimate(lot);
  const sub = [est, lot.auctionHouse].filter(Boolean).join(' · ');
  const title = `${who ? `${who} · ` : ''}${craftTitle(lot.title, lot.auctionHouse)}`;
  // a phone prints the FIGURE first and lets the title take two lines — a
  // single ellipsized line cut the estimate, not the noise (R2 f)
  // the lot's photo leads its lines (the command center shows what it counts down to)
  const ph = <Thumb src={lot.imageUrl} label={lot.title} size={phone ? 48 : 40} />;
  return phone ? (
    <span className="ck-lotline ck-ph" style={{ '--ph': '48px' } as React.CSSProperties}>
      {ph}
      {sub && <span className="ck-ccell-sub">{sub}</span>}
      <span className="ck-ccell-lot">{title}</span>
    </span>
  ) : (
    <span className="ck-lotline ck-ph" style={{ '--ph': '40px' } as React.CSSProperties} title={[title, sub, tip].filter(Boolean).join(' — ')}>
      {ph}
      <span className="ck-ccell-lot">{title}</span>
      {sub && <span className="ck-ccell-sub">{sub}</span>}
    </span>
  );
}

const KIND_WORD: Record<WeekRow['kind'], string> = { watch: 'your watch', pick: 'a pick', name: 'your name' };

export default function Cockpit() {
  const { desk } = useDesk();
  const i = useDeskInternals();
  const { upcoming, summary, record, deskView } = i;
  const todayKey = localToday();
  // THE WEEK's rows — the one source the strip, Your week and (via X2) the
  // Today band count; the return loop's closing picks join the picks
  const plan = useMemo(() => {
    const seen = new Set(desk.recs.map(r => r.lot.id));
    const recs = desk.closingPicks.length ? desk.recs.concat(desk.closingPicks.filter(r => !seen.has(r.lot.id))) : desk.recs;
    return planWeek({ now: desk.now, saved: desk.saved, savedIds: desk.savedIds, recs, book: desk.book, follows: desk.follows, collection: desk.collection });
  }, [desk]);
  const picksLive = useMemo(() => {
    const ids = new Set(desk.recs.map(r => r.lot.id));
    for (const r of desk.closingPicks) ids.add(r.lot.id);
    return ids.size;
  }, [desk.recs, desk.closingPicks]);
  // the three desks
  const live = deskView;
  const cold = !live && plan.rows.length === 0 && picksLive === 0;
  const picksOnly = !live && !cold;
  const strip = useMemo(
    () => hammerStrip(plan.rows.map(r => ({ day: r.day, est: r.estMid ?? 0, kind: r.kind })), todayKey),
    [plan, todayKey],
  );
  const max = Math.max(1, ...strip.map(d => d.n));
  const total = strip.reduce((s, d) => s + d.n, 0);
  const streak = record ? streakOf(record.series) : null;
  // YOUR CALLS graded — Edge's own read (edge.ts), never a copy
  const edge = useMemo(() => (desk.saved.length ? gradeDesk({ now: desk.now, saved: desk.saved, metaFor: desk.metaFor, ledger: desk.ledger }) : null), [desk.saved, desk.now, desk.metaFor, desk.ledger]);
  // (Phase 2) the soonest WATCHED close by the house's published instant —
  // the same read Your week's Closing-now strip makes (closingNowOf), so the
  // cell and the strip never name different lots; the summary's day-ordered
  // next is the fallback for a lot with no close instant. With nothing
  // watched: the soonest pick, else the soonest sale of one of your names
  const cn = useMemo(() => closingNowOf(desk.saved, desk.now), [desk.saved, desk.now]);
  // a lot past its sale day (result pending) is never the NEXT hammer
  const nextWatch = cn.rows[0]?.lot ?? cn.next?.lot ?? (summary.next && closeDays(summary.next) >= 0 ? summary.next : null);
  const nextRow: WeekRow | null = useMemo(() => {
    if (nextWatch) return null;
    const yours = plan.rows.filter(r => r.kind === 'pick').sort((a, b) => a.closeMs - b.closeMs)[0];
    if (yours) return yours;
    return plan.rows.filter(r => r.kind === 'name').sort((a, b) => a.closeMs - b.closeMs)[0] ?? null;
  }, [nextWatch, plan]);
  const next = nextWatch ?? nextRow?.lot ?? null;
  const nextKind: WeekRow['kind'] | null = nextWatch ? 'watch' : nextRow?.kind ?? null;
  const nextDays = next ? closeDays(next) : NaN;
  // SCOPE (R2 a): picks and your names' sales that close TODAY before your next
  // watched hammer — the Today band prints them as "Closing tonight", so the
  // cell says so too and the first screen can't contradict itself
  const tonight = useMemo(() => {
    if (!nextWatch) return null;
    const nextMs = cn.rows[0]?.closeMs ?? cn.next?.closeMs ?? Infinity;
    const today = localDayOf(desk.now);
    const rows = plan.rows.filter(r => r.kind !== 'watch' && r.day === today && r.closeMs < nextMs);
    const picks = rows.filter(r => r.kind === 'pick').length, names = rows.length - picks;
    return picks || names ? { picks, names } : null;
  }, [nextWatch, cn, plan, desk.now]);
  // the strip lands on Your week once it registers; on the room until then
  // decided from the desk, not the DOM: under tabs, Your week / Watching
  // aren't mounted unless their tab is open (jump() opens it)
  const stripTarget = () => {
    const ids = new Set(mountedSections(desk, i).map(s => s.id));
    const id = ids.has('week') ? 'week' : ids.has('watching') ? 'watching' : null;
    if (id) jump(id);
  };
  // (Oct 29) a bar lands on ITS day in Your week (#week-YYYY-MM-DD, the day
  // card's own anchor — the fold opens on the way); without the week, the room
  const dayTarget = (day: string) => {
    const ids = new Set(mountedSections(desk, i).map(s => s.id));
    if (ids.has('week')) jump(`week-${day}`); else stripTarget();
  };
  const hits = edge ? edge.graded.filter(c => c.hit).length : 0;
  const scopeLine = tonight
    ? ` · ${[tonight.picks ? `${tonight.picks} ${tonight.picks === 1 ? 'pick' : 'picks'}` : null, tonight.names ? `${tonight.names} of your names` : null].filter(Boolean).join(' and ')} ${tonight.picks + tonight.names === 1 ? 'closes' : 'close'} tonight`
    : '';

  // NEEDS YOU (Oct 28) — the one count of what waits on the reader: live bids
  // past their max (Watching's news), their watches closing today, and settled
  // results not yet confirmed (the Today inbox / History). Each is a figure
  // the tab bar or a room already prints; the cell adds them and links the
  // first one's home.
  const overMax = overMaxN(desk, i);
  // counted once: a watch past your max that also closes today is one thing (derive.needsYouOf)
  // a watch that closed earlier today waits on the house, not you: said apart, never counted
  const ny = needsYouOf(upcoming, id => desk.metaFor(id)?.maxUsd, i.unclaimedWins, desk.now);
  const needs = ny.n;
  const needsHref = overMax > 0 ? '#watching' : summary.closesToday > 0 ? '#today' : i.todayShows ? '#results' : '#settled';
  const needsFacts = [
    overMax > 0 ? `${overMax} ${overMax === 1 ? 'bid' : 'bids'} past your max` : null,
    summary.closesToday > 0 ? `${summary.closesToday} ${summary.closesToday === 1 ? 'closes' : 'close'} today` : null,
    i.unclaimedWins > 0 ? `${i.unclaimedWins} ${i.unclaimedWins === 1 ? 'result' : 'results'} to confirm` : null,
    ny.closedEarlierToday > 0 ? `${ny.closedEarlierToday} closed earlier today · results pending` : null,
  ].filter(Boolean) as string[];
  const showNeeds = live || needs > 0 || ny.closedEarlierToday > 0;
  const nCells = cold ? 3 : showNeeds ? 4 : 3;

  return (
    <div className="ck-cockpit" data-cold={cold || undefined} data-live={picksOnly ? 'picks' : undefined} aria-label="Your desk at a glance">
      <div className="ck-ccells" data-n={nCells}>
        {/* 1 · WATCHING — the lots on the block and what they add to */}
        {cold ? (
          <Cell k="Watching" tap v={<>Watch a lot <span aria-hidden>›</span></>} href="#for-you"
            body="Bookmark any lot on lectr — the picks under For you have the button — and its estimate counts here to the hammer, with the engine’s read beside it." />
        ) : picksOnly ? (
          <Cell k="Watching" v="0" note="watched" href="#for-you"
            body={<span>{picksLive} {picksLive === 1 ? 'pick' : 'picks'} live <span aria-hidden>→</span> For you{plan.nameRows > 0 && <> · {plan.nameRows} {plan.nameRows === 1 ? 'sale' : 'sales'} of your names this fortnight</>}</span>} />
        ) : summary.totalEst > 0 ? (
          // the headline prints the total; the cell leads with the count and
          // carries the total's basis (never the same figure twice at cell scale)
          <Cell k="Watching"
            v={upcoming.length.toLocaleString()}
            note={upcoming.length === 1 ? 'live lot' : 'live lots'}
            body={<span>{fmtFace(summary.totalEst)} at estimate midpoint · {summary.priced} of {upcoming.length} priced{summary.oneSided > 0 && <> · {summary.oneSided} from one bound, not summed</>}{summary.flagged > 0 && <> · <b>{summary.flagged} below market</b></>}</span>}
            href="#watching" />
        ) : (
          <Cell k="Watching"
            v={upcoming.length > 0 ? upcoming.length.toLocaleString() : '—'}
            note={upcoming.length > 0 ? (upcoming.length === 1 ? 'live lot' : 'live lots') : null}
            body={upcoming.length === 0
              ? 'Nothing live on the block — your settled watches are judged under Your record.'
              : <span>{upcoming.length === 1 ? 'no two-sided estimate' : 'no two-sided estimates to sum'}{summary.flagged > 0 && <> · <b>{summary.flagged} below market</b></>}</span>}
            href={upcoming.length > 0 ? '#watching' : undefined} />
        )}

        {/* 2 · NEXT HAMMER — the soonest closing watch (else pick / your name), counting down */}
        {cold ? (
          <Cell k="Next hammer" tap v={<>Tonight&rsquo;s closers <span aria-hidden>›</span></>} href="/value?sort=closing"
            body="Your soonest closing watch counts down here, with the engine’s max bid and the gap to its projected close. Until you watch one: what closes on the block tonight." />
        ) : (
          <Cell k="Next hammer"
            v={next
              ? (nextDays === 0 && next.saleDateTime
                  ? <CloseClock iso={next.saleDateTime} windowHours={24} />
                  : hammerWord(nextDays))
              : '—'}
            note={next
              ? <>{nextKind && nextKind !== 'watch' ? KIND_WORD[nextKind] : 'your watch'}{!(nextDays === 0 && next.saleDateTime) && next.saleDateTime ? <span className="ck-ccell-clock"><CloseClock iso={next.saleDateTime} windowHours={48} /></span> : null}</>
              : null}
            // (Oct 29) the scope line prints only when the lot is NOT the reader's
            // own next watched hammer (a pick, a name's sale); for a watch it rides
            // in the lot line's tooltip with what else closes tonight — the cell
            // keeps the others' height and no fact is dropped (Today prints tonight)
            body={next
              ? <>
                  <LotLine lot={next} tip={nextKind === 'watch' ? `your next watched hammer${scopeLine}` : undefined} />
                  {nextKind !== 'watch' && (
                    <span className="ck-ccell-scope">{nextKind === 'pick' ? 'nothing watched — your soonest pick' : 'nothing watched — the soonest sale of one of your names'}{scopeLine}</span>
                  )}
                </>
              : 'No watch is on a hammer clock right now.'}
            href={next ? `/lot?id=${encodeURIComponent(next.id)}` : undefined}>
            {next && <DecisionLine lot={next} estimate={false} when={false} abstain="quiet" className="ck-ccell-decision" />}
          </Cell>
        )}

        {/* 3 · NEEDS YOU — what waits on the reader, counted once, with its home */}
        {!cold && showNeeds && (
          <Cell k="Needs you"
            v={needs > 0 ? needs.toLocaleString() : '0'}
            note={needs === 0 ? 'all clear' : needs === 1 ? 'thing' : 'things'}
            body={needsFacts.length ? needsFacts.join(' · ') : 'No bid past your max, nothing of yours closing today, no result waiting on you.'}
            href={needs > 0 ? needsHref : undefined} />
        )}

        {/* 4 · YOUR EDGE — your calls graded (edge.ts); else the settled record, named as such */}
        {cold ? (
          <Cell k="Your calls" tap v={<>The engine&rsquo;s record <span aria-hidden>›</span></>} href="/receipts"
            body="Every watch that settles is judged against its estimate — your eye, measured, call by call. Until then: how the engine’s own calls have done." />
        ) : edge && edge.n > 0 ? (
          <Cell k="Your calls"
            v={edge.all.medianMiss != null ? fmtSignedPct(Math.round(edge.all.medianMiss)) : edge.n.toLocaleString()}
            // a miss is distance from your call, not a gain — ink, never the lamp
            tone={undefined}
            note={edge.all.medianMiss != null
              ? (Math.round(edge.all.medianMiss) === 0 ? 'typical miss — hammers landed on your calls'
                : `typical miss — hammers ran ${edge.all.medianMiss > 0 ? 'above' : 'below'} your calls`)
              : (edge.n === 1 ? 'call graded' : 'calls graded')}
            body={<span>{edge.n} {edge.n === 1 ? 'call' : 'calls'} graded against the hammer · {hits} of {edge.n} within ±{EDGE_HIT_PCT}%{edge.streak.current >= 2 && <> · <b>{edge.streak.current} hits in a row</b></>}</span>}
            href="#edge" />
        ) : record && record.med != null ? (
          <Cell k="Record"
            v={fmtSignedPct(Math.round(record.med))}
            tone={lamp(Math.round(record.med))}
            note="vs estimate, median"
            body={<span>{record.n} {record.n === 1 ? 'watch' : 'watches'} judged, all-in{streak && <> · <b>{streak.n} {streak.dir === 'beat' ? 'beat' : 'missed'} in a row</b></>} · no call of yours graded yet</span>}
            href="#record" />
        ) : (
          <Cell k="Your calls" v="—"
            body={desk.saved.length > 0
              ? 'Grades once a watch settles with a published price against an estimate.'
              : 'Every watch that settles is judged against its estimate — your eye, measured, call by call.'}
            href={desk.saved.length > 0 ? '#edge' : undefined} />
        )}
      </div>

      {/* phone (≤639): the cells fold to one row of label · figure; the
          Next-hammer lot and its decision line ride as one line under them
          on Today (CSS hides this ≥640 and past Today) */}
      {next && (
        <Link className="ck-cockpit-next" href={`/lot?id=${encodeURIComponent(next.id)}`}>
          <LotLine lot={next} phone />
          {(scopeLine || nextKind !== 'watch') && <span className="ck-ccell-scope">{nextKind === 'watch' ? 'next watched hammer' : nextKind === 'pick' ? 'a pick — nothing watched' : 'one of your names — nothing watched'}{scopeLine}</span>}
          <DecisionLine lot={next} estimate={false} when={false} abstain="quiet" className="ck-ccell-decision" />
        </Link>
      )}

      {/* THE 14-DAY HAMMER STRIP — the week's rows: watches bold, picks and your
          names light. Each bar is a tap on its day; the caption opens the week */}
      <div className="ck-hstrip" data-empty={total === 0 || undefined}>
        <span className="ck-hstrip-bars" role="group" aria-label="The next 14 days, a bar per day">
          {strip.map(d => {
            const words = `${d.today ? 'Today' : dayLabel(d.day)} · ${d.n ? `${d.n} closing${d.watches !== d.n ? ` (${d.watches} ${d.watches === 1 ? 'watch' : 'watches'}, ${d.n - d.watches} ${d.picks && !d.names ? 'picks' : d.names && !d.picks ? 'of your names' : 'picks / your names'})` : ''}${d.est > 0 ? ` · ${fmtFace(d.est)} at estimate midpoint` : ''}` : 'nothing closing'}`;
            return (
              <button key={d.day} type="button" className="ck-hbar" disabled={total === 0} onClick={() => dayTarget(d.day)}
                data-today={d.today || undefined} data-n={d.n || undefined} data-w={d.watches || undefined} data-mix={(d.watches > 0 && d.watches < d.n) || undefined}
                title={words} aria-label={`${words} — open the day in your week`}>
                <i aria-hidden style={{ height: d.n ? `${Math.max(14, Math.round((d.n / max) * 100))}%` : undefined }}>
                  {d.n > 0 && d.watches > 0 && d.watches < d.n && <u style={{ height: `${Math.round((d.watches / d.n) * 100)}%` }} />}
                </i>
                <b aria-hidden>{d.dow}</b>
              </button>
            );
          })}
        </span>
        <button type="button" className="ck-hstrip-cap" onClick={stripTarget} disabled={total === 0}
          aria-label={`${stripCaption(strip)} — ${total ? 'open your week' : 'nothing to open yet'}`}>
          <span className="kicker">Next 14 days</span>
          <span title={total ? stripCaption(strip) : undefined}>{total === 0 ? (cold ? 'your watched lots land here, day by day' : 'nothing of yours closes in the next 14 days') : stripCaption(strip)}</span>
        </button>
      </div>
    </div>
  );
}
