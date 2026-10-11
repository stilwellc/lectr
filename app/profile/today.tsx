'use client';
/**
 * THE TODAY BAND (Oct 11 2026, /profile redesign) — "what's new for me",
 * in one row grammar (ck-read: tag · work · fact) and one claim set:
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
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import type { Rec } from '../lib/recs';
import { nextCloseText, type ReturnLoop } from '../components/PickStrips';
import CloseClock from '../components/CloseClock';
import { closeMsOf } from '../lib/priority';
import { closeIsTimed } from '../lib/house-tz';
import { displayMakerOf } from '../lib/maker-subjects';
import { craftTitle, localToday } from '../utils';
import { formatEstimate } from '../components/LotCard';
import { AwayMark } from '../components/marks';
import DecisionLine from '../components/DecisionLine';
import { HelpChip } from './help';

export interface TodayRead { key: string; tag: string; lot: AuctionLot; fact: React.ReactNode; tone?: 'up' | 'hot' }

type Row = { key: string; group: 'closing' | 'top' | 'new' | 'reads'; tag: React.ReactNode; tone?: 'up' | 'hot'; lot: AuctionLot; fact: React.ReactNode;
  /** (N2) the pick's decision line — projected close · worth up to · gap */
  decision?: React.ReactNode };

const PER_COL = 3;
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
  return closeIsTimed(l) ? new Date(c).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Today';
}

/** every row's fact starts with WHO (one grammar across the band): the
 *  maker or the lot's subject — a pseudo-maker bucket is left out, never
 *  printed as a name (maker-subjects.displayMakerOf) */
