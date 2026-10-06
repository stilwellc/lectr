/**
 * scripts/lib/classify.ts — the shared classification ladder (crawlers +
 * corpus-normalize reclassifyCorpus). Fixtures are REAL titles from the Oct 6
 * 2026 hand-labelled categorization audit (scratchpad dd-cat/labels.jsonl),
 * each pinned to the label the auditor gave it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCardTitle, goldinSportKind, reclassifyLot, artCategoryFix, DROP } from '../lib/classify';
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

test('class 2 · art: Madoura ceramics → sculpture, unique mediums → original, real prints untouched', () => {
  const A = (o: R) => ({ artist: 'pablo-picasso', category: 'print', title: '', medium: '', description: '', ...o });
  const cases: [R, string | null][] = [
    [{ title: 'Pablo Picasso (1881-1973) Poisson bleu', description: "Pablo Picasso (1881-1973) Poisson bleu stamped, marked and numbered 'Madoura Plein Feu/Empreinte Originale de Picasso/106/200' (underneath) partially glazed ceramic plate" }, 'sculpture'],
    [{ title: 'vase aux chèvres (a. r. 156)' }, 'sculpture'],
    [{ title: 'PABLO PICASSO Face in Thick Relief (A.R. 408)' }, 'sculpture'],
    [{ title: 'Pitcher with Birds', category: 'design', medium: 'White earthenware clay turned pitcher with decoration in engobes under partial b' }, 'sculpture'],
    [{ artist: 'henri-matisse', title: 'Henri Matisse (1869-1954) Fermes en Bretagne, Belle-Île', description: "Henri Matisse (1869-1954) Fermes en Bretagne, Belle-Île signed and dated 'H. MATISSE 97' (lower left) oil on canvas 18 x 21 5/8 in." }, 'original'],
    [{ artist: 'andy-warhol', title: 'Andy Warhol (1928-1987) Four-foot Flowers', description: "signed and dedicated 'to Roy L. Andy Warhol' (on the reverse) synthetic polymer and silkscreen inks on canvas 48 x 48 in." }, 'original'],
    [{ artist: 'henri-matisse', title: 'Tête de fille et feuillage', medium: 'ink and pencil on paper8 x 103⁄8 in' }, 'original'],
    [{ artist: 'francis-bacon', category: 'unknown', title: 'Seated Man', description: 'FRANCIS BACON (1909-1992) Seated Man oil on canvas 55 x 43 3/8in.' }, 'original'],
    // real prints and print posters stay
    [{ title: 'Madoura (Bloch 1021: Baer 1270) Linocut printed in colours, 1961, on wove' }, null],
    [{ title: 'affiche exposition de céramiques (bloch 1281; mourlot 314; czwiklitzer 31)' }, null],
    [{ artist: 'andy-warhol', title: 'Untitled', medium: 'screenprint and collage on paper' }, null],
    // not an art maker → never touched
    [{ artist: 'george-nakashima', category: 'design', title: 'glazed ceramic lamp' }, null],
  ];
  for (const [o, want] of cases) assert.equal(artCategoryFix(A(o)), want, o.title);
  const l = L({ artist: 'pablo-picasso', category: 'print', title: 'pichet espagnol (a. r. 244)', auctionHouse: "Sotheby's" });
  assert.deepEqual(reclassifyLot(l), { fired: ['art-ceramic-unique-vs-print'], drop: false });
  assert.equal(l.category, 'sculpture');
  assert.deepEqual(reclassifyLot(l), { fired: [], drop: false }, 'idempotent');
});

test('class 3 · sports-house pop-memorabilia → sports kinds; toys/comics evicted; genuine pop stays', () => {
  const P = (title: string, house = 'Huggins & Scott') => move({ auctionHouse: house, artist: 'pop-memorabilia', title });
  assert.equal(P('1955-56 Parkhurst Hockey Complete Set of (79/79) Cards'), 'graded-cards');
  assert.equal(P('Mostly 2000-Present Multi-Sport Warehouse Lot of (750,000+) Cards'), 'graded-cards');
  assert.equal(P('(11) 1947-1953 New York Yankees Programs'), 'programs-publications');
  assert.equal(P('1954 Sports Illustrated Issue #1', 'REA'), 'programs-publications');
  assert.equal(P('1925 Pittsburgh Pirates World Series Champions Pin', 'REA'), 'memorabilia');
  assert.equal(P('234 1920s All Star Boxing Show with Tommy Ryan, Erie, Pennsylvania Poster', 'Lelands'), 'memorabilia');
  assert.equal(P('(5) 1963-1967 Pro Football Championship Game Programs'), 'programs-publications');
  assert.equal(P('(6) CGC Graded 1944-52 Captain Marvel Adventures “Gold Age” Comic Books'), DROP);
  assert.equal(P('1971 Beach Boys Syria Mosque Concert Poster', 'REA'), 'pop-memorabilia');
  assert.equal(P('1910s to 1960s Non-Sport Set Collection (26 sets)', 'REA'), DROP);
  // Hake's: toys and comics have no home, whatever slug they were filed under
  assert.equal(move({ auctionHouse: "Hake's", artist: 'pop-memorabilia', title: 'STAR WARS: RETURN OF THE JEDI (1983) - BIB FORTUNA 65 BACK-B CARDED ACTION FIGURE (TSUKUDA STICKER).' }), DROP);
  assert.equal(move({ auctionHouse: "Hake's", artist: 'graded-cards', title: 'AMAZING SPIDER-MAN #361 APRIL 1992 CGC 7.5 VF- (FIRST CARNAGE).' }), DROP);
  assert.equal(move({ auctionHouse: "Hake's", artist: 'unopened-wax', title: 'TEENAGE MUTANT NINJA TURTLES (1990) - SLUDGEMOBILE VEHICLE IN SEALED BOX.' }), DROP);
  assert.equal(move({ auctionHouse: "Hake's", artist: 'pop-memorabilia', title: 'LARGE I LIKE IKE BLUE PORTRAIT BUTTON.' }), 'pop-memorabilia');
});
