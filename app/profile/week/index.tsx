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
 * Each row is the desk's one row (../desk/row DeskRow, THE DESK v4): the
 * photo, the title (the link — the whole row opens the lot), who / house /
 * estimate / bids and the engine's bid velocity where it measured one (↑,
 * ink — descriptive, never a lamp) on the sub-line, the kind as the tag, the
 * decision line (DecisionLine — one lot, one number), and the FIGURE is the
 * close on the reader's clock (a sale the house dated without an hour says
 * "time TBC"), a live countdown under it inside 24h. The action slot holds
 * Bid (the house's page) and Calendar (an .ics made on the device, ./ics) —
 * both reachable by Tab. Two of your watches inside 30 minutes from
 * different sales say "overlaps" on both rows (ink, not a lamp). j/k walks
 * the rows (the page's [data-nav-row] walk, the title is the focus target);
 * Enter on a walked row opens the lot.
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
import type { AuctionLot } from '../../types';
import type { SectionProps, SectionMeta, DeskData } from '../desk/types';
import type { DeskInternals } from '../desk/provider';
import { RoomHead } from '../head';
import { HorizonMark } from '../../components/marks';
import DecisionLine from '../../components/DecisionLine';
import Flick from '../../components/Flick';
import { DeskRow } from '../desk/row';
import { formatEstimate } from '../../lib/estimate-text';
import { displayMakerOf } from '../../lib/maker-subjects';
import { safeHref } from '../../lib/safe-href';
import { houseTzOf } from '../../lib/house-tz';
import { storageGet, storageSet } from '../../lib/safe-storage';
import { craftTitle, formatPrice } from '../../utils';
import {
  planWeek, viewOf, pickDefault, weekLeadOf, ownedWords, PICKS_KEY, WEEK_PICKS_EVENT, dayWords, offsetWord, localClock, houseClock, countdownText, velocityText, bidsText,
  CLOSING_NOW_MS, NAME_ROWS_OPEN, WATCH_ROWS_OPEN, PICK_ROWS_OPEN, WEEK_DAYS, cityOf, type WeekPlan, type WeekRow, type WeekDay,
} from './week';
import { icsCalendar, eventOfRow, icsFileName } from './ics';
import { ClosingNow } from './closing-now';
import './week.css';

export { ClosingNow };

export { PICKS_KEY };

/* ── the rail's entry: the pill carries YOURS (watches + picks on the
      week), never the names' sales (R1#8, R3) — the sub-line keeps those ── */
export function meta(desk: DeskData, i: DeskInternals): SectionMeta {
  const plan = planOf(desk);
  // (pass 13) the pill counts what the room lists: the device's picks toggle
  // decides whether the picks are in it — read ONCE in the provider's effect
  // (DeskInternals.weekPicksShown), never from storage during render (SSR
  // and the first client render agree on the plan's default)
  const show = pickDefault(plan, i.weekPicksShown ?? null);
  return { id: 'week', label: 'Your week', count: weekLeadOf(plan, show) || undefined, quiet: plan.rows.length === 0 };
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

/* (Oct 20 audit, perf) planWeek scans the whole book; the desk object
   changes every minute (its clock) and meta() runs on every render. The plan
   is memoised on its inputs' identities and a 5-minute clock bucket — a row
   moving between days at a 5-minute grain is invisible; the countdowns read
   the live clock separately. */
const PLAN_GRAIN = 5 * 60_000;
let planMemo: { k: readonly unknown[]; plan: WeekPlan } | null = null;
export function planOf(desk: DeskData): WeekPlan {
  const recs = recsOf(desk);
  const bucket = Math.floor(desk.now / PLAN_GRAIN);
  const k = [bucket, desk.saved, desk.savedIds, desk.recs, (desk as DeskData & { closingPicks?: unknown }).closingPicks, desk.book, desk.follows, desk.collection];
  if (planMemo && planMemo.k.length === k.length && planMemo.k.every((x, i) => x === k[i])) return planMemo.plan;
  const plan = planWeek({ now: bucket * PLAN_GRAIN, saved: desk.saved, savedIds: desk.savedIds, recs, book: desk.book, follows: desk.follows, collection: desk.collection });
  planMemo = { k, plan };
  return plan;
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

/** a 14px calendar glyph (the day head's add-to-calendar and the row's) */
function CalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </svg>
  );
}

const TBC_TITLE = 'The house published the sale day, not a close time';

function Row({ r, now, titleById }: { r: WeekRow; now: number; titleById: ReadonlyMap<string, WeekRow> }) {
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
  return (
    <DeskRow lot={lot} as="li" title={title}
      attrs={{ 'data-kind': r.kind, 'data-conflict': conflict.length ? '' : undefined, 'data-soon': soon ? '' : undefined, 'aria-label': `${KIND_TAG[r.kind]}: ${title}` }}
      // the rule above a names group names it, so a name row carries no tag of its own
      tag={r.kind === 'name' ? null : { text: KIND_TAG[r.kind], tone: r.kind === 'watch' ? 'hot' : undefined }}
      sub={<>
        {who && <b>{who}</b>}
        {own && <> · <span title="pieces in your collection by this name">{own}</span></>}
        {who && ' · '}{lot.auctionHouse}
        {est ? <> · {est}</> : null}
        {bids ? <> · {bids}</> : null}
        {vel ? <> · <span className="ck-week-vel" title="bids added in the trailing window — the engine's bid velocity (descriptive, not a price)"><i aria-hidden>↑</i>{vel.replace(/^\+/, '')}</span></> : null}
      </>}
      subText={[who, own, lot.auctionHouse, est || null, bids, vel].filter(Boolean).join(' · ')}
      figureText={r.timed ? localClock(r.closeMs) : 'time to be confirmed'}
      figureSubText={soon ? (r.timed && lot.saleDateTime ? countdownText(r.closeMs, now) : `day ends ${countdownText(r.closeMs, now)} in ${cityOf(houseTzOf(lot))}`) : null}
      // the figure: the close on the reader's clock; inside 24h the countdown rides under it
      figureKind="clock"
      figure={r.timed
        ? <time className="dk-clock" data-soon={soon || undefined} dateTime={new Date(r.closeMs).toISOString()} title={house ? `${localClock(r.closeMs)} on your clock · ${house} at the house` : 'the house’s published close, on your clock'}>{localClock(r.closeMs)}</time>
        : <span className="dk-clock" data-quiet title={TBC_TITLE}>time TBC</span>}
      figureSub={soon
        ? (r.timed && lot.saleDateTime
          ? countdownText(r.closeMs, now)
          : <span title={`${TBC_TITLE} — the day ends in ${cityOf(houseTzOf(lot))}`}>day ends {countdownText(r.closeMs, now)} · {cityOf(houseTzOf(lot))}</span>)
        : null}
      meta={conflict.length > 0 ? (
        <span className="dk-meta-fact ck-week-conflict" title="Two of your watches close within 30 minutes of each other, in different sales">
          <span className="ck-week-conflict-word">overlaps</span> {conflict.map((c, i) => <React.Fragment key={c.lot.id}>{i > 0 && ', '}<b>{shortTitle(craftTitle(c.lot.title, c.lot.auctionHouse))}</b> ({c.lot.auctionHouse}) · {localClock(c.closeMs)}</React.Fragment>)}
        </span>
      ) : undefined}
      // a name's sale is theirs, not yours: no decision line (as before)
      decision={r.kind === 'name' ? undefined : <DecisionLine lot={lot} estimate={false} when={false} abstain="quiet" nowMs={now} />}
      // the action slot: Bid (the house's page) and Calendar, both Tab stops (R5#3); the
      // sub-line already names the house, so the link says "Bid" and carries the house in its name (R5#4)
      action={<>
        {href && <a className="ck-week-act" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Bid at ${lot.auctionHouse} (opens the house’s page)`} title={`Bid at ${lot.auctionHouse}`}>Bid <Flick size={10} /></a>}
        <button type="button" className="ck-week-act ck-week-act-cal" onClick={() => downloadIcs([r], now, `${r.day} ${title.slice(0, 40)}`)}
          aria-label={`Add ${title} to your calendar (.ics, made on this device)`} title="Add this close to your calendar (.ics, made on this device)"><CalIcon /><span className="ck-week-act-t">Calendar</span></button>
      </>} />
  );
}

function DayCol({ d, now, titleById, open, onMore, onShowPicks }: { d: WeekDay; now: number; titleById: ReadonlyMap<string, WeekRow>; open: boolean; onMore: () => void; onShowPicks: () => void }) {
  const w = dayWords(d.day);
  const word = offsetWord(d.offset);
  const watches = d.rows.filter(r => r.kind === 'watch');
  const picks = d.rows.filter(r => r.kind === 'pick');
  const names = d.rows.filter(r => r.kind === 'name');
  const yours = d.rows.filter(r => r.kind !== 'name');
  // (Oct 20) watches fold too: a heavy day no longer runs two screens past its
  // neighbours — every row is still one tap away behind "+N more"
  const shownWatches = open ? watches : watches.slice(0, WATCH_ROWS_OPEN);
  const foldedWatches = watches.length - shownWatches.length;
  const shownPicks = open ? picks : picks.slice(0, PICK_ROWS_OPEN);
  const shownNames = open ? names : names.slice(0, NAME_ROWS_OPEN);
  const foldedPicks = picks.length - shownPicks.length;
  const foldedNames = names.length - shownNames.length;
  const folded = foldedWatches + foldedPicks + foldedNames;
  const foldable = watches.length > WATCH_ROWS_OPEN || picks.length > PICK_ROWS_OPEN || names.length > NAME_ROWS_OPEN;
  const foldWords = [foldedWatches ? `${foldedWatches} ${foldedWatches === 1 ? 'watch' : 'watches'}` : null, foldedPicks ? `${foldedPicks} ${foldedPicks === 1 ? 'pick' : 'picks'}` : null, foldedNames ? `${foldedNames} of your names` : null].filter(Boolean).join(', ');
  const dayName = `${w.wd} ${w.md}${word ? ` (${word})` : ''}`;
  const sub = d.rows.length
    ? `${d.yours} yours${d.priced ? ` · ${formatPrice(d.estTotal)} at estimate midpoint${d.priced < d.yours ? ` (${d.priced} of ${d.yours} priced)` : ''}` : ''}${d.names ? ` · ${d.names} of your names` : ''}${d.conflicts ? ` · ${d.conflicts} ${d.conflicts === 1 ? 'overlap' : 'overlaps'}` : ''}`
    : null;
  return (
    <section className="ck-week-day" id={`week-${d.day}`} data-today={d.offset === 0 ? '' : undefined} data-empty={d.rows.length ? undefined : ''} aria-label={dayName}>
      <div className="ck-week-dayhead">
        <div className="ck-week-dayname">
          <b>{w.wd}, {w.md}</b>
          {word && <span className="ck-week-dayword">{word}</span>}
        </div>
        {d.rows.length > 0 ? (
          <div className="ck-week-daysum" title={sub ?? undefined}>
            {d.yours > 0 ? <><b>{d.yours}</b> yours{d.priced > 0 && <span> · {formatPrice(d.estTotal)}</span>}</> : <span>{d.names} of your names</span>}
            {d.yours > 0 && d.names > 0 && <span> · +{d.names} names</span>}
            {d.conflicts > 0 && <span className="ck-week-dayconf"> · {d.conflicts} {d.conflicts === 1 ? 'overlap' : 'overlaps'}</span>}
          </div>
        ) : d.hidden > 0
          ? <div className="ck-week-daysum" data-quiet>{d.hidden} {d.hidden === 1 ? 'pick' : 'picks'} · hidden</div>
          : <div className="ck-week-daysum" data-quiet>—</div>}
        {yours.length > 0 && (
          <button type="button" className="ck-week-act ck-week-daycal" onClick={() => downloadIcs(yours, now, `week ${d.day}`)}
            aria-label={`Add your ${yours.length === 1 ? 'close' : `${yours.length} closes`} on ${w.wd} ${w.md} to your calendar (.ics)`}
            title={`Add your ${yours.length === 1 ? 'close' : `${yours.length} closes`} on ${w.md} to your calendar (.ics)`}><CalIcon /></button>
        )}
      </div>
      {d.rows.length > 0 ? (
        <>
          {(shownWatches.length > 0 || shownPicks.length > 0) && (
            <ul className="ck-week-rows dk-list" aria-label={`Yours on ${w.md}`}>
              {shownWatches.map(r => <Row key={r.lot.id} r={r} now={now} titleById={titleById} />)}
              {shownPicks.map(r => <Row key={r.lot.id} r={r} now={now} titleById={titleById} />)}
            </ul>
          )}
          {shownNames.length > 0 && (
            <>
              {/* the rule names the group, so a name row needs no "Name" tag of its own */}
              <div className="ck-week-namesrule" data-first={yours.length ? undefined : ''}><span className="kicker">Your names</span><i className="ck-reads-rule" /></div>
              <ul className="ck-week-rows dk-list" aria-label={`Your names on ${w.md}`}>
                {shownNames.map(r => <Row key={r.lot.id} r={r} now={now} titleById={titleById} />)}
              </ul>
            </>
          )}
          {foldable && (
            <button type="button" className="ck-today-more ck-week-more" aria-expanded={open} onClick={onMore}>
              {open ? 'Show less' : `+${folded} more (${foldWords})`}
            </button>
          )}
        </>
      ) : d.hidden > 0 ? (
        // (Oct 29) a day whose only rows are picks behind the toggle is not
        // empty — the cockpit's strip draws their bar; say so and offer the toggle
        <p className="ck-week-quiet ck-week-quiet-hidden">
          {d.hidden} {d.hidden === 1 ? 'pick closes' : 'picks close'} {word ?? `on ${w.md}`} · hidden ·{' '}
          <button type="button" className="ck-week-act" onClick={onShowPicks}>Show picks</button>
        </p>
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
  const set = useCallback((v: boolean) => {
    setRemembered(v); storageSet(PICKS_KEY, v ? '1' : '0');
    // the provider mirrors the toggle (DeskInternals.weekPicksShown) for the tab's count
    try { window.dispatchEvent(new CustomEvent(WEEK_PICKS_EVENT, { detail: v })); } catch { /* no window */ }
  }, []);
  return [show, set];
}

export default function WeekSection({ desk }: SectionProps) {
  // (Oct 20 audit) every width reads the week the phone's way: the day chips
  // are the index, one day fills the room — seven 140px columns truncated
  // every title on a desk. The day's cards lay out in a grid on wide screens.
  const narrow = true;
  const plan = useMemo(() => planOf(desk), [desk]);
  const [showPicks, setShowPicks] = useShowPicks(plan);
  const view = useMemo(() => viewOf(plan, { picks: showPicks }), [plan, showPicks]);
  const titleById = useMemo(() => new Map(plan.rows.map(r => [r.lot.id, r])), [plan]);
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
      {/* (Oct 20 clean-up) the week's numbers as a stat strip; the fine print rides one quiet line under it */}
      <span className="ck-week-stats">
        {/* the count of yours IS the tab's headline — the strip starts at the money */}
        {plan.yours === 0 && <span className="ck-week-stat">None of your watches or picks close in the next {WEEK_DAYS} days</span>}
        {plan.priced > 0 && <span className="ck-week-stat"><b>{formatPrice(plan.estTotal)}</b> at estimate midpoint</span>}
        {plan.watches > 0 && <span className="ck-week-stat"><b>{plan.watches}</b> {plan.watches === 1 ? 'watch' : 'watches'}</span>}
        {plan.picks > 0 && <span className="ck-week-stat"><b>{plan.picks}</b> {plan.picks === 1 ? 'pick' : 'picks'}{showPicks ? '' : ' · hidden'}</span>}
        {plan.nameRows > 0 && <span className="ck-week-stat"><b>{plan.nameRows}</b> {plan.nameRows === 1 ? 'sale' : 'sales'} of your names</span>}
        {plan.conflicts > 0 && <span className="ck-week-stat ck-week-dayconf"><b>{plan.conflicts}</b> {plan.conflicts === 1 ? 'overlap' : 'overlaps'}</span>}
      </span>
      <span className="ck-week-fine">
        {[
          plan.priced > 0 && plan.priced < plan.yours ? `${plan.priced} of ${plan.yours} priced` : null,
          plan.nameRows > 0 ? `${plan.names.slice(0, 4).join(', ')}${plan.names.length > 4 ? ` +${plan.names.length - 4}` : ''}` : null,
          plan.beyond > 0 ? `${plan.beyond} more of yours after ${dayWords(plan.dayKeys[WEEK_DAYS - 1]).md}` : null,
        ].filter(Boolean).join(' · ')}
      </span>
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
            close as a 30-minute event with an alarm 30 minutes before, a day-only sale as an all-day event. A row opens its lot;
            keyboard: <b>Tab</b> reaches each title, Bid and Calendar; <b>j</b>/<b>k</b> walk the rows and <b>Enter</b> opens the lot.
          </> }} />
        {narrow && view.rows.length > 0 && (
          <div className="ck-week-chipwrap">
            <div className="ck-week-chips" role="group" aria-label="Days" ref={chips}>
              {view.days.map(d => {
                const w = dayWords(d.day);
                const n = d.rows.length;
                // a chip over hidden picks only: their count, faint (the day card explains)
                return (
                  <button key={d.day} type="button" className="ck-week-chip" aria-pressed={page === d.offset}
                    aria-label={`${w.wd} ${w.md}${n ? `, ${n} ${n === 1 ? 'row' : 'rows'}` : d.hidden ? `, ${d.hidden} ${d.hidden === 1 ? 'pick' : 'picks'} hidden` : ', nothing of yours'}`}
                    data-today={d.offset === 0 ? '' : undefined} data-empty={n ? undefined : ''} onClick={() => scrollToDay(d.day)}>
                    <span className="kicker">{w.wd.slice(0, 2)}</span><b>{w.dayNum}</b>{n > 0 ? <i>{n}</i> : d.hidden > 0 ? <i data-hidden>{d.hidden}</i> : null}
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
              <DayCol key={d.day} d={d} now={desk.now} titleById={titleById}
                open={!!openDays[d.day]} onMore={() => setOpenDays(o => ({ ...o, [d.day]: !o[d.day] }))} onShowPicks={() => setShowPicks(true)} />
            ))}
          </div>
        ) : plan.rows.length > 0 ? (
          <p className="ck-week-quiet ck-week-quiet-view">Your picks are hidden — nothing else of yours hammers in the next {WEEK_DAYS} days.</p>
        ) : null}
      </div>
    </section>
  );
}
