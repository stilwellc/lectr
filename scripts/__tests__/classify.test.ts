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
import { classifyForm } from '../../app/lib/comps';
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

test('class 4 · expansion-house sports kind: card first, game-used needs use language, vintage issues are cards', () => {
  const X = (artist: string, title: string, house = 'REA') => move({ auctionHouse: house, artist, title });
  assert.equal(X('autographs', '2016 Bowman Chrome Prospects Red Shimmer Autographed Refractor #CPA-JS Juan Soto #8/10 BGS GEM MINT 9.5 with 1'), 'graded-cards');
  assert.equal(X('autographs', 'Signed 2003 Donruss Team Heroes #460 Ichiro Suzuki - PSA/DNA'), 'graded-cards');
  assert.equal(X('autographs', '1939 Play Ball #48 Lefty Gomez Signed - PSA VG 3, PSA/DNA 8 Auto.', 'SCP'), 'graded-cards');
  assert.equal(X('memorabilia', '1928 Fro-Joy #3 Babe Ruth BVG 2.5', 'Huggins & Scott'), 'graded-cards');
  assert.equal(X('memorabilia', '172 1911 Zeenut PCL Henry Melchoir - SGC FAIR 20', 'Love of the Game'), 'graded-cards');
  assert.equal(X('memorabilia', '1933 DeLong Gum #7 Lou Gehrig (HOF) - PSA FR 1.5', 'Love of the Game'), 'graded-cards');
  assert.equal(X('game-used', 'Phil Rizzuto Autographed Lot of (3) with Jersey, Ball & 8x10 Photo', 'Huggins & Scott'), 'autographs');
  assert.equal(X('game-used', 'Ty Cobb Vintage 12" Decal Mini-Bat - Rare Decal', 'Memory Lane'), 'memorabilia');
  assert.equal(X('game-used', '89 Deion Sanders Cincinnati Reds Game Used Baseball Bat', 'Lelands'), 'game-used');
  // not cards: index cards, photos named with a card maker, card-photos
  assert.equal(X('autographs', 'Tris Speaker Signed 3x5 Card PSA/DNA MINT 9'), 'autographs');
  assert.equal(X('type-1-photos', 'Mickey Mantle Signed 16 x 20 Photograph (Upper Deck)'), 'type-1-photos');
  assert.equal(X('type-1-photos', 'Circa 1940s Babe Ruth Vintage Brown Brothers Photograph PSA/DNA Type IV - Image Used for 1933 Goudey Cards!'), 'type-1-photos');
  // other houses untouched
  assert.equal(X('game-used', 'Mickey Mantle Signed Bat - JSA', 'NFL Auction'), 'game-used');
});

test('class 5 · science at Christie\'s/Sotheby\'s must be earned by the title', () => {
  const S = (artist: string, title: string, saleName = '', house = "Christie's") => move({ auctionHouse: house, artist, title, saleName });
  // books & letters by scientists → science-tech; other books/artworks → evicted
  assert.equal(S('scientific-instruments', 'KEPLER, Johannes (1571-1630). Dioptrice seu Demonstratio eorum quae visui & visibilibus propter conspicilla no'), 'science-tech');
  assert.equal(S('scientific-instruments', 'KING, Augusta Ada, Countess of Lovelace (1815-52). Autograph letter signed to Albany Fonblanque (1793-1872). A'), 'science-tech');
  assert.equal(S('space-exploration', 'LAPLACE, Pierre Simon, Marquis de (1749-1827). Traité de mécanique céleste . Paris: Crapelet for J.B.M. Duprat'), 'science-tech');
  assert.equal(S('scientific-instruments', 'TAYLOR, ZACHARY, President . Autograph letter signed ("Z. Taylor") to Dr. A.P. Merrill in Natchez, Mississippi'), 'entertainment-memorabilia');
  assert.equal(S('scientific-instruments', 'ARKWRIGHT, Richard (1732-92). The Trial of a Cause instituted by Richard Pepper Arden, Esq; his Majesty\'s Atto'), DROP);
  assert.equal(S('scientific-instruments', 'Screaming Eagle--Vintage 2004 6 magnums per lot', 'Fine And Rare Wines Featu'), DROP);
  assert.equal(S('scientific-instruments', 'ISAMU NOGUCHI (1904-1988) Pylon', 'Post War To Present'), DROP);
  assert.equal(S('space-exploration', 'apollo and marsyas', 'Master Paintings Sculptur', "Sotheby's"), DROP);
  assert.equal(S('space-exploration', 'A rare TM (Masudaya) battery-operated Sonicon Rocket', 'The Paul Lips Robot And S'), DROP);
  assert.equal(S('space-exploration', 'HUANG YONGYU (b. 1924) Chicken and Duck Talk', 'Fine Chinese Modern Paint'), DROP);
  assert.equal(S('fossils', 'a george iii portland stone, blue john, specimen marbles and fossilised limestone table, the top late 18th/ear', 'The Pimlico Road', "Sotheby's"), DROP);
  // genuine science stays
  assert.equal(S('space-exploration', 'FLOWN Lunar Module Pin from Apollo X. Approx. ¾ in. tall lapel pin', 'Space Exploration'), 'space-exploration');
  assert.equal(S('scientific-instruments', 'An English 3¾-inch terrestrial globe SMITH & SON, [C.1850]', 'Travel Science  Natural H'), 'scientific-instruments');
  assert.equal(S('scientific-instruments', 'ensemble de trois sphères armillaires et un globe terrestre d\'époque louis-philippe, vers 1845', '', "Sotheby's"), 'scientific-instruments');
  assert.equal(S('fossils', 'A MEGALODON TOOTH NORTH CAROLINA', 'Travel Science And Natura'), 'fossils');
  // RR / Goldin run their own routing — untouched by the science rule
  assert.equal(S('space-exploration', 'apollo and marsyas', '', 'RR Auction'), 'space-exploration');
});

