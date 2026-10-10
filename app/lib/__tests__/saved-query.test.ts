/**
 * Saved searches carry the triage row (app/lib/saved-query, Oct 9) and the
 * nightly matcher (scripts/match-alerts hitsFor) honors every field — and
 * refuses, rather than over-matches, a query it can't fully read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedQueryOf, hasCriteria, matchesSavedQuery, unmatchableReason } from '../saved-query';
import { TRIAGE_DEFAULTS } from '../feed-filters';
import { hitsFor } from '../../../scripts/match-alerts';

const BASE = { ...TRIAGE_DEFAULTS, query: '', maker: null, sport: null, category: null, belowOnly: false };
const NOW = Date.parse('2026-10-09T12:00:00Z');

const card = (o: Record<string, unknown> = {}) => ({
  id: String(Math.random()), artist: 'sports-cards', subCat: 'cards', drill: 'baseball', status: 'upcoming',
  title: '2018 Topps Chrome #1 Shohei Ohtani Rookie - PSA 10', auctionHouse: 'Goldin',
  estimateLow: 8000, estimateHigh: 12000, currency: 'USD', saleDate: '2026-10-10', firstSeen: '2026-10-09', ...o,
});
const art = (o: Record<string, unknown> = {}) => ({
  id: String(Math.random()), artist: 'kaws', title: 'Companion (Flayed)', status: 'upcoming', auctionHouse: 'Phillips',
  estimateLow: 3000, estimateHigh: 5000, currency: 'USD', saleDate: '2026-10-20', firstSeen: '2026-10-09', ...o,
});

test('legacy fields keep their exact shape (dedupe against older saves)', () => {
  const q = savedQueryOf({ ...BASE, query: ' kaws ', belowOnly: true }, 'art');
  assert.equal(JSON.stringify(q), JSON.stringify({ market: 'art', maker: null, sport: null, category: null, text: 'kaws', belowOnly: true }));
});

test('triage fields are saved when set', () => {
  const q = savedQueryOf({ ...BASE, win: '48h', cat: 'sports-cards', sub: 'cards', house: 'Goldin', minUsd: 5000, fx: ['graded'], newOnly: true }, 'all');
  assert.deepEqual(
    { win: q.win, cat: q.cat, sub: q.sub, house: q.house, minUsd: q.minUsd, fx: q.fx },
    { win: '48h', cat: 'sports-cards', sub: 'cards', house: 'Goldin', minUsd: 5000, fx: ['graded'] });
  assert.equal('newOnly' in q, false, 'every alert is already new');
  assert.equal(q.market, null);
  // a triage-only cut is a real search now
  assert.ok(hasCriteria(savedQueryOf({ ...BASE, house: 'Goldin' }, 'all')));
  assert.ok(!hasCriteria(savedQueryOf({ ...BASE, newOnly: true }, 'all')));
});

test('the matcher honors the triage fields', () => {
  const today = '2026-10-09';
  const q = savedQueryOf({ ...BASE, cat: 'sports-cards', house: 'Goldin', minUsd: 5000 }, 'all');
  assert.ok(matchesSavedQuery(q, card(), today));
  assert.ok(!matchesSavedQuery(q, card({ auctionHouse: 'Heritage' }), today), 'house');
  assert.ok(!matchesSavedQuery(q, card({ estimateLow: 500, estimateHigh: 800 }), today), 'value floor');
  assert.ok(!matchesSavedQuery(q, art({ auctionHouse: 'Goldin', estimateLow: 9000, estimateHigh: 12000 }), today), 'category');
  const win = savedQueryOf({ ...BASE, win: '48h', house: 'Goldin' }, 'all');
  assert.ok(matchesSavedQuery(win, card({ saleDate: '2026-10-10' }), today));
  assert.ok(!matchesSavedQuery(win, card({ saleDate: '2026-10-25' }), today), 'closing window');
  const fx = savedQueryOf({ ...BASE, cat: 'sports-cards', fx: ['graded'] }, 'all');
  assert.ok(matchesSavedQuery(fx, card(), today));
  assert.ok(!matchesSavedQuery(fx, card({ title: '1909-11 T206 Honus Wagner' }), today), 'facet');
});

test('hitsFor: a triage search no longer matches every fresh lot', () => {
  const fresh = [card(), card({ auctionHouse: 'Heritage' }), art(), art({ estimateLow: 100, estimateHigh: 200 })];
  const q = savedQueryOf({ ...BASE, house: 'Goldin' }, 'all');
  assert.equal(hitsFor(q, fresh, NOW).length, 1);
  // legacy text search still works
  assert.equal(hitsFor(savedQueryOf({ ...BASE, query: 'companion' }, 'all'), fresh, NOW).length, 2);
});

test('hitsFor: unknown fields, malformed values and empty queries earn nothing', () => {
  const fresh = [card(), art()];
  const logs: string[] = [];
  assert.equal(hitsFor({ vertical: 'art' } as never, fresh, NOW, m => logs.push(m)).length, 0);
  assert.match(logs[0], /unknown field/);
  assert.equal(hitsFor({ house: 'Goldin', win: 'fortnight' } as never, fresh, NOW).length, 0);
  assert.equal(hitsFor({ cat: 'sports-cards', fx: 'graded' } as never, fresh, NOW).length, 0);
  assert.equal(hitsFor({}, fresh, NOW).length, 0);
  assert.equal(hitsFor({ market: null, maker: null, text: null }, fresh, NOW).length, 0);
  assert.equal(unmatchableReason({ house: 'Goldin' }), null);
});

test('hitsFor: follows keep their capped shortlist branch', () => {
  const fresh = [card(), card({ auctionHouse: 'Heritage' })];
  const hits = hitsFor({ follow: 'house', house: 'Goldin', label: 'Goldin' }, fresh, NOW);
  assert.ok(hits.every(l => l.auctionHouse === 'Goldin'));
  // a player follow is a plain search on the player field
  assert.equal(hitsFor({ player: 'kaws', playerName: 'KAWS' }, [card(), art()], NOW).length, 1);
});

test('hitsFor: a subject / set follow alerts on its entity key', () => {
  const fresh = [card({ ek: 'sj:tcg|k:charizard' }), card({ ek: 'pl:shohei-ohtani' }), art()];
  assert.equal(hitsFor({ follow: 'entity', id: 'sj:tcg|k:charizard', label: 'Charizard' }, fresh, NOW).length, 1);
  assert.equal(hitsFor({ follow: 'entity', id: null, label: 'x' }, fresh, NOW).length, 0);
});
