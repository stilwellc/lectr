/**
 * Oct 9 labels audit — the BUILD-TIME half of the misfile fixes (the nightly
 * stamps: culture itemClass, subCat / drill, the reclass ladder). Fixtures are
 * REAL live-book titles; each pins the value the audit judged right. The view-
 * time half (taxonOf with a title) is app/lib/__tests__/labels-classify.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subCatOf, cultureTextDomain, spaceScienceDrillOf } from '../lib/sub-cats';
import { cultureItemClass } from '../lib/corpus-normalize';
import { reclassifyLot, scienceMusicFilmFix } from '../lib/classify';
import { taxonOf } from '../../app/lib/taxonomy';

type R = Record<string, unknown>;
const C = (title: string, o: R = {}) => {
  const itemClass = cultureItemClass({ title, ...o } as { title: string });
  return { itemClass, ...subCatOf({ artist: 'entertainment-memorabilia', title, itemClass, ...o }) };
};
/** the nightly stamp read through taxonOf WITHOUT a title (what ships before any view-time rule) */
const stampTaxon = (artist: string, title: string, o: R = {}) => {
  const l = { artist, title, ...o } as R;
  if (artist.match(/memorabilia|movie-tv/)) l.itemClass = cultureItemClass(l as { title: string });
  const st = subCatOf(l);
  return taxonOf({ artist, subCat: st.subCat, drill: st.drill });
};

test('P1 / P3: itemClass — strong object phrases beat the first noun', () => {
  assert.equal(C('DePatie-Freleng Enterprises The Pink Panther Show Pink Panther in Cowboy Hat Animation Cel - 10.5 x 14').itemClass, 'cel-art');
  assert.equal(C('Les Paul Type I Original Photo by Ebet Roberts - Fat Tuesdays, NYC - 5.5 x 8 - PSA/DNA').itemClass, 'photo');
  assert.equal(C('Hand Drawn Storyboard from David Lynch\'s Dune - Auction House COA, Ursa Authentic OOA').itemClass, 'cel-art');
  assert.equal(C('Joseph Musso Ghost of Mars Production-Made Concept Art Prints Collection (8) - Ursa Authentic OOA').itemClass, 'cel-art');
  assert.equal(C('c. 1987-88 Who Framed Roger Rabbit Color Concept Artwork Collection (2) - 20 x 16').subCat, 'cel-art');
  // a prop stays a prop; a signed piece stays an autograph
  assert.equal(C('Brad Pitt "Tyler Durden" Production-Made Airplane Tickets/Boarding Passes (2) from Fight Club (1999)').itemClass, 'prop');
  assert.equal(C('Jurassic Park Multi-Signed Advanced Screening Pass (4 Signatures)').itemClass, 'ticket');
  assert.equal(C('Rick James Signed 8 x 10 Promo Photo Plus 1982 Tour Band Member ID and Access Pass').itemClass, 'signed-photo');
});

test('P4 / P5: Mondo prints and flyers are posters; passes are tickets → the new Entertainment tickets sub', () => {
  assert.equal(C('Dumbo Mondo Print by Tom Whalen LE (#82/155) - 24 x 36').subCat, 'posters');
  assert.equal(C('1978 Morris Ave. Block Association Grandmaster Caz Original Flyer - 8.5 x 11').subCat, 'posters');
  assert.equal(C('1989 Dolly Parton "White Limozeen Tour" Backstage Cloth Passes Rare Set of 12 Unused').subCat, 'tickets');
  assert.deepEqual(stampTaxon('entertainment-memorabilia', 'Pink Floyd at the Fillmore Auditorium Full Ticket - PSA NM-MT 8', { saleName: 'music' }).sub, 'tickets');
});

test('P2: zeppelin — Led Zeppelin is music, the Hindenburg aviation', () => {
  assert.equal(cultureTextDomain('1971 John Bonham Led Zeppelin Type I Original Photo - Hiroshima, Japan Tour'), 'music');
  assert.equal(cultureTextDomain('Hindenburg Zeppelin Flown Cover'), 'aviation');
  assert.equal(spaceScienceDrillOf('Led Zeppelin Signed Album'), 'space-science');
  assert.equal(C("Bomb's Away Army Themed Guitar").drill, 'music');
  assert.equal(C('1978 Battle Flyer Featuring Grandmaster Flash, Disco Bee, Keith-Keith').drill, 'music');
});