test('class 6 · sale-name gates: pop/film sales are not sports; RR space sale prior; New Jersey / Mac', () => {
  const G = (o: R) => move(o);
  // Christie's pop / film sales swept in by the bare 'memorabilia' gate
  assert.equal(G({ auctionHouse: "Christie's", artist: 'sports-memorabilia', title: 'George Harrison', saleName: 'Pop Memorabilia' }), 'entertainment-memorabilia');
  assert.equal(G({ auctionHouse: "Christie's", artist: 'sports-memorabilia', title: 'THE INVISIBLE MAN, UNIVERSAL, 1933', saleName: 'Television And Film Memorabilia And Posters' }), 'entertainment-memorabilia');
  assert.equal(G({ auctionHouse: "Christie's", artist: 'sports-memorabilia', title: 'A 1924 Cunard/Anchor-Donaldson calendar', saleName: 'The Wayne Lapoe Collection Of Oceanliner Memorabilia And Art' }), DROP);
  // …but a sports lot in a pop sale stays sports, and real sports sales are untouched
  assert.equal(G({ auctionHouse: "Christie's", artist: 'sports-memorabilia', title: 'Muhammad Ali signed boxing glove', saleName: 'Pop Memorabilia' }), 'autographs'); // stays sports (class 7 types it)
  assert.equal(G({ auctionHouse: "Christie's", artist: 'sports-memorabilia', title: 'TY COBB LETTER', saleName: 'Sports Memorabilia' }), 'autographs'); // stays sports (class 7 types it)
  // RR: a space catalogue lists astronauts by bare name
  assert.equal(G({ auctionHouse: 'RR Auction', artist: 'entertainment-memorabilia', title: 'John Young', saleName: 'Space & Aviation Auction' }), 'space-exploration');
  assert.equal(G({ auctionHouse: 'RR Auction', artist: 'entertainment-memorabilia', title: 'Charles Lindbergh Signed Photograph with the \'Spirit of St. Louis\'', saleName: 'Space & Aviation' }), 'entertainment-memorabilia');
  assert.equal(G({ auctionHouse: 'RR Auction', artist: 'entertainment-memorabilia', title: 'Jack Swigert\'s Skylab II and III Robbins Medals', saleName: 'Fine Autographs and Artifacts' }), 'space-exploration');
  assert.equal(G({ auctionHouse: 'RR Auction', artist: 'science-tech', title: 'Magic Sam and Mac Thompson Signatures', saleName: 'Fine Autographs and Artifacts' }), 'entertainment-memorabilia');
});

