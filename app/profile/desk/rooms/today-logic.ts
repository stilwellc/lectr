/**
 * today-logic.ts — THE READS' selection (Today's insight layer), pure (Oct 29
 * 2026). The provider renders the words; this file decides WHICH lots carry
 * WHICH read, on what evidence, under what gate:
 *
 *   hot      the two fastest rooms (bidVelocity.delta, descending) — ONLY
 *            while the crawl is fresh (components/LotCard crawlIsFresh: the
 *            velocity freshness gate; a stale crawl must never print
 *            "+5 bids in 24h"). The percentile is cited only above median
 *            ("faster than 19% of live lots" praised a bottom-quintile pace).
 *   quiet    the engine's sleeper read (lib/lanes sleeperRead: zero bids on
 *            a lot whose fairness the engine verified, closing inside the
 *            week), soonest first, two
 *   soon     hammers within TAG_SOON_DAYS (derive), three
 *   comps    the build's same-card comps (cardComps.n > 0, a median), two,
 *            only once the archive loaded
 *   below    the deepest Below Market by comps.dealScore — THE one flagged
 *            ranking — two
 *
 * ONE read per lot, claimed in evidence order (hot > quiet > soon > comps >
 * below); READS_MAX in all. Facts are data — the provider prints them.
 */
import type { AuctionLot } from '../../../types';
import { formatEstimate } from '../../../components/LotCard';
import { crawlIsFresh } from '../../../components/LotCard';
import { dealScore } from '../../../lib/comps';
import { sleeperRead } from '../../../lib/lanes';
import { closeDays, TAG_SOON_DAYS, type SignalRead } from '../derive';

export const HOT_N = 2, QUIET_N = 2, SOON_N = 3, COMPS_N = 2, BELOW_N = 2, READS_MAX = 8;
/** a velocity percentile is cited only from the median up */
export const PCTILE_CITE_MIN = 50;

export type ReadFact =
  | { kind: 'hot'; delta: number; hours: number; /** cited only ≥ PCTILE_CITE_MIN, else null */ pctile: number | null }
  | { kind: 'quiet'; days: number; entry: number | null; cvu: number; atEstimate: boolean }
  | { kind: 'soon'; days: number; estText: string; /** the bid count, only when estText did not already print the bid form */ bids: number | null }
  | { kind: 'comps'; n: number; med: number }
  | { kind: 'below'; sig: { label: string; pct: number }; estText: string; /** the live bid, only when estText did not already print it */ bid: number | null };

export interface ReadPick {
  key: string;
  tag: 'Most bids' | 'Quietest' | 'Lands soon' | 'Direct comps' | 'Below market';
  tone?: 'up' | 'hot';
  lot: AuctionLot;
  fact: ReadFact;
}

export interface ReadsInput {
  upcoming: readonly AuctionLot[];
  signalById: ReadonlyMap<string, SignalRead>;
  fullLoaded: boolean;
  nowMs: number;
  /** the crawl's stamp (useRayData lastCrawl) — the velocity gate's clock */
  lastCrawl: string | null | undefined;
}

/** the velocity freshness gate — a "Most bids" read needs a crawl from today (or inside 24h) */
export const velocityFresh = (lastCrawl: string | null | undefined, nowMs: number): boolean => crawlIsFresh(lastCrawl, nowMs);

export function todayReadsOf({ upcoming, signalById, fullLoaded, nowMs, lastCrawl }: ReadsInput): ReadPick[] {
  const rows: ReadPick[] = [];
  const used = new Set<string>();
  const claim = (l: AuctionLot) => { used.add(l.id); return l; };

  if (velocityFresh(lastCrawl, nowMs)) {
    const hot = upcoming
      .filter(l => l.bidVelocity && l.bidVelocity.delta > 0)
      .sort((a, b) => (b.bidVelocity!.delta) - (a.bidVelocity!.delta))
      .slice(0, HOT_N);
    for (const l of hot) {
      const v = l.bidVelocity!;
      rows.push({ key: `hot-${claim(l).id}`, tag: 'Most bids', lot: l, tone: 'hot',
        fact: { kind: 'hot', delta: v.delta, hours: Math.round(v.hours), pctile: v.pctile != null && v.pctile >= PCTILE_CITE_MIN ? v.pctile : null } });
    }
  }

  const quiet = upcoming
    .filter(l => !used.has(l.id))
    .map(l => ({ l, read: sleeperRead(l, nowMs) }))
    .filter((x): x is { l: AuctionLot; read: NonNullable<ReturnType<typeof sleeperRead>> } => !!x.read)
    .sort((a, b) => closeDays(a.l) - closeDays(b.l))
    .slice(0, QUIET_N);
  for (const { l, read } of quiet) {
    rows.push({ key: `q-${claim(l).id}`, tag: 'Quietest', lot: l,
      fact: { kind: 'quiet', days: closeDays(l), entry: read.entry, cvu: read.cvu, atEstimate: read.anchor === 'fair-est' } });
  }

  const soon = upcoming
    .filter(l => !used.has(l.id))
    .filter(l => { const d = closeDays(l); return d >= 0 && d <= TAG_SOON_DAYS; })
    .slice(0, SOON_N);
  for (const l of soon) {
    // when formatEstimate prints the live-bid form ("$402 bid · 10 bids" — it
    // does this for ANY lot with a live bid and no two-sided estimate),
    // appending bid state again printed "· 10 bids · 10 bids". Gate on what
    // it PRINTED, not on which fields exist.
    const estText = formatEstimate(l);
    const printedBid = estText.includes('bid');
    rows.push({ key: `soon-${claim(l).id}`, tag: 'Lands soon', lot: l, tone: 'hot',
      fact: { kind: 'soon', days: closeDays(l), estText, bids: !printedBid && typeof l.bidCount === 'number' && l.bidCount > 0 ? l.bidCount : null } });
  }

  if (fullLoaded) {
    let found = 0;
    for (const l of upcoming) {
      if (used.has(l.id)) continue;
      if (l.cardComps && l.cardComps.n > 0 && l.cardComps.med != null) {
        rows.push({ key: `dc-${claim(l).id}`, tag: 'Direct comps', lot: l, fact: { kind: 'comps', n: l.cardComps.n, med: l.cardComps.med } });
        found++;
      }
      if (found >= COMPS_N) break;
    }
  }

  const under = upcoming
    .filter(l => !used.has(l.id))
    .map(l => ({ l, sig: signalById.get(l.id) }))
    .filter((x): x is { l: AuctionLot; sig: { label: string; pct: number } } => !!x.sig && x.sig.label === 'Below Market')
    .sort((a, b) => dealScore(b.l, b.sig.pct) - dealScore(a.l, a.sig.pct))
    .slice(0, BELOW_N);
  for (const { l, sig } of under) {
    const estText = formatEstimate(l);
    const printedBid = estText.includes('bid');
    rows.push({ key: `bm-${claim(l).id}`, tag: 'Below market', lot: l, tone: 'up',
      fact: { kind: 'below', sig, estText, bid: !printedBid && (l.currentBid || 0) > 0 ? l.currentBid! : null } });
  }
  return rows.slice(0, READS_MAX);
}

/** "today" / "tomorrow" / "in N days" — the reads' hammer word */
export const hammersIn = (d: number): string => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);
