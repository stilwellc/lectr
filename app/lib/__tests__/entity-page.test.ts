/**
 * The entity page's pure parts (makers overhaul P2): the retired pseudo-maker
 * map, the facet splits (grade / language / object), and the lens labels.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { ARTISTS, MAKER_MARKETS, type Market } from '../../constants';
import { RETIRED_MAKERS, retiredTarget, makerHref, PAGE_MAKERS } from '../entity/retired';
import { facetGroupsOf, facetKeysFor, facetSplits, ladderNote } from '../entity/facets';
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

/* (r8) THE MATCHED GRADE LADDER — each rung prices the SAME cards (SoldPoint.kg) */
const card = (id: string, kg: string, p: number, d: string, t: string, lens = 'tcg:vintage', artist = 'pokemon'): SoldPoint => ({ ...pt(p, d, t, id, lens, artist), kg });
const CZ = 'sj:tcg|k:charizard';
const G = { 8: 'PSA NM-MT 8', 9: 'PSA MINT 9', 10: 'PSA GEM MT 10' } as const;
/** six cards, each sold at PSA 8, 9 and 10 (×0.5 / ×1 / ×2.5 of its own base) */
function ladderRows(): SoldPoint[] {
  const rows: SoldPoint[] = [];
  for (let c = 0; c < 6; c++) {
    const base = 100 * (c + 1);
    const t = (g: 8 | 9 | 10) => `1999 Pokemon Base Set Holo #${c + 1} Charizard - ${G[g]}`;
    rows.push(card(CZ, `card-${c}`, base * 0.5, '2026-03-01', t(8)));
    rows.push(card(CZ, `card-${c}`, base, '2026-04-01', t(9)));
    rows.push(card(CZ, `card-${c}`, base * 2.5, '2026-05-01', t(10)));
  }
  return rows;
}

test('grade ladder (r8): the same cards at each grade — a mix of cheap PSA 10s cannot invert it', () => {
  const rows = ladderRows();
  // 30 cheap modern PSA 10s, sold at no other grade: under a plain median per rung they made
  // PSA 10 read below PSA 9 (Mantle: $215 PSA 10 under an $8,224 PSA 9)
  for (let i = 0; i < 30; i++) rows.push(card(CZ, `cheap-${i}`, 20, '2026-06-01', `2023 Pokemon 151 #${200 + i} Charizard - ${G[10]}`));
  const grade = facetSplits(CZ, rows, '2026-10-09')!.find(x => x.key === 'grade')!;
  const by = Object.fromEntries(grade.rows.map(r => [r.key, r]));
  assert.strictEqual(grade.basis, 'matched');
  assert.strictEqual(grade.base, 'psa-9');
  assert.strictEqual(grade.cards, 6);
  // the base rung: the median price those six cards sold at as PSA 9 ($350); the others its premium
  assert.strictEqual(by['psa-9'].med12m, 350);
  assert.strictEqual(by['psa-8'].med12m, 175);
  assert.strictEqual(by['psa-10'].med12m, 875);
  // n = the cards matched at that grade; all-time sales still count every PSA 10
  assert.strictEqual(by['psa-10'].n12, 6);
  assert.strictEqual(by['psa-10'].n, 36);
  assert.ok(by['psa-8'].med12m! < by['psa-9'].med12m! && by['psa-9'].med12m! < by['psa-10'].med12m!);
  assert.ok(ladderNote(grade).includes('6 cards') && ladderNote(grade).includes('PSA 9'), ladderNote(grade));
});

test('grade ladder (r8): a rung needs five matched cards; a ladder that still falls prints no level', () => {
  // four cards only → nothing prices (the gate is MIN_MED_N cards)
  const four = ladderRows().filter(r => !['card-4', 'card-5'].includes(r.kg!));
  const g4 = facetSplits(CZ, four, '2026-10-09')!.find(x => x.key === 'grade')!;
  assert.ok(g4.rows.every(r => r.med12m == null));
  // the same cards falling from PSA 9 to PSA 10 is noise the ladder never prints
  const inv = ladderRows().map(r => (r.t.includes('GEM MT 10') ? { ...r, p: r.p / 10 } : r));
  const gi = facetSplits(CZ, inv, '2026-10-09')!.find(x => x.key === 'grade')!;
  assert.ok(gi.rows.every(r => r.med12m == null));
  // …and a raw read at or above a slab's is no raw card: the raw rung alone leaves
  const raw = ladderRows();
  for (let c = 0; c < 6; c++) raw.push(card(CZ, `card-${c}`, 100 * (c + 1) * 3, '2026-02-01', `1999 Pokemon Base Set Holo #${c + 1} Charizard`));
  const gr = facetSplits(CZ, raw, '2026-10-09')!.find(x => x.key === 'grade')!;
  const by = Object.fromEntries(gr.rows.map(r => [r.key, r]));
  assert.strictEqual(by.raw.med12m, null);
  assert.strictEqual(by['psa-10'].med12m, 875);
});

