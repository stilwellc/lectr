/**
 * Chips audit (Oct 9): the sub-category strip (taxonomy subChipsOf — one
 * builder for FeedToolbar, TriageBar and a maker page's lot browser) and the
 * facet strip's cuts (facets.facetChips): a chip that keeps ≥95% of its pool
 * is dropped, a dropped parent opens its children, strays get no chip, a
 * guest category is one chip, catch-alls run last, Fine Art has no medium
 * chips.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subChipsOf, MARKET_CATS, cutsSomething } from '../taxonomy';
import { facetChips, facetCatOf, facetsFor, toggleFacet, lotFacets, cardBadgesOf } from '../facets';

const card = (title: string) => ({ artist: 'sports-cards', subCat: 'cards', drill: 'baseball', title });
const mem = (title: string, artist = 'game-used') => ({ artist, subCat: '', drill: 'baseball', title });
const ent = (title: string, subCat = 'props', drill = 'hollywood') => ({ artist: 'entertainment-memorabilia', subCat, drill, title });
const hist = (title: string, drill = 'political') => ({ artist: 'entertainment-memorabilia', subCat: 'documents', drill, title });
const watch = (title: string, subCat = 'wristwatches') => ({ artist: 'patek-philippe', subCat, title });
const tcg = (title: string, sub = 'classic') => ({ artist: 'pokemon', subCat: '', drill: sub, title });
const rep = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
const NONE = { cat: null, sub: null };

test('NEAR_TOTAL: a chip keeping ≥95% of its pool cuts nothing', () => {
  assert.ok(cutsSomething(9, 10));
  assert.ok(!cutsSomething(19, 20));
  assert.ok(!cutsSomething(70, 72));
  assert.ok(!cutsSomething(0, 10));
});

test('subs: a dominant sub drops, and so do its crumbs', () => {
  const pool = [...rep(70, i => watch(`Ref ${i}`)), watch('Pocket', 'pocket-watches'), watch('Clock', 'clocks')];
  assert.deepEqual(subChipsOf(pool, NONE, MARKET_CATS.watches).map(c => `${c.label} ${c.n}`), []);
  // the picked chip always shows, even the dominant one
  assert.ok(subChipsOf(pool, { cat: 'watches', sub: 'wristwatches' }, MARKET_CATS.watches).some(c => c.sub === 'wristwatches'));
});

test('subs: strays get no chip, categories group, the catch-all runs last', () => {
  const pool = [
    ...rep(10, i => card(`200${i} Topps #${i} Player - PSA 9`)),
    ...rep(4, i => mem(`Game-Used Bat ${i}`)),
    ...rep(5, i => mem(`Signed Pennant ${i}`, 'sports-memorabilia')),
    ...rep(3, i => mem(`Production-Worn Trunks from Rocky (1976) ${i}`)),
  ];
  const chips = subChipsOf(pool, NONE, MARKET_CATS.sports);
  assert.ok(!chips.some(c => c.cat === 'entertainment'), 'a film costume a sports house sells: no chip');
  assert.deepEqual(chips.map(c => c.label), ['Cards · Singles', 'Game-Used & Worn', 'Equipment & Collectibles']);
  // without the market's cats the stray would be chipped
  assert.ok(subChipsOf(pool, NONE).some(c => c.cat === 'entertainment'));
});

test('subs: a guest category is one chip, its subs right after it once picked', () => {
  const pool = [
    ...rep(6, i => ent(`Prop ${i}`)), ...rep(4, i => ent(`Guitar ${i}`, 'instruments', 'music')),
    ...rep(3, i => hist(`Lincoln Document Signed ${i}`)), ...rep(2, i => hist(`Royal Letter ${i}`, 'royalty')),
  ];
  const top = subChipsOf(pool, NONE, MARKET_CATS.culture);
  assert.deepEqual(top.map(c => `${c.label} ${c.n}`), ['Props & Wardrobe 6', 'Instruments, Records & Awards 4', 'Historical & Documents 5']);
  assert.equal(top[2].sub, null);
  const open = subChipsOf(pool, { cat: 'historical', sub: null }, MARKET_CATS.culture);
  assert.deepEqual(open.slice(2).map(c => c.label), ['Historical & Documents', 'Presidential & Political', 'Royalty & World Leaders']);
});

test('subs: a picked sub emptied by another filter shows its 0', () => {
  const chips = subChipsOf([watch('a'), watch('b', 'pocket-watches')], { cat: 'watches', sub: 'clocks' }, MARKET_CATS.watches);
  assert.ok(chips.some(c => c.sub === 'clocks' && c.n === 0));
});

test('facets: a near-total chip drops ("Signed 474" inside Autographs 477)', () => {
  const pool = [...rep(20, i => mem(`Signed Baseball ${i}`, 'autographs')), mem('Unsigned Cap', 'autographs')];
  assert.ok(!facetChips('sports-memorabilia', pool, []).some(c => c.key === 'auto'));
});

test('facets: a near-total PARENT opens its children, and a tap picks it too', () => {
  // every slab, two graders: Graded is implied, the graders show with via
  const pool = [...rep(18, i => tcg(`Pokemon #${i} Pikachu - PSA 10`)), tcg('Pokemon #99 Mew - CGC 9.5'), tcg('Pokemon #98 Raw Mew')];
  const chips = facetChips('tcg', pool, []);
  assert.ok(!chips.some(c => c.key === 'graded'));
  const psa = chips.find(c => c.key === 'psa');
  assert.ok(psa && psa.n === 18 && psa.via?.join() === 'graded');
  assert.ok(chips.some(c => c.key === 'raw' && c.n === 1), 'the complement stays');
  assert.deepEqual(toggleFacet([], 'psa', psa.via), ['graded', 'psa']);
  // a grader that is EVERY slab is implied too: the grade ladder opens
  const one = facetChips('tcg', [tcg('a #1 - PSA 10'), tcg('b #2 - PSA 9'), tcg('c #3 - PSA 10')], []);
  const g10 = one.find(c => c.key === 'g10');
  assert.ok(g10 && g10.n === 2 && g10.via?.join() === 'graded,psa');
  // …but a 95% grader is not (a BGS 9.5 is not a PSA 9.5)
  const mixed = facetChips('tcg', [...rep(19, i => tcg(`x #${i} - PSA 10`)), tcg('y #50 - BGS 9.5')], []);
  assert.ok(!mixed.some(c => c.group === 'grade'));
  // Film & TV holding every lot opens the franchises directly
  const film = facetChips('entertainment', [ent('Star Wars Stormtrooper Helmet'), ent('Star Wars Prop Blaster'), ent('Harry Potter Wand'), ent('Prop Hat')], []);
  assert.ok(film.some(c => c.key === 'fr-starwars' && c.via?.join() === 'film-tv'));
  assert.ok(!film.some(c => c.key === 'film-tv'));
});

test('facets: complications and franchises run biggest first', () => {
  const pool = [watch('A perpetual calendar'), watch('A GMT one'), watch('A GMT two'), watch('A GMT three'), watch('Chronograph'), watch('Chronograph 2'), watch('plain'), watch('plain 2')];
  assert.deepEqual(facetChips('watches', pool, []).map(c => c.key), ['cx-gmt', 'cx-chrono', 'cx-perpetual']);
});

test('Fine Art: no medium chips (the form splits 54 of 75), badges stay', () => {
  assert.deepEqual(facetsFor('fine-art'), []);
  const pool = [
    { artist: 'andy-warhol', subCat: 'originals', formKey: 'painting', title: 'Shoes' },
    { artist: 'andy-warhol', subCat: 'originals', formKey: 'work-on-paper', title: 'Drawing' },
    { artist: 'andy-warhol', subCat: 'originals', formKey: 'original-2d', title: 'Board' },
  ];
  assert.equal(facetCatOf(null, pool), null);
  assert.ok(lotFacets(pool[0]).has('painting'));
  assert.deepEqual(cardBadgesOf(pool[0]), ['Painting']);
  // an old shared link's pick stays on screen so it can be un-picked
  assert.deepEqual(facetsFor('fine-art', ['painting']).map(d => d.key), ['painting']);
});

test('facetCatOf: a market\'s strays do not make the pool two-category', () => {
  const space = (t: string) => ({ artist: 'space-exploration', subCat: 'space', drill: 'apollo', title: t });
  const pool = [space('Apollo 11 Flown Flag'), space('Signed Photo'), { artist: 'science-tech', subCat: '', title: 'Beatles Vinyl Records' }];
  assert.equal(facetCatOf(null, pool), null);
  assert.equal(facetCatOf(null, pool, { cats: MARKET_CATS.science }), 'space-science');
});

