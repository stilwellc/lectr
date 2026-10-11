'use client';
/**
 * YOUR WEEK `#week` (THE DESK v3, Oct 11 2026) — the hammer timeline: the
 * reader's watched lots, their picks, and the sales of the names they follow
 * or own, laid day by day over the next 14 days.
 *
 *   desktop  day columns (7 in view, the next 7 a page to the right); each
 *            column is as tall as its own rows (an empty day is one line)
 *   phone    one day per scroll-snap card at 92% so the next day peeks, a
 *            14-day chip strip (edge-masked, the day in view kept in sight)
 *
 * Each row: the close on the reader's clock (a sale the house dated without
 * an hour says "time TBC"), the title (a link — the row's Tab stop), who /
 * house / estimate / bids and the engine's bid velocity where it measured
 * one (↑, mono, ink — descriptive, never a lamp), the decision line
 * (DecisionLine — one lot, one number), a live countdown inside 24h, and a
 * visible two-button action strip — Bid (the house's page) and Calendar (an
 * .ics made on the device, ./ics) — both reachable by Tab. Two of your
 * watches inside 30 minutes from different sales say "overlaps" on both rows
 * (ink, a dotted rule — not a lamp). j/k walks the rows (the page's
 * [data-nav-row] walk, the row itself at tabIndex −1 so Tab never lands on
 * it twice); Enter / Space on a walked row opens the lot.
 *
 * THE VIEW (R1#15): watches + names show by default; picks sit behind
 * "Show picks (N)" (remembered on this device; a week with no watch shows
 * its picks — week.ts pickDefault / viewOf). The rail's count and the
 * sub-line read the full plan; the columns read the view.
 *
 * Every read is ./week.ts (plain .ts, unit-tested); this file only prints.
 * One clock: desk.now.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AuctionLot } from '../../types';
import type { SectionProps, SectionMeta, DeskData } from '../desk/types';
import { RoomHead } from '../head';
import { HorizonMark } from '../../components/marks';
import DecisionLine from '../../components/DecisionLine';
import Flick from '../../components/Flick';
import { formatEstimate } from '../../lib/estimate-text';
import { displayMakerOf } from '../../lib/maker-subjects';
import { safeHref } from '../../lib/safe-href';
import { houseTzOf } from '../../lib/house-tz';
import { storageGet, storageSet } from '../../lib/safe-storage';
import { craftTitle, formatPrice } from '../../utils';
import {
  planWeek, viewOf, pickDefault, ownedWords, dayWords, offsetWord, localClock, houseClock, countdownText, velocityText, bidsText,
  CLOSING_NOW_MS, NAME_ROWS_OPEN, PICK_ROWS_OPEN, WEEK_DAYS, cityOf, type WeekPlan, type WeekRow, type WeekDay,
} from './week';
import { icsCalendar, eventOfRow, icsFileName } from './ics';
import { ClosingNow } from './closing-now';
import './week.css';

export { ClosingNow };

/** the device's memory of the picks toggle ('1' shown / '0' hidden; absent = the week decides) */
export const PICKS_KEY = 'lectr-week-picks';

/* ── the rail's entry: the pill carries YOURS (watches + picks on the
      week), never the names' sales (R1#8, R3) — the sub-line keeps those ── */
export function meta(desk: DeskData): SectionMeta {
  const plan = planOf(desk);
  return { id: 'week', label: 'Your week', count: plan.yours || undefined, quiet: plan.rows.length === 0 };
}

/** the picks the week reads: the ranked room plus the return loop's
 *  "closing tonight" picks (R4#7 — Today printed closers the week lacked).
 *  TODO(X1): read `desk.closingPicks` (the field the shell is adding to
 *  DeskData for the return loop's closing picks) — until it is on main this
 *  reads it when present and falls back to desk.recs alone. */
function recsOf(desk: DeskData): readonly { lot: AuctionLot }[] {
  const extra = (desk as DeskData & { closingPicks?: readonly { lot: AuctionLot }[] }).closingPicks;
  return extra?.length ? [...desk.recs, ...extra] : desk.recs;
}

