/**
 * "What do you collect?" (Oct 11 2026): the quick start's follow storage and
 * state. Makers and players follow on the device signed out and travel into
 * the account as the very { player, playerName } row FollowButton always
 * wrote; the carry-over saves each missing follow once; finishing the picker
 * adds the new picks and drops only what the reader un-tapped on screen; the
 * price range is stored defensively and narrows by the feed's value anchor;
 * the offered names are the market's most-live entities, each mapped to the
 * follow that matches its lots.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makerFollow, catFollow, entityFollow, houseFollow, queryOf, followOf, migrationPlan, followsDiff, affinityOf, type Follow,
} from '../follows';
import {
  parseInterests, readInterests, writeInterests, getPricePref, inPriceRange, priceText, INTERESTS_KEY,
} from '../interests';
import {
  followOfEntity, topNames, topCats, searchNames, initQs, qsReduce, canAdvance, defaultMarketOfFollow, type QsState,
} from '../quickstart';
import { buildTaste, recommend, type RecLot } from '../recs';
import type { AuctionLot } from '../../types';

/* ── follows: storage + migration ─────────────────────────────────────── */

test('a maker / player follow is stored as the { player, playerName } row and reads back as a maker follow', () => {
  const jordan = makerFollow('michael-jordan', 'Michael Jordan');
  assert.deepEqual(queryOf(jordan), { player: 'michael-jordan', playerName: 'Michael Jordan' });
  assert.deepEqual(followOf(queryOf(jordan)), jordan);
  // the row FollowButton wrote before Oct 11 reads as the same follow
  assert.deepEqual(followOf({ player: 'kaws', playerName: 'KAWS' }), makerFollow('kaws', 'KAWS'));
  // every kind survives the round trip
  for (const f of [catFollow('tcg', 'vintage'), entityFollow('sj:tcg|k:charizard', 'Charizard'), houseFollow('Goldin'), catFollow('watches', null)]) {
    assert.deepEqual(followOf(queryOf(f)), f, f.key);
  }
  // a plain saved search is not a follow
  assert.equal(followOf({ q: 'rolex daytona' } as never), null);
});

test('migrationPlan carries each signed-out follow missing from the account, once — makers and players included', () => {
  const local: Follow[] = [
    makerFollow('michael-jordan', 'Michael Jordan'),
    makerFollow('andy-warhol', 'Andy Warhol'),
    entityFollow('sj:tcg|k:charizard', 'Charizard'),
    makerFollow('michael-jordan', 'Michael Jordan'), // tapped twice on the device
    catFollow('sports-cards', 'baseball'),
  ];
  const cloud: Follow[] = [makerFollow('andy-warhol', 'Andy Warhol')];
  const plan = migrationPlan(local, cloud);
  assert.deepEqual(plan.map(f => `${f.kind}:${f.key}`), ['maker:michael-jordan', 'entity:sj:tcg|k:charizard', 'cat:sports-cards:baseball']);
  // each planned follow becomes the row the account stores
  assert.deepEqual(queryOf(plan[0]), { player: 'michael-jordan', playerName: 'Michael Jordan' });
  // nothing left once the account has them all; junk in storage is skipped
  assert.deepEqual(migrationPlan(local, [...cloud, ...plan]), []);
  assert.deepEqual(migrationPlan([null, { kind: 'maker' }] as unknown as Follow[], []), []);
});

test('followsDiff adds new picks and drops only follows the picker showed and the reader un-tapped', () => {
  const jordan = makerFollow('michael-jordan', 'Michael Jordan');
  const ohtani = makerFollow('shohei-ohtani', 'Shohei Ohtani');
  const zard = entityFollow('sj:tcg|k:charizard', 'Charizard');
  const rolex = makerFollow('rolex', 'Rolex'); // followed elsewhere, never on screen
  const { add, drop } = followsDiff([jordan, rolex], [ohtani, zard], [jordan, ohtani, zard]);
  assert.deepEqual(add, [ohtani, zard]);
  assert.deepEqual(drop, [jordan]);
  // unchanged picks → nothing to write
  assert.deepEqual(followsDiff([jordan], [jordan], [jordan]), { add: [], drop: [] });
});

