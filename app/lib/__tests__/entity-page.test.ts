/**
 * The entity page's pure parts (makers overhaul P2): the retired pseudo-maker
 * map, the facet splits (grade / language / object), and the lens labels.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { ARTISTS, MAKER_MARKETS, type Market } from '../../constants';
import { RETIRED_MAKERS, retiredTarget, makerHref, PAGE_MAKERS } from '../entity/retired';
import { facetGroupsOf, facetKeysFor, facetSplits } from '../entity/facets';
import type { SoldPoint } from '../entity/stats';
import { shortLens, drillSlugOf } from '../entity/lens';

test('every category pseudo-maker is retired, no named maker is', () => {
  for (const a of ARTISTS) {
    const maker = MAKER_MARKETS.has(a.market as Market);
    assert.strictEqual(!!retiredTarget(a.slug), !maker, a.slug);
  }
  assert.strictEqual(PAGE_MAKERS.length, ARTISTS.filter(a => MAKER_MARKETS.has(a.market as Market)).length);
  // a target is never itself a maker page
  for (const to of Object.values(RETIRED_MAKERS)) assert.ok(!to.startsWith('/makers/'), to);
});

test('makerHref links a real maker to its page and a retired slug to its home', () => {
  assert.strictEqual(makerHref('andy-warhol'), '/makers/andy-warhol');
  assert.strictEqual(makerHref('pokemon'), '/sub/tcg/pokemon-cards');
  assert.strictEqual(makerHref('graded-cards'), '/sports?cat=sports-cards&sub=singles&tab=all#on-the-block');
  assert.strictEqual(makerHref('meteorites'), '/entity?id=cs%3Aspace-science%3Ameteorites');
});

test('facet groups by entity kind', () => {
  assert.deepStrictEqual(facetGroupsOf('sj:tcg|k:charizard'), ['grade', 'lang']);
  assert.deepStrictEqual(facetGroupsOf('st:tcg|s:base-set'), ['grade', 'lang']);
  assert.deepStrictEqual(facetGroupsOf('sj:science|m:apollo-11'), ['object']);
  assert.strictEqual(facetGroupsOf('mk:andy-warhol'), null);
  assert.strictEqual(facetKeysFor('mk:andy-warhol', { title: 'x', artist: 'andy-warhol' }), undefined);
});

const pt = (p: number, d: string, t: string, id: string, lens = 'tcg:vintage', artist = 'pokemon'): SoldPoint => ({
  p, d, h: 'Goldin', lens, coarse: 'tcg', id: t + p + d, t, img: null, fx: facetKeysFor(id, { title: t, artist }),
});

test('grade ladder: PSA 9 / PSA 10 / other slabs / raw, medians n-gated on the trailing year', () => {
  const id = 'sj:tcg|k:charizard';
  const rows: SoldPoint[] = [];
  for (let i = 0; i < 6; i++) rows.push(pt(1000 + i, '2026-05-01', '1999 Pokemon Base Set Holo #4 Charizard - PSA GEM MT 10', id));
  for (let i = 0; i < 5; i++) rows.push(pt(400 + i, '2026-06-01', '1999 Pokemon Base Set Holo #4 Charizard - PSA MINT 9', id));
  rows.push(pt(300, '2026-06-01', '1999 Pokemon Base Set Holo #4 Charizard - BGS 9.5', id));
  rows.push(pt(500, '2020-06-01', '1999 Pokemon Base Set Holo #4 Charizard - PSA GEM MT 10', id)); // outside 12 mo
  const g = facetSplits(id, rows, '2026-10-09')!;
  const grade = g.find(x => x.key === 'grade')!;
  const by = Object.fromEntries(grade.rows.map(r => [r.key, r]));
  assert.strictEqual(by['psa-10'].n, 7);
  assert.strictEqual(by['psa-10'].n12, 6);
  assert.ok(by['psa-10'].med12m! >= 1000);
  assert.strictEqual(by['psa-9'].n12, 5);
  assert.ok(by['psa-9'].med12m != null);
  assert.strictEqual(by['graded-other'].n, 1);
  assert.strictEqual(by['graded-other'].med12m, null); // n=1 never prints a median
});

test('grade ladder (r7): PSA 8 apart from the 7–8.5 chip bucket; BGS / CGC rungs only where n allows a median', () => {
  const id = 'sj:tcg|k:charizard';
  const rows: SoldPoint[] = [];
  for (let i = 0; i < 5; i++) rows.push(pt(700 + i, '2026-05-01', '1999 Pokemon Base Set Holo #4 Charizard - PSA NM-MT 8', id));
  rows.push(pt(650, '2026-05-01', '1999 Pokemon Base Set Holo #4 Charizard - PSA NM-MT+ 8.5', id)); // not PSA 8
  for (let i = 0; i < 5; i++) rows.push(pt(3000 + i, '2026-06-01', '1999 Pokemon Base Set Holo #4 Charizard - BGS 9.5', id));
  for (let i = 0; i < 2; i++) rows.push(pt(9000 + i, '2026-06-01', '1999 Pokemon Base Set Holo #4 Charizard - CGC 10', id)); // under the gate
  const grade = facetSplits(id, rows, '2026-10-09')!.find(x => x.key === 'grade')!;
  const by = Object.fromEntries(grade.rows.map(r => [r.key, r]));
  assert.strictEqual(by['psa-8'].n12, 5);
  assert.strictEqual(by['psa-8'].med12m, 702);
  assert.strictEqual(by['bgs-9.5'].n12, 5);
  assert.strictEqual(by['bgs-9.5'].med12m, 3002);
  // the CGC 10 rung cannot print a median: left off, folded into the other slabs (with the PSA 8.5)
  assert.strictEqual(by['cgc-10'], undefined);
  assert.strictEqual(by['graded-other'].n, 3);
  // every graded point sits in exactly one rung
  assert.strictEqual(grade.rows.reduce((s, r) => s + r.n, 0), rows.length);
});

test('grade ladder (r7): an athlete reads it over their cards only — memorabilia never picks the lens', () => {
  const id = 'pl:mickey-mantle';
  assert.deepStrictEqual(facetGroupsOf(id), ['grade']);
  const card = (p: number, t: string) => pt(p, '2026-04-01', t, id, 'sports-cards:singles', 'graded-cards');
  const rows: SoldPoint[] = [];
  for (let i = 0; i < 5; i++) rows.push(card(20000 + i, '1952 Topps #311 Mickey Mantle PSA 8'));
  for (let i = 0; i < 5; i++) rows.push(card(90000 + i, '1952 Topps #311 Mickey Mantle PSA 9'));
  rows.push(card(400, '1952 Topps #311 Mickey Mantle'));
  // more memorabilia than cards in the year — the ladder still reads the cards
  for (let i = 0; i < 20; i++) rows.push(pt(500, '2026-04-01', 'Mickey Mantle Signed Baseball', id, 'sports-memorabilia:autographs', 'autographs'));
  // the athlete's points carry only the ladder's keys
  assert.ok(rows[0].fx!.every(k => ['graded', 'psa', 'g7', 'gn:8'].includes(k)), rows[0].fx!.join());
  const grade = facetSplits(id, rows, '2026-10-09')!.find(x => x.key === 'grade')!;
  const by = Object.fromEntries(grade.rows.map(r => [r.key, r]));
  assert.strictEqual(grade.scope, undefined); // one lens among the graded points
  assert.strictEqual(by['psa-8'].med12m, 20002);
  assert.strictEqual(by['psa-9'].med12m, 90002);
  assert.strictEqual(by.raw.n, 1);
  assert.strictEqual(by.raw.med12m, null);
});

test('a facet split reads ONE lens when the entity spans several', () => {
  const id = 'sj:tcg|k:charizard';
  const rows: SoldPoint[] = [];
  for (let i = 0; i < 6; i++) rows.push(pt(50, '2026-05-01', '2023 Pokemon 151 Charizard ex - PSA GEM MT 10', id, 'tcg:modern'));
  for (let i = 0; i < 6; i++) rows.push(pt(60, '2026-05-01', '2023 Pokemon 151 Charizard ex - PSA MINT 9', id, 'tcg:modern'));
  rows.push(pt(9000, '2026-05-01', '1999 Pokemon Base Set Charizard - PSA MINT 9', id, 'tcg:vintage'));
  const grade = facetSplits(id, rows, '2026-10-09')!.find(x => x.key === 'grade')!;
  assert.strictEqual(grade.scope, 'tcg:modern');
  assert.strictEqual(grade.rows.find(r => r.key === 'psa-9')!.n, 6);
});

test('mission object split: flown / signed / everything else, each lot once', () => {
  const id = 'sj:science|m:apollo-11';
  const sp = (t: string) => pt(1000, '2026-03-01', t, id, 'space-science:apollo', 'space-exploration');
  const rows = [sp('Apollo 11 Flown Robbins Medallion'), sp('Apollo 11 Crew-Signed Insurance Cover'), sp('Apollo 11 Press Kit')];
  const obj = facetSplits(id, rows, '2026-10-09')!.find(x => x.key === 'object')!;
  assert.deepStrictEqual(obj.rows.map(r => r.n), [1, 1, 1]);
});

test('lens labels and drill slugs speak the live chips', () => {
  assert.strictEqual(shortLens('sports-cards:singles', 'Sports Cards · Singles'), 'Cards');
  assert.strictEqual(shortLens('sports-memorabilia:autographs', 'Sports Memorabilia · Autographs'), 'Autographs');
  assert.strictEqual(shortLens('fine-art:prints', 'Prints & Multiples'), 'Prints & Multiples');
  assert.strictEqual(drillSlugOf('sports-cards:singles', 'baseball'), 'cards:baseball');
  assert.strictEqual(drillSlugOf('sports-memorabilia:photographs', 'baseball'), 'photos:baseball');
  assert.strictEqual(drillSlugOf('fine-art:unique', null), 'art:originals');
  assert.strictEqual(drillSlugOf('tcg:vintage', null), 'pokemon-era:vintage');
  assert.strictEqual(drillSlugOf('sports-cards:singles', null), null);
});
