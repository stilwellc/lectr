/**
 * lot-browser.ts — the pure half of the shared live-lot browser
 * (components/LotBrowser): the home feed's filter + order pass, lifted out of
 * TerminalHome so a maker page (or any scoped pool) runs the exact same
 * machinery, plus the deep-link that carries a /makers triage view onto a
 * maker page's lot browser.
 */
import { marketArtists } from '../constants';
import { searchTextOf } from './lot-labels';
import type { AuctionLot } from '../types';
import { trueSaleDay, isClosedPending } from '../utils';
import { dealScore } from './comps';
import { sportOfLot } from './submarkets';
import { passesTriage, type HouseBaselines } from './feed-filters';
import { byPriority, spread } from './priority';
import { subjectKeyOf } from './maker-subjects';
import type { FeedFilters } from '../components/FeedToolbar';

// The default view's diversity cap: max 8 lots per maker per page window.
const MAKER_CAP = 8;
export function diversifyFeed(arr: AuctionLot[], windowSize: number): AuctionLot[] {
  if (arr.length <= MAKER_CAP || windowSize <= 0) return arr;
  const out: AuctionLot[] = [];
  let pool = arr;
  while (pool.length) {
    const counts: Record<string, number> = {};
    const taken: AuctionLot[] = [];
    const deferred: AuctionLot[] = [];
    for (const l of pool) {
      if (taken.length < windowSize && (counts[l.artist] || 0) < MAKER_CAP) {
        taken.push(l);
        counts[l.artist] = (counts[l.artist] || 0) + 1;
      } else {
        deferred.push(l);
      }
    }
    if (taken.length === 0) { out.push(...deferred); break; }
    out.push(...taken);
    pool = deferred;
  }
  return out;
}

export interface FeedPassOpts {
  belowIds: ReadonlySet<string>;
  belowPct: ReadonlyMap<string, number>;
  prevVisitDay: string | null;
  baselines: HouseBaselines;
  /** the data's "today" — results-pending lots before it sink to the end */
  crawlDay: string;
  pageSize: number;
  /** a scoped pool (one maker): the vertical / maker lenses don't apply and
   *  the per-maker diversity cap is meaningless */
  scoped?: boolean;
  nowMs?: number;
}

/** Every lot passing search + lenses + triage, in the chosen order. */
export function feedPass(upcoming: AuctionLot[], f: FeedFilters, o: FeedPassOpts): AuctionLot[] {
  const q = f.query.trim().toLowerCase();
  let arr = upcoming;
  if (f.vertical && !o.scoped) {
    const vset = marketArtists(f.vertical);
    arr = arr.filter(l => vset.has(l.artist));
  }
  if (f.maker && !o.scoped) {
    // one maker, or the compare tray's several (comma-joined)
    const ms = new Set(f.maker.split(','));
    arr = arr.filter(l => ms.has(l.artist));
  }
  // one /makers subject row, exactly (a player, a Pokémon, a film …)
  if (f.subj && !o.scoped) arr = arr.filter(l => subjectKeyOf(l) === f.subj);
  if (f.sport) arr = arr.filter(l => (sportOfLot(l) || 'Other') === f.sport);
  if (f.category) arr = arr.filter(l => l.category === f.category);
  if (f.saleDay) arr = arr.filter(l => l.saleDate?.slice(0, 10) === f.saleDay);
  if (f.belowOnly) arr = arr.filter(l => o.belowIds.has(l.id));
  // triage: closing window, clean category/sub, house, value floor, new
  arr = arr.filter(l => passesTriage(l, f, { prevVisitDay: o.prevVisitDay, baselines: o.baselines }));
  if (q) {
    // the haystack carries the printed label vocabulary — the player, "PSA
    // 10", "Signed", "Rookie", "Apollo" (app/lib/lot-labels searchTextOf,
    // memoised per lot: 10K lots a keystroke)
    arr = arr.filter(l => searchTextOf(l).includes(q));
  }
  const est = (l: AuctionLot) => l.estimateHigh || l.estimateLow || l.currentBid || 0;
  // results pending: a past sale day, or (r7) a sale that closed earlier today
  const pastNow = o.nowMs ?? Date.now();
  const past = (l: AuctionLot) => !!l.resultsPending && ((trueSaleDay(l) !== '' && trueSaleDay(l) < o.crawlDay) || isClosedPending(l, pastNow));
  if (f.sort === 'priority') {
    // "Matters most" (app/lib/priority): size on each market's own scale,
    // measured edge, evidence, closing time — then re-dealt so no one sale
    // or player runs >3 deep in any 12 (a 3,489-lot REA night can't wall
    // the first screens). Results-pending lots still sink to the end.
    const now = o.nowMs ?? Date.now();
    const live = spread(arr.filter(l => !past(l)).sort(byPriority(now)));
    arr = [...live, ...arr.filter(past)];
  } else if (f.sort === 'est-desc') arr = [...arr].sort((a, b) => est(b) - est(a));
  else if (f.sort === 'est-asc') arr = [...arr].sort((a, b) => est(a) - est(b));
  else if (f.sort === 'gap-desc') {
    const score = (l: AuctionLot) => {
      const p = o.belowPct.get(l.id);
      return p == null ? -Infinity : dealScore(l, p);
    };
    arr = [...arr].sort((a, b) => score(b) - score(a));
  } else if (f.sort === 'newest') {
    const seen = (l: AuctionLot) => l.firstSeen || '';
    arr = [...arr].sort((a, b) => (seen(a) < seen(b) ? 1 : seen(a) > seen(b) ? -1 : 0));
  } else if (f.sort === 'bids-desc') {
    // The pill says "Most bids", so the BID COUNT is the rank — velocity is
    // only the tiebreaker. (Until Sep 2026 this added the two terms, so a
    // 42-bid lot moving +29 outranked a 69-bid lot moving +1 and the column
    // read 89, 72, 84, 83 — sorted, but visibly not by the number shown.)
    // Lots with no bid state at all sink below every lot that has one.
    const count = (l: AuctionLot) => (typeof l.bidCount === 'number' ? l.bidCount : -1);
    const delta = (l: AuctionLot) => (l.bidVelocity && l.bidVelocity.delta > 0 ? l.bidVelocity.delta : 0);
    const known = (l: AuctionLot) => (count(l) >= 0 || delta(l) > 0 ? 1 : 0);
    arr = [...arr].sort((a, b) =>
      (known(b) - known(a)) || (count(b) - count(a)) || (delta(b) - delta(a))
    );
  } else {
    arr = [...arr.filter(l => !past(l)), ...arr.filter(past)];
    if (!o.scoped && !q && !f.vertical && !f.maker && !f.subj && !f.sport && !f.category && !f.belowOnly && !f.saleDay) {
      arr = diversifyFeed(arr, o.pageSize);
    }
  }
  return arr;
}

