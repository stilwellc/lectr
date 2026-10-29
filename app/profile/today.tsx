'use client';
/**
 * THE TODAY BAND (Oct 11 2026, /profile redesign) — "what's new for me",
 * in the desk's one row grammar (desk/row DeskRow: photo · title · the
 * reason · the clock as the figure) and one claim set:
 *
 *   Closing tonight   your watches that hammer today, then picks that close
 *                     before tonight ends (recs.pickStrips)
 *   New since …       picks first seen after your previous visit
 *   Today's reads     the desk's evidence reads (velocity, quiet, landing,
 *                     direct comps, below market) — rows unchanged
 *   Top 3 for you     (Oct 11 follow-up) on a desk whose own watches lead
 *                     the page, the three strongest picks ride here so a
 *                     heavy desk still sees personal picks in its first
 *                     screen; the picks room further down starts after them
 *                     (never the same pick twice on the page)
 *
 * A lot claimed by one group never prints in another. Desktop: two columns
 * (closing + new | reads), three rows each; phone: one list, three rows.
 * "+N more today" opens the rest in place — nothing is dropped, only folded.
 * The while-you-were-away facts ride the band's header line.
 *
 * A row whose engine abstained prints no decision part for it (the band's
 * (?) says what a missing line means) — never "no engine read" on every row.
 *
 * (THE DESK v4, Oct 29 2026) every row is a DeskRow: the figure is the
 * CLOCK — the hour it hammers tonight (the countdown under it), else the day
 * further out; a closing row's tag used to be that hour and is the figure
 * now; the group's tag (Below market · For you · New · a read) leads the
 * meta line; a set My max rides under the clock as the pill.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import type { Rec } from '../lib/recs';
import { nextCloseText, type ReturnLoop } from '../components/PickStrips';
import { closeMsOf } from '../lib/priority';
import { closeIsTimed } from '../lib/house-tz';
import { displayMakerOf } from '../lib/maker-subjects';
import { craftTitle, localToday } from '../utils';
import { formatEstimate, lotSignal } from '../components/LotCard';
import { imageOf } from '../lib/house-images';
import { AwayMark } from '../components/marks';
import DecisionLine from '../components/DecisionLine';
import { RoomHead } from './head';
import { Thumb, SigPill } from './desk/thumb';
import { StoryViewer } from './desk/story';
import { useMyMax, MyMax } from './desk/mymax';
import { DeskRow, CloseFigure, CloseFigureSub } from './desk/row';

export interface TodayRead { key: string; tag: string; lot: AuctionLot; fact: React.ReactNode; tone?: 'up' | 'hot' }

type Row = { key: string; group: 'closing' | 'top' | 'new' | 'reads'; tag: React.ReactNode; tone?: 'up' | 'hot'; lot: AuctionLot; fact: React.ReactNode;
  /** (N2) the pick's decision line — projected close · worth up to · gap */
  decision?: React.ReactNode };

const PER_COL = 3;
/** your own watches closing tonight never fold behind picks — up to this
 *  many show (Oct 20; THE DESK v4: three, so results + closing + Top 3 fit
 *  one desktop screen — the rest ride "+N more today") */
const CLOSING_OPEN = 3;
/** the picks strip's size */
export const TOP_N = 3;

/** the strongest picks not already claimed by the band's Closing tonight
 *  (a pick closing tonight prints there, under its close) */
export function topPicksOf<R extends { lot: { id: string } }>(recs: readonly R[], claimed: ReadonlySet<string>, n = TOP_N): R[] {
  const out: R[] = [];
  for (const r of recs) {
    if (out.length >= n) break;
    if (!claimed.has(r.lot.id)) out.push(r);
  }
  return out;
}

const dayWord = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function closeTag(l: AuctionLot): string {
  const c = closeMsOf(l);
  if (c == null) return 'Tonight';
  return closeIsTimed(l) ? new Date(c).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Time TBC';   // (Oct 20 audit) every row here closes today — the tag says WHEN, or that the house gave no hour
}

