/**
 * THE DESK v3 — the pure reads the desk's rooms share (Oct 11 2026).
 *
 * Lifted verbatim out of app/profile/page.tsx so the provider, the cockpit
 * and every room read ONE copy of each rule: the day-to-hammer convention
 * (NaN-safe), the past-pending judgment, the one why-now classifier and the
 * live-signal ink. No React in here — every function is unit-testable on a
 * fixture.
 */
import type { AuctionLot } from '../../types';
import { signalCallOf, type SavedMeta } from '../../lib/account';
import { daysUntil as daysUntilOrNull } from '../../components/Terminal';
import { lotSignal } from '../../components/LotCard';
import { signalMagnitude } from '../../lib/comps';
import { sleeperRead } from '../../lib/lanes';
import { idAliases } from '../../lib/recs';
import { closeDayOf, localToday, median, overEstimatePct } from '../../utils';
import { closeMsOf } from '../../lib/priority';
import { pricedTotal, liveBidUsd } from './priced';
export { liveBidUsd };

/** Terminal's shared daysUntil, kept on the desk's NaN convention (every
    comparison here is NaN-safe; a null would need `?? NaN` at 14 call sites) */
export const daysUntil = (dateStr: string): number => daysUntilOrNull(dateStr) ?? NaN;
/** days to a lot's PRINTED close day (closeDayOf — the reader's true day,
    never the crawl day a late-night close was stamped with) */
export const closeDays = (l: AuctionLot): number => daysUntil(closeDayOf(l));

