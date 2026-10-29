'use client';
/**
 * THE DESK ROW (THE DESK v4, Oct 29 2026) — one row grammar for every lot
 * the desk prints. Watching was a seven-column ledger, Today a tag · work ·
 * fact line, Your week its own soft cards: three designs for the same
 * object. "Think Robinhood — tons of data but easy to use and simple
 * beauty": every room now prints the SAME row, and only the figure on the
 * right changes with the room's question.
 *
 *   [photo]  Title — one line, ellipsis                        FIGURE
 *            maker · house · estimate (the sub-line)           figure sub
 *            [tag] meta facts (signal, Δ saved, overlap…)      [My max]
 *            projected close · worth up to · gap   (the decision line)
 *            ─ expansion (a watch's dossier) under the row ─
 *
 *   figure   the ONE number that answers the room: Watching = the live bid
 *            or the estimate (My max under it); Your week = the close
 *            clock; Today = the clock; For you / Budget = the estimate or
 *            the plan figure; Collection / Portfolio = the mark with its
 *            measured delta; History / Your calls = the hammer.
 *   action   one inline slot (I won it · Remove · Bid ↗ · Watch · Details ›).
 *
 * (pass 2) a row needs only a RowLot — id, title, house, photo — so an
 * archived save, a graded call or a pick's snapshot prints in the same
 * grammar as a live AuctionLot; `href` points a row somewhere other than
 * its lot (a name's page), `below` hangs an editor under the row.
 *
 * THE WHOLE ROW IS THE LINK to /lot?id= — the title is the <a>, stretched
 * over the row with a pseudo-element, so the DOM never nests a button in a
 * link (R5#2): every control (My max, Details, the action) sits above the
 * stretched link and keeps its own tap target (≥ 44px on a phone).
 *
 * INPUT CRAFT: the row is [data-nav-row]; j/k (../keys) focuses its
 * [data-nav-focus] control — the title link (Enter opens the lot) or, on an
 * expanding row, the Details button (Enter opens the dossier, as the ledger
 * always did). The focus ring draws on the row (.dk-row:has(:focus-visible)).
 *
 * Styles: ../styles/row.css (imported by the profile layout).
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../../types';
import { craftTitle, closeDayOf } from '../../utils';
import { closeMsOf } from '../../lib/priority';
import { closeIsTimed } from '../../lib/house-tz';
import { displayMakerOf } from '../../lib/maker-subjects';
import { formatEstimate } from '../../lib/estimate-text';
import { fromText } from './priced';
import { Thumb } from './thumb';
import { closeDays, hammerWord } from './derive';

export type RowTone = 'up' | 'down' | 'hot';

/** the least a row needs — a live AuctionLot, an archived save, a graded call's snapshot */
export type RowLot = { id: string; title: string; auctionHouse?: string | null; imageUrl?: string | null };

/** the maker / subject a RowLot files under (null for a snapshot that names none) */
export const rowWhoOf = (lot: RowLot): string | null => {
  try { return displayMakerOf(lot as unknown as AuctionLot)?.name ?? null; } catch { return null; }
};

