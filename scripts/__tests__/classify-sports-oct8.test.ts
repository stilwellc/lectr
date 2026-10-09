/**
 * Oct 8 2026 sports classification audit (E1–E9, Lots & Sets, sport facet).
 * Fixtures are REAL titles from the audit sample / the live + corpus scans the
 * fixes were measured on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reclassifyLot, DROP, goldinNonSportFix, hasSportsTitleEvidence, sportsObjectKind, isPhotoTitle,
  SEALED_RE, NON_SPORT_RE, GOLDIN_NON_SPORT_RE,
} from '../lib/classify';
import { classifySports } from '../lib/sports-crawl';
import { goldinRoute, routeItem } from '../lib/houses/routing';
import { subCatOf, sportFromText, sportByName, nameKey, NOT_PERSON_NAME_RE, JUNK_PLAYER_SLUG_RE } from '../lib/sub-cats';
import { parseCard, cardKey, cardLadderKey, isMultiCardTitle } from '../../app/lib/cards';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const move = (o: R) => { const l = { ...o } as never as R; const r = reclassifyLot(l as never); return r.drop ? DROP : l.artist; };
const SPORTS = new Set(['game-used', 'tickets-passes', 'trophies-awards', 'sports-memorabilia', 'type-1-photos', 'autographs', 'programs-publications', 'memorabilia', 'equipment-artifacts', 'sports-cards', 'graded-cards', 'unopened-wax']);

test('E1 · a Goldin Thematic-auction lot is sports only on sports evidence', () => {
  const T = (title: string, artist = 'game-used') => move({ auctionHouse: 'Goldin', artist, saleName: 'Goldin Thematic Auction', title });
  for (const [t, a] of [
    ['Filmation He-Man and the Masters of the Universe Evil-Lyn Animation Cel - 10 x 14', 'game-used'],
    ['Collection of Bob Hope Vintage Studio Photographs', 'game-used'],
    ['1990 Prince "Nude Tour" Cloth Working Crew Backstage Pass Collection (12)', 'tickets-passes'],
    ['Pink Floyd U.S. Debut Full Ticket - Winterland Ballroom San Francisco, California - PSA MINT 9 - Pop 5', 'tickets-passes'],
    ['1990 John Lee Hooker Contemporary Male Blues Artist Of The Year Award', 'trophies-awards'],
  ]) assert.ok(!SPORTS.has(String(T(t, a))), t);
  // sports evidence keeps the lot: use language, a city + franchise, a fight poster
  assert.equal(T('2021 Jonah Williams Los Angeles Rams White Practice-Used Jersey – Rams COA'), 'game-used');
  assert.equal(T('Roy Jones Jr. vs. Merqui Sosa Fight Poster - 14 x 22', 'sports-memorabilia'), 'sports-memorabilia');
  assert.equal(T('Rey Mysterio Signed, Inscribed Mask - WWE - PSA/DNA COA', 'autographs'), 'autographs');
  // outside the Thematic sale the narrow word list still decides (Weekly/Elite sports lots stay)
  assert.equal(goldinNonSportFix({ auctionHouse: 'Goldin', artist: 'tickets-passes', saleName: 'Goldin Elite Auction', title: 'July 4th, 1919 Willard Vs Dempsey, Dempsey 3rd Round KO Full Ticket - PSA EX 5' }), null);
  assert.equal(hasSportsTitleEvidence('Superman IV (1987) Cast-Signed, Framed Wooden Key Plaque Display - 31 x 17.5'), false);
  assert.equal(hasSportsTitleEvidence('Max Verstappen Signed Red Bull Racing Cap'), true);
});

test('E2 · a ticket before the award it names; a trophy needs an object word', () => {
  assert.equal(move({ auctionHouse: 'Goldin', artist: 'trophies-awards', title: 'MLB All-Star Game Full Ticket - Roberto Alomar MVP - PSA NM 7' }), 'tickets-passes');
  assert.equal(move({ auctionHouse: 'Goldin', artist: 'trophies-awards', title: 'Super Bowl IV Blue Variation Ticket Stub - Len Dawson MVP - Kansas City Chiefs vs. Minnesota Vikings - PSA VG-EX 4' }), 'tickets-passes');
  assert.equal(goldinRoute('Kobe Bryant NBA All-Star Game MVP Full Ticket - West 135, East 120 - PSA Authentic'), 'tickets-passes');
  assert.equal(goldinRoute('Kobe Bryant NBA All-Star Game MVP Full Ticket - West 135, East 120 - PSA Authentic', true), 'tickets-passes');
  assert.equal(routeItem(null, 'STANLEY CUP FINALS FULL TICKET 1967'), 'tickets-passes');
  // a real award stays one
  assert.equal(goldinRoute('1985 Wayne Gretzky Hart Memorial Trophy Presented Award'), 'trophies-awards');
  assert.equal(move({ auctionHouse: 'Goldin', artist: 'trophies-awards', title: '2012 London Olympic Champion Team USA Basketball Ring Presented to George Raveling' }), 'trophies-awards');
  // a trophy with a ticket riding along is the trophy
  assert.equal(sportsObjectKind('1958 Championship Trophy with Original Ticket Stub'), 'trophies-awards');
});

test('E3 · a photo of a trophy is a photo', () => {
  const t = '1997 Michael Jordan NBA Championship Type I Original Photo - Bulls Trophy Presentation Ceremony in Chicago - 8 x 10';
  assert.equal(move({ auctionHouse: 'Goldin', artist: 'trophies-awards', title: t }), 'type-1-photos');
  assert.equal(goldinRoute(t), 'type-1-photos');
  assert.equal(move({ auctionHouse: 'SCP', artist: 'trophies-awards', title: '1925 ROGER PECKINPAUGH WASHINGTON SENATORS ORIGINAL PHOTOGRAPH FROM HIS AL MVP SEASON - PSA/DNA TYPE I' }), 'type-1-photos');
  assert.equal(classifySports('', '1925 ROGER PECKINPAUGH WASHINGTON SENATORS ORIGINAL PHOTOGRAPH FROM HIS AL MVP SEASON - PSA/DNA TYPE I'), 'photograph');
});

test('E4 · RIAA / BRIT sales awards, gold & platinum records, Grammys read non-sport', () => {
  for (const t of [
    'Creed "My Own Prison" Framed RIAA Double Platinum Sales Award Display - 33.25 x 20',
    'Patti LaBelle, Michael McDonald "On My Own" BRIT Certified Silver Single Sales Award Display - Presented to John Sa',
    'Barry Manilow "Barry" Platinum Record Award - Consignor LOP',
    '1977 National Academy of Recording Arts & Sciences Grammy Award',
  ]) { assert.ok(GOLDIN_NON_SPORT_RE.test(t), t); assert.ok(NON_SPORT_RE.test(t), t); }
  assert.equal(move({ auctionHouse: 'Goldin', artist: 'trophies-awards', saleName: 'Goldin Weekly Auction', title: 'Creed "My Own Prison" Framed RIAA Double Platinum Sales Award Display - 33.25 x 20' }), 'music-memorabilia');
});

test('E5 · an athlete-signed photo is an autograph, a photographer-signed one a photo', () => {
  assert.equal(move({ auctionHouse: 'Huggins & Scott', artist: 'type-1-photos', title: 'Dazzy Vance Autographed Photograph PSA/DNA' }), 'autographs');
  assert.equal(move({ auctionHouse: 'SCP', artist: 'type-1-photos', title: "C. 1930'S LOU GEHRIG SIGNED AND INSCRIBED GEORGE BURKE ORIGINAL PHOTOGRAPH - PSA/DNA PSA 9" }), 'autographs');
  assert.equal(move({ auctionHouse: 'Love of the Game', artist: 'type-1-photos', title: '238 Circa 1910s Charles Conlon Signed Type I Photo Collection (3) PSA/DNA' }), 'type-1-photos');
  assert.equal(move({ auctionHouse: 'REA', artist: 'type-1-photos', title: 'Nat Fein Signed 11 x 14-Inch Photo - "The Babe Bows Out" - Pulitzer Prize Winning Photograph' }), 'type-1-photos');
  assert.equal(classifySports('', 'Dazzy Vance Autographed Photograph PSA/DNA'), 'autograph');
  assert.equal(classifySports('', '238 Circa 1910s Charles Conlon Signed Type I Photo Collection (3) PSA/DNA'), 'photograph');
});

test('E6 · the Equipment & Other catch-all takes its object\'s kind', () => {
  const M = (title: string, artist = 'memorabilia', house = 'Love of the Game') => move({ auctionHouse: house, artist, title });
  assert.equal(M("174 c.1910's Hal Chase Type 2 Photo by Brown Brothers (PSA/DNA)"), 'type-1-photos');
  assert.equal(M('1907 Real-Photo Postcard of the Bangor Base Ball Club with Louis Sockalexis', 'equipment-artifacts', 'REA'), 'type-1-photos');
  assert.equal(M('Oct. 25, 2018 Sports Graphic Number Shohei Ohtani Cover (Japan) - PSA 7.0 - Only 4 Higher-Graded Examples', 'sports-memorabilia', 'Goldin'), 'programs-publications');
  assert.equal(M('May 21, 2012 Weekly Baseball Shohei Ohtani Cover (Japan) - PSA 7.0 - Only 4 Higher-Graded Examples', 'sports-memorabilia', 'Goldin'), 'programs-publications');
  assert.equal(M('173 1954 First Issue of Sports Illustrated', 'memorabilia', 'Lelands'), 'programs-publications');
  assert.equal(M('(16) Baseball Autographed Flats All Period Items', 'memorabilia', 'Huggins & Scott'), 'autographs');
  // stays: a photo PENNANT, the Turkish Trophies cigarette brand, a magazine that shows a photo
  assert.equal(M('1964 and 1970 Washington Senators Photo Pennants', 'memorabilia', 'Huggins & Scott'), 'memorabilia');
  assert.equal(M('1911 Turkish Trophies Advertising Display with Joe Tinker S81 Silk', 'equipment-artifacts', 'REA'), 'equipment-artifacts');
  assert.equal(isPhotoTitle('Oct. 1951 SPORT Jackie Robinson 2nd Cover (Newsstand) - CGC 6.0 - Only Robinson Sliding Photo on Major Magazine Cover'), false);
  assert.equal(isPhotoTitle('1969 John Havlicek Sports Illustrated Cover-Used Type I Original Photo by George Long'), true);
  // a non-athlete's piece still leaves for culture first (TV Guide / JFK medals)
  assert.equal(M('1954-56 TV Guide Lot of (3) with L. Ball, Elvis & Sinatra', 'memorabilia', 'Huggins & Scott'), 'entertainment-memorabilia');
});

test('E7 · NFL Auction: game-issued and coin-toss pieces are game-used', () => {
  const N = (title: string, artist: string) => move({ auctionHouse: 'NFL Auction', artist, title });
  assert.equal(N('International Games - Colts Kenny Moore II Signed Game Issued Pants Size 28 | The official auction site of the National Football League', 'autographs'), 'game-used');
  assert.equal(N('Giants Game Issued Crucial Catch Flip Coin  | The official auction site of the National Football League', 'memorabilia'), 'game-used');
  assert.equal(N('NFL - Super Bowl 46 Game Issued Ball Numbered and Stamped Patriots Offense | The official auction site of the National Football League', 'memorabilia'), 'game-used');
  // other houses keep the autograph doctrine
  assert.equal(move({ auctionHouse: 'Goldin', artist: 'autographs', title: 'Joe DiMaggio Signed OAL Brown Baseball - JSA' }), 'autographs');
});

test('E8 · sealed wax names its product in the title', () => {
  const W = (title: string, house = 'REA') => move({ auctionHouse: house, artist: 'unopened-wax', title });
  assert.equal(W('Three Dozen Unopened Official League Baseballs (Feeney, Giamatti, MacPhail)'), 'memorabilia');
  assert.equal(W('Circa 1950s Baseball Card & Gumball Vending Machine'), 'memorabilia');
  assert.equal(W('(400) 1970 Topps Baseball Cards – Straight from Vending', 'Huggins & Scott'), 'graded-cards');
  assert.equal(W('Tiger Woods Signed 2005 Masters Flag UDA', 'Huggins & Scott'), 'autographs');
  // real wax stays
  assert.equal(W('1984 Topps "Masters of the Universe" Unopened Wax Box (36 Packs) - BBCE'), 'unopened-wax');
  assert.equal(W('1986 Star Michael Jordan Sealed Team Bag', 'Memory Lane'), 'unopened-wax');
  assert.equal(W('1985 Star Gatorade Slam Dunk Factory-Sealed', 'Memory Lane'), 'unopened-wax');
  assert.equal(SEALED_RE.test('Three Dozen Unopened Official League Baseballs'), false);
  assert.notEqual(classifySports('Unopened Material', 'Three Dozen Unopened Official League Baseballs (Feeney, Giamatti, MacPhail)'), 'unopened-wax');
  assert.notEqual(classifySports('', '1957 Baseball Card Gumball Vending Machine'), 'unopened-wax');
  assert.equal(classifySports('', '1952 Topps Baseball Unopened 1-Cent Wax Pack'), 'unopened-wax');
});

test('E9 · association football before American football', () => {
  assert.equal(sportFromText("2010 FIFA WORLD CUP WINNER'S GOLD MEDAL ISSUED BY SPANISH FOOTBALL FEDERATION"), 'soccer');
  assert.equal(sportFromText('1994 FIFA World Cup Final Full Ticket - Brazil vs. Italy at the Rose Bowl'), 'soccer');
  assert.equal(sportFromText('A WHITE ENGLAND INTERNATIONAL SHIRT'), 'soccer');
  assert.equal(sportFromText('2004 Jose Theodore Signed World Cup of Hockey Game Issued Jersey'), 'hockey');
  assert.equal(sportFromText('2004 Donruss Playoff Prestige Football League Leaders Jerseys #LL-6 Steve McNair'), 'football');
  assert.equal(sportFromText('1947-1949 A.A.F.C. San Francisco 49ers Program Collection (24)'), 'football');
  assert.equal(sportFromText("61 Medaglia D'Oro Winning Dubai World Cup Exercise Saddle Cloth"), null);
});

test('Lots & Sets · bulk card lots stamp card-lots and never key as one card', () => {
  const S = (title: string, artist = 'graded-cards') => subCatOf({ artist, title, auctionHouse: 'REA' }).subCat;
  for (const t of [
    '1909-11 T206 White Borders Collection of (27) Cards with (7) Southern Leaguers',
    '(400) 1970 Topps Baseball Cards – Straight from Vending',
    '1954-1962 Topps Baseball Hall of Fame & Star Rookies Graded Card Lot of (7) with (2) Mantle',
    '1971-1986 Topps Football Hoard of (28,000+) Cards',
    '97 Upper Deck Jordan\'s Viewpoints Michael Jordan PSA-Graded Collection (8 Different)',
  ]) {
    assert.equal(S(t), 'card-lots', t);
    const c = parseCard(t);
    assert.equal(c.multi, true, t);
    assert.equal(cardKey(c), null, t);
    assert.equal(cardLadderKey(c), null, t);
  }
  assert.equal(S('1990 Donruss Baseball Complete Set - Includes Juan Gonzalez, Ken Griffey Jr, Bo Jackson', 'sports-cards'), 'card-lots');
  // singles stay cards — a product line named "Collection" / "Team Set" is one card
  for (const t of [
    '2018 Panini Immaculate Collection Autograph Patch #37 Shohei Ohtani Signed Patch Rookie Card (#35/99) - PSA NM-MT 8',
    '04 Upper Deck Exquisite Collection Gold #78 LeBron James Rookie Card (#02/25) - BGS MINT 9 - Pop 5',
    '23 Topps Paris Saint-Germain Team Set Red #48 Lionel Messi (#1/5) - PSA EX-MT 6',
  ]) { assert.equal(S(t, 'sports-cards'), 'cards', t); assert.equal(isMultiCardTitle(t), false, t); }
  // wax lots keep their own kind
  assert.equal(S('1984 Topps Masters of the Universe Wax Box Lot of (2) - Both BBCE Wrapped', 'unopened-wax'), 'wax');
});

test('sport facet · name map, brand defaults, junk slugs, Masters false golf stamps', () => {
  const maps = (o: R = {}) => ({ byPid: new Map<string, string>(), byPlayer: new Map<string, string>(), ...o });
  // a frequent multi-word player name the title spells out
  const byName = new Map([[nameKey('Shohei Ohtani'), 'baseball']]);
  assert.equal(sportByName('Shohei Ohtani Signed 16x20 Photo - Fanatics', byName), 'baseball');
  assert.equal(sportByName('Ohtani Signed Photo', byName), null); // one word never joins
  assert.equal(subCatOf({ artist: 'autographs', title: 'Shohei Ohtani Signed 16x20 Photo - Fanatics', auctionHouse: 'SCP' }, maps({ byName })).drill, 'baseball');
  for (const n of ['Los Angeles', 'Baseball Hall', 'New York Giants', 'The Beatles', 'Babe Ruth Original']) assert.ok(NOT_PERSON_NAME_RE.test(nameKey(n)), n);
  assert.ok(!NOT_PERSON_NAME_RE.test(nameKey('Shohei Ohtani')));
  // the one-sport card brands
  assert.equal(subCatOf({ artist: 'sports-cards', auctionHouse: 'Goldin', title: '2025 Bowman Chrome Rookie Autographs Blue Refractor #CRA-RL Rhett Lowder Signed Rookie Card (#095/150) - PSA GEM MT 10' }).drill, 'baseball');
  assert.equal(subCatOf({ artist: 'sports-cards', auctionHouse: 'Goldin', title: '2023 Topps Now #123 Elly De La Cruz Rookie Card - PSA 10' }).drill, 'baseball');
  assert.equal(subCatOf({ artist: 'sports-cards', auctionHouse: 'Goldin', title: '1950 Bowman #5 Johnny Lujack - PSA NM 7' }).drill, null); // vintage Bowman printed football too
  assert.equal(subCatOf({ artist: 'sports-cards', auctionHouse: 'Goldin', title: '2024 Bowman University Chrome #12 Caleb Williams - PSA 10' }).drill, null); // not a baseball-only line
  // "A Pair of Staffordshire Figures" read tennis off a lot-opening slug
  assert.ok(JUNK_PLAYER_SLUG_RE.test('a-pair-of'));
  assert.ok(!JUNK_PLAYER_SLUG_RE.test('a-j-foyt'));
  assert.equal(subCatOf({ artist: 'sports-memorabilia', auctionHouse: "Christie's", saleName: 'Cricket Tennis Golf Memorabilia', playerSlug: 'a-pair-of', title: 'A PAIR OF LARGE EARLY STAFFORDSHIRE FIGURES' }, maps({ byPlayer: new Map([['a-pair-of', 'tennis']]) })).drill, null);
  // Goldin's 'Golf' stamp on "Masters of the Universe" cels / "Gem Masters" cards
  assert.equal(subCatOf({ artist: 'game-used', sport: 'Golf', auctionHouse: 'Goldin', title: 'Filmation He-Man and the Masters of the Universe Evil-Lyn Animation Cel - 10 x 14' }).drill, null);
  assert.equal(subCatOf({ artist: 'sports-cards', sport: 'Golf', auctionHouse: 'Goldin', title: '1999 SkyBox Metal Universe Gem Masters #246 Barry Bonds (#1/1) - PSA EX-MT 6' }, maps({ byPlayer: new Map([['barry-bonds', 'baseball']]), cardPlayer: () => 'barry-bonds' })).drill, 'baseball');
  assert.equal(subCatOf({ artist: 'sports-cards', sport: 'Golf', auctionHouse: 'Goldin', title: '1998 Champions of Golf The Masters Collection Gold Foil Tiger Woods Rookie Card - PSA NM 7' }).drill, 'golf');
});