export function hammerWord(days: number): string {
  if (isNaN(days)) return 'scheduled';
  // past its sale day but still on the desk: the house hasn't posted the result
  if (days < 0) return 'result pending';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** sort key for saleDate — a missing/garbled date must sort DETERMINISTICALLY
    (to the end of any ordering), never feed NaN into a comparator. `missing`
    is the sentinel: MAX for ascending lists, 0 for descending ones, so the
    dateless rows land LAST either way. */
export const saleTime = (l: AuctionLot, missing = Number.MAX_SAFE_INTEGER): number => {
  const t = Date.parse(`${(l.saleDate || '').slice(0, 10)}T00:00:00Z`);
  return isNaN(t) ? missing : t;
};

import { isPastPending } from './pending';
export { isPastPending };

/* ── THE ONE CLASSIFIER — why a live watch needs you now. Both surfaces
   that tag rows (Today's reads and the Watching ledger) read THESE
   thresholds; a tuning change lands in both or in neither. ── */
export const TAG_SOON_DAYS = 2;      // "Lands soon": hammers within 2 days
// "Quiet" IS the engine's sleeper read (app/lib/lanes.ts sleeperRead: a dead
// room — zero bids — on a lot whose fairness the engine VERIFIED from its own
// appraisal, closing within the week). The old local rule (≤3 bids, no
// fairness check) was a second sleeper classifier; one-source law.
export type WatchTag = { tag: 'Lands soon' | 'Below market' | 'Most bids' | 'Quiet'; rank: number };
export function watchTagOf(l: AuctionLot, sig: { label: string } | null | undefined, now = Date.now()): WatchTag | null {
  const d = closeDays(l);
  // the read outranks the clock: a lot closing today that reads below market
  // says so (its row already prints when it hammers)
  if (sig?.label === 'Below Market') return { tag: 'Below market', rank: 1 };
  if (d >= 0 && d <= TAG_SOON_DAYS) return { tag: 'Lands soon', rank: 0 };
  if (l.bidVelocity && l.bidVelocity.delta > 0) return { tag: 'Most bids', rank: 2 };
  if (sleeperRead(l, now)) return { tag: 'Quiet', rank: 3 };
  return null;
}

export type LiveSignal = NonNullable<ReturnType<typeof lotSignal>>;
/** live-signal ink + text — THE app-wide formatter, comps.signalMagnitude
 *  ("+38%", "3.2×" past 2×, "5×+", "−50%"): the same string lot-face
 *  call.text prints on the lot page, the cards and /value (X5: the desk
 *  printed "+224%" where the lot page printed "3.2×") */
export const sigInk = (label: LiveSignal['label']) =>
  label === 'Below Market' ? 'var(--color-up)' : 'var(--color-down-text)';
export const sigText = (sig: LiveSignal) => signalMagnitude(sig.label, sig.pct);

/** a save's meta (keyed by the id at save time) — the raw shape rooms read */
export type MetaOf = (rowId: string) => SavedMeta | undefined;

/* ═══════════════════════════════════════════════════════════════════════════
   THE DESK'S OWN FIGURES (Oct 29 2026) — every number the masthead, the
   cockpit and the tab badges print, lifted out of provider.tsx as pure
   functions over fixtures. The provider hands each one the memoised inputs it
   always had and prints what comes back; nothing here reads React, the DOM or
   a store. The reader's clock (localToday / Date.now) is the ONE thing read
   from the environment, exactly as the inline bodies read it.
   ═══════════════════════════════════════════════════════════════════════════ */

/** an archive orphan the sold-outcomes ledger answered for */
export interface SoldOrphan { id: string; priceUsd: number; saleDate: string; provisional: boolean }
/** the ledger's row shape (hooks/useRayData LedgerEntry): [priceUsd, saleDate, provisional?] */
export type LedgerRow = readonly [number, string] | readonly [number, string, 1];

/* ── resolve saved ids through the alias map (id~ flips, Wright-family
   mirrors) BEFORE declaring an orphan — a settled watch must never silently
   drop out of the record (selection bias). Orphans are declared only once the
   archive has answered (fullLoaded). ── */
export function resolveSaved(savedIds: readonly string[], allLots: readonly AuctionLot[], fullLoaded: boolean): {
  savedLots: AuctionLot[];
  /** resolved row id → the id it was saved under (only when they differ) */
  savedIdByLotId: Map<string, string>;
  orphanIds: string[];
} {
  const byId = new Map(allLots.map(l => [l.id, l]));
  const resolve = (id: string): AuctionLot | undefined => {
    for (const a of idAliases(id)) {
      const hit = byId.get(a);
      if (hit) return hit;
    }
    return undefined;
  };
  const lots: AuctionLot[] = [];
  const idMap = new Map<string, string>(); // resolved row id → original saved id
  const seen = new Set<string>();
  const orphans: string[] = [];
  for (const id of savedIds) {
    const l = resolve(id);
    if (l) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      lots.push(l);
      if (l.id !== id) idMap.set(l.id, id);
    } else if (fullLoaded) {
      orphans.push(id);
    }
  }
  return { savedLots: lots, savedIdByLotId: idMap, orphanIds: orphans };
}

/** the orphans the sold-outcomes ledger answers for (a sale) vs the ones it
 *  doesn't (gone). Walks the SAME aliases corpus resolution walks — the
 *  ledger keys canonical ids, and a raw-id miss dressed a real sale as
 *  "withdrawn by the house". Before the ledger loads nothing is judged: a
 *  fetch failure must never be printed as "withdrawn". */
export function splitOrphans(orphanIds: readonly string[], ledger: ReadonlyMap<string, LedgerRow>, loaded: boolean): { soldOrphans: SoldOrphan[]; goneOrphans: string[] } {
  const soldO: SoldOrphan[] = [];
  const goneO: string[] = [];
  if (!loaded) return { soldOrphans: soldO, goneOrphans: goneO };
  for (const id of orphanIds) {
    let hit: LedgerRow | undefined;
    for (const a of idAliases(id)) { hit = ledger.get(a); if (hit) break; }
    if (hit) soldO.push({ id, priceUsd: hit[0], saleDate: hit[1], provisional: hit.length > 2 });
    else goneO.push(id);
  }
  soldO.sort((a, b) => (a.saleDate < b.saleDate ? 1 : -1));
  return { soldOrphans: soldO, goneOrphans: goneO };
}

/** the desk's three shelves: live (soonest hammer first), settled (most
 *  recent first — a past-pending row counts as left the block), everything
 *  else (withdrawn / passed, most recent first). Reads the reader's calendar
 *  through isPastPending. */
