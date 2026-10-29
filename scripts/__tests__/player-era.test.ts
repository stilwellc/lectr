/**
 * A player's career era (app/lib/player-era): the 10th–90th percentile of the
 * sold cards' years, every lot one sample, from at least five dated lots; the
 * players.json reader hands it to the recommender keyed by `pl:<slug>`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardYear, eraFromYears, playerErasOf, ERA_MIN_LOTS } from '../../app/lib/player-era';

test('cardYear reads a parse year as written', () => {
  assert.equal(cardYear('2017'), 2017);
  assert.equal(cardYear('1996-97'), 1996);
  assert.equal(cardYear('1952'), 1952);
  assert.equal(cardYear(null), null);
  assert.equal(cardYear('nope'), null);
  assert.equal(cardYear('1492'), null);
});

test('eraFromYears: 10th–90th percentile, one sample per lot — a lone 1952 reprint does not stretch a modern player', () => {
  const modern = [2003, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2012, 2015, 2018, 2020, 2022, 2023, 1952];
  const e = eraFromYears(modern)!;
  assert.ok(e.from >= 2003 && e.from <= 2004, `from ${e.from}`);
  assert.ok(e.to >= 2020 && e.to <= 2023, `to ${e.to}`);
  assert.equal(e.n, modern.length);
  // weighting by lot count: twenty 1965 lots and one 1990 lot are a 1965 player
  const namath = [...Array.from({ length: 20 }, () => 1965), 1968, 1970, 1972, 1990];
  const n = eraFromYears(namath)!;
  assert.equal(n.from, 1965);
  assert.ok(n.to <= 1972);
});

test(`eraFromYears needs ${ERA_MIN_LOTS} dated lots`, () => {
  assert.equal(eraFromYears([1965, 1966, 1967, 1968]), null);
  assert.ok(eraFromYears([1965, 1966, 1967, 1968, 1969]));
  assert.equal(eraFromYears([]), null);
});

test('playerErasOf keys by pl:<slug> and skips players without an era', () => {
  const m = playerErasOf([{ slug: 'joe-namath', era: { from: 1965, to: 1977, n: 40 } }, { slug: 'new-guy' }, { slug: 'bad', era: { from: NaN, to: 2000, n: 9 } }]);
  assert.deepEqual(Array.from(m.entries()), [['pl:joe-namath', { lo: 1965, hi: 1977 }]]);
  assert.equal(playerErasOf(null).size, 0);
});
