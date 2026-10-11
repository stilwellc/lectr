/**
 * Home surfacing (components/home/matters): What matters prints in score
 * order whatever pass seated a lot, and a house lens with no live lot in the
 * market is flagged stale.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mattersList, staleHouse } from '../matters';
import { shortlist, priorityOf } from '../../../lib/priority';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const art = (id: string, artist: string, house: string, est: number, h = 30) => ({
  id, artist, auctionHouse: house, saleDate: inHours(h).slice(0, 10), saleName: house, title: `${artist} ${id}`,
  saleDateTime: inHours(h), estimateLow: est, estimateHigh: est,
});

test('What matters reads best-first even when a later pass seats the stronger lot', () => {
  // five strong lots in ONE sale (only 3 seat on the first pass, 8/sale on
  // the last) and a weak lot alone in another sale: seat order puts the weak
  // lot 4th, ahead of two stronger lots seated on the looser pass
  const lots = [
    art('a', 'andy-warhol', "Christie's", 3_000_000),
    art('b', 'pablo-picasso', "Christie's", 2_500_000),
    art('c', 'roy-lichtenstein', "Christie's", 2_000_000),
    art('d', 'keith-haring', "Christie's", 1_800_000),
    art('e', 'jean-michel-basquiat', "Christie's", 1_600_000),
    // (W26) big enough that its close tonight still lifts it (size gates the boosts)
    art('weak', 'george-condo', 'Rago', 120_000, 6),
  ];
  const seated = shortlist(lots, NOW, 20);
  const listed = mattersList(lots, NOW, 20);
  assert.deepEqual(new Set(listed.map(l => l.id)), new Set(seated.map(l => l.id)), 'the same seats');
  const scores = listed.map(l => priorityOf(l, NOW)!.score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] >= scores[i], `score order at ${i}: ${scores.join(', ')}`);
  if (seated.length > 4) assert.notDeepEqual(seated.map(l => l.id), listed.map(l => l.id), 'the fixture exercises a re-order');
  assert.equal(listed[listed.length - 1].id, 'weak');
});

test('staleHouse: only a set house with no live lot here', () => {
  const live = [{ auctionHouse: 'Goldin' }, { auctionHouse: 'REA' }];
  assert.equal(staleHouse('NFL Auction', live), true);
  assert.equal(staleHouse('Goldin', live), false);
  assert.equal(staleHouse(null, live), false);
  assert.equal(staleHouse('NFL Auction', []), false, 'an unloaded book proves nothing');
});