test('P10 / P11: the Massacre, Prohibition, the Capone family → crime', () => {
  assert.equal(C("Saint Valentine's Day Massacre: The Detroit Free Press Newspaper (February 15, 1929)").drill, 'crime');
  assert.equal(C('Prohibition: Front Page of the Chicago Herald and Examiner, December 6, 1933').drill, 'crime');
  assert.equal(C("Albert 'Bites' Capone (2) Original Photographs").drill, 'crime');
  assert.equal(cultureTextDomain('Harper’s Weekly Newspaper'), 'historic');
});

test('P12: film archive titles never read a historical domain', () => {
  assert.equal(C('Ghost Recon Soldier Tactical Costume from John Wick: Chapter 3 - Parabellum - Ursa Authentic OOA').drill, null);
  assert.equal(C('Home Alone 2 Newspaper - Galbate LOA, Ursa Authentic OOA').drill, null);
  // the reclass ladder: a film production piece under a sports slug is movie-tv
  const l = { artist: 'sports-memorabilia', auctionHouse: 'Goldin', title: 'Antonio Tarver "Mason Dixon" Production-Made Boxing Trunks from Rocky Balboa (2006) - Ursa Authentic OOA' };
  reclassifyLot(l);
  assert.equal(l.artist, 'movie-tv');
  const g = { artist: 'game-used', auctionHouse: 'Goldin', title: 'Patrick Mahomes Game-Worn Jersey from Super Bowl LVII (2023)' };
  reclassifyLot(g);
  assert.equal(g.artist, 'game-used');
});

test('P13: the reclass ladder moves music / film objects off science slugs', () => {
  assert.equal(scienceMusicFilmFix({ artist: 'scientific-instruments', title: 'Poison - "I Want Action" Sealed Cassette Tape - Enigma/Capitol Records - 1986 - AMG E 8' }), 'music-memorabilia');
  assert.equal(scienceMusicFilmFix({ artist: 'fossils', title: 'Hollywood Palladium Flyer - Featuring Nirvana, Dinosaur Jr. - 8.5 x 11' }), 'music-memorabilia');
  assert.equal(scienceMusicFilmFix({ artist: 'scientific-instruments', title: 'Star Trek: The Next Generation (1987-94) Bajoran Antares Class Freighter Shooting Scale Model' }), 'movie-tv');
  // real instruments, real fossils, and space lots stay
  assert.equal(scienceMusicFilmFix({ artist: 'scientific-instruments', title: 'Edison Concert Phonograph with Cylinder Records' }), null);
  assert.equal(scienceMusicFilmFix({ artist: 'scientific-instruments', title: 'Enigma Cipher Machine, Three-Rotor' }), null);
  assert.equal(scienceMusicFilmFix({ artist: 'fossils', title: 'Triceratops Horn Core' }), null);
  assert.equal(scienceMusicFilmFix({ artist: 'space-exploration', title: 'Apollo 11 Flown Vinyl Patch' }), null);
});

test('P14: Mercury capsules by name', () => {
  assert.equal(subCatOf({ artist: 'space-exploration', title: 'Aurora 7 Flown Heat Shield' }).drill, 'mercury-gemini');
  assert.equal(subCatOf({ artist: 'space-exploration', title: 'Sigma 7 Flown Kapton Foil' }).drill, 'mercury-gemini');
  assert.equal(subCatOf({ artist: 'space-exploration', title: 'Apollo 11 Flown Flag' }).drill, 'apollo');
});

test('P15: yearless WotC sets stamp the vintage drill', () => {
  assert.equal(subCatOf({ artist: 'pokemon', title: 'Pokemon Japanese Jungle #25 Pikachu - PSA MINT 9' }).drill, 'vintage');
  assert.equal(subCatOf({ artist: 'pokemon', title: 'Pokemon Japanese Promo #25 Pikachu' }).drill, null);
  assert.equal(subCatOf({ artist: 'pokemon', title: '2023 Pokemon Scarlet & Violet #25 Pikachu' }).drill, 'modern');
});