export interface DeskRowProps {
  lot: RowLot;
  /** where the row goes (default: the lot's page) */
  href?: string;
  /** the photo's fallback letter comes from this (default: the maker, else the title) */
  who?: string | null;
  /** the title (default: craftTitle — the house's noise trimmed) */
  title?: string;
  /** the sub-line (default: maker · house · estimate — rowSubOf) */
  sub?: React.ReactNode;
  /** the sub-line wraps (a pick's reason is its honesty payload, never cut); default: one line, ellipsis */
  wrap?: boolean;
  /** the small pill leading the meta line: why-now, the kind, the read */
  tag?: { text: React.ReactNode; tone?: RowTone } | null;
  /** facts after the tag on the meta line (the signal pill, Δ saved, an overlap) */
  meta?: React.ReactNode;
  /** the one figure, top right */
  figure?: React.ReactNode;
  /** the small line under the figure (bids, a countdown) */
  figureSub?: React.ReactNode;
  /** the pill under the figure (My max) */
  pill?: React.ReactNode;
  /** the decision / engine read (DecisionLine) — its own line */
  decision?: React.ReactNode;
  /** one inline action slot (I won it · Remove · Bid ↗) */
  action?: React.ReactNode;
  /** the photo's ring — the market's own ink, nothing else (thumb.tsx) */
  tone?: 'up' | 'down' | 'ink';
  /** an expanding row: the Details › control and what opens under the row (children) */
  expand?: { open: boolean; id: string; onToggle: () => void };
  /** the lot id a pick row carries (the retention tracker's pick_open) */
  pick?: string;
  /** the outer element — <li> inside a list */
  as?: 'div' | 'li';
  /** data-* / aria-* hooks for the outer element (data-flip-id, data-kind…) */
  attrs?: Record<string, string | number | undefined>;
  className?: string;
  /** the expansion (a dossier) — rendered under the row while expand.open */
  children?: React.ReactNode;
  /** always under the row, inside the item (an editor, a note) */
  below?: React.ReactNode;
}

/** the default sub-line: maker · house · estimate (ONE "priced" rule — a
 *  one-sided estimate prints "from $X", ../priced) */
export function rowSubOf(lot: AuctionLot): string {
  return [displayMakerOf(lot)?.name, lot.auctionHouse, fromText(lot) ?? formatEstimate(lot)].filter(Boolean).join(' · ');
}

/** the price as a figure + sub pair: a two-sided estimate ("$2K–$3K" ·
 *  "estimate"), a live bid ("$8K" · "bid · 12 bids"), a one-sided estimate
 *  ("from $2K" · "estimate"), else the house's words, quiet (ONE "priced"
 *  rule, ../priced; the printed-bid gate, estimate-text) */
export function priceFigureOf(lot: AuctionLot): { fig: string; sub: string | null; quiet: boolean } {
  const from = fromText(lot);
  if (from) return { fig: from, sub: 'estimate', quiet: false };
  const t = formatEstimate(lot);
  if (/ est\.$/.test(t)) return { fig: t.replace(/ est\.$/, ''), sub: 'estimate', quiet: false };
  if (t.includes(' bid')) { const [lead, ...rest] = t.split(' · '); return { fig: lead.replace(/ bid$/, ''), sub: ['bid', ...rest].join(' · '), quiet: false }; }
  return { fig: t, sub: null, quiet: true };
}

/** the lot's own URL on the desk */
export const lotHref = (lot: Pick<RowLot, 'id'>) => `/lot?id=${encodeURIComponent(lot.id)}`;

