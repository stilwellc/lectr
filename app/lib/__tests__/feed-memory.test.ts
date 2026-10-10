/**
 * "New since last visit" onboarding baselines + "open my feed the way I left
 * it" memory (app/lib/feed-filters, Oct 9).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  houseBaselines, isNewLot, passesTriage, TRIAGE_DEFAULTS, BASELINE_MIN,
  memoryOf, restoreParams,
} from '../feed-filters';

const TODAY = '2026-10-09';
const lots = (house: string, day: string | null, n: number, status = 'upcoming') =>
  Array.from({ length: n }, () => ({ auctionHouse: house, firstSeen: day, status }));

test('a first-crawl flood is the house baseline, not "new"', () => {
  // REA, Oct 9: every live lot first seen the day the house was added
  const book = [...lots('REA', TODAY, 3489), ...lots('Goldin', '2026-09-29', 1220), ...lots('Goldin', TODAY, 40)];
  const b = houseBaselines(book, TODAY);
  assert.equal(b.get('REA'), TODAY);
  assert.equal(b.has('Goldin'), false, 'a running book is never a baseline');
  const rea = { auctionHouse: 'REA', firstSeen: TODAY };
  const goldin = { auctionHouse: 'Goldin', firstSeen: TODAY };
  // first visit ever, a repeat visit today, and a visit last week
  for (const prevVisitDay of [null, TODAY, '2026-10-02']) {
    assert.equal(isNewLot(rea, { today: TODAY, prevVisitDay, baselines: b }), false, `REA, prev=${prevVisitDay}`);
    assert.equal(isNewLot(goldin, { today: TODAY, prevVisitDay, baselines: b }), true, `Goldin, prev=${prevVisitDay}`);
  }
  // passesTriage carries the same rule
  const f = { ...TRIAGE_DEFAULTS, newOnly: true };
  assert.equal(passesTriage(rea, f, { today: TODAY, prevVisitDay: null, baselines: b }), false);
  assert.equal(passesTriage(goldin, f, { today: TODAY, prevVisitDay: null, baselines: b }), true);
  // without baselines the old behavior stands (back-compat for callers)
  assert.equal(passesTriage(rea, f, { today: TODAY, prevVisitDay: null }), true);
});

test('a later catalog from an onboarded house counts again', () => {
  const book = [...lots('REA', '2026-10-08', 3000), ...lots('REA', TODAY, 200)];
  const b = houseBaselines(book, TODAY);
  assert.equal(b.get('REA'), '2026-10-08');
  assert.equal(isNewLot({ auctionHouse: 'REA', firstSeen: TODAY }, { today: TODAY, prevVisitDay: '2026-10-08', baselines: b }), true);
  assert.equal(isNewLot({ auctionHouse: 'REA', firstSeen: '2026-10-08' }, { today: TODAY, prevVisitDay: '2026-10-07', baselines: b }), false);
});

test('small first catalogs, old onboardings and shared days are not baselines', () => {
  // Rago's 13-lot first catalog stays new
  assert.equal(houseBaselines(lots('Rago', TODAY, 13), TODAY).size, 0);
  assert.equal(houseBaselines(lots('Rago', TODAY, BASELINE_MIN), TODAY).get('Rago'), TODAY);
  // the window: an onboarding more than 2 days back no longer masks anything
  assert.equal(houseBaselines(lots('REA', '2026-10-07', 500), TODAY).get('REA'), '2026-10-07');
  assert.equal(houseBaselines(lots('REA', '2026-10-06', 500), TODAY).size, 0);
  // sold history before the flood day means the house is not new
  const withHistory = [...lots('REA', TODAY, 500), ...lots('REA', '2026-08-01', 5, 'sold')];
  assert.equal(houseBaselines(withHistory, TODAY).size, 0);
  // no single day holds > 60% of the live book
  // earliest day 10-08 holds 50 of 110 live lots — not a baseline
  const split = [...lots('NFL Auction', TODAY, 60), ...lots('NFL Auction', '2026-10-08', 50)];
  assert.equal(houseBaselines(split, TODAY).size, 0);
});

test('lots without firstSeen are never new (RR predates the stamp)', () => {
  const book = lots('RR Auction', null, 965);
  const b = houseBaselines(book, TODAY);
  assert.equal(b.size, 0);
  assert.equal(isNewLot({ auctionHouse: 'RR Auction', firstSeen: null }, { today: TODAY, prevVisitDay: null, baselines: b }), false);
  assert.equal(isNewLot({ auctionHouse: 'RR Auction' }, { today: TODAY, prevVisitDay: '2026-10-01' }), false);
});

test('houseBaselines caches per pool + day', () => {
  const book = lots('REA', TODAY, 100);
  assert.equal(houseBaselines(book, TODAY), houseBaselines(book, TODAY));
  assert.equal(houseBaselines(book, '2026-10-20').size, 0, 'a new day recomputes');
});

test('feed memory: triage + tab + sort remembered, search and day are not', () => {
  const p = new URLSearchParams('q=jordan&day=2026-10-10&sort=newest&tab=all&win=48h&cat=sports-cards&sub=cards&fx=graded&house=Goldin&min=5000&new=1&below=1&v=sports');
  const mem = memoryOf(p, 'all');
  const got = new URLSearchParams(mem.p);
  assert.equal(got.get('q'), null);
  assert.equal(got.get('day'), null);
  assert.equal(got.get('v'), null);
  for (const [k, v] of [['sort', 'newest'], ['tab', 'all'], ['win', '48h'], ['cat', 'sports-cards'], ['sub', 'cards'], ['fx', 'graded'], ['house', 'Goldin'], ['min', '5000'], ['new', '1'], ['below', '1']]) {
    assert.equal(got.get(k), v, k);
  }
});

test('feed memory: same market restores everything, another market only what applies', () => {
  const mem = memoryOf(new URLSearchParams('sort=soonest&win=week&cat=sports-cards&sub=cards&fx=graded&house=Goldin'), 'all');
  const same = restoreParams(mem, 'all')!;
  assert.equal(same.get('cat'), 'sports-cards');
  assert.equal(same.get('fx'), 'graded');
  const art = restoreParams(mem, 'art')!;
  assert.equal(art.get('cat'), null);
  assert.equal(art.get('sub'), null);
  assert.equal(art.get('fx'), null);
  assert.equal(art.get('sort'), 'soonest');
  assert.equal(art.get('win'), 'week');
  assert.equal(art.get('house'), 'Goldin');
  // nothing that applies → no restore at all
  assert.equal(restoreParams(memoryOf(new URLSearchParams('cat=sports-cards'), 'all'), 'art'), null);
  assert.equal(restoreParams(memoryOf(new URLSearchParams(''), 'all'), 'all'), null);
  // corrupt storage is ignored
  assert.equal(restoreParams(null, 'all'), null);
  assert.equal(restoreParams({ m: 1, p: 2 } as unknown as { m: string; p: string }, 'all'), null);
});
