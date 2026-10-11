import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPaletteIndex, rankPalette, soldQueryOf, type PaletteItem, type PaletteEntity } from '../palette-search';
import { rewriteQuery, feedQueryMatcher, editDistance } from '../search-query';
import { matchRefs, type RefRow } from '../search-index';
import { refLabel } from '../../utils';
import type { AuctionLot } from '../../types';

const lot = (id: string, artist: string, title: string): AuctionLot => ({
  id, artist, title, category: 'object', imageUrl: '', auctionHouse: 'Goldin', saleName: '', saleDate: '2026-10-20',
  lotNumber: 1, currency: 'USD', estimateLow: 0, estimateHigh: 0, status: 'upcoming', url: '',
} as unknown as AuctionLot);

const ITEMS: PaletteItem[] = [
  { label: 'Value', hint: 'below-market lots', path: '/value', kind: 'section' },
  { label: 'Andy Warhol', hint: 'art maker', path: '/makers/andy-warhol', kind: 'maker' },
  { label: 'George Nakashima', hint: 'design maker', path: '/makers/george-nakashima', kind: 'maker' },
  { label: 'George Condo', hint: 'art maker', path: '/makers/george-condo', kind: 'maker' },
  { label: 'Daytona · Rolex', hint: 'sub-market · watches · 900 lots tracked', path: '/sub/rolex/daytona', kind: 'sub' },
  { label: 'Sealed wax', hint: 'sub-market · tcg · 90 lots tracked', path: '/sub/tcg/pokemon-sealed', kind: 'sub' },
];
const ENTS: PaletteEntity[] = [
  { id: 'pl:mickey-mantle', label: 'Mickey Mantle', hint: 'player · Baseball', path: '/player?id=mickey-mantle', sold: 12598 },
  { id: 'pl:michael-jordan', label: 'Michael Jordan', hint: 'player · Basketball', path: '/player?id=michael-jordan', sold: 17008 },
  { id: 'pl:jordan-love', label: 'Jordan Love', hint: 'player · Football', path: '/player?id=jordan-love', sold: 565 },
  { id: 'sj:tcg|k:charizard', label: 'Charizard', hint: 'Pokémon · TCG', path: '/entity?id=charizard', sold: 2129 },
  { id: 'sj:culture|p:paul-newman', label: 'Paul Newman', hint: 'person · Culture', path: '/entity?id=paul-newman', sold: 80 },
  { id: 'sj:culture|fr:fr-starwars', label: 'Star Wars', hint: 'franchise · Culture', path: '/entity?id=starwars', sold: 516 },
  { id: 'sj:sports|t:dallas-stars', label: 'Dallas Stars', hint: 'team · Sports', path: '/entity?id=stars', sold: 20 },
];
const REFS: RefRow[] = [
  { maker: 'rolex', ref: '6263', n: 248, med: 73955, line: 'daytona' },
  { maker: 'rolex', ref: '6239', n: 193, med: 70625, line: 'daytona' },
  { maker: 'rolex', ref: '1675', n: 259, med: 14629 },
  { maker: 'patek-philippe', ref: '5711', n: 28, med: 48187, line: 'nautilus' },
];
const LOTS = [
  lot('a', 'nakashima', 'Conoid Chair, 1966'),
  lot('b', 'graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8'),
  lot('c', 'graded-cards', '1986 Fleer #57 Michael Jordan Rookie Card - PSA 9'),
  lot('d', 'andy-warhol', 'Marilyn Monroe (F. & S. II.31)'),
];
const idx = buildPaletteIndex({ items: ITEMS, ents: ENTS, liveByEntity: new Map(), upcomingLots: LOTS, refs: REFS, refLabel });
const top = (q: string) => rankPalette(q, idx).rows[0]?.path;
const sectionsOf = (q: string) => rankPalette(q, idx).sections.map(s => s.key);

test('edit distance counts a transposition as one edit', () => {
  assert.equal(editDistance('micheal', 'michael'), 1);
  assert.equal(editDistance('pickaso', 'picasso'), 2);
  assert.equal(editDistance('warhole', 'warhol'), 1);
  assert.equal(editDistance('abcdef', 'uvwxyz', 2), 3);
});