export function partitionSaved(savedLots: readonly AuctionLot[]): { upcoming: AuctionLot[]; sold: AuctionLot[]; other: AuctionLot[] } {
  const upcoming = savedLots
    .filter(l => l.status === 'upcoming' && !isPastPending(l))
    .sort((a, b) => saleTime(a) - saleTime(b));
  const sold = savedLots
    .filter(l => l.status === 'sold' || isPastPending(l))
    .sort((a, b) => saleTime(b, 0) - saleTime(a, 0));
  const other = savedLots
    .filter(l => l.status !== 'upcoming' && l.status !== 'sold')
    .sort((a, b) => saleTime(b, 0) - saleTime(a, 0));
  return { upcoming, sold, other };
}

/** the live signal a row carries, as the summary reads it (label + pct) */
export type SignalRead = { label: string; pct: number } | null | undefined;

export interface WatchSummary {
  /** Σ estimate midpoints over the PRICED live watches (./priced: both
   *  bounds, USD — the build converts every foreign estimate; the raw
   *  estimateLow/High aliases ARE dollars, so a GBP Bonhams lot sums at face
   *  and a lot whose estimate the money layer could not convert carries no
   *  USD bound at all and adds nothing) */
  totalEst: number;
  priced: number;
  /** live watches with a one-sided estimate ("from $X") — counted, never summed */
  oneSided: number;
  flagged: number; next: AuctionLot | null;
  /** watches whose close day is today and whose close is still ahead */
  closesToday: number;
  /** watches whose close day is today but whose published close instant has
   *  passed (results pending) — "closed earlier today", never "closes today" */
  closedEarlierToday: number;
}

/* ── WATCHING summary ── */
export function watchSummaryOf(upcoming: readonly AuctionLot[], signalById: ReadonlyMap<string, SignalRead>, nowMs: number = Date.now()): WatchSummary {
  // ONE "priced" rule (./priced, R4#3): a sum of estimate MIDPOINTS over the
  // lots with BOTH bounds — every surface that prints it labels it so ("at
  // estimate midpoint · N of M priced"); a one-sided estimate is "from $X"
  // on its row and never enters the total; a bid-only lot adds nothing
  const { total: totalEst, priced, oneSided } = pricedTotal(upcoming);
  const flagged = upcoming.filter(l => signalById.get(l.id)?.label === 'Below Market').length;
  const todayIso = localToday();
  const next = upcoming.find(l => { const d = closeDayOf(l).slice(0, 10); return !!d && d >= todayIso; }) || null;
  const today = upcoming.filter(l => closeDays(l) === 0);
  const closedEarlierToday = today.filter(l => closedBy(l, nowMs)).length;
  return { totalEst, priced, oneSided, flagged, next, closesToday: today.length - closedEarlierToday, closedEarlierToday };
}

/** the lot's published close instant (house-tz closeMsOf: a date-only sale
 *  closes when its day ends where it is sold) is behind the clock */
export const closedBy = (l: AuctionLot, nowMs: number): boolean => {
  const ms = closeMsOf(l);
  return ms != null && ms <= nowMs;
};

/** the settled shelf's rows the house hasn't resulted yet (past their sale
 *  day, still 'upcoming') — "awaiting results", never "settled" */
export const pendingResultsOf = (sold: readonly AuctionLot[]): number => sold.filter(l => l.status !== 'sold').length;

/** THE SETTLED SHELF, counted once for every surface (History's head, the
 *  masthead, the Record's cell, the tab badges):
 *    total     every row on the shelf — resolved sold / past-pending rows +
 *              the archive orphans the ledger answered for
 *    pending   the rows AWAITING RESULTS: past their day with no price, and
 *              the orphans the ledger knows only provisionally
 *    settled   total − pending — the only count the word "settled" may wear */
export function settledShelfOf(sold: readonly AuctionLot[], soldOrphans: readonly { provisional: boolean }[]): { total: number; settled: number; pending: number } {
  const total = sold.length + soldOrphans.length;
  const pending = pendingResultsOf(sold) + soldOrphans.filter(o => o.provisional).length;
  return { total, settled: total - pending, pending };
}

