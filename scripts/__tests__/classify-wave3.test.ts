/**
 * Categorization wave 3 (Oct 6 2026 re-audit #2, 743 fresh lots + the wave-2
 * label sets). Fixtures are REAL titles from the labelled lots, pinned to the
 * label the auditor gave them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subCatOf, sportOfSale, cultureTextDomain, curatedDomainOf } from '../lib/sub-cats';
import { stampSubCats, clearJunkModelKeys, cultureItemClass } from '../lib/corpus-normalize';
import { reclassifyLot, DROP } from '../lib/classify';
import { isWatchModelLine } from '../../app/lib/watch-ref';
import { parseCard, cardLadderKey, cardKey, playerOf, knownPlayerSet } from '../../app/lib/cards';

type R = Record<string, any>;

test('drill 1a · a single-sport sale names the sport; a mixed one does not', () => {
  assert.equal(sportOfSale('Football Memorabilia', "Christie's"), 'soccer');
  assert.equal(sportOfSale('Nba Auctions Summer Series', "Sotheby's"), 'basketball');
  assert.equal(sportOfSale('Golfing Memorabilia', "Christie's"), 'golf');
  assert.equal(sportOfSale('Cricket Tennis Golf Memorabilia', "Christie's"), null);
  assert.equal(sportOfSale('Sporting Books And Memorabilia', "Christie's"), null);
  assert.equal(sportOfSale('Goldin Weekly Auction', 'Goldin'), null);
  const D = (o: R) => subCatOf({ artist: 'sports-memorabilia', title: 't', ...o }).drill;
  assert.equal(D({ title: 'A blue Scotland International short-sleeved shirt, No.7', saleName: 'Football Memorabilia', auctionHouse: "Christie's" }), 'soccer');
  assert.equal(D({ title: 'jaden hardy dallas mavericks 2024-2025 city edition warmup set', saleName: 'Nba Auctions Summer Series', auctionHouse: "Sotheby's" }), 'basketball');
  // cricket / rugby lots carry no drill of ours
  assert.equal(D({ title: 'A Victorian cricket bat signed by W.G. Grace', saleName: 'Football Memorabilia', auctionHouse: "Christie's" }), null);
});

test('drill 1b · sport words: golf clubs, WNBA / Hoops, prize fighters, pre-war codes anywhere', () => {
  const D = (artist: string, title: string, o: R = {}) => subCatOf({ artist, title, ...o }).drill;
  assert.equal(D('sports-memorabilia', 'A JEAN GASSIAT PUTTER'), 'golf');
  assert.equal(D('sports-cards', '00 SkyBox Hoops Pure Players 100% #4 Grant Hill (#077/100) - BGS GEM MINT 9.5'), 'basketball');
  assert.equal(D('graded-cards', '1938 F. C. Cartledge "Famous Prize Fighters" PSA-Graded Collection (29)'), 'boxing-mma');
  assert.equal(D('graded-cards', '1909-11 American Caramel E90-1 Joe Jackson Graded BVG 1'), 'baseball');
  assert.equal(D('graded-cards', 'All (3) 1909-1911 T206 Christy Mathewson Poses'), 'baseball');
});

test('drill 1c · the vintage card houses: a pre-1981 card naming no sport is baseball', () => {
  const D = (title: string, house = 'REA', artist = 'graded-cards') => subCatOf({ artist, title, auctionHouse: house }).drill;
  assert.equal(D('1948 Bowman #30 Whitey Lockman Short Print PSA NM 7'), 'baseball');
  assert.equal(D('1975 Topps PSA-Graded Near-Complete Set (658/660)'), 'baseball');
  assert.equal(D('1952 Topps Double Print Error Uncut Panel'), 'baseball');
  // not at Goldin, not modern, not a non-sport issue, not a wax box
  assert.equal(D('1952 Topps #311 Mickey Mantle', 'Goldin', 'sports-cards'), null);
  assert.equal(D('1993 Topps #98 Derek Jeter'), null);
  assert.equal(D('Circa-1892 Buffalo Bill Cody Brisbois Cabinet - SGC 50'), null);
  assert.equal(D('1979 Topps Unopened Cello Box (24 Packs)', 'REA', 'unopened-wax'), null);
});

test('drill 1d · learned maps: player → sport (roster athletes), set → sport, subject → domain, reference → family', () => {
  const lots: R[] = [];
  // a roster athlete's sport, learned from his worded lots, reaches a bare-name autograph
  for (let i = 0; i < 3; i++) lots.push({ id: `a${i}`, artist: 'autographs', title: `Joe DiMaggio Signed Baseball ${i}`, auctionHouse: 'RR Auction', saleName: '' });
  lots.push({ id: 'a9', artist: 'autographs', title: 'Joe DiMaggio Signed Photograph', auctionHouse: 'RR Auction', saleName: 'Fine Autographs and Artifacts' });
  // a set's sport, learned from the set's sport-stamped cards
  for (let i = 0; i < 5; i++) lots.push({ id: `s${i}`, artist: 'sports-cards', sport: 'Baseball', title: `2020 Bowman Chrome Prospects #BCP-${i} Player${String.fromCharCode(65 + i)} Name${i} - PSA GEM MT 10`, auctionHouse: 'Goldin' });
  lots.push({ id: 's9', artist: 'sports-cards', title: '2020 Bowman Chrome Prospects Orange Refractors #CPA-BL Bayron Lora Signed Rookie Card (#14/25) - PSA 10', auctionHouse: 'Goldin' });
  // a culture subject's domain, learned from its worded lots
  lots.push({ id: 'c1', artist: 'entertainment-memorabilia', title: 'Schuyler Colfax Signed Document as Vice President', subjectKeys: ['schuyler colfax'] });
  lots.push({ id: 'c2', artist: 'entertainment-memorabilia', title: 'Schuyler Colfax Autograph Letter Signed as Speaker of the House to a Senator', subjectKeys: ['schuyler colfax'] });
  lots.push({ id: 'c9', artist: 'entertainment-memorabilia', title: 'Schuyler Colfax', subjectKeys: ['schuyler colfax'] });
  // a curated 'other' subject (Civil War) is never learned
  lots.push({ id: 'w1', artist: 'entertainment-memorabilia', title: 'Civil War: Army Regiment Muster Roll', subjectKeys: ['civil war'] });
  lots.push({ id: 'w2', artist: 'entertainment-memorabilia', title: 'Civil War: Soldier Letter', subjectKeys: ['civil war'] });
  lots.push({ id: 'w9', artist: 'entertainment-memorabilia', title: 'Civil War: Confederate Bond', subjectKeys: ['civil war'] });
  // a watch reference's family, learned from its titled siblings
  for (let i = 0; i < 3; i++) lots.push({ id: `r${i}`, artist: 'rolex', formKey: 'wristwatch', reference: '5513', title: `Rolex Submariner ref. 5513 no. ${i}` });
  lots.push({ id: 'r9', artist: 'rolex', formKey: 'wristwatch', reference: '5513', title: 'A stainless steel automatic center seconds wristwatch' });
  stampSubCats(lots as never);
  const by = (id: string) => lots.find(l => l.id === id)!.drill ?? null;
  assert.equal(by('a9'), 'baseball');
  assert.equal(by('s9'), 'baseball');
  assert.equal(by('c9'), 'political');
  // (Oct 8) never LEARNED — but the words "Civil War" now name the domain
  assert.equal(by('w9'), 'military');
  assert.equal(by('r9'), 'submariner');
});

test('drill 1e · culture domain from the lot\'s own words; Prince and Queen the musicians are not royalty', () => {
  assert.equal(cultureTextDomain('Feb. 3, 1968 - Jimi Hendrix Winterland Ballroom Concert Full Ticket - PSA EX-MT 6'), 'music');
  assert.equal(cultureTextDomain('Feb. 4, 1999 - Bill Clinton Impeachment Trial Pass - PSA EX-MT 6 - Pop 2'), 'political');
  assert.equal(cultureTextDomain('Production-Made Dex\'s Diner Waitress Accessory Prop from Star Wars Episode II'), 'hollywood');
  assert.equal(cultureTextDomain('Jubal A. Early Autograph Letter Signed on Lee and Jackson, Army of Northern Virginia'), 'military');
  assert.equal(cultureTextDomain('Queen Victoria Group Lot'), 'royalty');
  assert.equal(cultureTextDomain('King Louis XIII Document Signed'), 'royalty');
  assert.equal(cultureTextDomain('Prince Lovesexy Handwritten Tour Book Essay'), 'music');
  assert.equal(cultureTextDomain('Prince Guitar Picks and Pin'), 'music');
  assert.equal(cultureTextDomain('Stephen King Signed Book'), null);
  assert.equal(cultureTextDomain('William Pitt the Younger Document Signed as Prime Minister of Great Britain'), 'political');
  // a longer capitalised subject run is looked up by its leading words
  assert.equal(curatedDomainOf(['marilyn monroe unpublished snapshot']), 'hollywood');
});

test('drill 1f · watch family from the description head', () => {
  const W = subCatOf({ artist: 'rolex', formKey: 'wristwatch', title: 'A very fine stainless steel chronograph wristwatch with bracelet', description: 'Rolex Cosmograph Daytona, ref. 6263, a very fine stainless steel chronograph' });
  assert.equal(W.drill, 'daytona');
});

test('modelKey 2 · a model key survives only as an identity: design codes, art catalogue numbers, watch model lines / printed refs', () => {
  const lots: R[] = [
    { id: 'g', artist: 'sports-cards', title: '2019 Panini Prizm #1 Zion - PSA GEM MT 10', modelKey: 'mt10' },
    { id: 'p', artist: 'entertainment-memorabilia', title: 'Signed 8 x 10 Photo', modelKey: 'x10' },
    { id: 'w', artist: 'patek-philippe', title: 'PATEK PHILIPPE. AN 18K GOLD WRISTWATCH', modelKey: 'an18' },
    { id: 'wl', artist: 'rolex', title: 'Rolex Submariner', modelKey: 'submariner' },
    { id: 'wr', artist: 'patek-philippe', title: 'Patek Philippe ref. 3919', reference: '3919/005', modelKey: '3919' },
    { id: 'd', artist: 'charles-eames', title: 'LCW chair', modelKey: 'lcw' },
    { id: 'a', artist: 'andy-warhol', title: 'Marilyn (F. & S. II.31)', modelKey: 'ii31' },
  ];
  assert.equal(clearJunkModelKeys(lots as never), 3);
  const mk = (id: string) => lots.find(l => l.id === id)!.modelKey ?? null;
  assert.deepEqual(['g', 'p', 'w', 'wl', 'wr', 'd', 'a'].map(mk), [null, null, null, 'submariner', '3919', 'lcw', 'ii31']);
  assert.equal(isWatchModelLine('rolex', 'daytona'), true);
  assert.equal(isWatchModelLine('rolex', 'nautilus'), false);
});

test('cardKey 3 · a numberless pre-war catalog card keys on code + player + pose / team / back', () => {
  const L = (t: string) => cardLadderKey(parseCard(t));
  assert.equal(L('1909-1911 T206 White Border Ty Cobb Portrait Green Background'), 'ty-cobb|t206|t206|-|p:portrait-green-background');
  assert.equal(L('1909-1911 T206 White Border Rube Waddell Portrait SGC GOOD 30'), 'rube-waddell|t206|t206|-|p:portrait');
  assert.equal(L('1912 T207 Brown Background Mike Mitchell Cincinnati PSA GOOD 2'), 'mike-mitchell|t207|t207|-|p:cincinnati');
  assert.equal(L('1911 E94 George Close Candy Ty Cobb PSA NM 7 - Rare Orange Background!'), 'ty-cobb|e94|e94|-|p:orange-background');
  // REA, Goldin and LOTG print the same card three ways — one key
  const a = L('1909-1911 T206 White Border Christy Mathewson Portrait PSA VG-EX 4');
  assert.equal(a, L('11 T206 White Border Christy Mathewson, Portrait - PSA VG-EX 4'));
  assert.equal(a, L('27 1909-11 T206 Christy Mathewson (HOF - Portrait) - PSA VG-EX 4'));
  assert.notEqual(L('1909-1911 T206 White Border Bill Dahlen Boston PSA VG+ 3.5'), L('1909-1911 T206 White Border Bill Dahlen Brooklyn PSA VG+ 3.5'));
  assert.equal(cardKey(parseCard('1909-1911 T206 White Border Charlie Starr PSA EX 5')), 'charlie-starr|t206|t206|-|PSA5');
  // lots, folders, team cards, a numbered card: no catalog key
  assert.equal(L('1912 T207 Brown Background Collection (17) Including Eight Hall of Famers'), null);
  assert.equal(L('1912 T202 Hassan Triple Folder "Close at the Plate" Payne/Walsh PSA EX-MT 6'), null);
  assert.equal(L('1913 T200 Fatima Team Card New York Nationals with Christy Mathewson and Jim Thorpe PSA POOR 1'), null);
  assert.equal(L('1933 Goudey #53 Babe Ruth PSA 5'), 'babe-ruth|1933|goudey|53');
});

test('player 4 · sold sports objects: the one known player anywhere in the head; descriptor names trimmed', () => {
  const known = new Set(['babe-ruth', 'jim-brown', 'kobe-bryant', 'grayson-allen', 'jackie-robinson', 'hank-aaron', 'warren-spahn', 'san-francisco', 'fc-barcelona']);
  const P = (t: string, slug = 'autographs') => playerOf(t, slug, known).player;
  assert.equal(P('9/1/1957 Jim Brown Signed Cleveland Browns (at S.F. 49ers) Game Program PSA/DNA LOA', 'programs-publications'), 'Jim Brown');
  assert.equal(P('Jan. 1996 - Kobe Bryant Signed, Inscribed Philadelphia Sports The Fan Magazine - Beckett LOA'), 'Kobe Bryant');
  assert.equal(P("grayson allen 'china games' phoenix suns 2025-2026 game worn icon edition jersey", 'game-used'), 'Grayson Allen');
  assert.equal(P('HIGH-GRADE JACKIE ROBINSON SIGNED & INSCRIBED "BEST WISHES" INDEX CARD - PSA/DNA MINT 9'), 'Jackie Robinson');
  // two known players, a team-signed ball, a city, a club: no one player
  assert.equal(P('1958 Signed Photograph of Hank Aaron and Warren Spahn'), null);
  assert.equal(P('1957 Milwaukee Braves Team Signed ONL Baseball Incl. Hank Aaron'), null);
  assert.equal(P('Historic 2011 Houston Astros vs San Francisco Giants Full Ticket', 'tickets-passes'), null);
  assert.equal(P('Raphinha Signed FC Barcelona Jersey - Beckett'), null);
  // a descriptor run is never a known player ("Babe Ruth Type" → Babe Ruth)
  const k2 = knownPlayerSet(['Babe Ruth', 'Babe Ruth', 'Babe Ruth', 'Babe Ruth Type', 'Babe Ruth Type', 'Babe Ruth Type']);
  assert.equal(k2.has('babe-ruth-type'), false);
  assert.equal(playerOf('1932 Babe Ruth Type I Original Photo - PSA/DNA', 'type-1-photos', k2).player, 'Babe Ruth');
});

type Mv = { artist: string; title: string; auctionHouse: string; category?: string; description?: string; saleName?: string };
const mv = (o: Mv): string => {
  const l: any = { id: 'x', category: 'object', saleName: '', description: '', ...o };
  const r = reclassifyLot(l);
  return r.drop ? DROP : `${l.artist}${o.category ? `/${l.category}` : ''}`;
};

test('sports 5 · misroutes: slabbed ticket-named cards, signed balls, GU footballs, non-athlete autographs; wrongful evictions restored', () => {
  // wave-2 wrongful evictions: Contenders / Prospect Ticket "Gold Vinyl" cards
  assert.equal(mv({ artist: 'tickets-passes', auctionHouse: 'Goldin', title: '22 Panini Contenders Rookie Ticket Autograph Premium Edition Gold Vinyl #138 Luka Garza Signed Rookie Card (#1/1) – PSA MINT 9' }), 'sports-cards');
  assert.equal(mv({ artist: 'tickets-passes', auctionHouse: 'Goldin', title: '2024 Panini Prospect Edition Prospect Ticket Gold Vinyl #62 Blake Dunn Rookie Card (#1/1) - PSA GEM MT 10' }), 'sports-cards');
  // and the H&S mixed Multi / Non-Sport lots
  assert.equal(mv({ artist: 'graded-cards', auctionHouse: 'Huggins & Scott', title: 'Late 1880s-1980s Multi/Non-Sport Treasure Chest of (2,049) Cards with Many Hall of Famers & Stars' }), 'graded-cards');
  // wave-2 slip: a singles collection that also has wrappers stays a card lot
  assert.equal(mv({ artist: 'graded-cards', auctionHouse: 'Huggins & Scott', title: '1970-79 Topps Baseball Singles Collection (844) Plus (22) Wrappers' }), 'graded-cards');
  assert.equal(mv({ artist: 'sports-cards', auctionHouse: 'Goldin', title: 'Roger Clemens Signed Commemorative 300th Win, 4,000 Strikeout OML Yankees 100th Anniversary Selig Baseball - Beckett' }), 'autographs');
  assert.equal(mv({ artist: 'trophies-awards', auctionHouse: 'Goldin', title: 'Aaron Rodgers Signed & "2021 MVP" Inscribed Official NFL Football - Fanatics' }), 'autographs');
  assert.equal(mv({ artist: 'trophies-awards', auctionHouse: 'Goldin', title: '1957 Mickey Mantle MVP Award Plaque Signed' }), 'trophies-awards');
  assert.equal(mv({ artist: 'tickets-passes', auctionHouse: 'NFL Auction', title: 'NFL - Vikings Game Used Football (11/16/2025) Numbered 020 Next Gen Stats Notable Play: J. McCarthy 30 Yard TD Pass' }), 'game-used');
  assert.equal(mv({ artist: 'autographs', auctionHouse: 'Huggins & Scott', title: '1963 Dwight D. Eisenhower Signed Typed Letter with Original Mailing Envelope--Full JSA' }), 'entertainment-memorabilia');
  assert.equal(mv({ artist: 'autographs', auctionHouse: 'RR Auction', title: 'Billy Joel Signed Baseball' }), 'entertainment-memorabilia');
  assert.equal(mv({ artist: 'autographs', auctionHouse: 'RR Auction', title: 'Babe Ruth and Calvin Coolidge Signed Photograph' }), 'autographs');
});

test('culture 6 · NASA photos are space, RR "Horse Racing:" an athlete autograph, Hake\'s 1920+ pins and magazine runs are mass', () => {
  assert.equal(mv({ artist: 'entertainment-memorabilia', auctionHouse: 'Goldin', title: 'Jul. 3, 1969 Buzz Aldrin Apollo 11 "Countdown Demo Test" Type I Original Photo by NASA' }), 'space-exploration');
  assert.equal(mv({ artist: 'entertainment-memorabilia', auctionHouse: 'RR Auction', title: 'Horse Racing: Cauthen, Steve' }), 'autographs');
  assert.equal(mv({ artist: 'entertainment-memorabilia', auctionHouse: "Hake's", title: 'ROBERT F. KENNEDY 1968 STAFF PIN.' }), DROP);
  assert.equal(mv({ artist: 'entertainment-memorabilia', auctionHouse: "Hake's", title: 'TRUMAN AND BARKLEY CLASSIC JUGATE WITH LIGHT AGE TONE.' }), 'entertainment-memorabilia');
  assert.equal(mv({ artist: 'entertainment-memorabilia', auctionHouse: "Christie's", title: 'THE BEATLES MONTHLY - A COMPLETE RUN' }), DROP);
});

test('culture 7 · kind: a portrait DRAWING is not a photo; RR narrative letter headlines are documents', () => {
  assert.equal(cultureItemClass({ title: 'NIRVANA: KURT COBAIN SIGNED ORIGINAL DJ PORTRAIT DRAWING &bull;' }), 'autograph-other');
  assert.equal(cultureItemClass({ title: 'Edwin M. Stanton: Stanton consoles a doctor shortly before teaming with Lincoln', auctionHouse: 'RR Auction' }), 'document');
  assert.equal(cultureItemClass({ title: 'Judy Garland: Judy refuses to share her money from A Star Is Born', auctionHouse: 'RR Auction' }), 'document');
  assert.equal(cultureItemClass({ title: 'Marilyn Monroe Signed Portrait Photograph' }), 'signed-photo');
});

test('art 8 · originals without print evidence, Koons porcelain, homage / appropriation / photographer leads', () => {
  const W = (o: Partial<Mv>) => mv({ artist: 'andy-warhol', category: 'print', auctionHouse: "Christie's", title: 't', ...o });
  // an estate inventory number is not an edition
  assert.equal(W({ title: 'Andy Warhol (1928-1987) Owl and Feet', description: "stamped with the Estate of the Andy Warhol and the Andy Warhol Foundation for the Visual Arts, Inc. stamps and numbered '221.032' (on the reverse) ink on paper 16 x 14 in." }), 'andy-warhol/original');
  assert.equal(W({ title: 'ANDY WARHOL (1928-1987) Santa Claus (from Myths)', description: "numéroté 'PA51.010' (sur le revers) peinture au polymère synthétique, peinture dorée et encres sérigraphiques sur toile 152.4 x 152.4 cm." }), 'andy-warhol/original');
  assert.equal(W({ title: 'Andy Warhol (1928-1987) Coke Bottle', description: 'silkscreen ink, acrylic and ballpoint pen on linen 11 1/8 x 6in.' }), 'andy-warhol/original');
  // a print stays a print
  assert.equal(W({ title: 'Marilyn (F. & S. II.31)', description: 'screenprint in colors on wove paper, edition of 250' }), 'andy-warhol/print');
  assert.equal(mv({ artist: 'jeff-koons', category: 'print', auctionHouse: 'Rago', title: 'Puppy (vase)' }), 'jeff-koons/sculpture');
  assert.equal(mv({ artist: 'andy-warhol', category: 'original', auctionHouse: "Christie's", title: 'STURTEVANT (1924-2014) Warhol Gold Marilyn' }), DROP);
  assert.equal(mv({ artist: 'pablo-picasso', category: 'print', auctionHouse: "Christie's", title: 'JIM DINE Big Red Wrench in a Landscape, from Hommage à Picasso (W. C. 146)' }), DROP);
  assert.equal(mv({ artist: 'pablo-picasso', category: 'photograph', auctionHouse: 'Bruun Rasmussen', title: 'Jacques-Henri Lartigue: Spanish painter Pablo Picasso (1881–1973) reclining on a sofa.' }), DROP);
  assert.equal(mv({ artist: 'henri-matisse', category: 'print', auctionHouse: 'Bruun Rasmussen', title: 'Henri Matisse: Exhibition poster. Signed in print Matisse 52. Lithographic poster in colours.' }), DROP);
  assert.equal(mv({ artist: 'henri-matisse', category: 'print', auctionHouse: 'Bonhams', title: 'Verve: Volume IX, Nos 35 & 36. Dernières Oeuvres de Matisse 1950-54' }), 'henri-matisse/print');
});