test('class 7 · sports-sale catch-all: programmes → programs, signed → autographs, RR autograph-house prior', () => {
  const K = (o: R) => move({ saleName: 'Sports Memorabilia', ...o });
  assert.equal(K({ auctionHouse: "Christie's", artist: 'sports-memorabilia', title: 'A RUN OF FIVE PROGRAMMES FOR THE AMATEUR BOXING CHAMPIONSHIP at The Royal Albert Hall, comprising: the 45th, 2', saleName: 'Sporting Memorabilia' }), 'programs-publications');
  assert.equal(K({ auctionHouse: "Christie's", artist: 'tickets-passes', title: 'A BLACKBURN ROVERS V. HUDDERSFIELD TOWN, F.A. CUP FINAL, MATCH PROGRAMME, 21/4/28' }), 'programs-publications');
  assert.equal(K({ auctionHouse: "Christie's", artist: 'sports-memorabilia', title: 'BILL TERRY SINGLE SIGNED BASEBALL' }), 'autographs');
  assert.equal(K({ auctionHouse: 'RR Auction', artist: 'sports-memorabilia', title: 'Barry Bonds Baseball', saleName: 'Fine Autographs and Artifacts' }), 'autographs');
  assert.equal(K({ auctionHouse: 'RR Auction', artist: 'sports-memorabilia', title: 'Ted Williams Signed Baseball', saleName: 'Fine Autographs and Artifacts' }), 'autographs');
  assert.equal(K({ auctionHouse: 'RR Auction', artist: 'sports-memorabilia', title: 'Seoul 1988 Summer Olympics Winner\'s Diploma', saleName: 'Olympic Memorabilia' }), 'trophies-awards');
  assert.equal(K({ auctionHouse: 'RR Auction', artist: 'tickets-passes', title: 'Tiger Woods Signed Golf Score Card', saleName: 'Fine Autograph and Artifacts' }), 'autographs');
  assert.equal(K({ auctionHouse: "Sotheby's", artist: 'sports-memorabilia', title: 'Beijing 2008 Summer Olympics Pin Set' }), 'sports-memorabilia');
});

test('class 8 · watch forms (pocket vs wrist, cushion cases, glued text) and jewellery / Tudor evicted', () => {
  const F = (title: string) => classifyForm({ title, medium: null, category: 'object' } as never);
  assert.equal(F('ref 5651a yellow gold open faced watch circa 1970'), 'pocket-watch');
  assert.equal(F('a fine and rare early 18k yellow gold hunting cased watch with enamel scenes1850 no 4735'), 'pocket-watch');
  assert.equal(F('yellow gold openface keyless watchref 866 mvt 932316 case 433516 made in 1974'), 'pocket-watch');
  assert.equal(F('AUDEMARS PIGUET. A RARE AND IMPRESSIVE 18K WHITE GOLD, DIAMOND AND SAPPHIRE-SET CUSHION-SHAPED WRISTWATCH WITH'), 'wristwatch');
  assert.equal(F('a stainless steel cushion-form automatic centre seconds wristwatch with date and braceletref 3800/1 mvt 142421'), 'wristwatch');
  assert.equal(F("Audemars Piguet. A gents 18ct gold slim case wristwatch1960's"), 'wristwatch');
  assert.equal(F('An attractive and early stainless steel dual-time wristwatch with center seconds, date, black lacquer dial, ring lock'), 'wristwatch');
  assert.equal(F("reference 4239/1j | a yellow gold bangle watch | circa 1976"), 'wristwatch');
  assert.equal(F('A Gold and Steel \'Panther\' Necklace'), 'jewelry');
  // the reclass rule evicts jewellery and Tudor from the watch makers
  assert.equal(move({ auctionHouse: 'Phillips', artist: 'cartier', title: "Pair of diamond, onyx and emerald earrings, 'Panthère'" }), DROP);
  assert.equal(move({ auctionHouse: "Christie's", artist: 'rolex', title: 'Tudor. A fine stainless steel waterproof chronograph wristwatch with date and bracelet SIGNED TUDOR, OYSTER DA' }), DROP);
  assert.equal(move({ auctionHouse: "Christie's", artist: 'rolex', title: 'ROLEX/TUDOR. A STAINLESS STEEL SELF-WINDING WATERPROOF CHRONOGRAPH SIGNED ROLEX AND TUDOR' }), 'rolex');
  assert.equal(move({ auctionHouse: 'Phillips', artist: 'cartier', title: "A rare yellow gold 'Tank' wristwatch" }), 'cartier');
});
