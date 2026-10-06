/**
 * scripts/lib/classify.ts — the shared classification ladder (crawlers +
 * corpus-normalize reclassifyCorpus). Fixtures are REAL titles from the Oct 6
 * 2026 hand-labelled categorization audit (scratchpad dd-cat/labels.jsonl),
 * each pinned to the label the auditor gave it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCardTitle, goldinSportKind, reclassifyLot, DROP } from '../lib/classify';
import { goldinRoute } from '../lib/houses/routing';
import { reclassifyCorpus } from '../lib/corpus-normalize';

type R = Record<string, any>;
const L = (o: R): any => ({ id: 'x', artist: 'memorabilia', title: 't', category: 'object', auctionHouse: 'REA', saleName: '', status: 'sold', ...o });
const move = (o: R) => { const l = L(o); const r = reclassifyLot(l); return r.drop ? DROP : l.artist; };

test('class 1 · Goldin Sport facet: the card detector decides card; objects get their kind', () => {
  const cases: [string, string][] = [
    ['Ted Williams Signed Photo - 8 x 10 - JSA', 'autographs'],
    ['Mario Lemieux Signed Pittsburgh Penguins Home Jersey - Beckett', 'autographs'],
    ['Neymar Jr. Signed Paris Saint-Germain Jersey - Beckett', 'autographs'],
    ['2022 Bowman Baseball Factory-Sealed Jumbo Hobby Box (12 Packs) - Possible Elly De La Cruz, Jackson Chourio', 'unopened-wax'],
    ['Amazing Spider-Man #251, 253-267 (1984-85 Marvel) 16 Books - Raw - Spider-Man\'s Costume Revealed to be Alien S', DROP],
    ['1930s Babe Ruth Original News Service Photo by William Kuenzel - Batting Practice - PSA/DNA Type I', 'type-1-photos'],
    ['Oct. 18, 1993 Sports Illustrated Michael Jordan Cover (Newsstand) - Pop 13, None Higher - CGC 9.8', 'programs-publications'],
    ['2003 Yu-Gi-Oh! MFC Magician\'s Force #107 Diffusion Wave-Motion – PSA MINT 9', DROP],
    ['2021 Jonah Williams Los Angeles Rams White Practice-Used Jersey – Rams COA', 'game-used'],
    ['Wayne Gretzky Signed 75th NHL All-Star Game Jersey - JSA LOA', 'autographs'],
  ];
  for (const [t, want] of cases) assert.equal(goldinSportKind(t), want, t);
  // genuine cards stay cards — incl. the graded-title shapes looksLikeCard misses
  for (const t of [
    '1990 Leaf #125 Bo Jackson - PSA GEM MT 10',
    '11 T206 White Border Ty Cobb, Bat On Shoulder - PSA GD 2',
    '1985 Topps 1984 USA Baseball Team 401 Mark Mcgwire – PSA EX-MT 6',
    '1940 Play Ball Tris Speaker - PSA VG 3',
    'Mike Antonovich Signed Trading Card - PSA/DNA Authentic Autograph',
    '78 Topps Basketball Complete Set (132) - Featuring Kareem Abdul-Jabbar, Julius Erving, Pete Maravich',
  ]) {
    assert.ok(isCardTitle(t), t);
    assert.equal(goldinSportKind(t), 'sports-cards', t);
  }
  // the reclass rule only touches Goldin sports-cards rows
  assert.equal(move({ auctionHouse: 'Goldin', artist: 'sports-cards', title: 'Rivaldo Signed FC Barcelona Jersey - Beckett' }), 'autographs');
  assert.equal(move({ auctionHouse: 'REA', artist: 'graded-cards', title: 'Rivaldo Signed FC Barcelona Jersey - Beckett' }), 'graded-cards');
  // crawler parity: the sport-scoped Goldin route reads the same ladder
  assert.equal(goldinRoute('Rivaldo Signed FC Barcelona Jersey - Beckett', true), 'autographs');
  assert.equal(goldinRoute('2002 Yu-Gi-Oh! Metal Raiders 1st Edition #MRD-031 Leghul - PSA GEM MT 10', true), 'blocked');
  assert.equal(goldinRoute('1990 Leaf #125 Bo Jackson - PSA GEM MT 10', true), 'sports-cards');
});

test('reclassifyCorpus: moves, evicts, counts per class; idempotent', () => {
  const lots = [
    L({ id: 'a', auctionHouse: 'Goldin', artist: 'sports-cards', title: 'Kaka Signed Brazil Jersey - Beckett' }),
    L({ id: 'b', auctionHouse: 'Goldin', artist: 'sports-cards', title: '2025 One Piece OP-11 A Fist of Divine Speed Factory-Sealed Booster Box (24 Packs)' }),
    L({ id: 'c', auctionHouse: 'Goldin', artist: 'sports-cards', title: '1990 Score #556 Jerry Rice – PSA MINT 9' }),
  ];
  const r = reclassifyCorpus(lots);
  assert.equal(r.dropped, 1);
  assert.equal(r.byClass['goldin-sport-noncard'], 2);
  assert.deepEqual(lots.map(l => [l.id, l.artist]), [['a', 'autographs'], ['c', 'sports-cards']]);
  const again = reclassifyCorpus(lots);
  assert.deepEqual(again, { byClass: {}, dropped: 0 });
});