/** every row's fact starts with WHO (one grammar across the band): the
 *  maker or the lot's subject — a pseudo-maker bucket is left out, never
 *  printed as a name (maker-subjects.displayMakerOf) */
const whoOf = (l: AuctionLot): string | null => displayMakerOf(l)?.name ?? null;
const lead = (l: AuctionLot, rest: React.ReactNode): React.ReactNode => {
  const who = whoOf(l);
  // a reason that already names the maker ("Same maker · you own Patek
  // Philippe") is not prefixed with it a second time
  // a price band never breaks at its dash ("$25K–" / "50K" at 1440)
  if (typeof rest === 'string') rest = rest.replace(/(\$[\d.,]+[KMB]?)–(\$?[\d.,]+[KMB]?)/g, '$1\u2060–\u2060$2');
  if (who && typeof rest === 'string') {
    // "Like your Andy Warhol prints" over an untitled-looking lot ("Van
    // Heusen (Ronald Reagan)…") hid that the lot IS a Warhol: WHO leads,
    // the reason keeps what is shared ("Andy Warhol · Like your prints")
    const esc = who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const yours = new RegExp(`\\byour ${esc}\\b\\s*`, 'i');
    // (only when something follows the name — "Like your Charizard" stays whole)
    const m = rest.match(yours);
    if (m && /^\s*[a-z]/i.test(rest.slice(m.index! + m[0].length))) return <>{who} · {rest.replace(yours, 'your ')}</>;
    if (rest.toLowerCase().includes(who.toLowerCase())) return rest;
  }
  return who ? <>{who} · {rest}</> : rest;
};

function pickFact(r: Rec<AuctionLot>): React.ReactNode {
  return lead(r.lot, r.short || r.reason);
}

function useNarrow(): boolean {
  const [n, setN] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899.98px)');
    const on = () => setN(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return n;
}

/* (W19) every row's fact wraps — the reason / the read is the row's
   honesty payload and was cut mid-word at 1440 ("Patek Philippe · Same
   maker · you…", "Michael Jordan · 8 sales,…"); the title keeps its one line */
function ReadRow({ r, wrap = true }: { r: Row; wrap?: boolean }) {
  const max = useMyMax(r.lot.id);
  const closing = r.group === 'closing';
  return (
    <DeskRow lot={r.lot} wrap={wrap} sub={r.fact} decision={r.decision}
      // a pick in the strip is a pick (the retention tracker's pick_open)
      pick={r.group === 'top' ? r.lot.id : undefined}
      tone={r.tone === 'up' ? 'up' : undefined}
      // a closing row's tag IS its clock — the figure prints it; the engine's
      // read (the same one the story ring wears) is the only tag it carries
      tag={closing ? (r.tone === 'up' ? { text: 'Below market', tone: 'up' } : null) : { text: r.tag, tone: r.tone }}
      figure={<CloseFigure lot={r.lot} />} figureKind="clock" figureSub={<CloseFigureSub lot={r.lot} />}
      // the reader's ceiling, set or passed (MyMax says "bid passed it"), under the clock
      pill={max != null ? <MyMax lot={r.lot} compact /> : undefined}
      attrs={{ 'data-decision': r.decision ? '' : undefined }} />
  );
}

/** TONIGHT — the story strip: every lot of yours that hammers tonight as a
 *  round photo, its clock under it; a green ring is a lot the ENGINE reads
 *  under the market (lotSignal / a flagged pick — the same read the row's
 *  "Below market" tag wears), ink otherwise. One glance before the rows
 *  (Oct 20 photo pass). */
