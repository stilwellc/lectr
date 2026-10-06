/**
 * Categorization wave 4 (Oct 6 2026 re-audit #3). Fixtures are REAL corpus
 * titles the rules were written against (corpus scans + the DEV halves of the
 * earlier label sets), one test per rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subCatOf } from '../lib/sub-cats';
import { cultureItemClass, clearJunkModelKeys } from '../lib/corpus-normalize';
import {
  reclassifyLot, DROP, cultureSubSlugFix, cultureMassFix, pokemonOnlyFix, watchMakerFix, attributionFix,
  scienceVerdict, cultureLeakFix, brandedNumberedCard, signedFlatAutograph, pennantNotProgram,
  cultureAthleteToSports, nonAthleteAutograph, signedSubsetCardLot, isSignedRetailObject, artCategoryFix,
  leadArtMakerOf, sportsObjectKind, isSpaceLeadTitle,
} from '../lib/classify';
import { athleteIn } from '../lib/athlete-roster';
import { parseCard, cardKey } from '../../app/lib/cards';
import { cardRepeatKey } from '../sub-markets';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const ent = (o: R) => reclassifyLot({ ...o } as never);

test('class 1 · culture kind from the lot\'s own nouns: free frank, quotation, photo process, pose, posters, props, garments, tapes', () => {
  const K = (title: string, o: R = {}) => cultureItemClass({ title, ...o });
  assert.equal(K('Henry Wilson Free Frank', { auctionHouse: 'RR Auction' }), 'document');
  assert.equal(K('James Buchanan Souvenir Quotation', { auctionHouse: 'RR Auction' }), 'document');
  assert.equal(K('Victor Herbert Autograph Musical Quotation Signed'), 'document');
  assert.equal(K('Gary Cooper: Uncommon Western pose of the Hollywood legend', { auctionHouse: 'RR Auction' }), 'photo');
  assert.equal(K('Some Like It Hot, 1959', { description: 'Some Like It Hot, 1959 A collection of contact prints comprising approximately 648 black and white contact prints' }), 'photo');
  assert.equal(K('GUY BOURDIN (1928-1991) Untitled, 1976', { description: 'GUY BOURDIN (1928-1991) Untitled, 1976 chromogenic print 6 1/8 x 9 1/8in.' }), 'photo');
  // a description's "flying pose" describes a model, not a photograph
  assert.notEqual(K('Superman', { description: 'Superman Two special effects portrait models of Christopher Reeve as Superman in flying pose, modelled' }), 'photo');
  assert.equal(K('The Goose Steps Out', { description: 'The Goose Steps Out 1942, Ealing, British quad -- 30x40in. (76x105cm.), (A-)' }), 'poster');
  assert.equal(K('BREAKFAST AT TIFFANY\'S, PARAMOUNT, 1961', { description: 'BREAKFAST AT TIFFANY\'S, PARAMOUNT, 1961 Italian, (B+), Linen-Backed 27 1/2 x 11 1/2in.' }), 'poster');
  assert.equal(K('Lot # 47: Grace\'s Three Long Stunt Rebars', { auctionHouse: 'Propstore' }), 'prop');
  assert.equal(K('Lot # 51: Mike Ehrmantraut (as played by Jonathan Banks) Nail Hose Strip', { auctionHouse: 'Propstore' }), 'prop');
  assert.equal(K('GRETA GARBO CARDIGAN SWEATERS AND TROUSERS'), 'costume');
  assert.equal(K('JANET JACKSON GLOVES'), 'costume');
  assert.equal(K('Prince \'Crystal Ball\' Analog Cassettes'), 'record');
  // a photo album is not a record album
  assert.notEqual(K('1890s-1900s Yale University Large Cloth Banner and Ornate Photo Album (2 Items)'), 'record');
  assert.equal(subCatOf({ artist: 'entertainment-memorabilia', title: 'Daniel Webster Free Frank', itemClass: 'document' }).subCat, 'documents');
});

test('class 8 · culture sub-slug: Propstore / screen-used / film costume → movie-tv, stage-played → music', () => {
  const S = (title: string, o: R = {}) => cultureSubSlugFix({ artist: 'entertainment-memorabilia', title, ...o });
  assert.equal(S('Lot # 42: Back To The Future Part II (1989) - Griff Tannen\'s (Thomas F. Wilson) "P.I.T Bull" Hoverboard', { auctionHouse: 'Propstore' }), 'movie-tv');
  assert.equal(S('STAR TREK: THE MOTION PICTURE MEGARITE ALIEN COSTUME', { artist: 'pop-memorabilia', auctionHouse: "Julien's", saleName: 'Icons & Idols Hollywood' }), 'movie-tv');
  assert.equal(S('Marky Ramone Studio-Used Drum Sticks from the Recording of Adios Amigos', { auctionHouse: 'RR Auction' }), 'music-memorabilia');
  assert.equal(S('RUSH: ALEX LIFESON "R30" STAGE PLAYED VIDEO MATCHED 2004 GIBSON LES PAUL', { artist: 'pop-memorabilia', auctionHouse: "Julien's" }), 'music-memorabilia');
  // a sports house's pop slug is not re-homed; a plain historic piece stays
  assert.equal(S('1952 The Pride of St. Louis One-Sheet Movie Poster', { artist: 'pop-memorabilia', auctionHouse: 'REA' }), null);
  assert.equal(S('Abraham Lincoln Signed Document', { auctionHouse: 'RR Auction' }), null);
});

test('class 5 · mass culture pieces: records, campaign pins, figurine runs, encapsulated designer toys', () => {
  const M = (title: string, house = 'RR Auction') => cultureMassFix({ artist: 'entertainment-memorabilia', title, auctionHouse: house });
  assert.equal(M('Led Zeppelin - "Good Times Bad Times" - First Pressing, 7-Inch Single, 45RPM, Japan Release - Atlantic Records - 1969', 'Goldin'), DROP);
  assert.equal(M('Martin Luther King, Jr.: March on Washington Pinback Button'), DROP);
  assert.equal(M('George W. Bush Bumper Sticker'), DROP);
  assert.equal(M('2025 PiggyBanx Good 2 Mr. Banx 50,000 Black Label (#1/1) - PiggyBanx Encapsulated', 'Goldin'), DROP);
  // a signed / owned / early piece, a uniform's buttons, a provenance house: kept
  assert.equal(M('Abraham Lincoln and Hannibal Hamlin Campaign Button'), null);
  assert.equal(M('George A. Custer: Nine Custer Military Uniform Buttons'), null);
  assert.equal(M('Franklin D. Roosevelt\'s Wooden Dog and Pig Figurines'), null);
  assert.equal(M('RHONDA FLEMING COLLECTION OF VINYL RECORD ALBUMS', "Julien's"), null);
  assert.equal(M('Beatles Signed Abbey Road LP'), null);
});

test('class 5 · tcg merchandise, watch papers / tools, Daum under Prouvé, the philosopher Bacon', () => {
  const P = (title: string) => pokemonOnlyFix({ artist: 'pokemon', title });
  assert.equal(P('1998 Pokemon: Water Blast! Sealed VHS Tape - IGS 7/6.5'), DROP);
  assert.equal(P('Hasbro Pokemon Plush Toy Collection (8 Total, 7 Different)'), DROP);
  assert.equal(P('2021 Pokemon Celebrations Unopened Pikachu VMAX Premium Figure Collection (8 4-Card Packs, 3 Packs)'), null);
  assert.equal(P('2020 Pokemon Sword & Shield Figure Collection Black Star Promo #020 Pikachu - PSA GEM MT 10'), null);
  const W = (artist: string, title: string) => watchMakerFix({ artist, title, category: 'object' });
  assert.equal(W('patek-philippe', 'PATEK PHILIPPE. AN ATTESTATION FOR A SET OF REF. 5075'), DROP);
  assert.equal(W('rolex', "rolex | day-date a heavy gilt brass retailer's light box with advertisement, circa 1970"), DROP);
  assert.equal(W('rolex', 'easy oyster opener, reference 1001 | a steel case opener with 11 cast for various case size'), DROP);
  assert.equal(W('patek-philippe', 'Patek Philippe. An aluminium electronic marine chronometer with jumping centre seconds and original mahogany box'), null);
  assert.equal(attributionFix({ artist: 'jean-prouve', title: 'Daum Nancy display table' }), DROP);
  assert.equal(attributionFix({ artist: 'francis-bacon', title: 'The Historie of the Raigne of King Henry The Seventh', description: 'BACON (FRANCIS) The Historie of the Raigne of King Henry The Seventh' }), DROP);
  assert.equal(attributionFix({ artist: 'francis-bacon', title: 'Sylva Sylvarum; or, A Naturall Historie, John Haviland, for William Lee, 1635' }), DROP);
  assert.equal(attributionFix({ artist: 'francis-bacon', title: 'Vincent Van Gogh, Arles 1888-1988', description: 'Francis Bacon (British, 1909-1992) Vincent Van Gogh, Arles 1888-1988' }), null);
});

test('class 7 · astronauts and flown pieces are space; scientists are science-tech; dated artworks leave science', () => {
  const L = (title: string, o: R = {}) => cultureLeakFix({ artist: 'entertainment-memorabilia', auctionHouse: 'RR Auction', title, ...o });
  assert.equal(L('Jim Irwin Signed Photograph'), 'space-exploration');
  assert.equal(L('Edgar Mitchell Publication'), 'space-exploration');
  assert.equal(L('Sergei Krikalev\'s Expedition 11 (2) EVA Flown Patches'), 'space-exploration');
  // an ambiguous name needs a space word; an aviator stays culture
  assert.equal(L('Michael Collins'), null);
  assert.equal(L('Michael Collins Signed Apollo 11 Photograph'), 'space-exploration');
  assert.equal(L('Chuck Yeager Bell X-1A Flown Cover'), null);
  assert.equal(L('Max Planck: To a fellow Nobel laureate'), 'science-tech');
  assert.equal(L('Guglielmo Marconi Signed Photograph'), 'science-tech');
  assert.equal(L('Rutherford B. Hayes Signed Document'), null);
  assert.equal(L('Olivia Newton-John Signed Photograph'), null);
  assert.equal(L('Orville Wright Signed Check'), null);
  const V = (o: R) => scienceVerdict({ auctionHouse: "Christie's", ...o } as never);
  assert.equal(V({ artist: 'space-exploration', title: 'F. N. SOUZA (1924-2002) Astronaut', description: "F. N. SOUZA (1924-2002) Astronaut signed and dated 'Souza 1966' (lower right); oil on canvas" }), DROP);
  assert.equal(V({ artist: 'space-exploration', title: 'Belkis Ayón (1967-1999) Untitled (Sikan, Nasako and Holy Spirit)', description: 'collograph on paper' }), DROP);
  assert.ok(isSpaceLeadTitle('Hubble Space Telescope flight spare component'));
});

test('class 2 · sports kind: branded numbered cards, signed displays / postcards / bare signed cards, pennants, award winners', () => {
  const C = (artist: string, title: string, house = 'Goldin') => brandedNumberedCard({ artist, title, auctionHouse: house });
  assert.equal(C('trophies-awards', '1995 Fleer Award Winners #1 Frank Thomas - PSA MINT 9'), 'sports-cards');
  assert.equal(C('game-used', '2003 Fleer Avant Football #AGW/50 Tom Brady Game-Worn Jersey Blue 113/250 SGC NM/MT 88', 'REA'), 'graded-cards');
  // a photo used for a card, a framed collage, a graded ticket / magazine stay objects
  assert.equal(C('type-1-photos', '1939 Ted Williams Rookie Year Photo - Image Used for his 1959 Fleer #43 Baseball Card Subject (PSA 9 Example', 'Memory Lane'), null);
  assert.equal(C('trophies-awards', '2007 Kobe Bryant Signed, Inscribed, Framed "07 AS MVP" All-Star Game Jersey and Memorabilia Collage Upper Deck (#53/124)'), null);
  assert.equal(C('tickets-passes', 'Aug. 6, 1965 Detroit Tigers Full Ticket - Mantle Hits #468 HR PSA 6', 'REA'), null);
  const F = (artist: string, title: string, house = 'Huggins & Scott') => signedFlatAutograph({ artist, title, auctionHouse: house });
  assert.equal(F('equipment-artifacts', 'Ty Cobb Signed Display with Full JSA'), 'autographs');
  assert.equal(F('trophies-awards', 'Derek Jeter Signed Hall of Fame Plaque Postcard - PSA/DNA GEM MT 10, MLB Authenticated', 'Goldin'), 'autographs');
  assert.equal(F('sports-cards', 'Ronald Acuna Jr. Signed Trading Card - PSA/DNA GEM MT 10', 'Goldin'), 'autographs');
  // a set / year / brand / numbered card stays a card
  assert.equal(F('sports-cards', '1966 Exhibits Willie Mays Signed Card - PSA EX-MT 6, PSA/DNA Authentic', 'Goldin'), null);
  assert.equal(F('graded-cards', 'Signed Football Goal Line Art Card Lot of (20)'), null);
  assert.equal(F('graded-cards', '1980-2001 Perez-Steele Hall of Fame Postcard Autographed Set (61 Signed Cards)', 'REA'), null);
  assert.equal(pennantNotProgram({ artist: 'programs-publications', title: '1912 Boston Red Sox "Champions" Pennant', auctionHouse: 'REA' }), 'memorabilia');
  assert.equal(pennantNotProgram({ artist: 'programs-publications', title: '1944 World Series Program and Pennant', auctionHouse: 'REA' }), null);
  // an award NAMED as who signed is not an award object
  assert.ok(isSignedRetailObject('Gold Glove Award Winners Single-Signed Baseballs (5)'));
  assert.equal(sportsObjectKind('(25) Heisman Trophy Award Winner Single-Signed Mini Helmets'), 'autographs');
  assert.equal(sportsObjectKind('1958 Heisman Trophy Presented to Pete Dawkins'), 'trophies-awards');
  assert.equal(signedSubsetCardLot({ artist: 'autographs', title: '90s Baseball Hall of Famers Card Collection (24) Including (10) Signed Cards - Featuring Mike Schmidt', auctionHouse: 'Goldin' }), 'sports-cards');
});

test('class 2 · non-athletes leave sports; a HOF player\'s "Presidential" piece and a nicknamed athlete stay', () => {
  const N = (artist: string, title: string, house = 'Goldin') => nonAthleteAutograph({ artist, title, auctionHouse: house });
  assert.notEqual(N('autographs', 'Charlie Sheen Signed Custom Jersey - Beckett'), null);
  assert.notEqual(N('type-1-photos', '1950 Ronald Reagan Hollywood Boulevard Original Warner Brothers Photograph PSA/DNA Type I', 'REA'), null);
  assert.equal(N('autographs', 'Clinton Portis Signed Washington Redskins Full-Size Football Helmet - Beckett'), null);
  assert.equal(N('memorabilia', '134 1981 George "Highpockets" Kelly (HOF) Presidential Luncheon Invitation w/Family Provenance', 'Love of the Game'), null);
  assert.equal(athleteIn('George "Highpockets" Kelly (HOF) Presidential Luncheon Invitation'), 'george kelly');
});

test('class 3 · athletes in culture: roster additions, game-worn with a team, team-signed RR lots', () => {
  assert.equal(athleteIn('Vince Lombardi Signature'), 'vince lombardi');
  assert.equal(athleteIn('Floyd Patterson and Ingemar Johansson Signed Photograph'), 'floyd patterson');
  const A = (title: string, house = "Christie's") => cultureAthleteToSports({ artist: 'entertainment-memorabilia', title, auctionHouse: house });
  assert.equal(A('SPARKY ANDERSON DETROIT TIGERS GAME WORN UNIFORM 1984'), 'game-used');
  assert.equal(A('Boston Red Sox', 'RR Auction'), 'autographs');
  assert.equal(A('1927 New York Yankees Team', 'RR Auction'), 'autographs');
  assert.equal(A('Billy Joel Signed Baseball', 'RR Auction'), null);
  assert.equal(A('Babe Ruth Story Film Costume Worn by William Bendix'), null);
  const r = ent({ artist: 'entertainment-memorabilia', title: 'Vince Lombardi Signature', auctionHouse: 'RR Auction' });
  assert.equal(r.drop, false);
});

test('class 4 · card player: descriptor words leave the name and key the variation', () => {
  const c = parseCard('2021 Topps #27 Mike Trout Wearing Mask Super Short Print PSA MINT 9');
  assert.equal(c.playerSlug, 'mike-trout');
  assert.equal(c.descriptor, 'wearing-mask');
  assert.match(String(cardKey(c)), /^mike-trout\|2021\|topps\|27\|v:[^|]*d-wearing-mask/);
  assert.equal(parseCard('1911 T3 Turkey Red #111 Harry Niles Cabinets - Checklist Back PSA 5 EX').playerSlug, 'harry-niles');
  assert.equal(parseCard('1961-1962 Fleer Basketball #62 Bill Russell In Action PSA NM 7').playerSlug, 'bill-russell');
  // a real surname that is a descriptor word, with one name word kept, stays
  assert.equal(parseCard('2012 Topps #55 Brandon Belt Rookie Card PSA 10').playerSlug, 'brandon-belt');
  // a pre-war baseball issue names the sport before a shared-name player vote
  const byPlayer = new Map([['john-kerr', 'basketball']]);
  const maps = { byPid: new Map(), byPlayer, cardPlayer: () => 'john-kerr' };
  assert.equal(subCatOf({ artist: 'graded-cards', title: '1933 R319 Goudey #214 John Kerr PSA NM 7', auctionHouse: 'REA' }, maps).drill, 'baseball');
  assert.equal(subCatOf({ artist: 'graded-cards', title: '1961-1962 Fleer Basketball #25 John Kerr PSA MINT 9', auctionHouse: 'REA' }, maps).drill, 'basketball');
  // the repeat-sale key keeps the variation apart from the base card
  const rk = (title: string) => cardRepeatKey({ id: 'x', title, _card: parseCard(title) } as never);
  assert.notEqual(rk('2021 Topps #27 Mike Trout Wearing Mask Super Short Print PSA MINT 9'), rk('2021 Topps #27 Mike Trout PSA MINT 9'));
});

test('class 6 · art kind: print catalogue refs before ceramic / sculpture words, dated drawings, Koons materials, the lead maker', () => {
  const A = (o: R) => artCategoryFix({ auctionHouse: "Christie's", ...o } as never);
  assert.equal(A({ artist: 'pablo-picasso', category: 'sculpture', title: 'Pablo Picasso Sculpteur, Modèle et Sculpture assise, from La Suite Vollard (B. 146; Ba. 297Bd)', description: 'etching, 1933, on Montval paper' }), 'print');
  assert.equal(A({ artist: 'pablo-picasso', category: 'sculpture', title: 'Figure au corsage rayé (Bloch 604; Mourlot 179)' }), 'print');
  assert.equal(A({ artist: 'pablo-picasso', category: 'sculpture', title: 'Pablo Picasso (1881-1973) Two dancers (Ramiro 380)', description: 'plate, 1956, white earthenware clay, engraving heightened' }), null);
  assert.equal(A({ artist: 'pablo-picasso', category: 'print', title: 'PABLO PICASSO (1881-1973) Dans la loge du clown', description: "PABLO PICASSO (1881-1973) Dans la loge du clown signed, dated and numbered 'Picasso 6.1.54. XII' (lower right) brush and pen and India ink on paper" }), 'original');
  assert.equal(A({ artist: 'francesco-clemente', category: 'unknown', title: 'Francesco Clemente (b. 1952) Geography: West', description: 'aquatint in grey, 1992, on wove paper, signed in pencil' }), 'print');
  assert.equal(A({ artist: 'jeff-koons', category: 'unknown', title: 'Ushering in Banality', description: "JEFF KOONS (B. 1955) Ushering in Banality incised with the artist's signature, number and date 'Jeff Koons 3/3 88' (on the underside) polychromed wood" }), 'sculpture');
  // a birth year in parentheses is not a Bloch number
  assert.equal(A({ artist: 'rashid-johnson', category: 'unknown', title: 'Glenn', description: "RASHID JOHNSON (B. 1977) Glenn signed 'Rashid Johnson' (on the reverse) branded red oak flooring, black soap and wax" }), null);
  assert.equal(attributionFix({ artist: 'pablo-picasso', title: 'ROY LICHTENSTEIN Still Life with Picasso, from Hommage à Picasso (C. 127)' }), 'roy-lichtenstein');
  assert.equal(attributionFix({ artist: 'pablo-picasso', title: 'Retour aux sources: Picasso touriste à la Fuente de Canaletas, plate 81 from Série 347 (Bl. 1561, Ba. 1577)' }), null);
  // a collaboration keeps whichever co-maker holds it
  assert.equal(leadArtMakerOf('KEITH HARING AND ANDY WARHOL Andy Mouse : one plate (L. p. 68)'), null);
  assert.equal(leadArtMakerOf('Jean-Michel Basquiat (1960-1988) Untitled (Pablo Picasso)'), 'jean-michel-basquiat');
});

test('class 9 / 10 · junk art & design model keys; design kind nouns', () => {
  const lots: R[] = [
    { artist: 'charles-eames', modelKey: 'coffee' }, { artist: 'george-nakashima', modelKey: 'conoid' },
    { artist: 'andy-warhol', modelKey: 'x101' }, { artist: 'andy-warhol', modelKey: 'electric' },
    { artist: 'andy-warhol', modelKey: 'f&sii.31' }, { artist: 'jean-prouve', modelKey: 'standard' },
  ];
  clearJunkModelKeys(lots as never);
  assert.deepEqual(lots.map(l => l.modelKey ?? null), [null, 'conoid', null, null, 'f&sii.31', 'standard']);
  const K = (artist: string, title: string, description = '') => subCatOf({ artist, title, description, formKey: 'unknown' }).subCat;
  assert.equal(K('jean-prouve', "JEAN PROUVÉ (1901-1984) Bahut 'BA 12', le modèle créé vers 1946"), 'case-storage');
  assert.equal(K('pierre-jeanneret', 'Amphitheatre banquette from the Faculté des Lettres, Besançon'), 'seating');
  assert.equal(K('pierre-jeanneret', 'IT-1'), 'tables');
});
