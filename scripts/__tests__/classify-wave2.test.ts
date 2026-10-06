/**
 * Categorization wave 2 (Oct 6 2026 re-audit, 1,648 fresh lots under the
 * original rubric). Fixtures are REAL titles from the re-audit labels
 * (scratchpad reaudit-cat/w/parts) and its eviction check, each pinned to the
 * label the auditor gave it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reclassifyLot, isCardTitle, isSignedDocument, DROP } from '../lib/classify';
import { reclassifyCorpus, rerouteScienceMisroutes } from '../lib/corpus-normalize';
import { routeRRLot } from '../rr-auction';
import { athleteIn } from '../lib/athlete-roster';

type R = Record<string, any>;
const L = (o: R): any => ({ id: 'x', artist: 'memorabilia', title: 't', category: 'object', auctionHouse: 'REA', saleName: '', status: 'sold', ...o });
const move = (o: R) => { const l = L(o); const r = reclassifyLot(l); return r.drop ? DROP : l.artist; };

test('regression a · wrongful evictions: signed historic documents, culture-sale lots, signed media, sports cards', () => {
  // Christie's book-department signed documents are the historic catch-all, not "books"
  assert.equal(move({ auctionHouse: "Christie's", artist: 'scientific-instruments', saleName: 'Fine Printed Books And Manuscripts Including Americana',
    title: 'HANCOCK, John (1737-1793), Signer (Massachusetts) . Bound volume of 168 printed bills of lading, preliminary blank boldly inscribed "Bill of Lading Book." 21 BILLS ACCOMPLISHED BY JOHN HANCOCK AND SIGNED ("John Hancock")' }), 'entertainment-memorabilia');
  assert.equal(move({ auctionHouse: "Christie's", artist: 'scientific-instruments', saleName: 'Printed Books And Manuscripts',
    title: 'TRUMAN, Harry S. Printed text of his last message as President signed ("Harry Truman"), Washington, D.C., 15 January 1953.' }), 'entertainment-memorabilia');
  // a scientist's signed photograph is science-tech
  assert.equal(move({ auctionHouse: "Christie's", artist: 'scientific-instruments', saleName: 'The Jerome Shochet Collection',
    title: 'CURIE, Marie ( née Maria Sklodowska), (1867-1934). Photograph signed (M. Curie"), by an unidentified photographer, n.d. [ca.1920?}.' }), 'science-tech');
  // an Entertainment Memorabilia sale's bare-name lot is culture
  assert.equal(move({ auctionHouse: "Christie's", artist: 'scientific-instruments', saleName: 'Entertainment Memorabilia', title: 'TOM THUMB',
    description: 'TOM THUMB A group of eight carte-de-visite, 1863 photographs of Charles Stratton, "Tom Thumb".' }), 'entertainment-memorabilia');
  // books and maker-signed objects still go
  assert.equal(move({ auctionHouse: "Christie's", artist: 'scientific-instruments', saleName: 'Valuable Printed Books And Manuscripts',
    title: 'MAIER, Michael. Atalanta fugiens, hoc est, emblemata nova de secretis naturae chymica. Oppenheim: 1618. 4to.' }), DROP);
  assert.ok(!isSignedDocument("Longines, A fine and very rare silver keyless lever two-day deck watch Signed Longines, no. 1'927'932, circa 1909"));
  assert.ok(!isSignedDocument('helmut newton, fashion study. model in trouser suit, 1970s, colour print, signed...'));
  // a celebrity-signed piece is an autograph, not the mass object it is signed on
  assert.equal(move({ auctionHouse: 'RR Auction', artist: 'entertainment-memorabilia', title: 'The Godfather: Al Pacino, James Caan, and Diane Keaton Signed LaserDisc Sleeve' }), 'entertainment-memorabilia');
  assert.equal(move({ auctionHouse: "Julien's", artist: 'pop-memorabilia', title: 'OLIVIA NEWTON-JOHN AND JOHN TRAVOLTA SIGNED MENU FROM 2019 "MEET \'N\' GREASE MOVIE SING-A-LONG!," SIGNED IMAGE AND TRADING CARD' }), 'pop-memorabilia');
  // …but slabbed / sealed / comic product stays out
  assert.equal(move({ auctionHouse: 'Goldin', artist: 'entertainment-memorabilia', title: '2023 Hit Parade Iron Throne Edition Series 27 Hobby Box - Possible Emilia Clarke, Kit Harington, Peter Dinklage Signed Cards' }), DROP);
  assert.equal(move({ auctionHouse: 'Propstore', artist: 'pop-memorabilia', title: 'Lot # 1524: Marvel Comics - Charles Lippincott Collection: Star Wars No. 1 Comic Signed by Charles Lippincott, Roy Thomas, and Howard Chaykin CBCS 5.5' }), DROP);
  // a sports card in culture goes home — a roster athlete or a vintage issue with no sport word
  assert.equal(move({ auctionHouse: 'RR Auction', artist: 'entertainment-memorabilia', saleName: 'Sports', title: '1966 Philadelphia Gum Gale Sayers RC PSA EX 5' }), 'sports-cards');
  assert.equal(move({ auctionHouse: 'RR Auction', artist: 'entertainment-memorabilia', title: '1952 Red Man Complete SGC Graded Set (52)' }), 'graded-cards');
  // a "set" of crew signatures is not a card set
  assert.equal(move({ auctionHouse: 'RR Auction', artist: 'entertainment-memorabilia', title: 'USS Pueblo: Extraordinary near-complete set of the USS Pueblo crew' }), 'entertainment-memorabilia');
  // non-sport graded cards still have no home
  assert.equal(move({ auctionHouse: 'Goldin', artist: 'entertainment-memorabilia', title: '1968 Gordon Currie Star Trek Capt. Kirk – PSA MINT 9' }), DROP);
});

test('regression a · an astronaut\'s effects in a space sale are never evicted as an untracked watch maker', () => {
  const lots: any[] = [
    L({ id: 'bean', auctionHouse: 'RR Auction', artist: 'space-exploration', saleName: 'Space', title: 'Wristwatch Group Lot (6) - From the Personal Collection of Alan Bean' }),
    L({ id: 'rm', auctionHouse: "Christie's", artist: 'scientific-instruments', saleName: 'Important Watches', title: 'RICHARD MILLE. A TITANIUM SKELETONISED TOURBILLON WRISTWATCH' }),
  ];
  rerouteScienceMisroutes(lots);
  assert.deepEqual(lots.map(l => l.id), ['bean']);
});

test('regression b · rows outside sports shed a stale playerName / playerSlug', () => {
  const lots: any[] = [
    L({ id: 'j', auctionHouse: "Julien's", artist: 'memorabilia', title: 'MARILYN MONROE HOTEL TELEPHONE MESSAGES', playerName: 'MARILYN MONROE', playerSlug: 'marilyn-monroe' }),
    L({ id: 'c', auctionHouse: "Christie's", artist: 'entertainment-memorabilia', title: "CHINESE A GRAY SCHOLAR'S ROCK", playerName: 'CHINESE A GRAY', playerSlug: 'chinese-a-gray' }),
    L({ id: 's', auctionHouse: 'Goldin', artist: 'game-used', title: 'Kobe Bryant Game-Worn Jersey', playerName: 'Kobe Bryant', playerSlug: 'kobe-bryant' }),
  ];
  reclassifyCorpus(lots);
  const by = Object.fromEntries(lots.map(l => [l.id, l]));
  assert.equal(by.c.playerName, undefined); assert.equal(by.c.playerSlug, undefined);
  assert.equal(by.s.playerName, 'Kobe Bryant');
});

test('regression c · flips: aviators in a space sale, graded tickets / lineup cards / wrappers are not cards', () => {
  assert.equal(routeRRLot('Jacqueline Cochran Signed Photograph', '', 'Space'), 'entertainment-memorabilia');
  assert.equal(routeRRLot('John Young', '', 'Space & Aviation'), 'space-exploration');
  assert.equal(move({ auctionHouse: 'RR Auction', artist: 'space-exploration', saleName: 'Space', title: 'Jacqueline Cochran Signed Photograph' }), 'entertainment-memorabilia');
  for (const t of [
    'Aug. 6, 1965 Detroit Tigers Full Ticket - Mantle Hits #468 HR PSA 6 EX-MT',
    '203 May 28, 1964 New York Mets Lineup Card Signed by Casey Stengel (PSA)',
    'Group of (12) Different 1969 Topps Baseball Wrappers with 2 Canadian Versions',
    'Impressive Michael Jordan Autographed 1986 Fleer Rookie Card Blown-Up Print in Large Frame UDA COA',
  ]) assert.ok(!isCardTitle(t), t);
  // card sets that include a wrapper, and Contenders "Rookie Ticket" cards, stay cards
  assert.ok(isCardTitle('1960 Fleer Football Complete Set (132) Plus Original Wrapper'));
  assert.ok(isCardTitle('218 2018 Panini Contenders Optic Rookie Ticket Autograph Orange #101 Baker Mayfield Rookie Autograph 1/25 BGS MINT 9'));
  // a signed graded card is a card (Beckett auto grade)
  assert.ok(isCardTitle('Signed 1984 Topps Football #63 John Elway (HOF RC) - BECKETT AUTO GEM MINT 10'));
  assert.equal(move({ auctionHouse: 'Memory Lane', artist: 'graded-cards', title: 'Aug. 6, 1965 Detroit Tigers Full Ticket - Mantle Hits #468 HR PSA 6 EX-MT' }), 'tickets-passes');
  assert.equal(move({ auctionHouse: 'Lelands', artist: 'graded-cards', title: '203 May 28, 1964 New York Mets Lineup Card Signed by Casey Stengel (PSA)' }), 'autographs');
  assert.equal(move({ auctionHouse: 'Memory Lane', artist: 'graded-cards', title: 'Group of (12) Different 1969 Topps Baseball Wrappers with 2 Canadian Versions' }), 'memorabilia');
  assert.equal(move({ auctionHouse: 'Love of the Game', artist: 'autographs', title: 'Signed 1984 Topps Football #63 John Elway (HOF RC) - BECKETT AUTO GEM MINT 10' }), 'graded-cards');
});

test('athlete roster: corpus card players, never teams / phrases / namesakes', () => {
  assert.equal(athleteIn('Sugar Ray Robinson Signed Photograph'), 'ray robinson');
  assert.equal(athleteIn('Ty Cobb Signature'), 'ty cobb');
  assert.equal(athleteIn('St. Louis Cardinals Signed Photograph'), null);
  assert.equal(athleteIn('1960s TV Series High-Grade Complete Sets (3): Beverly Hillbillies, Munsters, and Superman'), null);
  assert.equal(athleteIn('Marilyn Monroe Signed Photograph'), null);
  assert.equal(athleteIn('John F. Kennedy 1959 Signed Photograph with Inscription Mentioning Ted Williams', 2), null);
});

test('class 4 · RR athlete autographs by bare name are sports, not culture', () => {
  const R = (title: string) => move({ auctionHouse: 'RR Auction', artist: 'entertainment-memorabilia', saleName: 'Fine Autographs and Artifacts', title });
  assert.equal(R('Ted Williams and Carl Yastrzemski'), 'autographs');
  assert.equal(R('Warren Spahn and John Sain Signed Photograph'), 'autographs');
  assert.equal(R('Sugar Ray Robinson Signed Photograph'), 'autographs');
  assert.equal(R('Roger Clemens (2) Signed Baseballs'), 'autographs');
  assert.equal(R('“Pistol” Pete Maravich'), 'autographs');
  // a pair with a non-athlete, a name deep in the title, a non-sport subject: culture stays
  assert.equal(R('Gale Sayers and Billy Dee Williams'), 'entertainment-memorabilia');
  assert.equal(R('Frank Thomas and Ollie Johnston Group Lot'), 'entertainment-memorabilia');
  assert.equal(R('John F. Kennedy 1959 Signed Photograph with Inscription Mentioning Ted Williams'), 'entertainment-memorabilia');
  assert.equal(R('Orville Wright'), 'entertainment-memorabilia');
  // the crawler reads the same roster
  assert.equal(routeRRLot('Ty Cobb Signature', '', 'Fine Autographs and Artifacts'), 'autographs');
  // the sports houses' pop desk: a roster athlete is sports unless the object reads non-sport
  assert.equal(move({ auctionHouse: 'SCP', artist: 'pop-memorabilia', title: 'Hack Wilson Autographed Album Page - PSA/DNA Authentic' }), 'autographs');
  assert.equal(move({ auctionHouse: 'Lelands', artist: 'pop-memorabilia', title: '208 Wilt Chamberlain Stilt Record Label Acetate & More' }), 'pop-memorabilia');
});