/* ── what changed since the saves: signals that moved, bids that landed ── */
export function watchChangesOf(upcoming: readonly AuctionLot[], metaFor: MetaOf, signalById: ReadonlyMap<string, SignalRead>): { moved: number; newBids: number } {
  let moved = 0;
  let newBids = 0;
  for (const lot of upcoming) {
    const m = metaFor(lot.id);
    if (!m) continue;
    const cur = signalById.get(lot.id);
    const call = signalCallOf(m);
    if (call && cur && call.dir !== 'unknown') {
      // legacy saves have no recorded direction — SavedDelta and the Δ
      // column render them neutral, so the masthead must not count them
      // as "moved" on magnitude alone (the two surfaces would disagree)
      const flipped = (call.dir === 'below' && cur.label !== 'Below Market') || (call.dir === 'above' && cur.label !== 'Above Market');
      if (flipped || Math.round(cur.pct) !== Math.round(call.pct)) moved++;
    }
    if (m.bidCount != null && (lot.bidCount || 0) > m.bidCount) newBids += (lot.bidCount || 0) - m.bidCount;
  }
  return { moved, newBids };
}

export interface RecordRead {
  n: number; realized: number; med: number | null;
  /** of n, the watches judged against a ONE-BOUND estimate (utils.overEstimatePct
   *  reads the published bound as the midpoint) — the line says so */
  oneSidedN: number;
  /** of n, the watches SAVED AFTER their hammer — the Record still judges the
   *  lot (its outcome vs its estimate is a fact about the lot), but a bookmark
   *  on a result is not the reader's eye; Your calls excludes them, the Record
   *  says how many it holds */
  afterHammerN: number;
  split: { flagged: number | null; flaggedN: number; rest: number | null; restN: number } | null;
  series: { id: string; d: string; pct: number; title: string }[];
}

/* ── THE RECORD — measured, receipts attached. A watch is JUDGED when it sold
   with a published price against a published estimate (utils.overEstimatePct:
   the raw realized price vs the estimate midpoint, premium inside). ── */
export function recordOf(sold: readonly AuctionLot[], metaFor: MetaOf): RecordRead | null {
  const judged = sold
    .map(l => ({ l, pct: overEstimatePct(l) }))
    .filter((x): x is { l: AuctionLot; pct: number } => x.pct != null);
  if (!judged.length) return null;
  const realized = judged.reduce((s, x) => s + (x.l.priceUsd || 0), 0);
  const med = median(judged.map(x => x.pct));
  // the flagged-vs-rest split reads DIRECTIONS, which only post-convention
  // saves carry; legacy direction-unknown saves stay in the blended median
  // but never claim a side of the split.
  const flaggedAtSave = judged.filter(x => signalCallOf(metaFor(x.l.id))?.dir === 'below');
  const restAtSave = judged.filter(x => {
    const c = signalCallOf(metaFor(x.l.id));
    return c != null && c.dir !== 'below' && c.dir !== 'unknown';
  });
  const split = flaggedAtSave.length >= 3 && restAtSave.length >= 3
    ? { flagged: median(flaggedAtSave.map(x => x.pct)), flaggedN: flaggedAtSave.length, rest: median(restAtSave.map(x => x.pct)), restN: restAtSave.length }
    : null;
  // the TIMELINE — every judged call in hammer order, most recent 60. The
  // median is the headline; the sequence is the receipt trail (and shows
  // whether the eye is improving).
  const series = judged
    .slice()
    .sort((a, b) => ((a.l.saleDate || '') < (b.l.saleDate || '') ? -1 : 1))
    .slice(-60)
    .map(x => ({ id: x.l.id, d: (x.l.saleDate || '').slice(0, 10), pct: x.pct, title: x.l.title }));
  const oneSidedN = judged.filter(x => !((x.l.estimateLow || 0) > 0 && (x.l.estimateHigh || 0) > 0)).length;
  const afterHammerN = judged.filter(x => { const at = (metaFor(x.l.id)?.savedAt || '').slice(0, 10), d = (x.l.saleDate || '').slice(0, 10); return !!at && !!d && at > d; }).length;
  return { n: judged.length, realized, med, oneSidedN, afterHammerN, split, series };
}

