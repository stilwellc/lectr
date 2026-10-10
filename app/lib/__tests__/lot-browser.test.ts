/**
 * The shared lot browser (Oct 9, r4): the home feed's filter + order pass
 * scoped to one maker, the /makers → maker page deep link, the value ceiling,
 * the named-maker shortlist and the speed of the pass on a big book.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedPass, liveBookHref } from '../lot-browser';
import { FEED_DEFAULTS } from '../../components/FeedToolbar';
import { passesTriage, triageFromParams, triageToParams, TRIAGE_DEFAULTS, houseBaselines, valueOptionOf, valuePatchOf } from '../feed-filters';
import { savedQueryOf, matchesSavedQuery, unmatchableReason } from '../saved-query';
import { shortlist } from '../priority';
import type { AuctionLot } from '../../types';

const art = (o: Record<string, unknown> = {}) => ({
  id: String(Math.random()), artist: 'andy-warhol', title: 'Flowers', status: 'upcoming', auctionHouse: 'Phillips',
  estimateLow: 3000, estimateHigh: 5000, currency: 'USD', saleDate: '2026-10-12', firstSeen: '2026-10-01', ...o,
}) as unknown as AuctionLot;
const OPTS = { belowIds: new Set<string>(), belowPct: new Map<string, number>(), prevVisitDay: null, baselines: new Map(), crawlDay: '2026-10-09', pageSize: 24 };

test('liveBookHref: a maker row carries the /makers triage onto #upcoming, All lots', () => {
  const h = liveBookHref('/makers/rolex', '?win=48h&house=Phillips&min=5000&max=25000&fx=cx-chrono&q=sub&sort=live&cols=a.b');
  const u = new URL(h, 'https://x');
  assert.equal(u.pathname, '/makers/rolex');
  assert.equal(u.hash, '#upcoming');
  assert.equal(u.searchParams.get('win'), '48h');
  assert.equal(u.searchParams.get('house'), 'Phillips');
  assert.equal(u.searchParams.get('min'), '5000');
  assert.equal(u.searchParams.get('max'), '25000');
  assert.equal(u.searchParams.get('fx'), 'cx-chrono');
  assert.equal(u.searchParams.get('tab'), 'all');
  // /makers' own roster keys never leak into the feed's codec
  assert.equal(u.searchParams.get('q'), null);
  assert.equal(u.searchParams.get('sort'), null);
  assert.equal(u.searchParams.get('cols'), null);
});

test('liveBookHref: no filters → the bare anchor; the dossier button opens at the top', () => {
  assert.equal(liveBookHref('/makers/kaws', ''), '/makers/kaws?tab=all#upcoming');
  assert.equal(liveBookHref('/makers/kaws', '?win=today', { land: false }), '/makers/kaws?win=today');
});

test('liveBookHref: a sport pick becomes the sport lens; a collection row keeps its own cat', () => {
  const m = new URL(liveBookHref('/makers/graded-cards', '?spk=baseball'), 'https://x');
  assert.equal(m.searchParams.get('sp'), 'Baseball');
  const h = new URL(liveBookHref('/?cat=sports-cards&sub=singles&tab=all', '?cat=watches&fx=cx-chrono&win=week'), 'https://x');
  assert.equal(h.pathname, '/');
  assert.equal(h.hash, '#on-the-block');
  assert.equal(h.searchParams.get('cat'), 'sports-cards');
  assert.equal(h.searchParams.get('win'), 'week');
  assert.equal(h.searchParams.get('fx'), null, 'a facet of another category is dropped');
});

test('value ceiling: URL round-trip, triage and saved searches honor it', () => {
  const p = new URLSearchParams();
  triageToParams({ ...TRIAGE_DEFAULTS, maxUsd: 5000 }, p);
  assert.equal(p.get('max'), '5000');
  assert.equal(triageFromParams(p).maxUsd, 5000);
  const cheap = art({ estimateLow: 1000, estimateHigh: 2000 });
  const dear = art({ estimateLow: 20000, estimateHigh: 30000 });
  const f = { ...TRIAGE_DEFAULTS, maxUsd: 5000 };
  assert.ok(passesTriage(cheap, f));
  assert.ok(!passesTriage(dear, f));
  assert.ok(!passesTriage(art({ estimateLow: null, estimateHigh: null, currentBid: null }), f), 'no anchor → not placed under a ceiling');
  const q = savedQueryOf({ ...TRIAGE_DEFAULTS, maxUsd: 5000, query: '', maker: 'andy-warhol', sport: null, category: null, belowOnly: false }, 'art');
  assert.equal(q.maxUsd, 5000);
  assert.equal(unmatchableReason(q as unknown as Record<string, unknown>), null);
  assert.ok(matchesSavedQuery(q, cheap, '2026-10-09'));
  assert.ok(!matchesSavedQuery(q, dear, '2026-10-09'));
  // the one value select: an option per side, picking one clears the other
  assert.equal(valueOptionOf({ minUsd: null, maxUsd: 5000 }), 'max:5000');
  assert.deepEqual(valuePatchOf('max:5000'), { minUsd: null, maxUsd: 5000 });
  assert.deepEqual(valuePatchOf('min:1000'), { minUsd: 1000, maxUsd: null });
  assert.deepEqual(valuePatchOf(''), { minUsd: null, maxUsd: null });
});

test('feedPass scoped: the vertical / maker lenses do not apply, no maker diversity', () => {
  const lots = Array.from({ length: 30 }, (_, i) => art({ id: `w${i}`, saleDate: `2026-10-${String(10 + (i % 9)).padStart(2, '0')}` }));
  const f = { ...FEED_DEFAULTS, sort: 'soonest' as const, vertical: 'watches' as const, maker: 'rolex', tab: 'all' as const };
  assert.equal(feedPass(lots, f, { ...OPTS, scoped: true }).length, 30);
  assert.equal(feedPass(lots, f, OPTS).length, 0);
  // soonest keeps the caller's hammer order when scoped (no 8-per-maker re-deal)
  const g = { ...FEED_DEFAULTS, sort: 'soonest' as const };
  assert.deepEqual(feedPass(lots, g, { ...OPTS, scoped: true }).map(l => l.id), lots.map(l => l.id));
});

test('shortlist: a named maker page lifts the ≤2-per-maker cap', () => {
  const now = Date.parse('2026-10-09T16:00:00-04:00');
  const lots = Array.from({ length: 12 }, (_, i) => art({
    id: `s${i}`, title: `Flowers ${i}`, auctionHouse: ['Phillips', 'Christie\'s', 'Sotheby\'s', 'Bonhams'][i % 4],
    saleName: `Sale ${i % 4}`, saleDate: '2026-10-11', saleDateTime: '2026-10-11T18:00:00Z',
    estimateLow: 20000 + i * 1000, estimateHigh: 30000 + i * 1000,
  }));
  const capped = shortlist(lots, now, 20);
  const open = shortlist(lots, now, 20, { who: Infinity });
  assert.ok(capped.length <= 2, `capped ${capped.length}`);
  assert.ok(open.length > capped.length, `open ${open.length}`);
});

test('performance: the whole live book through feedPass stays well under a frame budget per change', () => {
  let book: AuctionLot[] = [];
  try {
    const d = JSON.parse(readFileSync('public/data/ray/upcoming.json', 'utf8')) as { lots: AuctionLot[] };
    book = d.lots.filter(l => l.status === 'upcoming');
  } catch { return; } // a checkout without the data build: nothing to time
  const baselines = houseBaselines(book);
  const opts = { ...OPTS, baselines };
  feedPass(book, FEED_DEFAULTS, opts); // warm the per-lot memos
  const t0 = performance.now();
  for (const sort of ['priority', 'soonest', 'est-desc'] as const) {
    feedPass(book, { ...FEED_DEFAULTS, sort, win: 'week' }, { ...opts, scoped: true });
  }
  const ms = (performance.now() - t0) / 3;
  assert.ok(ms < 400, `feedPass over ${book.length} lots took ${ms.toFixed(0)}ms`);
});