const whoOf = (l: AuctionLot): string | null => displayMakerOf(l)?.name ?? null;
const lead = (l: AuctionLot, rest: React.ReactNode): React.ReactNode => {
  const who = whoOf(l);
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

function ReadRow({ r, wrap = false }: { r: Row; wrap?: boolean }) {
  return (
    <Link href={`/lot?id=${encodeURIComponent(r.lot.id)}`} className="ck-read" role="listitem" data-nav-row
      data-decision={r.decision ? '' : undefined}
      // a pick in the strip is a pick (the retention tracker's pick_open)
      data-pick={r.group === 'top' ? r.lot.id : undefined}>
      <span className="ck-tag" data-tone={r.tone}>{r.tag}</span>
      <span className="ck-read-title">{craftTitle(r.lot.title, r.lot.auctionHouse)}</span>
      {/* a pick's reason is its honesty payload: in the picks strip it wraps,
          never cut */}
      <span className="ck-read-fact" style={wrap ? { whiteSpace: 'normal' } : undefined}>{r.fact}</span>
      {/* the decision rides its own line under the row — the fact (the
          reason) keeps its width and is never cut for it */}
      {r.decision && <span style={{ flex: '1 1 100%', minWidth: 0 }}>{r.decision}</span>}
    </Link>
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

export default function TodayBand({ loop, closingWatches, reads, away, top = [], phoneRows = PER_COL }: {
  loop: ReturnLoop | null;
  /** live watches that hammer today, soonest first */
  closingWatches: AuctionLot[];
  reads: TodayRead[];
  /** the while-you-were-away facts (null = nothing happened) */
  away: React.ReactNode | null;
  /** the picks strip (topPicksOf) — empty: no strip */
  top?: readonly Rec<AuctionLot>[];
  /** rows a phone opens on (a desk with live watches opens on 2, so its
   *  own Watching room starts in the first screen) */
  phoneRows?: number;
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
      closing.push({
        key: `cw-${l.id}`, group: 'closing', tone: 'hot', lot: l, tag: closeTag(l),
        // the fact prints the estimate and the tag the close: the line adds the rest
        decision: <DecisionLine lot={l} estimate={false} when={false} abstain="quiet" style={{ marginTop: 0 }} />,
        fact: lead(l, <>your watch{est ? <> · {est}</> : null}{l.saleDateTime ? <CloseClock iso={l.saleDateTime} windowHours={24} prefix=" · " /> : null}</>),
      });
    }
    for (const r of loop?.closing ?? []) {
      if (!take(r.lot.id)) continue;
      closing.push({ key: `cp-${r.lot.id}`, group: 'closing', tone: 'hot', lot: r.lot, tag: closeTag(r.lot), fact: pickFact(r),
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
  if (!total && !picks.length && !away && !loop) return null;

  const since = loop?.since && loop.since < localToday() ? loop.since : null;
  const newLabel = since ? `New since your last visit · ${dayWord(since)}` : 'New today in your picks';
  // the honest empty line for the picks side (never padded)
  const quietPicks = loop && !closing.length && !fresh.length
    ? <p className="ck-today-empty">Nothing new in your picks {since ? `since ${dayWord(since)}` : 'today'}, and none close tonight{nextCloseText(loop)}.</p>
    : null;

  // the fold: desktop 3 per column, phone 3 in one list
  let shown: { closing: Row[]; fresh: Row[]; rest: Row[] };
  if (all) shown = { closing, fresh, rest };
  else if (narrow) {
    let left = phoneRows;
    const cut = (xs: Row[]) => { const s = xs.slice(0, Math.max(0, left)); left -= s.length; return s; };
    shown = { closing: cut(closing), fresh: cut(fresh), rest: cut(rest) };
  } else {
    const c = closing.slice(0, PER_COL);
    shown = { closing: c, fresh: fresh.slice(0, PER_COL - c.length), rest: rest.slice(0, PER_COL) };
  }
  const hidden = total - (shown.closing.length + shown.fresh.length + shown.rest.length);
  const picksLabel = `Top ${picks.length} for you`;
  const picksList = picks.length > 0 ? (
    <div className="ck-reads" role="list" aria-label={picksLabel}>
      <Head label={picksLabel} />
      {picks.map(r => <ReadRow key={r.key} r={r} wrap />)}
    </div>
  ) : null;
  const closingList = shown.closing.length > 0 ? (
    <div className="ck-reads" role="list" aria-label="Closing tonight">
      <Head label="Closing tonight" />
      {shown.closing.map(r => <ReadRow key={r.key} r={r} />)}
    </div>
  ) : null;
  const freshList = shown.fresh.length > 0 ? (
    <div className="ck-reads" role="list" aria-label={newLabel}>
      <Head label={newLabel} />
      {shown.fresh.map(r => <ReadRow key={r.key} r={r} />)}
    </div>
  ) : null;
  const readsList = shown.rest.length > 0 ? (
    <div className="ck-reads" role="list" aria-label="Today's reads">
      <Head label="Today’s reads" />
      {shown.rest.map(r => <ReadRow key={r.key} r={r} />)}
    </div>
  ) : null;
  // the columns: a phone reads one list (closing → top picks → new →
  // reads); a desk with the picks strip gives it the right column and
  // stacks the band's own groups on the left; otherwise closing + new left,
  // reads right
  const left: React.ReactNode[] = [];
  const right: React.ReactNode[] = [];
  if (narrow) left.push(closingList, picksList, freshList, quietPicks, readsList);
  else if (picksList) { left.push(closingList, freshList, quietPicks, readsList); right.push(picksList); }
  else { left.push(closingList, freshList, quietPicks); right.push(readsList); }
  const leftCol = left.some(Boolean);
  const rightCol = right.some(Boolean);

  return (
    <section id="today" className="ck-today rail ray-enter" aria-label="Today">
      <div className="ck-today-head">
        <span className="kicker"><span className="ray-sect-mark" aria-hidden><AwayMark size={14} /></span>Today</span>
        {/* the strip opens on its own full line after the away facts */}
        <HelpChip name="Today" stripStyle={{ flex: '1 1 100%', order: 9 }}>
          What is new for you today, in one list. <b>Closing tonight</b>: your watches that hammer today, then picks
          that close before tonight ends. {picks.length > 0 && <><b>Top {picks.length} for you</b>: the strongest of your
          picks — the full list follows under Lots you may like, starting after these. </>}<b>New since your last
          visit</b>: picks first seen after you were last here. <b>Today&rsquo;s reads</b>: what the desk&rsquo;s evidence
          says about your lots today. Under a row, <b>worth up to</b> is the engine&rsquo;s max bid and the gap to the
          projected close beside it; a row with no such line is one the engine abstained on (too little like it has
          sold) or could not price — no value is implied, high or low. A lot prints in one group only.
        </HelpChip>
        {away && <span className="ck-away-line">{away}</span>}
      </div>
      {(leftCol || rightCol) && (
        <div className="ck-today-cols" data-split={leftCol && rightCol ? 'two' : 'one'}>
          {leftCol && <div>{left.map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>)}</div>}
          {rightCol && <div>{right.map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>)}</div>}
        </div>
      )}
      {(hidden > 0 || all) && total > (narrow ? phoneRows : PER_COL) && (
        <button type="button" className="ck-today-more" aria-expanded={all} onClick={() => setAll(v => !v)}>
          {all ? 'Show less' : `+${hidden} more today`}
        </button>
      )}
    </section>
  );
}