test('grade ladder (r8): an optional slab rung prints only on five matched cards, else folds into Other graded', () => {
  const rows = ladderRows();
  for (let c = 0; c < 5; c++) rows.push(card(CZ, `card-${c}`, 100 * (c + 1) * 2, '2026-06-01', `1999 Pokemon Base Set Holo #${c + 1} Charizard - BGS 9.5`));
  for (let c = 0; c < 2; c++) rows.push(card(CZ, `card-${c}`, 100 * (c + 1) * 4, '2026-06-01', `1999 Pokemon Base Set Holo #${c + 1} Charizard - CGC 10`));
  const grade = facetSplits(CZ, rows, '2026-10-09')!.find(x => x.key === 'grade')!;
  const by = Object.fromEntries(grade.rows.map(r => [r.key, r]));
  assert.strictEqual(by['bgs-9.5'].n12, 5);
  assert.strictEqual(by['bgs-9.5'].med12m, 700);
  assert.strictEqual(by['cgc-10'], undefined);
  // the other slabs are many grades in one row: counted, never priced
  assert.strictEqual(by['graded-other'].n, 2);
  assert.strictEqual(by['graded-other'].med12m, null);
  // every graded point sits in exactly one row
  assert.strictEqual(grade.rows.reduce((s, r) => s + r.n, 0), rows.length);
});

test('grade ladder (r8): an athlete reads it over their cards only — memorabilia never picks the lens', () => {
  const id = 'pl:mickey-mantle';
  assert.deepStrictEqual(facetGroupsOf(id), ['grade']);
  const rows: SoldPoint[] = [];
  for (let c = 0; c < 5; c++) {
    const t = (g: string) => `1952 Topps #${300 + c} Mickey Mantle ${g}`;
    rows.push(card(id, `mantle-${c}`, 20000 + c, '2026-04-01', t('PSA 8'), 'sports-cards:singles', 'graded-cards'));
    rows.push(card(id, `mantle-${c}`, 90000 + c, '2026-04-01', t('PSA 9'), 'sports-cards:singles', 'graded-cards'));
  }
  // more memorabilia than cards in the year — the ladder still reads the cards
  for (let i = 0; i < 20; i++) rows.push(pt(500, '2026-04-01', 'Mickey Mantle Signed Baseball', id, 'sports-memorabilia:autographs', 'autographs'));
  // the athlete's points carry only the ladder's keys
  assert.ok(rows[0].fx!.every(k => ['graded', 'psa', 'g7', 'gn:8'].includes(k)), rows[0].fx!.join());
  const grade = facetSplits(id, rows, '2026-10-09')!.find(x => x.key === 'grade')!;
  const by = Object.fromEntries(grade.rows.map(r => [r.key, r]));
  assert.strictEqual(grade.scope, undefined); // one lens among the graded points
  assert.strictEqual(by['psa-9'].med12m, 90002);
  assert.strictEqual(by['psa-8'].med12m, Math.round(90002 * Math.exp((Math.log(20000) + Math.log(20001) + Math.log(20002) + Math.log(20003) + Math.log(20004) - Math.log(90000) - Math.log(90001) - Math.log(90002) - Math.log(90003) - Math.log(90004)) / 5)));
  // a row that never sold is left off (Pikachu's "Raw · 0 sales")
  assert.strictEqual(by.raw, undefined);
});

test('team season facet (r8): one team entity, its seasons as rows', () => {
  const id = 'sj:sports|t:new-york-yankees';
  assert.deepStrictEqual(facetGroupsOf(id), ['season']);
  assert.deepStrictEqual(facetKeysFor(id, { title: '1961 New York Yankees Team-Signed Ball', artist: 'autographs' }), ['season:1961']);
  const tp = (p: number, t: string) => ({ ...pt(p, '2026-05-01', t, id, 'sports-memorabilia:autographs', 'autographs') });
  const rows: SoldPoint[] = [];
  for (let i = 0; i < 6; i++) rows.push(tp(500 + i, '1961 New York Yankees Team-Signed Ball'));
  for (let i = 0; i < 2; i++) rows.push(tp(900, '1998 New York Yankees Team-Signed Bat'));
  rows.push(tp(100, 'New York Yankees Pennant'));
  const g = facetSplits(id, rows, '2026-10-09')!.find(x => x.key === 'season')!;
  assert.deepStrictEqual(g.rows.map(r => [r.label, r.n, r.med12m]), [['1961', 6, 503], ['Other seasons', 2, null], ['No season named', 1, null]]);
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