export function DeskRow({ lot, href, who, title, sub, wrap = false, tag, meta, figure, figureSub, pill, decision, action, tone, expand, pick, as = 'div', attrs, className, children, below }: DeskRowProps) {
  const Outer = as;
  const t = title ?? craftTitle(lot.title, lot.auctionHouse);
  const letterOf = who === undefined ? rowWhoOf(lot) : who;
  const showMeta = !!tag || meta != null;
  const hasRight = figure != null || figureSub != null;
  return (
    <Outer className={`dk-item${className ? ` ${className}` : ''}`} {...attrs}>
      <div className="dk-row" data-nav-row data-pick={pick} data-open={expand?.open || undefined} data-expand={expand ? '' : undefined}>
        <Thumb src={lot.imageUrl} label={letterOf || lot.title} size={56} tone={tone} />
        <div className="dk-main">
          <Link href={href ?? lotHref(lot)} className="dk-title" data-nav-focus={expand ? undefined : ''} title={t}>{t}</Link>
          {sub != null && sub !== '' && <span className="dk-sub" data-wrap={wrap || undefined}>{sub}</span>}
          {showMeta && (
            <span className="dk-meta">
              {tag && <span className="ck-tag" data-tone={tag.tone}>{tag.text}</span>}
              {meta}
            </span>
          )}
        </div>
        {/* the decision is the row's own grid child: under the lines on a desk,
            the full width under the row on a phone (row.css) */}
        {decision && <div className="dk-decision">{decision}</div>}
        {hasRight && (
          <div className="dk-right">
            {figure != null && <span className="dk-fig">{figure}</span>}
            {figureSub != null && <span className="dk-figsub">{figureSub}</span>}
          </div>
        )}
        {/* the controls share one line — under the figure on a desk, the full
            width under the row on a phone (row.css): the pill, the action, Details › */}
        {(pill != null || action != null || expand) && (
          <div className="dk-acts">
            {pill != null && <span className="dk-pill">{pill}</span>}
            {action != null && <span className="dk-act">{action}</span>}
            {expand && (
              <button type="button" className="dk-expand" data-nav-focus aria-expanded={expand.open} aria-controls={expand.id}
                aria-label={`${expand.open ? 'Close' : 'Open'} details for ${t}`} onClick={expand.onToggle}>
                <span className="dk-expand-t">{expand.open ? 'Close' : 'Details'}</span><span aria-hidden className="dk-expand-chev">›</span>
              </button>
            )}
          </div>
        )}
      </div>
      {expand?.open && children}
      {below}
    </Outer>
  );
}

/* ── THE CLOCK FIGURE — the close as the row's figure (Today, Your week).
   One clock: the caller's `now` (desk.now, a frozen capture) or a 30-second
   tick of its own, minutes never seconds (CloseClock's convention). ── */

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const clockText = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const mdText = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "in 3h 40m" / "in 12m" / "closing now" (inside the hour past the close) / null */
export function countdownOf(closeMs: number, now: number): string | null {
  const ms = closeMs - now;
  if (ms <= 0) return ms > -3_600_000 ? 'closing now' : null;
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return null;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

export interface CloseFigureRead { main: string; sub: string | null; soon: boolean }

/** the close, read for the figure slot: today = the clock (a house that
 *  published no hour: "Today · time TBC"), tomorrow / the weekday / the date
 *  further out, the hour under it when the house gave one */
export function closeFigureOf(lot: AuctionLot, now: number): CloseFigureRead {
  const days = closeDays(lot);
  const ms = closeMsOf(lot);
  const timed = ms != null && closeIsTimed(lot);
  if (isNaN(days)) return { main: 'scheduled', sub: null, soon: false };
  if (days < 0) return { main: 'result pending', sub: null, soon: false };
  if (days === 0) {
    if (timed) return { main: clockText(ms!), sub: countdownOf(ms!, now), soon: true };
    return { main: 'Today', sub: 'time TBC', soon: true };
  }
  if (days === 1) return { main: 'Tomorrow', sub: timed ? clockText(ms!) : null, soon: false };
  const day = new Date(`${closeDayOf(lot)}T12:00:00`);
  if (days < 7) return { main: WD[day.getDay()], sub: timed ? clockText(ms!) : mdText(day.getTime()), soon: false };
  return { main: mdText(day.getTime()), sub: timed ? clockText(ms!) : hammerWord(days), soon: false };
}

/** a 30-second clock for rows that have no `now` of their own */
export function useRowNow(given?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (given != null) return;   // the caller's clock ticks for us
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [given]);
  return given ?? now;
}

/** the close as a figure + sub pair, ready for DeskRow */
export function CloseFigure({ lot, now }: { lot: AuctionLot; now?: number }) {
  const n = useRowNow(now);
  const r = closeFigureOf(lot, n);
  return <span className="dk-clock" data-soon={r.soon || undefined} title={r.soon ? 'hammers today, on your clock' : undefined}>{r.main}</span>;
}
export function CloseFigureSub({ lot, now }: { lot: AuctionLot; now?: number }) {
  const n = useRowNow(now);
  const r = closeFigureOf(lot, n);
  return r.sub ? <>{r.sub}</> : null;
}