function Tonight({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (rows.length < 2) return null;
  const stories = rows.map(r => ({ lot: r.lot, when: r.tag, pill: r.tone === 'up' ? <SigPill dir="up">Below market</SigPill> : undefined }));
  return (
    <>
    {open != null && <StoryViewer stories={stories} start={open} onClose={() => setOpen(null)} />}
    <div className="ck-tonight" role="group" aria-label="Hammers tonight">
      {rows.map((r, n) => {
        const maker = displayMakerOf(r.lot)?.name;
        return (
          <Link key={r.key} href={`/lot?id=${encodeURIComponent(r.lot.id)}`} className="ck-story"
            // a plain tap opens the story; ⌘/ctrl-click keeps the link
            onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); setOpen(n); }}
            aria-label={`${craftTitle(r.lot.title, r.lot.auctionHouse)}${maker ? `, ${maker}` : ''}`}>
            <Thumb src={imageOf(r.lot)} label={maker || r.lot.title} size={68} round tone={r.tone === 'up' ? 'up' : 'ink'} />
            <span className="ck-story-t">{r.tag}</span>
            {maker && <span className="ck-story-m">{maker}</span>}
          </Link>
        );
      })}
    </div>
    </>
  );
}

function Head({ label }: { label: string }) {
  return (
    <div className="ck-reads-head">
      <span className="kicker">{label}</span>
      <i className="ck-reads-rule" />
    </div>
  );
}

/** the picks strip's seat while the deal is pending: its head and three
 *  rows in the shape of what lands (tag · title · reason, decision line
 *  under), so nothing below jumps when the picks arrive */