export function planOf(desk: DeskData): WeekPlan {
  return planWeek({ now: desk.now, saved: desk.saved, savedIds: desk.savedIds, recs: recsOf(desk), book: desk.book, follows: desk.follows, collection: desk.collection });
}

/* ── the .ics download (client only) ── */
function downloadIcs(rows: readonly WeekRow[], now: number, label: string): void {
  if (typeof window === 'undefined' || !rows.length) return;
  const origin = window.location.origin.startsWith('http') ? window.location.origin : 'https://lectr.bid';
  const text = icsCalendar(rows.map(r => eventOfRow(r, now, origin)), now, `lectr · ${label}`);
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = icsFileName(label); a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const KIND_TAG: Record<WeekRow['kind'], string> = { watch: 'Watch', pick: 'Pick', name: 'Name' };

/** a partner's title in an overlap note: the first ~40 characters */
const shortTitle = (t: string) => (t.length > 44 ? `${t.slice(0, 41).replace(/\s+\S*$/, '')}…` : t);

/** the row's "who": the maker / subject, else nothing (a pseudo-maker bucket is never a name) */
const whoOf = (l: AuctionLot): string | null => displayMakerOf(l)?.name ?? null;

/** the user asked for no motion: scrolls jump instead of gliding */
const reduceMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const TBC_TITLE = 'The house published the sale day, not a close time';

function Row({ r, now, titleById, onOpen }: { r: WeekRow; now: number; titleById: ReadonlyMap<string, WeekRow>; onOpen: (lot: AuctionLot) => void }) {
  const { lot } = r;
  const title = craftTitle(lot.title, lot.auctionHouse);
  const who = r.kind === 'name' ? r.name : whoOf(lot);
  const own = ownedWords(r);
  const est = formatEstimate(lot);
  // a live-bid lot's estimate text already carries its bid count
  const bids = /\bbids?\b/.test(est) ? null : bidsText(lot);
  const vel = velocityText(lot);
  const soon = r.closeMs - now <= CLOSING_NOW_MS;
  const house = houseClock(lot, r.closeMs);
  const href = safeHref(lot.url);
  const conflict = r.conflictWith.map(id => titleById.get(id)).filter((x): x is WeekRow => !!x);
  const onKey = (e: React.KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(lot); }
  };
  return (
    <li className="ck-week-row" data-nav-row tabIndex={-1} data-kind={r.kind}
      data-conflict={conflict.length ? '' : undefined} data-soon={soon ? '' : undefined}
      onKeyDown={onKey} aria-label={`${KIND_TAG[r.kind]}: ${title}`}>
      <div className="ck-week-when">
        <span className="ck-tag" data-tone={r.kind === 'watch' ? 'hot' : undefined}>{KIND_TAG[r.kind]}</span>
        {r.timed
          ? <time className="ck-week-time" dateTime={new Date(r.closeMs).toISOString()} title={house ? `${localClock(r.closeMs)} on your clock · ${house} at the house` : 'the house’s published close, on your clock'}>{localClock(r.closeMs)}</time>
          : <span className="ck-week-time" data-dayonly title={TBC_TITLE}>time TBC</span>}
      </div>
      <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} className="ck-week-title">{title}</Link>
      <div className="ck-week-fact">
        {who && <span className="ck-week-who">{who}</span>}
        {own && <> · <span className="ck-week-own" title="pieces in your collection by this name">{own}</span></>}
        {who && ' · '}{lot.auctionHouse}
        {est ? <> · {est}</> : null}
        {bids ? <> · {bids}</> : null}
        {vel ? <> · <span className="ck-week-vel" title="bids added in the trailing window — the engine's bid velocity (descriptive, not a price)"><i aria-hidden>↑</i>{vel.replace(/^\+/, '')}</span></> : null}
      </div>
      <DecisionLine lot={lot} estimate={false} when={false} abstain="quiet" nowMs={now} className="ck-week-decision" />
      {soon && !(r.timed && lot.saleDateTime) && (
        <div className="ck-week-clock" title={`${TBC_TITLE} — the day ends in ${cityOf(houseTzOf(lot))}`}>
          day ends {countdownText(r.closeMs, now)} · {cityOf(houseTzOf(lot))}
        </div>
      )}
      {conflict.length > 0 && (
        <div className="ck-week-conflict" title="Two of your watches close within 30 minutes of each other, in different sales">
          <span className="ck-week-conflict-word">overlaps</span> {conflict.map((c, i) => <React.Fragment key={c.lot.id}>{i > 0 && ', '}<b>{shortTitle(craftTitle(c.lot.title, c.lot.auctionHouse))}</b> ({c.lot.auctionHouse}) · {localClock(c.closeMs)}</React.Fragment>)}
        </div>
      )}
      {/* the action strip: visible, two controls, both Tab stops (R5#3); the
          fact line already names the house, so the link says "Bid" and
          carries the house in its name (R5#4) */}
      <div className="ck-week-acts">
        {href && <a className="ck-week-act" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Bid at ${lot.auctionHouse} (opens the house’s page)`} title={`Bid at ${lot.auctionHouse}`}>Bid <Flick size={10} /></a>}
        <button type="button" className="ck-week-act" onClick={() => downloadIcs([r], now, `${r.day} ${title.slice(0, 40)}`)}
          aria-label={`Add ${title} to your calendar (.ics, made on this device)`} title="Add this close to your calendar (.ics, made on this device)">Calendar</button>
      </div>
    </li>
  );
}

function DayCol({ d, now, titleById, onOpen, open, onMore }: { d: WeekDay; now: number; titleById: ReadonlyMap<string, WeekRow>; onOpen: (lot: AuctionLot) => void; open: boolean; onMore: () => void }) {
  const w = dayWords(d.day);
  const word = offsetWord(d.offset);
  const watches = d.rows.filter(r => r.kind === 'watch');
  const picks = d.rows.filter(r => r.kind === 'pick');
  const names = d.rows.filter(r => r.kind === 'name');
  const yours = d.rows.filter(r => r.kind !== 'name');
  const shownPicks = open ? picks : picks.slice(0, PICK_ROWS_OPEN);
  const shownNames = open ? names : names.slice(0, NAME_ROWS_OPEN);
  const foldedPicks = picks.length - shownPicks.length;
  const foldedNames = names.length - shownNames.length;
  const folded = foldedPicks + foldedNames;
  const foldable = picks.length > PICK_ROWS_OPEN || names.length > NAME_ROWS_OPEN;
  const foldWords = [foldedPicks ? `${foldedPicks} ${foldedPicks === 1 ? 'pick' : 'picks'}` : null, foldedNames ? `${foldedNames} of your names` : null].filter(Boolean).join(', ');
  const dayName = `${w.wd} ${w.md}${word ? ` (${word})` : ''}`;
  const sub = d.rows.length
    ? `${d.yours} yours${d.priced ? ` · ${formatPrice(d.estTotal)} at estimate midpoint${d.priced < d.yours ? ` (${d.priced} of ${d.yours} priced)` : ''}` : ''}${d.names ? ` · ${d.names} of your names` : ''}${d.conflicts ? ` · ${d.conflicts} ${d.conflicts === 1 ? 'overlap' : 'overlaps'}` : ''}`
    : null;
  return (
    <section className="ck-week-day" id={`week-${d.day}`} data-today={d.offset === 0 ? '' : undefined} data-empty={d.rows.length ? undefined : ''} aria-label={dayName}>
      <div className="ck-week-dayhead">
        <div className="ck-week-dayname">
          <span className="kicker">{w.wd}{word ? <> · {word}</> : null}</span>
          <b>{w.md}</b>
        </div>
        {d.rows.length > 0 ? (
          <div className="ck-week-daysum" title={sub ?? undefined}>
            {d.yours > 0 ? <><b>{d.yours}</b> yours{d.priced > 0 && <span> · {formatPrice(d.estTotal)}</span>}</> : <span>{d.names} of your names</span>}
            {d.yours > 0 && d.names > 0 && <span> · +{d.names} names</span>}
            {d.conflicts > 0 && <span className="ck-week-dayconf"> · {d.conflicts} {d.conflicts === 1 ? 'overlap' : 'overlaps'}</span>}
          </div>
        ) : <div className="ck-week-daysum" data-quiet>—</div>}
        {yours.length > 0 && (
          <button type="button" className="ck-week-act ck-week-daycal" onClick={() => downloadIcs(yours, now, `week ${d.day}`)}
            aria-label={`Add your ${yours.length === 1 ? 'close' : `${yours.length} closes`} on ${w.wd} ${w.md} to your calendar (.ics)`}
            title={`Add your ${yours.length === 1 ? 'close' : `${yours.length} closes`} on ${w.md} to your calendar (.ics)`}>Calendar</button>
        )}
      </div>
      {d.rows.length > 0 ? (
        <>
          {(watches.length > 0 || shownPicks.length > 0) && (
            <ul className="ck-week-rows" aria-label={`Yours on ${w.md}`}>
              {watches.map(r => <Row key={r.lot.id} r={r} now={now} titleById={titleById} onOpen={onOpen} />)}
              {shownPicks.map(r => <Row key={r.lot.id} r={r} now={now} titleById={titleById} onOpen={onOpen} />)}
            </ul>
          )}
          {shownNames.length > 0 && (
            <>
              {yours.length > 0 && <div className="ck-week-namesrule"><span className="kicker">Your names</span><i className="ck-reads-rule" /></div>}
              <ul className="ck-week-rows" aria-label={`Your names on ${w.md}`}>
                {shownNames.map(r => <Row key={r.lot.id} r={r} now={now} titleById={titleById} onOpen={onOpen} />)}
              </ul>
            </>
          )}
          {foldable && (
            <button type="button" className="ck-today-more ck-week-more" aria-expanded={open} onClick={onMore}>
              {open ? 'Show less' : `+${folded} more (${foldWords})`}
            </button>
          )}
        </>
      ) : (
        <p className="ck-week-quiet">Nothing of yours</p>
      )}
    </section>
  );
}

/** the picks toggle, remembered on the device (null until read — the plan decides) */
function useShowPicks(plan: WeekPlan): [boolean, (v: boolean) => void] {
  const [remembered, setRemembered] = useState<boolean | null>(null);
  useEffect(() => {
    const v = storageGet(PICKS_KEY);
    setRemembered(v === '1' ? true : v === '0' ? false : null);
  }, []);
  const show = pickDefault(plan, remembered);
  const set = useCallback((v: boolean) => { setRemembered(v); storageSet(PICKS_KEY, v ? '1' : '0'); }, []);
  return [show, set];
}

export default function WeekSection({ desk, narrow }: SectionProps) {
  const router = useRouter();
  const plan = useMemo(() => planOf(desk), [desk]);
  const [showPicks, setShowPicks] = useShowPicks(plan);
  const view = useMemo(() => viewOf(plan, { picks: showPicks }), [plan, showPicks]);
  const titleById = useMemo(() => new Map(plan.rows.map(r => [r.lot.id, r])), [plan]);
  const onOpen = useCallback((lot: AuctionLot) => router.push(`/lot?id=${encodeURIComponent(lot.id)}`), [router]);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const track = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  // desktop: which 7-day page is in view (the pager's label); phone: which card
  const [page, setPage] = useState(0);
  const scrollToDay = useCallback((day: string) => {
    const el = track.current?.querySelector<HTMLElement>(`#week-${day}`);
    el?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
  }, []);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const cols = () => Array.from(el.children) as HTMLElement[];
    const indexOf = () => {
      const c = cols();
      const w = c[0]?.offsetWidth || 1;
      return Math.max(0, Math.min(WEEK_DAYS - 1, Math.round(el.scrollLeft / (w + 10))));
    };
    // a phone's track is as tall as the card in view, not the tallest day
    // (a Friday with four rows would otherwise sit over a screen of nothing)
    const fit = () => {
      if (!narrow) { el.style.height = ''; return; }
      const c = cols()[indexOf()];
      if (c) el.style.height = `${c.offsetHeight}px`;
    };
    const on = () => {
      const i = indexOf();
      setPage(narrow ? i : (i >= 6 ? 1 : 0));
      fit();
    };
    el.addEventListener('scroll', on, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) for (const c of cols()) ro.observe(c);
    fit();
    return () => { el.removeEventListener('scroll', on); ro?.disconnect(); el.style.height = ''; };
  }, [narrow, view]);
  // the phone's chip strip keeps the day in view in sight (horizontal only —
  // never a page scroll)
  useEffect(() => {
    const strip = chips.current;
    if (!strip || !narrow) return;
    const chip = strip.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!chip) return;
    const left = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [page, narrow, view]);

  const loading = desk.book.length === 0 && !desk.fullError;
  const yoursShown = view.rows.filter(r => r.kind !== 'name');
  const sub = loading ? 'Reading the block…' : plan.rows.length === 0
    ? <>Nothing of yours hammers in the next {WEEK_DAYS} days{plan.nextBeyond ? <> — your next close is <Link href={`/lot?id=${encodeURIComponent(plan.nextBeyond.lot.id)}`} className="ck-away-link">{craftTitle(plan.nextBeyond.lot.title, plan.nextBeyond.lot.auctionHouse)}</Link> on {dayWords(plan.nextBeyond.day).wd}, {dayWords(plan.nextBeyond.day).md}</> : '. Watch a lot or follow a name and it lands here'}.</>
    : <>
      {plan.yours > 0
        ? <><b>{plan.yours}</b> of yours {plan.yours === 1 ? 'hammers' : 'hammer'} in the next {WEEK_DAYS} days{plan.watches && plan.picks ? ` — ${plan.watches} ${plan.watches === 1 ? 'watch' : 'watches'}, ${plan.picks} ${plan.picks === 1 ? 'pick' : 'picks'}${showPicks ? '' : ' (picks hidden)'}` : plan.watches ? ` — ${plan.watches === 1 ? 'a watch' : 'all watches'}` : ` — ${plan.picks === 1 ? 'a pick' : 'all picks'}${showPicks ? '' : ' (hidden)'}`}</>
        : <>None of your watches or picks close in the next {WEEK_DAYS} days</>}
      {plan.priced > 0 && <> · <b>{formatPrice(plan.estTotal)}</b> at estimate midpoint{plan.priced < plan.yours ? ` (${plan.priced} of ${plan.yours} priced)` : ''}</>}
      {plan.conflicts > 0 && <> · <span className="ck-week-dayconf">{plan.conflicts} {plan.conflicts === 1 ? 'overlap' : 'overlaps'}</span></>}
      {plan.nameRows > 0 && <> · {plan.nameRows} {plan.nameRows === 1 ? 'sale' : 'sales'} of your names ({plan.names.slice(0, 4).join(', ')}{plan.names.length > 4 ? ` +${plan.names.length - 4}` : ''})</>}
      {plan.beyond > 0 && <> · {plan.beyond} more of yours after {dayWords(plan.dayKeys[WEEK_DAYS - 1]).md}</>}
    </>;

  const actions = plan.rows.length > 0 ? (
    <>
      {plan.picks > 0 && (
        <button type="button" className="ck-week-act ck-week-act-picks" aria-pressed={showPicks} onClick={() => setShowPicks(!showPicks)}
          title={showPicks ? 'Hide your picks — the week shows your watches and the sales of your names' : `Show your ${plan.picks} ${plan.picks === 1 ? 'pick' : 'picks'} on the week (remembered on this device)`}>
          {showPicks ? `Hide picks (${plan.picks})` : `Show picks (${plan.picks})`}
        </button>
      )}
      {yoursShown.length > 0 && (
        <button type="button" className="ck-week-act ck-week-act-all" onClick={() => downloadIcs(yoursShown, desk.now, `week ${plan.dayKeys[0]}`)}
          title="Every watch and pick shown on the week as one .ics file, made on this device — nothing is uploaded">
          Add {yoursShown.length === 1 ? 'the close' : `${yoursShown.length} closes`} to calendar
        </button>
      )}
      {!narrow && (
        <span className="ck-week-pager" role="group" aria-label="Week page">
          <button type="button" className="ck-week-act" aria-pressed={page === 0} onClick={() => scrollToDay(plan.dayKeys[0])}>Days 1–7</button>
          <button type="button" className="ck-week-act" aria-pressed={page === 1} onClick={() => scrollToDay(plan.dayKeys[7])}>8–14</button>
        </span>
      )}
    </>
  ) : null;

  return (
    <section id="week" className="ray-saved-section rail ray-enter ck-week" aria-label="Your week">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead mark={<HorizonMark size={17} />} title="Your week" sub={sub} actions={actions} style={{ marginBottom: 14 }}
          help={{ name: 'Your week', body: <>
            The next {WEEK_DAYS} days of hammers that are yours: your <b>watches</b>, your current <b>picks</b>, and the live sales of the
            <b> names</b> you follow or own a piece by (makers, players, subjects — not whole categories or houses; a name you own a
            piece by says <b>you own N</b>). A lot prints once, under its strongest claim. The columns show your watches and your
            names&rsquo; sales; <b>Show picks</b> adds your picks and is remembered on this device (a week with no watch shows its picks).
            The time is the house&rsquo;s published close on <b>your</b> clock; a sale the house dates without an hour says
            <b> time TBC</b> and sits on its sale day where it is held. Under a row, <b>worth up to</b> is the engine&rsquo;s max bid and
            the gap to the projected close; a row with no such line is one the engine abstained on — no value implied. <b>↑N bids · 24h</b> is
            bids added in the trailing window where the engine measured it (Goldin live lots). <b>Overlaps</b>: two of your watches
            close within 30 minutes in different sales. Totals sum the estimate midpoints of your watches and picks that carry both
            bounds (a name&rsquo;s sales are never counted as your money). A day opens on every watch, {PICK_ROWS_OPEN} picks and
            {' '}{NAME_ROWS_OPEN} name rows; <b>+N more</b> opens the rest in place. <b>Calendar</b> writes an .ics on this device — a timed
            close as a 30-minute event with an alarm 30 minutes before, a day-only sale as an all-day event. Keyboard: <b>Tab</b> reaches
            each title, Bid and Calendar; <b>j</b>/<b>k</b> walk the rows and <b>Enter</b> opens the lot.
          </> }} />
        {narrow && view.rows.length > 0 && (
          <div className="ck-week-chipwrap">
            <div className="ck-week-chips" role="group" aria-label="Days" ref={chips}>
              {view.days.map(d => {
                const w = dayWords(d.day);
                const n = d.rows.length;
                return (
                  <button key={d.day} type="button" className="ck-week-chip" aria-pressed={page === d.offset}
                    aria-label={`${w.wd} ${w.md}${n ? `, ${n} ${n === 1 ? 'row' : 'rows'}` : ', nothing of yours'}`}
                    data-today={d.offset === 0 ? '' : undefined} data-empty={n ? undefined : ''} onClick={() => scrollToDay(d.day)}>
                    <span className="kicker">{w.wd.slice(0, 2)}</span><b>{w.dayNum}</b>{n > 0 && <i>{n}</i>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {loading ? (
          <div className="ck-week-days" aria-hidden data-loading="">
            {Array.from({ length: narrow ? 1 : 7 }, (_, i) => (
              <div key={i} className="ck-week-day">
                <div className="ck-week-dayhead"><i className="ray-sk" style={{ width: 70, height: 12 }} /></div>
                <i className="ray-sk" style={{ width: '80%', height: 12, marginTop: 14 }} />
                <i className="ray-sk" style={{ width: '60%', height: 12, marginTop: 8 }} />
              </div>
            ))}
          </div>
        ) : view.rows.length > 0 ? (
          <div className="ck-week-days" ref={track} data-narrow={narrow ? '' : undefined}>
            {view.days.map(d => (
              <DayCol key={d.day} d={d} now={desk.now} titleById={titleById} onOpen={onOpen}
                open={!!openDays[d.day]} onMore={() => setOpenDays(o => ({ ...o, [d.day]: !o[d.day] }))} />
            ))}
          </div>
        ) : plan.rows.length > 0 ? (
          <p className="ck-week-quiet ck-week-quiet-view">Your picks are hidden — nothing else of yours hammers in the next {WEEK_DAYS} days.</p>
        ) : null}
      </div>
    </section>
  );
}
