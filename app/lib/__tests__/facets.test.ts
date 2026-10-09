/**
 * In-category facets (app/lib/facets): card kind + era read from the title,
 * the entertainment domain from the taxonomy, era/graded-raw exclusivity, and
 * chips that cut nothing are dropped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotFacets, passesFacets, toggleFacet, facetChips, facetCatOf } from '../facets';
import { passesTriage, TRIAGE_DEFAULTS, triageFromParams, triageToParams, patchTriage } from '../feed-filters';

const card = (title: string, sub = 'cards') => ({ artist: 'sports-cards', subCat: sub, drill: 'baseball', title });

test('card facets from the title', () => {
  const f = lotFacets(card('2018 Topps Chrome Update #HMT1 Shohei Ohtani Rookie Card Signed (#12/25) - PSA GEM MT 10'));
  for (const k of ['graded', 'rookie', 'numbered', 'era-modern']) assert.ok(f.has(k), k);
  assert.ok(!f.has('raw'));
  const pre = lotFacets(card('1909-11 T206 White Border Honus Wagner'));
  assert.ok(pre.has('raw') && pre.has('era-prewar'));
  assert.ok(lotFacets(card('2026 Topps Pristine Popular Demand Autograph Relic Orange #PDAR-SO Shohei Ohtani Signed Game-Used Relic Card (#05/25) - Topps Encased')).has('relic'));
});

test('a sealed box is not a rookie, and has no graded/raw', () => {
  const f = lotFacets({ artist: 'unopened-wax', subCat: 'wax', drill: 'baseball', title: '2018 Topps Chrome Baseball Factory-Sealed Hobby Jumbo Box (12 Packs) - Possible Shohei Ohtani Rookie Cards' });
  assert.ok(!f.has('rookie') && !f.has('raw') && !f.has('graded'));
  assert.ok(f.has('era-modern'));
});

test('entertainment domain facet', () => {
  assert.ok(lotFacets({ artist: 'entertainment-memorabilia', subCat: 'props', drill: 'hollywood', title: 'x' }).has('film-tv'));
  assert.ok(lotFacets({ artist: 'music-memorabilia', subCat: 'instruments', title: 'y' }).has('music'));
});

test('toggle: one era at a time, graded xor raw, others AND', () => {
  assert.deepEqual(toggleFacet(['era-prewar', 'rookie'], 'era-modern'), ['rookie', 'era-modern']);
  assert.deepEqual(toggleFacet(['graded'], 'raw'), ['raw']);
  assert.deepEqual(toggleFacet(['graded', 'rookie'], 'rookie'), ['graded']);
  assert.ok(passesFacets(card('2018 Topps Chrome #1 Ohtani Rookie - PSA 10'), ['graded', 'rookie']));
  assert.ok(!passesFacets(card('2018 Topps Chrome #1 Ohtani Rookie - PSA 10'), ['raw']));
});

test('chips: categories without facets, all-or-nothing chips dropped', () => {
  assert.equal(facetCatOf(null, [{ artist: 'andy-warhol', subCat: 'prints' }]), null);
  assert.equal(facetCatOf(null, [card('a'), card('b')]), 'sports-cards');
  const pool = [card('2018 Topps #1 A Rookie - PSA 10'), card('2019 Topps #2 B - PSA 9')];
  const keys = facetChips('sports-cards', pool, []).map(c => c.key);
  assert.ok(keys.includes('rookie'), 'splits the pool');
  assert.ok(!keys.includes('graded'), 'every lot graded → cuts nothing');
  assert.ok(!keys.includes('era-prewar'), 'matches nothing');
});

test('triage: fx filters, round-trips the URL, clears on a category change', () => {
  const f: typeof TRIAGE_DEFAULTS = { ...TRIAGE_DEFAULTS, cat: 'sports-cards', fx: ['rookie'] };
  assert.ok(passesTriage(card('2018 Topps #1 A Rookie - PSA 10'), f));
  assert.ok(!passesTriage(card('2019 Topps #2 B - PSA 9'), f));
  const p = new URLSearchParams(); triageToParams(f, p);
  assert.equal(p.get('fx'), 'rookie');
  assert.deepEqual(triageFromParams(p).fx, ['rookie']);
  assert.deepEqual(patchTriage(f, { cat: 'tcg' }).fx, []);
  assert.deepEqual(patchTriage(f, { win: 'today' }).fx, ['rookie']);
});

test('a picked domain keeps its sibling offered', () => {
  const pool = [
    { artist: 'entertainment-memorabilia', subCat: 'props', drill: 'hollywood', title: 'a' },
    { artist: 'music-memorabilia', subCat: 'instruments', title: 'b' },
    { artist: 'entertainment-memorabilia', subCat: 'other', title: 'c' },
  ];
  assert.deepEqual(facetChips('entertainment', pool, ['film-tv']).map(c => c.key), ['film-tv', 'music']);
  assert.deepEqual(toggleFacet(['film-tv'], 'music'), ['music']);
});