function TopSeat() {
  return (
    <div className="ck-reads" aria-hidden data-loading="">
      <Head label={`Top ${TOP_N} for you`} />
      <div className="dk-list">
        {Array.from({ length: TOP_N }, (_, i) => (
          <div key={i} className="dk-item">
            <div className="dk-row">
              <i className="ray-sk" style={{ width: 'var(--dk-th)', height: 'var(--dk-th)', borderRadius: 12 }} />
              <div className="dk-main" style={{ gap: 8 }}>
                <i className="ray-sk" style={{ width: '48%', height: 13 }} />
                <i className="ray-sk" style={{ width: '70%', height: 11 }} />
              </div>
              <div className="dk-right"><i className="ray-sk" style={{ width: 44, height: 13 }} /></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TodayBand({ loop, closingWatches, reads, away, top = [], topLoading = false, phoneRows = PER_COL, picksN = 0, results }: {
  loop: ReturnLoop | null;
  /** live watches that hammer today, soonest first */
  closingWatches: AuctionLot[];
  reads: TodayRead[];
  /** the while-you-were-away facts (null = nothing happened) */
  away: React.ReactNode | null;
  /** the picks strip (topPicksOf) — empty: no strip */
  top?: readonly Rec<AuctionLot>[];
  /** the picks strip is coming (the deal is pending): hold its seat */
  topLoading?: boolean;
  /** rows a phone opens on (a desk with live watches opens on 2, so its
   *  own Watching room starts in the first screen) */
  phoneRows?: number;
  /** results to confirm (Did you win?) — rides under the Tonight strip */
  results?: React.ReactNode;
  /** the picks dealt right now — a first visit (no "since") with none
   *  closing tonight says what landed, not "nothing new" (R3#9) */
  picksN?: number;
}) {
  const narrow = useNarrow();
  const [all, setAll] = useState(false);
  const { closing, picks, fresh, rest } = useMemo(() => {
    const used = new Set<string>();
    const take = (id: string) => (used.has(id) ? false : (used.add(id), true));
    const closing: Row[] = [];
    for (const l of closingWatches) {
      if (!take(l.id)) continue;
      const est = formatEstimate(l);
      // (pass 4) the ring and the tag read the engine: green only under the market
      const below = lotSignal(l)?.label === 'Below Market';
      closing.push({
        key: `cw-${l.id}`, group: 'closing', tone: below ? 'up' : 'hot', lot: l, tag: closeTag(l),
        // the fact prints the estimate; the figure prints the close (the hour, the countdown): the line adds the rest
        decision: <DecisionLine lot={l} estimate={false} when={false} abstain="quiet" style={{ marginTop: 0 }} />,
        fact: lead(l, <>your watch{est ? <> · {est}</> : null}</>),
      });
    }
    for (const r of loop?.closing ?? []) {
      if (!take(r.lot.id)) continue;
      closing.push({ key: `cp-${r.lot.id}`, group: 'closing', tone: r.flagged ? 'up' : 'hot', lot: r.lot, tag: closeTag(r.lot), fact: pickFact(r),
        decision: <DecisionLine lot={r.lot} when={false} abstain="quiet" style={{ marginTop: 0 }} /> });
    }
    const picks: Row[] = [];
    for (const r of top) {
      if (!take(r.lot.id)) continue;
      picks.push({ key: `t-${r.lot.id}`, group: 'top', lot: r.lot, tone: r.flagged ? 'up' : undefined,
        tag: r.flagged ? 'Below market' : 'For you', fact: pickFact(r),
        decision: <DecisionLine lot={r.lot} abstain="quiet" style={{ marginTop: 0 }} /> });
    }
    const fresh: Row[] = [];
    for (const r of loop?.fresh ?? []) {
      if (!take(r.lot.id)) continue;
      fresh.push({ key: `n-${r.lot.id}`, group: 'new', lot: r.lot, tag: 'New', fact: pickFact(r),
        decision: <DecisionLine lot={r.lot} abstain="quiet" style={{ marginTop: 0 }} /> });
    }
    const rest: Row[] = [];
    for (const x of reads) {
      if (!take(x.lot.id)) continue;
      rest.push({ key: x.key, group: 'reads', tone: x.tone, lot: x.lot, tag: x.tag, fact: lead(x.lot, x.fact) });
    }
    return { closing, picks, fresh, rest };
  }, [loop, closingWatches, reads, top]);

  // the picks strip is never folded (it is why the band carries it) and
  // never counted in "+N more today"
  const total = closing.length + fresh.length + rest.length;
  if (!total && !picks.length && !away && !loop && !topLoading) return null;

  const since = loop?.since && loop.since < localToday() ? loop.since : null;
  const newLabel = since ? `New since your last visit · ${dayWord(since)}` : 'New today in your picks';
  // the honest empty line for the picks side (never padded)
  const quietPicks = loop && !closing.length && !fresh.length
    ? <p className="ck-today-empty">
        {!since && picksN > 0
          ? <>{picksN} {picksN === 1 ? 'pick' : 'picks'} landed in <a href="#for-you" className="ck-away-link">For you</a> · none close tonight{nextCloseText(loop).replace(' — the next closes', ' · the next closes')}.</>
          : <>Nothing new in your picks {since ? `since ${dayWord(since)}` : 'today'}, and none close tonight{nextCloseText(loop)}.</>}
      </p>
    : null;

  // the fold: desktop 3 per column, phone 3 in one list
  let shown: { closing: Row[]; fresh: Row[]; rest: Row[] };
  if (all) shown = { closing, fresh, rest };
  else if (narrow) {
    // your own closes lead whole; the phone budget folds what comes after them
    const c = closing.slice(0, CLOSING_OPEN);
    let left = Math.max(0, phoneRows - c.length);
    const cut = (xs: Row[]) => { const s = xs.slice(0, Math.max(0, left)); left -= s.length; return s; };
    shown = { closing: c, fresh: cut(fresh), rest: cut(rest) };
  } else {
    const c = closing.slice(0, CLOSING_OPEN);
    // (pass 3) beside the picks strip the left column opens on PER_COL rows in
    // all — closing first, then new, then reads — so Closing tonight and Top 3
    // sit side by side as three rows each and the rest ride "+N more today";
    // with no picks strip the reads keep their own column
    const f = fresh.slice(0, Math.max(0, PER_COL - c.length));
    shown = { closing: c, fresh: f, rest: rest.slice(0, picks.length ? Math.max(0, PER_COL - c.length - f.length) : PER_COL) };
  }
  const hidden = total - (shown.closing.length + shown.fresh.length + shown.rest.length);
  const picksLabel = `Top ${picks.length} for you`;
  const picksList = picks.length > 0 ? (
    <div className="ck-reads" role="group" aria-label={picksLabel}>
      <Head label={picksLabel} />
      <div className="dk-list">{picks.map(r => <ReadRow key={r.key} r={r} wrap />)}</div>
    </div>
  ) : topLoading ? <TopSeat /> : null;
  const closingList = shown.closing.length > 0 ? (
    <div className="ck-reads" role="group" aria-label="Closing tonight">
      <Head label="Closing tonight" />
      <div className="dk-list">{shown.closing.map(r => <ReadRow key={r.key} r={r} />)}</div>
    </div>
  ) : null;
  const freshList = shown.fresh.length > 0 ? (
    <div className="ck-reads" role="group" aria-label={newLabel}>
      <Head label={newLabel} />
      <div className="dk-list">{shown.fresh.map(r => <ReadRow key={r.key} r={r} />)}</div>
    </div>
  ) : null;
  const readsList = shown.rest.length > 0 ? (
    <div className="ck-reads" role="group" aria-label="Today's reads">
      <Head label="Today’s reads" />
      <div className="dk-list">{shown.rest.map(r => <ReadRow key={r.key} r={r} />)}</div>
    </div>
  ) : null;
  // the columns: a phone reads one list (closing → top picks → new →
  // reads); a desk with the picks strip gives it the right column and
  // stacks the band's own groups on the left; otherwise closing + new left,
  // reads right
  const left: React.ReactNode[] = [];
  const right: React.ReactNode[] = [];
  if (narrow) left.push(closingList, picksList, freshList, quietPicks, readsList);
  // (pass 3) nothing closing: the picks take the full width as three rows, the rest under them
  else if (picksList && !closingList) left.push(picksList, freshList, quietPicks, readsList);
  else if (picksList) { left.push(closingList, freshList, quietPicks, readsList); right.push(picksList); }
  else { left.push(closingList, freshList, quietPicks); right.push(readsList); }
  const leftCol = left.some(Boolean);
  const rightCol = right.some(Boolean);
  // (W19) two columns: "+N more" closes the column it unfolds (the left one
  // is the shorter), not a line under both — the band ends with its tallest column
  const twoCol = !narrow && leftCol && rightCol;
  const more = (hidden > 0 || all) && total > (narrow ? phoneRows : PER_COL) ? (
    <button type="button" className="ck-today-more" aria-expanded={all} onClick={() => setAll(v => !v)}>
      {all ? 'Show less' : `+${hidden} more today`}
    </button>
  ) : null;

  return (
    <section id="today" className="ck-today ray-saved-section rail ray-enter" aria-label="Today">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
      {/* (R5#8) the same head every room opens with — mark, title, (?), the
          while-you-were-away facts as the figure line */}
      <RoomHead className="ck-today-head" mark={<AwayMark size={17} />} title="Today"
        help={{ name: 'Today', body: <>
          What is new for you today, in one list. <b>Closing tonight</b>: your watches that hammer today, then picks
          that close before tonight ends. {picks.length > 0 && <><b>Top {picks.length} for you</b>: the strongest of your
          picks — the full list follows under Lots you may like, starting after these. </>}<b>New since your last
          visit</b>: picks first seen after you were last here. <b>Today&rsquo;s reads</b>: what the desk&rsquo;s evidence
          says about your lots today. Under a row, <b>worth up to</b> is the engine&rsquo;s max bid and the gap to the
          projected close beside it; a row with no such line is one the engine abstained on (too little like it has
          sold) or could not price — no value is implied, high or low. A lot prints in one group only.
        </> }}
        sub={away ? <span className="ck-away-line">{away}</span> : null} />
      <Tonight rows={closing} />
      {results}
      {(leftCol || rightCol) && (
        <div className="ck-today-cols" data-split={leftCol && rightCol ? 'two' : 'one'}>
          {leftCol && <div>{left.map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>)}{twoCol && more}</div>}
          {rightCol && <div>{right.map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>)}</div>}
        </div>
      )}
      {!twoCol && more}
      </div>
    </section>
  );
}