test('a followed player matches the lots carrying their slug (affinity 1)', () => {
  const lot = { artist: 'sports-cards', playerSlug: 'michael-jordan', subCat: 'cards', drill: 'basketball' };
  assert.equal(affinityOf(lot, [makerFollow('michael-jordan', 'Michael Jordan')]), 1);
  assert.equal(affinityOf(lot, [makerFollow('kobe-bryant', 'Kobe Bryant')]), 0);
});

/* ── interests: the price preference ──────────────────────────────────── */

function mem(): Pick<Storage, 'getItem' | 'setItem'> & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

test('interests are read defensively and the price getter returns only a stated range', () => {
  const s = mem();
  assert.equal(getPricePref(s), null);
  assert.deepEqual(readInterests(s).markets, []);
  writeInterests({ markets: ['sports', 'tcg', 'sports'], minUsd: 1000, maxUsd: null, at: '2026-10-11T00:00:00Z' }, s);
  assert.deepEqual(readInterests(s).markets, ['sports', 'tcg']);
  assert.deepEqual(getPricePref(s), { minUsd: 1000, maxUsd: null });
  // malformed / hostile values read as nothing stated
  assert.deepEqual(parseInterests('{nope'), parseInterests(null));
  assert.equal(parseInterests(JSON.stringify({ minUsd: -5, maxUsd: 'x', markets: ['all', 7] })).minUsd, null);
  assert.deepEqual(parseInterests(JSON.stringify({ markets: ['all', 7, 'art'] })).markets, ['art']);
  // an inverted range keeps its floor
  const inv = parseInterests(JSON.stringify({ minUsd: 5000, maxUsd: 1000 }));
  assert.deepEqual([inv.minUsd, inv.maxUsd], [5000, null]);
  // a storage that throws is no interests, never a crash
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(getPricePref(bad), null);
  assert.doesNotThrow(() => writeInterests({ markets: [], minUsd: null, maxUsd: null, at: null }, bad));
  assert.ok(s.m.has(INTERESTS_KEY));
});

test('inPriceRange narrows on the feed value anchor; an unplaceable lot is never hidden', () => {
  const lot = (lo: number, hi: number) => ({ artist: 'andy-warhol', title: 'Print', estimateLow: lo, estimateHigh: hi, currency: 'USD', status: 'upcoming' } as never);
  assert.equal(inPriceRange(lot(2000, 3000), { minUsd: 1000, maxUsd: null }), true);
  assert.equal(inPriceRange(lot(400, 600), { minUsd: 1000, maxUsd: null }), false);
  assert.equal(inPriceRange(lot(8000, 12000), { minUsd: null, maxUsd: 5000 }), false);
  assert.equal(inPriceRange(lot(8000, 12000), null), true);
  assert.equal(inPriceRange({ artist: 'andy-warhol', title: 'No price', status: 'upcoming' } as never, { minUsd: 1000, maxUsd: 5000 }), true);
  assert.equal(priceText({ minUsd: 5000, maxUsd: 50000 }), '$5K–$50K');
  assert.equal(priceText({ minUsd: null, maxUsd: 1000 }), 'under $1K');
  assert.equal(priceText({ minUsd: 25000, maxUsd: null }), '$25K and up');
});

/* ── quick start: entity → follow, the offered names, the state ───────── */

test('followOfEntity maps every entity kind to the follow that matches its lots', () => {
  assert.deepEqual(followOfEntity('mk:rolex', 'Rolex'), makerFollow('rolex', 'Rolex'));
  assert.deepEqual(followOfEntity('pl:michael-jordan', 'Michael Jordan'), makerFollow('michael-jordan', 'Michael Jordan'));
  assert.deepEqual(followOfEntity('sj:tcg|k:charizard', 'Charizard'), entityFollow('sj:tcg|k:charizard', 'Charizard'));
  assert.deepEqual(followOfEntity('st:tcg|s:base-set', 'Base Set'), entityFollow('st:tcg|s:base-set', 'Base Set'));
  assert.deepEqual(followOfEntity('cs:tcg:vintage', 'x'), catFollow('tcg', 'vintage'));
  // a science collection is the lot's own artist slug
  assert.deepEqual(followOfEntity('cs:space-science:meteorites', 'Meteorites'), makerFollow('meteorites', 'Meteorites'));
  assert.equal(followOfEntity('cs:tcg:not-a-sub', 'x'), null);
  assert.equal(followOfEntity('~:sports', 'Other'), null);
  assert.equal(followOfEntity('sj:broken', 'x'), null);
});

