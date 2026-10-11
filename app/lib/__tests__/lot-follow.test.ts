import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotFollowOf } from '../lot-follow';
import type { AuctionLot } from '../../types';

const lot = (o: Partial<AuctionLot> & { ek?: string | null }): AuctionLot =>
  ({ id: 'x', title: '', artist: '', auctionHouse: 'Goldin', saleDate: '2026-10-20', status: 'upcoming', ...o } as AuctionLot);

test('a maker lot follows its maker by slug', () => {
  assert.deepEqual(lotFollowOf(lot({ artist: 'andy-warhol', title: 'Mao, 1972', ek: 'mk:andy-warhol' })), { kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' });
});

test('a sports lot follows its athlete (the build-stamped key wins)', () => {
  const f = lotFollowOf(lot({ artist: 'baseball-cards', title: '1952 Topps Mickey Mantle #311 PSA 8', playerSlug: 'mickey-mantle', playerName: 'Mickey Mantle', ek: 'pl:mickey-mantle' }));
  assert.deepEqual(f, { kind: 'maker', key: 'mickey-mantle', label: 'Mickey Mantle' });
});

test('a sealed set follows the set entity, named by the subject reader', () => {
  const f = lotFollowOf(lot({ artist: 'pokemon', title: '2004 Pokemon EX Team Rocket Returns Factory-Sealed Booster Box' }));
  assert.equal(f?.kind, 'entity');
  assert.equal(f?.key, 'st:tcg|s:team-rocket-returns');
  assert.equal(f?.label, 'Team Rocket Returns');
});

test('no named entity → no follow (a bare collection is a category chip, not a lot follow)', () => {
  assert.equal(lotFollowOf(lot({ artist: 'pokemon', title: 'x', ek: 'cs:tcg:singles' })), null);
  assert.equal(lotFollowOf(lot({ artist: 'andy-warhol', title: 'x', ek: null })), null, 'misattributed: no one\'s entity');
  // a stamped subject key the subject reader does not name the same way → no
  // button that says one name and follows another
  assert.equal(lotFollowOf(lot({ artist: 'pokemon', title: 'Charizard Holo', ek: 'sj:tcg|k:pikachu' })), null);
});
