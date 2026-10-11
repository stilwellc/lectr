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
 *
 * A lot claimed by one group never prints in another. Desktop: two columns
 * (closing + new | reads), three rows each; phone: one list, three rows.
 * "+N more today" opens the rest in place — nothing is dropped, only folded.
 * The while-you-were-away facts ride the band's header line.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import type { Rec } from '../lib/recs';
import type { ReturnLoop } from '../components/PickStrips';
import CloseClock from '../components/CloseClock';
import { closeMsOf } from '../lib/priority';
import { closeIsTimed } from '../lib/house-tz';
import { makerLineOf } from '../lib/lot-labels';
import { craftTitle, localToday } from '../utils';
import { formatEstimate } from '../components/LotCard';
import { AwayMark } from '../components/marks';

export interface TodayRead { key: string; tag: string; lot: AuctionLot; fact: React.ReactNode; tone?: 'up' | 'hot' }

type Row = { key: string; group: 'closing' | 'new' | 'reads'; tag: React.ReactNode; tone?: 'up' | 'hot'; lot: AuctionLot; fact: React.ReactNode };

const PER_COL = 3;

const dayWord = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function closeTag(l: AuctionLot): string {
  const c = closeMsOf(l);
  if (c == null) return 'Tonight';
  return closeIsTimed(l) ? new Date(c).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Today';
}

function pickFact(r: Rec<AuctionLot>): string {
  const maker = makerLineOf(r.lot).name;
  const why = r.short || r.reason;
  return why.toLowerCase().includes(maker.toLowerCase()) ? why : `${maker} · ${why}`;
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

function ReadRow({ r }: { r: Row }) {
  return (
    <Link href={`/lot?id=${encodeURIComponent(r.lot.id)}`} className="ck-read" role="listitem" data-nav-row>
      <span className="ck-tag" data-tone={r.tone}>{r.tag}</span>
      <span className="ck-read-title">{craftTitle(r.lot.title, r.lot.auctionHouse)}</span>
      <span className="ck-read-fact">{r.fact}</span>
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

export default function TodayBand({ loop, closingWatches, reads, away }: {
  loop: ReturnLoop | null;
  /** live watches that hammer today, soonest first */
  closingWatches: AuctionLot[];
  reads: TodayRead[];
  /** the while-you-were-away facts (null = nothing happened) */
  away: React.ReactNode | null;
}) {
  const narrow = useNarrow();
  const [all, setAll] = useState(false);
  const { closing, fresh, rest } = useMemo(() => {
    const used = new Set<string>();
    const take = (id: string) => (used.has(id) ? false : (used.add(id), true));
    const closing: Row[] = [];
    for (const l of closingWatches) {
      if (!take(l.id)) continue;
      const est = formatEstimate(l);
      closing.push({
        key: `cw-${l.id}`, group: 'closing', tone: 'hot', lot: l, tag: closeTag(l),
        fact: <>{makerLineOf(l).name} · your watch{est ? <> · {est}</> : null}{l.saleDateTime ? <CloseClock iso={l.saleDateTime} windowHours={24} prefix=" · " /> : null}</>,
      });
    }
    for (const r of loop?.closing ?? []) {
      if (!take(r.lot.id)) continue;
      closing.push({ key: `cp-${r.lot.id}`, group: 'closing', tone: 'hot', lot: r.lot, tag: closeTag(r.lot), fact: pickFact(r) });
    }
    const fresh: Row[] = [];
    for (const r of loop?.fresh ?? []) {
      if (!take(r.lot.id)) continue;
      fresh.push({ key: `n-${r.lot.id}`, group: 'new', lot: r.lot, tag: 'New', fact: pickFact(r) });
    }
    const rest: Row[] = [];
    for (const x of reads) {
      if (!take(x.lot.id)) continue;
      rest.push({ key: x.key, group: 'reads', tone: x.tone, lot: x.lot, tag: x.tag, fact: <>{makerLineOf(x.lot).name} · {x.fact}</> });
    }
    return { closing, fresh, rest };
  }, [loop, closingWatches, reads]);

  const total = closing.length + fresh.length + rest.length;
  if (!total && !away && !loop) return null;

  const since = loop?.since && loop.since < localToday() ? loop.since : null;
  const newLabel = since ? `New since your last visit · ${dayWord(since)}` : 'New today in your picks';
  // the honest empty line for the picks side (never padded)
  const quietPicks = loop && !closing.length && !fresh.length
    ? <p className="ck-today-empty">Nothing new in your picks {since ? `since ${dayWord(since)}` : 'today'}, and none close tonight{loop.nextClose != null ? ` — the next closes ${new Date(loop.nextClose).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}.</p>
    : null;

  // the fold: desktop 3 per column, phone 3 in one list
  let shown: { closing: Row[]; fresh: Row[]; rest: Row[] };
  if (all) shown = { closing, fresh, rest };
  else if (narrow) {
    let left = PER_COL;
    const cut = (xs: Row[]) => { const s = xs.slice(0, Math.max(0, left)); left -= s.length; return s; };
    shown = { closing: cut(closing), fresh: cut(fresh), rest: cut(rest) };
  } else {
    const c = closing.slice(0, PER_COL);
    shown = { closing: c, fresh: fresh.slice(0, PER_COL - c.length), rest: rest.slice(0, PER_COL) };
  }
  const hidden = total - (shown.closing.length + shown.fresh.length + shown.rest.length);
  const leftCol = shown.closing.length + shown.fresh.length > 0 || quietPicks;
  const rightCol = shown.rest.length > 0;

  return (
    <section id="today" className="ck-today rail ray-enter" aria-label="Today">
      <div className="ck-today-head">
        <span className="kicker"><span className="ray-sect-mark" aria-hidden><AwayMark size={14} /></span>Today</span>
        {away && <span className="ck-away-line">{away}</span>}
      </div>
      {(leftCol || rightCol) && (
        <div className="ck-today-cols" data-split={leftCol && rightCol ? 'two' : 'one'}>
          {leftCol && (
            <div>
              {shown.closing.length > 0 && (
                <div className="ck-reads" role="list" aria-label="Closing tonight">
                  <Head label="Closing tonight" />
                  {shown.closing.map(r => <ReadRow key={r.key} r={r} />)}
                </div>
              )}
              {shown.fresh.length > 0 && (
                <div className="ck-reads" role="list" aria-label={newLabel}>
                  <Head label={newLabel} />
                  {shown.fresh.map(r => <ReadRow key={r.key} r={r} />)}
                </div>
              )}
              {quietPicks}
            </div>
          )}
          {rightCol && (
            <div className="ck-reads" role="list" aria-label="Today's reads">
              <Head label="Today’s reads" />
              {shown.rest.map(r => <ReadRow key={r.key} r={r} />)}
            </div>
          )}
        </div>
      )}
      {(hidden > 0 || all) && total > PER_COL && (
        <button type="button" className="ck-today-more" aria-expanded={all} onClick={() => setAll(v => !v)}>
          {all ? 'Show less' : `+${hidden} more today`}
        </button>
      )}
    </section>
  );
}