const NOW = Date.parse('2026-10-09T20:00:00Z');
const day = (d: number) => new Date(NOW + d * 864e5).toISOString().slice(0, 10);
let seq = 0;
function lot(o: Partial<AuctionLot> & { ek?: string | null }): AuctionLot {
  return {
    id: `q-${++seq}`, artist: 'sports-cards', title: 'Card', category: '', imageUrl: `https://img.example/${seq}.jpg`, auctionHouse: 'Goldin',
    saleName: 'Weekly', saleDate: day(3), lotNumber: String(seq), currency: 'USD', estimateLow: null, estimateHigh: null, status: 'upcoming', url: '',
    ...o,
  } as unknown as AuctionLot;
}

test('topNames offers the market\'s most-live names, labeled from the entities file, each with a face', () => {
  const pool = [
    ...Array.from({ length: 5 }, () => lot({ ek: 'pl:michael-jordan', playerSlug: 'michael-jordan' } as never)),
    ...Array.from({ length: 3 }, () => lot({ ek: 'pl:shohei-ohtani', playerSlug: 'shohei-ohtani' } as never)),
    lot({ ek: 'st:sports|s:1952-topps' }),
    lot({ ek: 'cs:sports-cards:singles' }), // unnamed → the remainder row, never offered as a name
  ];
  const labels: Record<string, string> = { 'pl:michael-jordan': 'Michael Jordan', 'pl:shohei-ohtani': 'Shohei Ohtani', 'st:sports|s:1952-topps': '1952 Topps' };
  const names = topNames(pool, 'sports', id => (labels[id] ? { label: labels[id], face: null } : null), 2);
  assert.deepEqual(names.map(n => [n.label, n.live]), [['Michael Jordan', 5], ['Shohei Ohtani', 3]]);
  assert.ok(names.every(n => n.face?.startsWith('https://img.example/')));
  assert.deepEqual(names[0].follow, makerFollow('michael-jordan', 'Michael Jordan'));
  // a maker market offers its makers
  const art = [lot({ artist: 'andy-warhol', ek: 'mk:andy-warhol' }), lot({ artist: 'andy-warhol', ek: 'mk:andy-warhol' }), lot({ artist: 'kaws', ek: 'mk:kaws' })];
  assert.deepEqual(topNames(art, 'art', () => null).map(n => [n.label, n.live]), [['Andy Warhol', 2], ['KAWS', 1]]);
});

test('topCats offers named sub-categories, never an "other" bucket', () => {
  const pool = [
    lot({ title: '1952 Topps Mickey Mantle PSA 5', subCat: 'cards', drill: 'baseball' } as never),
    lot({ title: '1986 Fleer Michael Jordan PSA 8', subCat: 'cards', drill: 'basketball' } as never),
  ];
  const cats = topCats(pool);
  assert.ok(cats.length > 0);
  assert.ok(cats.every(c => c.follow.kind === 'cat' && !/:other/.test(c.follow.key)));
});

test('searchNames finds any name in the market file, word starts and live names first', () => {
  const entries = [
    { id: 'sj:tcg|k:charizard', label: 'Charizard', face: null },
    { id: 'sj:tcg|k:reshiram-charizard-gx', label: 'Reshiram & Charizard GX', face: null },
    { id: 'sj:tcg|k:pikachu', label: 'Pikachu', face: null },
  ];
  const live = (id: string) => (id === 'sj:tcg|k:charizard' ? 72 : 0);
  const r = searchNames('chariz', entries, live);
  assert.deepEqual(r.map(x => x.label), ['Charizard', 'Reshiram & Charizard GX']);
  assert.equal(r[0].live, 72);
  assert.deepEqual(searchNames('c', entries, live), []); // one letter is not a search
});

