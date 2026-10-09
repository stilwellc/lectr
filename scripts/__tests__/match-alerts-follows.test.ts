/**
 * Category / house follows in the nightly matcher (Oct 8): they must alert only
 * on lots clearing the shortlist bar, best-first, capped — a category follow
 * must never match the whole fresh book (the old `matches` ignored unknown
 * query fields, which would have alerted on every lot).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = ''; // main() is a no-op without credentials
import { followHits } from '../match-alerts';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const soon = new Date(NOW + 20 * 3_600_000).toISOString();
const card = (id: string, usd: number, conf: string | null = 'medium') => ({
  id, artist: 'sports-cards', subCat: 'cards', drill: 'baseball', auctionHouse: 'Goldin', saleDateTime: soon,
  value: conf ? { expectedHammerUsd: usd, confidence: conf } : undefined, currentBid: conf ? undefined : usd,
});

test('category follow: only lots clearing the bar, best first, capped at 10', () => {
  const fresh = [card('cheap', 900), card('nobasis', 50000, null), ...Array.from({ length: 14 }, (_, i) => card(`c${i}`, 3000 + i * 1000))];
  const hits = followHits({ follow: 'cat', cat: 'sports-cards' }, fresh, NOW);
  assert.equal(hits.length, 10);
  assert.ok(!hits.some(h => h.id === 'cheap' || h.id === 'nobasis'));
  assert.equal(hits[0].id, 'c13');
});

test('sub-category and house follows narrow correctly', () => {
  const fresh = [card('a', 9000), { ...card('b', 9000), drill: 'basketball', auctionHouse: 'Heritage' }];
  assert.deepEqual(followHits({ follow: 'cat', cat: 'sports-cards', sub: 'sealed-wax' }, fresh, NOW).map(h => h.id), []);
  assert.deepEqual(followHits({ follow: 'house', house: 'Heritage' }, fresh, NOW).map(h => h.id), ['b']);
});