/* ── since your last visit — the watches that SETTLED after the previous
   visit day (the site's one last-visit clock, feed-filters useLastVisit).
   (Oct 29) settled means a result posted: a watch past its sale day whose
   house hasn't published (results pending) is on the History shelf but is
   not "settled" news, and its missing price would thin the median's n
   without saying so. ── */
export function sinceLastOf(sold: readonly AuctionLot[], prevDay: string | null, fullLoaded: boolean): { n: number; med: number | null } | null {
  if (!fullLoaded || !prevDay) return null;
  const fresh = sold.filter(l => l.status === 'sold' && (l.saleDate || '').slice(0, 10) > prevDay);
  if (!fresh.length) return null;
  const pcts = fresh.map(l => overEstimatePct(l)).filter((x): x is number => x != null);
  return { n: fresh.length, med: pcts.length ? median(pcts) : null };
}

/* ── the Did-you-win inbox: settled wins not yet in the collection. A result
   the reader cleared ("none of these were me") is not a win to claim; an
   archive orphan the ledger only knows provisionally is not yet a result.
   ONE filter for the count (Needs you, the Today badge) and the one-tap
   clear (the saved ids it dismisses) — the two can never disagree. ── */
export function unclaimedOf(args: {
  sold: readonly AuctionLot[]; soldOrphans: readonly SoldOrphan[];
  ownedLotIds: ReadonlySet<string>; ownedIdSet: ReadonlySet<string>;
  metaFor: MetaOf; savedMeta: Readonly<Record<string, SavedMeta>>;
  /** the id a resolved row is saved under (the alias map) */
  savedIdOf: (rowId: string) => string;
}): { n: number; ids: string[] } {
  const { sold, soldOrphans, ownedLotIds, ownedIdSet, metaFor, savedMeta, savedIdOf } = args;
  const lots = sold.filter(l => l.status === 'sold' && !ownedLotIds.has(l.id) && !metaFor(l.id)?.dismissed);
  const orphans = soldOrphans.filter(o => !o.provisional && !ownedIdSet.has(o.id) && !savedMeta[o.id]?.dismissed);
  const ids = Array.from(new Set(lots.map(l => savedIdOf(l.id)).concat(orphans.map(o => o.id))));
  return { n: lots.length + orphans.length, ids };
}

/** what the collection's totals read off a row */
export interface CollectionTotalsRow { paid: number | null; appraised: number | null }
export interface CollectionTotals {
  /** Σ bought over every piece with a price (your basis, else the realized price) */
  totalPaid: number;
  /** Σ the ENGINE's appraisal over the pieces it appraised — only those
   *  (R4#4: a piece without a comp pool never carries at cost into a
   *  figure called an appraisal) */
  totalAppraised: number;
  /** Σ bought over the appraised pieces that also carry a bought price —
   *  the denominator of `deltaPct` */
  appraisedPaid: number;
  /** Σ appraised over those SAME pieces — the numerator of `deltaPct`; the
   *  figure to print beside `appraisedPaid` (totalAppraised also carries the
   *  appraised pieces with no bought price, so "X marked vs Y bought" must
   *  read this, not totalAppraised) */
  appraisedOfPaid: number;
  /** appraised vs bought over the `appraisedPaidN` pieces that have both; null = no measurement */
  deltaPct: number | null;
  appraisedN: number; appraisedPaidN: number;
}

/* ── COLLECTION totals (R4#4, R1#4): the appraisal total is the ENGINE's over
   the pieces it appraised — never cost carried forward under the word
   "appraisal"; the ±% compares those same pieces with their bought price,
   n said ── */
