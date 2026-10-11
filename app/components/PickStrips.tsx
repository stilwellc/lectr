'use client';
/**
 * PickStrips — THE RETURN LOOP (Oct 11 2026). Two compact strips cut from
 * the reader's own picks (app/lib/recs.pickStrips), in-product only — no
 * email, ever:
 *
 *   NewSincePicks         picks first seen after the reader's previous visit
 *                         (useLastVisit + firstSeen; a house's onboarding
 *                         flood is not "new" — feed-filters.isNewLot)
 *   ClosingTonightPicks   picks whose sale closes before tonight ends
 *
 * One component per strip, so a page can place them where it wants (the
 * profile's For-you room and home's For-you tab both stack them above the
 * picks). Rows are the "Today's reads" strip rows (ck-reads / ck-read): tag,
 * work, maker · the pick's own reason. An empty strip says so in one line —
 * never padded with lots that are not new or not closing.
 */
import Link from 'next/link';
import { useMemo } from 'react';
import { recommend, pickStrips, tonightEndMs, type Rec, type RecLot, type Taste } from '../lib/recs';
import { isNewLot, type HouseBaselines } from '../lib/feed-filters';
import { closeMsOf } from '../lib/priority';
import { closeIsTimed } from '../lib/house-tz';
import { closeWhenText } from '../lib/close-time';
import { makerLineOf } from '../lib/lot-labels';
import { craftTitle, localToday } from '../utils';
import type { AuctionLot } from '../types';

/** how deep the strips read into the picks (past the visible deal) */
const STRIP_DEPTH = 60;

export interface ReturnLoop {
  fresh: Rec<AuctionLot>[];
  closing: Rec<AuctionLot>[];
  /** the reader's previous visit day (null = first visit: "new today") */
  since: string | null;
  /** the soonest close among the picks after tonight (the closing strip's empty line) */
  nextClose: number | null;
  /** that close carries a real clock time (else a date-only sale day) */
  nextCloseTimed?: boolean;
  /** when the loop was cut (the wording of nextClose is relative to it) */
  at?: number;
}

/** "the next closes tomorrow at 9 PM" — the reader's own calendar words
 *  (app/lib/close-time), never a bare date that turns out to be today */
export function nextCloseText(loop: Pick<ReturnLoop, 'nextClose' | 'nextCloseTimed' | 'at'>): string {
  return loop.nextClose != null ? ` — the next closes ${closeWhenText(loop.nextClose, loop.at ?? Date.now(), loop.nextCloseTimed ?? false)}` : '';
}

/** the two strips for one taste over one pool (the pool the picks read) */
export function useReturnLoop(pool: readonly AuctionLot[], taste: Taste | null, opts: { ready?: boolean; prevVisitDay: string | null; baselines?: HouseBaselines | null }): ReturnLoop | null {
  const { ready = true, prevVisitDay, baselines } = opts;
  return useMemo(() => {
    if (!ready || !taste || !taste.seeds.length) return null;
    const now = Date.now();
    const deep = recommend(pool, taste, { nowMs: now, n: STRIP_DEPTH });
    if (!deep.length) return null;
    const today = localToday();
    const by = tonightEndMs(now);
    const s = pickStrips(deep, { nowMs: now, closesBy: by, isNew: l => isNewLot(l, { today, prevVisitDay, baselines }) });
    let nextClose: number | null = null, nextCloseTimed = false;
    for (const r of deep) {
      const c = closeMsOf(r.lot);
      if (c != null && c > by && (nextClose == null || c < nextClose)) { nextClose = c; nextCloseTimed = closeIsTimed(r.lot); }
    }
    return { ...s, since: prevVisitDay, nextClose, nextCloseTimed, at: now };
  }, [pool, taste, ready, prevVisitDay, baselines]);
}

const dayWord = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function StripHead({ label }: { label: string }) {
  return (
    <div className="ck-reads-head">
      <span className="kicker">{label}</span>
      <i className="ck-reads-rule" />
    </div>
  );
}

function StripRow({ r, tag, tone }: { r: Rec<RecLot>; tag: string; tone?: 'hot' | 'up' }) {
  const l = r.lot as AuctionLot;
  const maker = makerLineOf(l).name;
  const why = r.short || r.reason;
  // the reason usually names the maker already ("Like your Andy Warhol prints")
  const fact = why.toLowerCase().includes(maker.toLowerCase()) ? why : `${maker} · ${why}`;
  return (
    <Link href={`/lot?id=${encodeURIComponent(l.id)}`} className="ck-read" role="listitem" data-nav-row>
      <span className="ck-tag" data-tone={tone}>{tag}</span>
      <span className="ck-read-title">{craftTitle(l.title, l.auctionHouse)}</span>
      <span className="ck-read-fact">{fact}</span>
    </Link>
  );
}

const emptyStyle = { fontSize: 12.5, color: 'var(--color-text-muted)', margin: 0, padding: '10px 2px' } as const;

/** "New since your last visit" — picks first seen after the previous visit */
export function NewSincePicks({ loop, max = 3 }: { loop: ReturnLoop; max?: number }) {
  const label = loop.since && loop.since < localToday() ? `New since your last visit · ${dayWord(loop.since)}` : 'New today in your picks';
  return (
    <div className="ck-reads" role="list" aria-label={label}>
      <StripHead label={label} />
      {loop.fresh.length
        ? loop.fresh.slice(0, max).map(r => <StripRow key={r.lot.id} r={r} tag="New" />)
        : <p style={emptyStyle}>Nothing new in your picks {loop.since && loop.since < localToday() ? `since ${dayWord(loop.since)}` : 'today'} — new lots land with every crawl.</p>}
    </div>
  );
}

const closeTag = (l: AuctionLot) => {
  const c = closeMsOf(l);
  if (c == null) return 'Tonight';
  return closeIsTimed(l)
    ? new Date(c).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : 'Today';
};

/** "Closing tonight from your picks" — soonest first */
export function ClosingTonightPicks({ loop, max = 3 }: { loop: ReturnLoop; max?: number }) {
  return (
    <div className="ck-reads" role="list" aria-label="Closing tonight from your picks">
      <StripHead label="Closing tonight from your picks" />
      {loop.closing.length
        ? loop.closing.slice(0, max).map(r => <StripRow key={r.lot.id} r={r} tag={closeTag(r.lot)} tone="hot" />)
        : <p style={emptyStyle}>None of your picks close tonight{nextCloseText(loop)}.</p>}
    </div>
  );
}
