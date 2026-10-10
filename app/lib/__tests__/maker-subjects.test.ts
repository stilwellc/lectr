import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotSubjectOf, subjectRowKeyOf, groupBySubject, OTHER } from '../maker-subjects';
import { makerLiveLots, sortByPriority, feedQueryMatches, feedSearchHref } from '../maker-pool';
import { byPriority } from '../priority';
import { TRIAGE_DEFAULTS } from '../feed-filters';

const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${artist}-${title}`.slice(0, 40), artist, title, status: 'upcoming', saleDate: '2026-10-20', ...extra });

test('maker-subjects: a card files under its player, memorabilia under the same player row', () => {
  const card = lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8');
  const bat = lot('game-used', 'Mickey Mantle Game-Used Louisville Slugger Bat');
  const a = lotSubjectOf(card), b = lotSubjectOf(bat);
  assert.equal(a?.name, 'Mickey Mantle');
  assert.equal(a?.kind, 'player');
  assert.equal(a?.key, 'p:mickey-mantle');
  assert.equal(b?.key, 'p:mickey-mantle');
  assert.equal(subjectRowKeyOf(card), 'sports|p:mickey-mantle');
});

test('maker-subjects: missions, Pokémon, franchises, solo acts', () => {
  assert.equal(lotSubjectOf(lot('space-exploration', 'Apollo 11 Flown Beta Cloth Patch'))?.key, 'm:apollo-11');
  assert.equal(lotSubjectOf(lot('pokemon', '1999 Pokemon Base Set Holo #4 Charizard - PSA 9'))?.name, 'Charizard');
  const sw = lotSubjectOf(lot('movie-tv', 'Stormtrooper Helmet from Star Wars: A New Hope (1977) Screen-Used'));
  assert.equal(sw?.kind, 'franchise');
  assert.equal(sw?.name, 'Star Wars');
  // a solo act's franchise facet joins the person row
  const mj = lotSubjectOf(lot('entertainment-memorabilia', 'Collection of Michael Jackson Tour Ephemera'));
  assert.equal(mj?.key, 'p:michael-jackson');
});

test('maker-subjects: art / design / watches never get subject rows; unnamed lots fall to the remainder', () => {
  assert.equal(subjectRowKeyOf(lot('andy-warhol', 'Marilyn')), null);
  assert.equal(subjectRowKeyOf(lot('pokemon', 'Pokemon Booster Box Sealed')), `tcg|${OTHER}`);
});

test('maker-subjects: every collection lot lands in exactly one group', () => {
  const lots = [
    lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8'),
    lot('game-used', 'Mickey Mantle Game-Used Louisville Slugger Bat'),
    lot('pokemon', 'Pokemon Booster Box Sealed'),
    lot('andy-warhol', 'Marilyn'),
  ];
  const g = groupBySubject(lots);
  let n = 0;
  g.forEach(x => { n += x.lots.length; });
  assert.equal(n, 3);
  assert.equal(g.get('sports|p:mickey-mantle')?.lots.length, 2);
});

test('maker-pool: sortByPriority is byPriority\'s order; makerLiveLots is the row\'s list', () => {
  const now = Date.parse('2026-10-09T16:00:00-04:00');
  const lots = [
    lot('andy-warhol', 'A', { estimateLow: 1000, estimateHigh: 2000 }),
    lot('andy-warhol', 'B', { estimateLow: 100000, estimateHigh: 200000 }),
    lot('andy-warhol', 'C', { estimateLow: 10000, estimateHigh: 20000, saleDate: '2026-10-10' }),
    lot('andy-warhol', 'D'),
  ];
  const want = lots.slice().sort(byPriority(now)).map(l => l.title);
  assert.deepEqual(sortByPriority(lots, now).map(l => l.title), want);
  assert.equal(makerLiveLots(lots, 'andy-warhol', TRIAGE_DEFAULTS, { today: '2026-10-09' }).length, 4);
  assert.equal(makerLiveLots(lots, 'kaws', TRIAGE_DEFAULTS, { today: '2026-10-09' }).length, 0);
});

test('maker-pool: the feed search link carries the query and the triage', () => {
  assert.equal(feedQueryMatches(lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8'), 'mantle'), true);
  assert.equal(feedSearchHref('sports', 'Mantle', { ...TRIAGE_DEFAULTS, win: 'week' }), '/sports?q=Mantle&tab=all&win=week');
  assert.equal(feedSearchHref('all', 'x', TRIAGE_DEFAULTS), '/?q=x&tab=all');
});