// ── /makers → maker page deep link ──────────────────────────────────────────
/** the /makers triage keys a maker page's lot browser understands */
const CARRY_KEYS = ['win', 'cat', 'sub', 'house', 'min', 'max', 'new', 'fx'] as const;
/** /makers' sport pick (taxonomy SPORTS key) → the feed's sport lens label
 *  (sportOfLot's labels); 'other-sports' has no single label and is dropped */
const SPORT_LABEL: Record<string, string> = {
  basketball: 'Basketball', baseball: 'Baseball', football: 'Football',
  soccer: 'Soccer', hockey: 'Hockey', 'boxing-mma': 'Boxing / MMA',
  golf: 'Golf', racing: 'Racing',
};

/**
 * The "+N more on the block" link: the row's destination with the /makers
 * triage view (`search`, the page's own query string) carried over, landing
 * on the live book. A maker page gets `#upcoming` (its lot browser) and
 * "All lots" (the reader came for the rest of the book, not a shortlist);
 * `land: false` (the "Open the dossier" button) carries the view but opens
 * the page at its top;
 * a collection row's home-feed link keeps its own cat/sub and gains the
 * window / house / floor / new / facets; a player dossier (`/player?id=`)
 * opens on "All lots" at its live book (#on-the-block), like a maker page —
 * and so does an entity page (/entity?id=).
 */
export function liveBookHref(base: string, search: string, opts: { land?: boolean } = {}): string {
  const land = opts.land ?? true;
  const src = new URLSearchParams(search);
  const [path, qs = ''] = base.split('?');
  const out = new URLSearchParams(qs);
  const own = new Set(Array.from(out.keys()));
  for (const k of CARRY_KEYS) {
    if (own.has(k)) continue;
    const v = src.get(k);
    if (v) out.set(k, v);
  }
  // a facet belongs to its category: never carry one onto a row whose own
  // category differs from the /makers view's
  if (own.has('cat') && src.get('cat') !== out.get('cat')) out.delete('fx');
  const spk = src.get('spk');
  if (spk && SPORT_LABEL[spk] && !out.has('sp')) out.set('sp', SPORT_LABEL[spk]);
  const isMaker = path.startsWith('/makers/');
  // a player dossier's live book is a lot browser too — the reader came for
  // the rest of the book, so it opens on "All lots" like a maker page's
  const isBook = isMaker || path === '/player' || path === '/entity';
  if (isBook && land && !own.has('tab')) out.set('tab', 'all');
  const q = out.toString();
  const hash = !land ? '' : isMaker ? '#upcoming' : '#on-the-block';
  return `${path}${q ? `?${q}` : ''}${hash}`;
}