test('nicknames and card-year shorthand rewrite the query', () => {
  assert.deepEqual(rewriteQuery('the mick').words, ['mickey', 'mantle']);
  assert.deepEqual(rewriteQuery('MJ').words, ['michael', 'jordan']);
  assert.deepEqual(rewriteQuery('mantle 52 topps psa 8').words, ['mantle', '1952', 'topps', 'psa', '8']);
  assert.deepEqual(rewriteQuery('Ref. 5711/1A').words, ['ref', '5711', '1a']);
  assert.deepEqual(rewriteQuery('omega 145.022').words, ['omega', '145.022']);
});

test('names: exact, nickname, typo and descriptor queries land on the name', () => {
  assert.equal(top('mickey mantle'), '/player?id=mickey-mantle');
  assert.equal(top('the mick'), '/player?id=mickey-mantle');
  assert.equal(top('mickie mantle'), '/player?id=mickey-mantle');
  assert.equal(top('micheal jordan'), '/player?id=michael-jordan');
  assert.equal(top('warhole'), '/makers/andy-warhol');
  assert.equal(top('pokemon charzard'), '/entity?id=charizard');
  assert.equal(top('stars wars'), '/entity?id=starwars');
  assert.equal(top('pokemon sealed'), '/sub/tcg/pokemon-sealed');
  // the heavier name first when the rest describes the object
  const names = rankPalette('jordan rookie', idx).sections.find(s => s.key === 'names')!.rows.map(r => r.path);
  assert.equal(names[0], '/player?id=michael-jordan');
});

test('a word the live book carries is never "corrected" into a name', () => {
  const r = rankPalette('conoid', idx);
  assert.ok(!r.rows.some(x => x.path === '/makers/george-condo'));
  assert.equal(r.rows[0].kind, 'lot');
});

test('a full name match drops the partial ones', () => {
  const names = rankPalette('paul newman', idx).sections.find(s => s.key === 'names')!.rows;
  assert.deepEqual(names.map(r => r.label), ['Paul Newman']);
});

test('sections: a typed reference number leads; rooms by label only; sold last', () => {
  assert.deepEqual(sectionsOf('patek 5711')[0], 'refs');
  assert.equal(top('rolex 1675 gilt'), '/ref/rolex/1675');
  assert.equal(top('value'), '/value');
  // live lots that carry every word outrank names that carry part of it
  assert.equal(sectionsOf('nakashima conoid')[0], 'live');
  const withSold = rankPalette('warhol', idx, [{ id: 's', title: 'Marilyn', maker: 'andy-warhol', price: 1, date: '2020-01-01', house: 'X' }], 12);
  assert.equal(withSold.sections[withSold.sections.length - 1].key, 'sold');
  assert.equal(withSold.sections[withSold.sections.length - 1].count, 12);
});

test('dial nicknames reach the references', () => {
  const hits = matchRefs('daytona paul newman', REFS, refLabel, 6).map(h => h.row.ref);
  assert.deepEqual(hits, ['6263', '6239']);
  assert.deepEqual(matchRefs('pepsi', REFS, refLabel, 6).map(h => h.row.ref), ['1675']);
});

test('the sold query: shorthand applied, a half-typed short word held back', () => {
  assert.equal(soldQueryOf('mantle 52 topps', idx), 'mantle 1952 topps');
  assert.equal(soldQueryOf('nakashima co', idx), 'nakashima ');
  assert.equal(soldQueryOf('the mick', idx), 'mickey mantle ');
});

test('feed search: folded words anywhere, grade numbers glued, typos repaired against the book', () => {
  const m = (q: string) => LOTS.filter(feedQueryMatcher(q, LOTS)).map(l => l.id);
  assert.deepEqual(m('jordan rookie'), ['c']);
  assert.deepEqual(m('mantle 52 topps'), ['b']);
  assert.deepEqual(m('psa 8'), ['b']);
  assert.deepEqual(m('conoid'), ['a']);
  assert.deepEqual(m('marylin'), ['d']);
  assert.deepEqual(m(''), ['a', 'b', 'c', 'd']);
});
