/**
 * Categorization wave 2 (Oct 6 2026 re-audit, 1,648 fresh lots under the
 * original rubric). Fixtures are REAL titles from the re-audit labels
 * (scratchpad reaudit-cat/w/parts) and its eviction check, each pinned to the
 * label the auditor gave it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reclassifyLot, isCardTitle, isSignedDocument, DROP } from '../lib/classify';
import { reclassifyCorpus, rerouteScienceMisroutes, cultureItemClass } from '../lib/corpus-normalize';
import { routeRRLot } from '../rr-auction';
import { athleteIn } from '../lib/athlete-roster';
import { subCatOf } from '../lib/sub-cats';

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

test('class 8 · Julien\'s / Propstore lots are sports only with sport evidence', () => {
  const J = (title: string, artist = 'memorabilia', saleName = 'Icons & Idols Hollywood', house = "Julien's") => move({ auctionHouse: house, artist, saleName, title });
  assert.equal(J('THE BIG LEBOWSKI JEFF BRIDGES WHITE SLEEVELESS COVERALLS'), 'entertainment-memorabilia');
  assert.equal(J('DAYS OF OUR LIVES EMMY AWARD', 'trophies-awards'), 'entertainment-memorabilia');
  assert.equal(J('MICHAEL JACKSON SIGNED STANDEE', 'autographs', 'The Collection of Tompkins and Bush'), 'entertainment-memorabilia');
  assert.equal(J("Lot # 368: Star Wars: The Phantom Menace (1999) - Obi-Wan Kenobi's (Ewan McGregor) Dueling Lightsaber Hilt", 'memorabilia', 'Entertainment Memorabilia Live', 'Propstore'), 'entertainment-memorabilia');
  assert.equal(J('PINOCCHIO RE-RELEASE POSTER', 'memorabilia', 'Icons & Idols 2012: Hollywood'), DROP);
  assert.equal(J('LETTER OPENER AND MAGNIFYING GLASS', 'memorabilia', "A Gentleman's Arcade of Luxury Treasures"), DROP);
  // sports evidence keeps it: a sports sale, a roster athlete, fight/match-worn language
  assert.equal(J('BOB GIBSON 1961 TOPPS TRADING CARD #211 - PSA MINT 9', 'graded-cards', 'Sports Legends'), 'graded-cards');
  assert.equal(J('DIEGO MARADONA 1995 MATCH WORN BOCA JUNIORS SHIRT', 'game-used', 'Icons & Idols: Sports'), 'game-used');
  assert.equal(J('ALI AND FRAZIER SIGNED NEIL LEIFER PHOTOGRAPH', 'type-1-photos', 'Sports Legends and Music Icons'), 'type-1-photos');
  assert.equal(J('MICHAEL JACKSON SIGNED BAD DISPLAY', 'equipment-artifacts', 'Sports Legends and Music Icons'), 'entertainment-memorabilia');
});

test('class 11 · Goldin\'s item-type facet: a music / film object is not game-used', () => {
  const G = (title: string, artist = 'game-used') => move({ auctionHouse: 'Goldin', artist, saleName: 'Goldin Thematic Auction', title });
  assert.equal(G('Simmone MacKinnon "Allie Reese" Production-Made Cropped Rash Guard from Baywatch (1989-2001) - Baywatch Production COA'), 'entertainment-memorabilia');
  assert.equal(G('Production-Made Death Eater Thorn Wand Prop from Harry Potter and the Deathly Hallows (2010-2011) - 13.5" - Coronado Trading OOA'), 'movie-tv');
  assert.equal(G('1946 Gilda Framed Belgian Movie Poster - 21.75 x 26'), 'entertainment-memorabilia');
  // sealed / graded records and modern tour posters are mass items
  assert.equal(G('The Beatles - "Anthology 1" - Sealed Vinyl Record - Europe Release, Tri-Fold, 3x Vinyl - Apple Records - 1995'), DROP);
  assert.equal(G('July 14-15, 2018 Eminem Revival Tour Poster - 11 x 17'), DROP);
  assert.equal(G('James Taylor - "Handy Man" - Test Pressing Vinyl - 12", 33 1/3 RPM - Columbia Records - 1977 - VMG EX 8.0'), DROP);
  // sport evidence keeps a sports lot
  assert.equal(G('2021 Jonah Williams Los Angeles Rams White Practice-Used Jersey – Rams COA'), 'game-used');
  assert.equal(G('1952 Rocky Marciano/Jersey Joe Walcott Type I Original Photo by Sam Goldstein - 7 x 9.25 - PSA/DNA', 'type-1-photos'), 'type-1-photos');
});

test('class 2 · sports houses: card lots are cards; non-sport cards have no home; Pokémon is tcg', () => {
  const H = (title: string, artist: string, house = 'Huggins & Scott') => move({ auctionHouse: house, artist, title });
  assert.equal(H('(19,000+) Multi-Sport 1980s-2000s Stars, Rookies & Inserts', 'memorabilia'), 'graded-cards');
  assert.equal(H('(3) 1941-1968 Hall of Fame Graded Rookie Lot with Ryan, Clemente and Reese', 'memorabilia'), 'graded-cards');
  assert.equal(H('1948-1982 Baseball & Football Singles Collection (317) with Hall of Famers & Stars', 'memorabilia'), 'graded-cards');
  // autograph collections, coins, tobacco packages, lobby cards are not card lots
  assert.equal(H('151 Hall of Famers Autograph Collection (15)', 'autographs', 'Lelands'), 'autographs');
  assert.equal(H('1828-1938 U.S. Graded Coin Lot of (10) with (2) Key Date Liberty Nickels', 'memorabilia'), 'memorabilia');
  assert.equal(H('1950s Mexican Movie Lobby Cards Lot (8) with Edward G. Robinson and Dan Dailey', 'memorabilia'), 'memorabilia');
  // non-sport cards / comics / other TCGs: no home; Pokémon → tcg; a non-sport 1/1 → pop-memorabilia
  assert.equal(H('1985 Topps "Garbage Pail Kids" Original Series 1 and Series 3 Near-Complete Set Pair (2 Sets, 156 Stickers)', 'graded-cards', 'REA'), DROP);
  assert.equal(H('1962 Topps "Mars Attacks" #24 "The Shrinking Ray" PSA NM-MT 8', 'graded-cards', 'REA'), DROP);
  assert.equal(H('1955 Topps "Rails and Sails" Collection (73)', 'graded-cards', 'REA'), DROP);
  assert.equal(H('1963 Marvel Amazing Spider-Man #1 Second Appearance of Spider-Man CGC 4.5', 'graded-cards'), DROP);
  assert.equal(H('2019 Pokémon Sun & Moon #205 Gardevoir/Sylveon GX Unbroken Bonds Full Art PSA GEM MINT 10', 'graded-cards'), 'pokemon');
  assert.equal(H('1962 Topps "Mars Attacks" Original Artwork for Card #14 - Charred By Martians', 'graded-cards', 'REA'), 'pop-memorabilia');
  // sports cards stay: a team name or roster athlete is sport evidence
  assert.equal(H('1949 Cleveland Indians Picture Pack Action Set with Satchel Paige PSA 9 MINT', 'graded-cards', 'Memory Lane'), 'graded-cards');
});

test('class 3 · mass items kept in culture: coins, toys, magazine lots, mass campaign buttons, unworn designer fashion', () => {
  const C = (title: string, house = 'Goldin', artist = 'entertainment-memorabilia', saleName = '') => move({ auctionHouse: house, artist, title, saleName });
  assert.equal(C('1921 Morgan Peace Dollar $1 Coin - PCGS MS63'), DROP);
  assert.equal(C('The Beatles Magazines, Books, Newspapers Collection (16) - Savenick LOP'), DROP);
  assert.equal(C('2025 Kickstradomis Charzilla Vs. Kong Iridescent Glow Premium Collection Iconic Mashups Series (#1/1) - Kickstradomis Encapsulated'), DROP);
  assert.equal(C('A BUDDY-L STEELPLATE FORD MODEL T DUMP TRUCK', "Christie's"), DROP);
  assert.equal(C('(3) American Eagle U.S. Silver Dollar Album Lot With (64) Total Coins', 'Huggins & Scott', 'pop-memorabilia'), DROP);
  // a named person's piece is provenance
  assert.equal(C("Dwight D. Eisenhower's Silver Dollar Belt Buckle: Ornate silver-and-gold belt buckle", 'RR Auction'), 'entertainment-memorabilia');
  // Hake's: mass campaign / cause buttons go; a classic jugate or a 1902 portrait button stays
  assert.equal(C('WILLKIE: "OUT OF THE DOG HOUSE INTO THE WHITE HOUSE" 1940 CARTOON BUTTON.', "Hake's", 'pop-memorabilia'), DROP);
  assert.equal(C('"ANOTHER DEMOCRAT FOR HOOVER" SLOGAN BUTTON.', "Hake's", 'pop-memorabilia'), DROP);
  assert.equal(C('"MCKINLEY AND HOBART" STARS AND STRIPES JUGATE BUTTON.', "Hake's", 'pop-memorabilia'), 'pop-memorabilia');
  assert.equal(C('"WELCOME ROOSEVELT SOUVENIR JULY 4, 1902" PORTRAIT BUTTON.', "Hake's", 'pop-memorabilia'), 'pop-memorabilia');
  // Hake's sports-slug political lots are culture; its toys go
  assert.equal(C('ZACHARY TAYLOR: WHIG ALMANAC 1849.', "Hake's", 'memorabilia'), 'entertainment-memorabilia');
  assert.equal(C('TRANSFORMERS (1988) MICROMASTER BATTLE STATION - MICROMASTER IRONWORKS BOXED.', "Hake's", 'memorabilia'), DROP);
  // Sotheby's Fashion Icons: an unworn designer garment / costume jewellery has no home; a star's gown stays
  assert.equal(C('Set of Three Gold and Pearl Earrings and Bracelet, Red Gripoix Necklace', "Sotheby's", 'entertainment-memorabilia', 'Fashion Icons'), DROP);
  assert.equal(C("Audrey Hepburn's Givenchy Haute Couture Cocktail Gown, Autumn-Winter 1966", "Sotheby's", 'entertainment-memorabilia', 'Fashion Icons'), 'entertainment-memorabilia');
});

test('class 1 · culture kind reads the description when the title is a bare name; signed pieces; plurals', () => {
  const K = (title: string, description = '', o: R = {}) => subCatOf({ artist: 'entertainment-memorabilia', title, itemClass: cultureItemClass({ title, description, ...o }) }).subCat;
  // the object lives in the description (Christie's / Sotheby's culture titles)
  assert.equal(K('Eric Clapton', "Eric Clapton A presentation 'platinum' disc award for the album From The Cradle"), 'awards');
  assert.equal(K('CASABLANCA', 'CASABLANCA Re-release 1962, Warner Bros., Italian locandina - linen-backed, (B+)'), 'posters');
  assert.equal(K('STEVIE NICKS', 'STEVIE NICKS A black velvet hat worn by Stevie Nicks on her 1988 WHOLE LOTTA TROUBLE tour'), 'worn-personal');
  assert.equal(K('Alien And Aliens', "Alien And Aliens A prop grotesque 'face hugger' of foam-filled latex"), 'props');
  assert.equal(K('Film Stars And Entertainers', 'Film Stars And Entertainers Approximately one hundred and seventy autographs, mainly on album pages'), 'autographs');
  // plurals and photo forms
  assert.equal(K('JOHN LENNON & BEATLES PHOTOGRAPHS BY DEZO HOFFMANN 1963-1967'), 'photos');
  assert.equal(K('MARILYN MONROE UNPUBLISHED SNAPSHOT 1945'), 'photos');
  // a signed flat / retail piece is an autograph; a signed document, guitar or album is that object
  assert.equal(K('Nat King Cole Signed Program Page'), 'autographs');
  assert.equal(K('Johnny Depp Signed Disney Pirate Hat - PSA/DNA LOA'), 'autographs');
  assert.equal(K('Pete Best Single-Signed Drum Sticks Pair (2) - Includes Personal Photo, Oasis Tour Passes - Beckett'), 'autographs');
  assert.equal(K('Franklin D. Roosevelt Signed Document'), 'documents');
  assert.equal(K('REO SPEEDWAGON SIGNED GUITAR'), 'instruments');
  assert.equal(K('Led Zeppelin: Robert Plant Signed Album'), 'records');
  assert.equal(K("Daniel Radcliffe's Personally-Owned Signed Shoes"), 'worn-personal');
  assert.equal(K('James Bond: Regin, Nadja Signed Photograph'), 'photos');
  assert.equal(K('Led Zeppelin Multi-Signed DVD Insert Booklet (3 Signatures) - Including Jimmy Page'), 'autographs');
  // RR documents and cut signatures (rubric: a signed cut is a document)
  assert.equal(K('Edward Rutledge Signature'), 'documents');
  assert.equal(K('Civil War: Confederate Bond'), 'documents');
  assert.equal(K('Henri de Toulouse-Lautrec: Sick with the flu, Lautrec writes his grandmother in early 1890'), 'documents');
  assert.equal(K('PAUL REUBENS PEE-WEE HERMAN SIGNATURE COSTUME'), 'worn-personal');
  // RR's "<Signer> Book" shorthand, and an RR Photography Auction lot
  assert.equal(K('Fritz Kreisler Book', '', { auctionHouse: 'RR Auction' }), 'autographs');
  assert.equal(K('Cecil Beaton', '', { auctionHouse: 'RR Auction', saleName: 'Photography Auction' }), 'photos');
});