test('precision guards (corpus scan): Prohibition Party, a WORN dress with its sketch, signed athlete cels', () => {
  assert.notEqual(C('PROHIBITION SWALLOW & CARROLL REAL PHOTO JUGATE PROHIBITION STICKPIN.').drill, 'crime');
  assert.equal(C('Prohibition Photographs').drill, 'crime');
  assert.equal(C('CARRIE UNDERWOOD 2014 CMA AWARDS WORN RANDI RAHM CUSTOM DRESS AND COSTUME SKETCH').itemClass, 'costume');
  assert.equal(C('Edith Head Signed Original Costume Sketch for Grace Kelly in To Catch a Thief').itemClass, 'cel-art');
  assert.notEqual(C('Abraham Lincoln: Lincoln passes an accusation of Confederate bribery onto Salmon Chase').itemClass, 'ticket');
  const l = { artist: 'autographs', auctionHouse: 'Huggins & Scott', title: 'Mickey Mantle Signed LE 1992 Warner Bros. Bugs Bunny Animation Cel - UDA' };
  reclassifyLot(l);
  assert.notEqual(l.artist, 'movie-tv');
  // RR names the signer, not the subject; its studio production drawings move
  const rr = { artist: 'autographs', auctionHouse: 'RR Auction', title: 'Carl Yastrzemski Animation Cel' };
  reclassifyLot(rr);
  assert.notEqual(rr.artist, 'movie-tv');
  const rr2 = { artist: 'autographs', auctionHouse: 'RR Auction', title: 'Goofy production drawing from How to Play Baseball Production Drawing' };
  reclassifyLot(rr2);
  assert.equal(rr2.artist, 'movie-tv');
  // a cigarette PACK, a cereal RING, a tobacco TIN are not cards
  for (const title of ['199 1940s Mecca Cigarette Pack Graded GAI 9 MINT', 'Vintage Baseball Tobacco Tin Lot of (2)', '1951 Kellogg\'s Pep Cereal Rings Collection (16) w/Babe Ruth and Print Ad']) {
    const m = { artist: 'memorabilia', auctionHouse: 'REA', title };
    reclassifyLot(m);
    assert.equal(m.artist, 'memorabilia', title);
  }
});

test('P6: the reclass ladder moves a graded card out of the memorabilia drawer', () => {
  const a = { artist: 'sports-memorabilia', auctionHouse: 'Goldin', title: 'Extremely Rare 1888 E223 G&B Chewing Gum Roger Connor Portrait - SGC VG-EX 4 - POP 1' };
  reclassifyLot(a);
  assert.equal(a.artist, 'sports-cards');
  const b = { artist: 'memorabilia', auctionHouse: 'REA', title: '1887 to 1889 N172 Old Judge Collection (5) Including Jim Mutrie' };
  reclassifyLot(b);
  assert.equal(b.artist, 'graded-cards');
  const c = { artist: 'memorabilia', auctionHouse: 'REA', title: '1916 BF2 Ferguson Bakery Felt Pennant Fred Merkle SGC Authentic' };
  reclassifyLot(c);
  assert.equal(c.artist, 'memorabilia');
});

test('P6–P9: the sports kind stamps — passes, covers, signed trophies, card lots', () => {
  assert.equal(subCatOf({ artist: 'sports-memorabilia', title: 'Boston Braves Pass - Jackie Robinson Debut Season - PSA VG 3' }).subCat, 'tickets');
  assert.equal(subCatOf({ artist: 'sports-memorabilia', title: 'Jun. 5, 1979 El Grafico Diego Maradona Cover (Spain) - Pop 1, None Higher - PSA 4.0' }).subCat, 'programs');
  assert.equal(subCatOf({ artist: 'sports-memorabilia', title: '2022 Shohei Ohtani ASICS M4S Professional Model Bat - PSA/DNA LOA' }).subCat, 'memorabilia');
  assert.equal(subCatOf({ artist: 'trophies-awards', title: '1980 USA Men\'s Hockey "Miracle On Ice" Gold Medal Multi-Signed Jersey (19 Signatures)' }).subCat, 'autographs');
  assert.equal(subCatOf({ artist: 'trophies-awards', title: '1980 NBA All-Star Game Trophy Presented By Washington Bullets' }).subCat, 'trophies');
  assert.equal(subCatOf({ artist: 'graded-cards', title: '1962 Topps PSA NM 7 Trio: Early Wynn, Jim Landis, and Floyd Robinson' }).subCat, 'card-lots');
  assert.equal(subCatOf({ artist: 'graded-cards', title: '1959 Fleer Ted Williams #71 Ted\'s Hitting Fundamentals #1 PSA MINT 9' }).subCat, 'cards');
});
