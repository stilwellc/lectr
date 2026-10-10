/**
 * The shared lot browser (Oct 9, r4): the home feed's filter + order pass
 * scoped to one maker, the /makers → maker page deep link, the value ceiling,
 * the named-maker shortlist and the speed of the pass on a big book.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedPass, liveBookHref } from '../lot-browser';
import { FEED_DEFAULTS, feedFromParams, feedToParams } from '../../components/FeedToolbar';
import { livePool, subjectLivePool } from '../maker-pool';
import { groupBySubject } from '../maker-subjects';
import { marketOf } from '../../constants';
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

// ── r5: player dossier, subject scope, compare tray ──────────────────────────
test('liveBookHref: a player dossier opens on All lots at its live book; the dossier button at the top', () => {
  const land = new URL(liveBookHref('/player?id=shohei-ohtani', '?win=48h&spk=baseball&q=oht'), 'https://x');
  assert.equal(land.pathname, '/player');
  assert.equal(land.searchParams.get('id'), 'shohei-ohtani');
  assert.equal(land.searchParams.get('win'), '48h');
  assert.equal(land.searchParams.get('sp'), 'Baseball');
  assert.equal(land.searchParams.get('tab'), 'all');
  assert.equal(land.searchParams.get('q'), null);
  assert.equal(land.hash, '#on-the-block');
  const top = new URL(liveBookHref('/player?id=shohei-ohtani', '?win=48h', { land: false }), 'https://x');
  assert.equal(top.searchParams.get('win'), '48h');
  assert.equal(top.searchParams.get('tab'), null);
  assert.equal(top.hash, '');
  // a subject's feed link keeps its own scope + tab and lands on the feed
  const subj = new URL(liveBookHref('/tcg?subj=k%3Acharizard&tab=all', '?house=Goldin'), 'https://x');
  assert.equal(subj.searchParams.get('subj'), 'k:charizard');
  assert.equal(subj.searchParams.get('house'), 'Goldin');
  assert.equal(subj.hash, '#on-the-block');
});

test('feed params: subj round-trips; a comma-joined maker scopes to several makers', () => {
  const p = new URLSearchParams();
  feedToParams({ ...FEED_DEFAULTS, subj: 'p:shohei-ohtani', maker: 'andy-warhol,francis-bacon' }, p);
  const back = feedFromParams(p);
  assert.equal(back.subj, 'p:shohei-ohtani');
  assert.equal(back.maker, 'andy-warhol,francis-bacon');
  const lots = [art(), art({ artist: 'francis-bacon' }), art({ artist: 'pablo-picasso' })];
  const out = feedPass(lots, { ...FEED_DEFAULTS, maker: 'andy-warhol,francis-bacon', tab: 'all' }, OPTS);
  assert.deepEqual(out.map(l => l.artist).sort(), ['andy-warhol', 'francis-bacon']);
});

test('subject scope: the feed (?subj=), the dossier pool and the /makers row count the same lots', () => {
  let book: AuctionLot[] = [];
  try {
    book = (JSON.parse(readFileSync('public/data/ray/upcoming.json', 'utf8')) as { lots: AuctionLot[] }).lots;
  } catch { return; }
  const today = '2026-10-09';
  const live = livePool(book, today);
  const groups = groupBySubject(live);
  let checked = 0;
  for (const [market, key] of [['sports', 'p:shohei-ohtani'], ['tcg', 'k:charizard'], ['culture', 'fr:fr-starwars'], ['science', '~']] as const) {
    const row = groups.get(`${market}|${key}`);
    if (!row) continue;
    checked++;
    const pool = subjectLivePool(book, market, key, today);
    assert.equal(pool.length, row.lots.length, `${market}|${key} dossier pool`);
    const mkt = live.filter(l => marketOf(l.artist) === market);
    const feed = feedPass(mkt, { ...FEED_DEFAULTS, subj: key, tab: 'all', sort: 'soonest' }, { ...OPTS, baselines: houseBaselines(mkt) });
    assert.equal(feed.length, row.lots.length, `${market}|${key} feed`);
  }
  assert.ok(checked > 0);
});
