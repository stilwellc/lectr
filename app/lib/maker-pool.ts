/**
 * maker-pool.ts — THE live pool every roster count reads (Oct 9, r4).
 *
 * /makers rows, their expanded live books, the triage chips and the maker
 * page's lot browser must all count the same lots, or a row says "101 live"
 * and the page behind it lists 80. The rules, in one place:
 *
 *   source       the EAGER upcoming book (useRayData allLots — upcoming.json,
 *                which carries every live lot). Never a maker shard's rows:
 *                the shards are a different nightly snapshot (Oct 9: Warhol
 *                80 live in the shard vs 101 on the served book).
 *   live         isLiveUpcoming on the reader's calendar day (app/utils).
 *   attribution  the lot's maker slug (`l.artist === slug`) — the same slug
 *                the market membership (marketArtists) is built from.
 *   filters      passesTriage (app/lib/feed-filters) with the page's
 *                houseBaselines + last-visit day.
 *   order        byPriority — what matters most first (app/lib/priority).
 */
import { isLiveUpcoming, localToday } from '../utils';
import { type Market } from '../constants';
import { searchTextOf } from './lot-labels';
import { passesTriage, triageToParams, TRIAGE_DEFAULTS, type TriageFilters, type NewLensOpts } from './feed-filters';
import { byPriority, priorityOf, closeMsOf } from './priority';

type PoolLot = Parameters<typeof isLiveUpcoming>[0] & Parameters<typeof passesTriage>[0] & { artist: string };

/** every live lot on the book (the reader's calendar day) */
export function livePool<L extends PoolLot>(lots: readonly L[], today: string = localToday()): L[] {
  return lots.filter(l => isLiveUpcoming(l, today));
}

/** one maker's live lots under the triage filters, what matters most first —
 *  the exact list (and count) a /makers row shows for that maker */
export function makerLiveLots<L extends PoolLot>(
  lots: readonly L[], slug: string, f: TriageFilters = TRIAGE_DEFAULTS, opts: NewLensOpts = {},
): L[] {
  const today = opts.today ?? localToday();
  return lots
    .filter(l => l.artist === slug && isLiveUpcoming(l, today) && passesTriage(l, f, { ...opts, today }))
    .sort(byPriority(Date.now()));
}

type FeedLot = Parameters<typeof searchTextOf>[0];

/** the home feed's text search, verbatim (TerminalHome feedAll): a lowercase
 *  substring over the label vocabulary + maker · title · house · sale
 *  (app/lib/lot-labels searchTextOf) */
export function feedQueryMatches(l: FeedLot, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return searchTextOf(l).includes(needle);
}

/** the home feed (every lot, not the top tab) searched for `q` inside the
 *  market, carrying the triage filters */
export function feedSearchHref(market: Market, q: string, f: TriageFilters): string {
  const p = new URLSearchParams();
  p.set('q', q.trim());
  p.set('tab', 'all');
  triageToParams(f, p);
  return `${market === 'all' ? '/' : `/${market}`}?${p.toString()}`;
}

/** byPriority's exact order, with each lot's score read ONCE (the comparator
 *  re-scores both lots on every comparison: ~50ms over 10K live lots → ~10) */
export function sortByPriority<L extends Parameters<typeof priorityOf>[0]>(lots: readonly L[], nowMs: number = Date.now()): L[] {
  const keyed = lots.map(l => {
    const p = priorityOf(l, nowMs);
    return { l, ok: !!p, s: p?.score ?? 0, c: closeMsOf(l) ?? Infinity, a: p?.a ?? 0 };
  });
  keyed.sort((x, y) => {
    if (!x.ok || !y.ok) return x.ok ? -1 : y.ok ? 1 : 0;
    if (y.s !== x.s) return y.s - x.s;
    if (x.c !== y.c) return x.c - y.c;
    return y.a - x.a;
  });
  return keyed.map(k => k.l);
}