test('the picker walks markets → names → price, gated on a market and a pick', () => {
  let s: QsState = initQs([], { markets: [], minUsd: null, maxUsd: null });
  assert.equal(s.step, 'markets');
  assert.equal(canAdvance(s), false);
  assert.equal(qsReduce(s, { t: 'next' }), s); // no market, no move
  s = qsReduce(s, { t: 'market', m: 'tcg' });
  s = qsReduce(s, { t: 'market', m: 'sports' });
  assert.deepEqual(s.markets, ['sports', 'tcg']); // the rail's order, not tap order
  s = qsReduce(s, { t: 'next' });
  assert.equal(s.step, 'names');
  assert.equal(qsReduce(s, { t: 'next' }).step, 'names'); // no pick yet
  assert.equal(qsReduce(s, { t: 'go', step: 'price' }).step, 'names'); // nor by jumping
  const jordan = makerFollow('michael-jordan', 'Michael Jordan');
  s = qsReduce(s, { t: 'pick', f: jordan });
  s = qsReduce(s, { t: 'pick', f: entityFollow('sj:tcg|k:charizard', 'Charizard') });
  s = qsReduce(s, { t: 'pick', f: jordan }); // un-tap
  assert.deepEqual(s.picked.map(f => f.key), ['sj:tcg|k:charizard']);
  s = qsReduce(s, { t: 'next' });
  assert.equal(s.step, 'price');
  // a floor above the ceiling clears the ceiling, and the other way round
  s = qsReduce(s, { t: 'max', usd: 5000 });
  s = qsReduce(s, { t: 'min', usd: 10000 });
  assert.deepEqual([s.minUsd, s.maxUsd], [10000, null]);
  s = qsReduce(s, { t: 'max', usd: 5000 });
  assert.deepEqual([s.minUsd, s.maxUsd], [null, 5000]);
  s = qsReduce(s, { t: 'back' });
  assert.equal(s.step, 'names');
  assert.equal(qsReduce(s, { t: 'go', step: 'markets' }).step, 'markets');
});

test('editing opens on the names with the reader\'s follows picked and their markets chosen', () => {
  const follows = [makerFollow('michael-jordan', 'Michael Jordan'), entityFollow('sj:tcg|k:charizard', 'Charizard'), houseFollow('Goldin')];
  const s = initQs(follows, { markets: [], minUsd: 1000, maxUsd: null }, f => (f.key.startsWith('sj:tcg') ? 'tcg' : f.kind === 'maker' ? 'sports' : null));
  assert.equal(s.step, 'names');
  assert.deepEqual(s.markets, ['sports', 'tcg']);
  assert.deepEqual(s.picked.map(f => f.kind), ['maker', 'entity']); // a house follow is not the picker's to drop
  assert.equal(s.minUsd, 1000);
  // stored markets win over the follows' own
  assert.deepEqual(initQs(follows, { markets: ['art'], minUsd: null, maxUsd: null }).markets, ['art']);
  assert.equal(defaultMarketOfFollow(entityFollow('sj:culture|fr:fr-beatles', 'The Beatles')), 'culture');
  assert.equal(defaultMarketOfFollow(makerFollow('rolex', 'Rolex')), 'watches');
  assert.equal(defaultMarketOfFollow(catFollow('sports-memorabilia', 'autographs')), 'sports');
});

test('a fresh visitor\'s quick-start follows turn straight into honest picks', () => {
  const at = (d: number) => new Date(NOW + d * 864e5).toISOString();
  const card = (title: string, slug: string, bid: number): RecLot => ({
    id: `r-${++seq}`, artist: 'sports-cards', title, subCat: 'cards', drill: 'basketball', playerSlug: slug, auctionHouse: 'Goldin',
    saleName: 'Weekly', saleDate: at(3).slice(0, 10), saleDateTime: at(3), currentBid: bid, bidCount: 5, currency: 'USD', status: 'upcoming',
  } as RecLot);
  const pool = [card('1986 Fleer Michael Jordan #57 PSA 8', 'michael-jordan', 9000), card('1996 Topps Chrome Kobe Bryant PSA 9', 'kobe-bryant', 4000)];
  const empty = buildTaste({ saved: [], follows: [], nowMs: NOW });
  assert.equal(recommend(pool, empty, { nowMs: NOW }).length, 0); // nothing to go on → nothing picked
  const taste = buildTaste({ saved: [], follows: [makerFollow('michael-jordan', 'Michael Jordan')], nowMs: NOW });
  const recs = recommend(pool, taste, { nowMs: NOW });
  assert.equal(recs[0].lot.title, '1986 Fleer Michael Jordan #57 PSA 8');
  assert.match(recs[0].reason, /Michael Jordan/);
  // (merge with p/quality) a thin follow goes on to its nearest kin through
  // the fallback ladder — each such pick labeled as a rung, citing the follow
  for (const r of recs.slice(1)) {
    assert.ok((r.tier ?? 1) > 1, r.reason);
    assert.match(r.reason, /you follow Michael Jordan/);
  }
});