export function collectionTotalsOf(rows: readonly CollectionTotalsRow[]): CollectionTotals {
  const totalPaid = rows.reduce((s, r) => s + (r.paid || 0), 0);
  const appraisedRows = rows.filter(r => r.appraised != null);
  const bothRows = appraisedRows.filter(r => r.paid != null && r.paid > 0);
  const totalAppraised = appraisedRows.reduce((s, r) => s + (r.appraised ?? 0), 0);
  const appraisedPaid = bothRows.reduce((s, r) => s + (r.paid ?? 0), 0);
  const appraisedOfPaid = bothRows.reduce((s, r) => s + (r.appraised ?? 0), 0);
  const deltaPct = appraisedPaid > 0 ? Math.round((appraisedOfPaid / appraisedPaid - 1) * 100) : null;
  return { totalPaid, totalAppraised, appraisedPaid, appraisedOfPaid, deltaPct, appraisedN: appraisedRows.length, appraisedPaidN: bothRows.length };
}

/* ── sub-market exposure — the MARKET's read, labeled as such: pieces and
   held value (appraised, else bought) per sub-market, largest first ── */
export function exposureOf<D extends { slug: string }>(rows: readonly { drill: D | null; appraised: number | null; paid: number | null }[]): { row: D; n: number; held: number }[] {
  const by = new Map<string, { row: D; n: number; held: number }>();
  for (const r of rows) {
    if (!r.drill) continue;
    const cur = by.get(r.drill.slug) || { row: r.drill, n: 0, held: 0 };
    cur.n += 1;
    cur.held += r.appraised ?? r.paid ?? 0;
    by.set(r.drill.slug, cur);
  }
  return Array.from(by.values()).sort((a, b) => b.held - a.held);
}

/** "on the desk since <Month Year>" — the oldest save, once it is older than
 *  30 days (a fresh desk has no tenure to speak of) */
export function tenureOf(savedIds: readonly string[], savedMeta: Readonly<Record<string, SavedMeta>>, nowMs: number = Date.now()): string | null {
  let min: string | null = null;
  for (const id of savedIds) {
    const at = savedMeta[id]?.savedAt;
    if (at && (!min || at < min)) min = at;
  }
  if (!min) return null;
  const days = (nowMs - Date.parse(min)) / 86_400_000;
  if (!(days > 30)) return null;
  return new Date(min).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/* ── MY MAX vs the live bid (./priced liveBidUsd — the Daily Desk reads the same rule) ── */
/** your watches whose live bid has passed your own max — the ids (Watching's
 *  news, the Needs-you count). A lot already priced (sold) is never over max. */
export function overMaxIdsOf(upcoming: readonly AuctionLot[], maxOf: (lotId: string) => number | null | undefined): string[] {
  const out: string[] = [];
  for (const l of upcoming) {
    const max = maxOf(l.id);
    const usd = liveBidUsd(l);
    if (typeof max === 'number' && max > 0 && l.priceUsd == null && usd != null && usd > max) out.push(l.id);
  }
  return out;
}
export const overMaxOf = (upcoming: readonly AuctionLot[], maxOf: (lotId: string) => number | null | undefined): number => overMaxIdsOf(upcoming, maxOf).length;

/* ── NEEDS YOU — what waits on the reader, COUNTED ONCE: a watch that is both
   past your max and closing today is one thing, not two. The facts keep their
   own counts (the cell prints each); `n` is the union. A watch that closed
   earlier today waits on the HOUSE (results pending), not the reader: it is
   said apart and never counted. ── */
export function needsYouOf(upcoming: readonly AuctionLot[], maxOf: (lotId: string) => number | null | undefined, unclaimedWins: number, nowMs: number = Date.now()): { n: number; overMax: number; closesToday: number; closedEarlierToday: number; results: number } {
  const over = overMaxIdsOf(upcoming, maxOf);
  const today = upcoming.filter(l => closeDays(l) === 0);
  const closing = today.filter(l => !closedBy(l, nowMs)).map(l => l.id);
  const live = new Set(over.concat(closing)).size;
  return { n: live + unclaimedWins, overMax: over.length, closesToday: closing.length, closedEarlierToday: today.length - closing.length, results: unclaimedWins };
}
