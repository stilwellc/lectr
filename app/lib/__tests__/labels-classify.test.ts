/**
 * Oct 9 labels audit — the view-time taxonomy read (taxonOf with a title), the
 * shared title rules the nightly also stamps with, the card single-vs-lot
 * detector, and ONE label vocabulary (taxonomy SUBS ↔ subcat-labels).
 * One test per measured misfile pattern (AUDIT.md 1–15).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taxonOf, subLabelOf, catLabelOf, subLabel, SUBS, cultureObjectOf, sportsMemSubOf, memIsCard,
  scienceCultureSlugOf, isShowbizTitle, isFilmProductionTitle,
} from '../taxonomy';
import { isCardLotTitle } from '../cards';
import { SUBCAT_LABELS, subCatLabel } from '../subcat-labels';

const ent = (title: string, subCat: string, drill?: string, artist = 'entertainment-memorabilia') => taxonOf({ artist, subCat, drill, title });

test('P1: a strong object phrase beats the first noun (hat / guitar)', () => {
  assert.equal(ent('DePatie-Freleng Enterprises The Pink Panther Show Pink Panther in Cowboy Hat Animation Cel - 10.5 x 14', 'worn-personal', 'hollywood').sub, 'animation');
  assert.equal(ent('Les Paul Type I Original Photo by Ebet Roberts - Fat Tuesdays, NYC - 5.5 x 8 - PSA/DNA', 'instruments', 'music').sub, 'photos-posters');
  assert.equal(cultureObjectOf('Michael Jackson "Thriller" Album Cover Original Test Polaroid by Dick Zimmerman'), 'photo');
  // a photo-MATCHED costume is no photo; a prop piece keeps its kind
  assert.equal(cultureObjectOf('Sylvester Stallone Screen-Worn, Photo-Matched Rambo: Last Blood (2019) Shirt'), null);
  assert.equal(ent('Brad Pitt "Tyler Durden" Production-Made Airplane Tickets/Boarding Passes (2) from Fight Club (1999)', 'props', 'hollywood').sub, 'props-costumes');
  // an autograph / document mentioning a ticket stays an autograph
  assert.equal(ent('Pete Best Single-Signed Drum Sticks Pair (2) - Includes Personal Photo, Oasis Tour Passes - Beckett', 'autographs', 'music').sub, 'autographs-documents');
});

test('P2: Led Zeppelin is no airship; an Army-themed guitar no war relic', () => {
  const z = ent('1971 John Bonham Led Zeppelin Type I Original Photo - Hiroshima, Japan Tour - 6 x 8 - PSA/DNA', 'photos', 'aviation');
  assert.deepEqual(z, { cat: 'entertainment', sub: 'photos-posters', domain: 'music' });
  assert.equal(ent("Bomb's Away Army Themed Guitar", 'instruments', 'military').cat, 'entertainment');
  // a statesman's signed guitar stays political; real aviation stays aviation
  assert.equal(ent('George W. Bush Signed Les Paul Style Guitar - Beckett LOA', 'autographs', 'political').cat, 'historical');
  assert.deepEqual(ent('Wilbur Wright Autograph Letter Signed, Outlining Purchase Terms for Wright Flyers', 'documents', 'aviation'), { cat: 'historical', sub: 'aviation' });
});

test('P3: production art outside Animation — concept art, storyboards, character sheets, costume sketches', () => {
  for (const t of [
    'c. 1987-88 Who Framed Roger Rabbit Daffy Duck Concept Artwork - 16.5 x 11.5 - Thompson LOP, Ursa Authentic OOA',
    'Beany & Cecil - Bob Clampett Set of (7) Character Sheets - Sullivan Archives LOA, Ursa Authentic OOA',
    '1940 The Invisible Man Returns Rosemary Odell Costume Sketch for Nan Grey as "Helen Manson" - Ursa Authentic OOA',
    'Walt Disney Studios "Greasy" Weasel Original Pre-Production Character Artwork from Who Framed Roger Rabbit? (1988)',
  ]) assert.equal(ent(t, 'other', 'hollywood').sub, 'animation', t);
  // a storyboard stamped a 'script' document is production art too
  assert.equal(ent('Hand Drawn Storyboard from David Lynch\'s Dune - Auction House COA, Ursa Authentic OOA', 'documents', 'hollywood').sub, 'animation');
  // a concept MAQUETTE is a prop
  assert.equal(cultureObjectOf('2006 Production-Made "Groot" Early Concept Maquette from Guardians of the Galaxy (2014)'), null);
});

test('P4: Mondo / Whalen prints and gig flyers are posters', () => {
  assert.equal(ent('Dumbo Mondo Print by Tom Whalen LE (#82/155) - 24 x 36', 'other').sub, 'photos-posters');
  assert.equal(ent('Toy Story Tom Whalen Print - 24 x 36', 'other').sub, 'photos-posters');
  assert.equal(ent('June 30, 1988 Squid Row Purple Concert Flyer - Featuring Skin Yard, Nirvana - 8.5 x 11', 'other', 'music').sub, 'photos-posters');
});

test('P5: Entertainment tickets & passes are their own (new-key) sub', () => {
  assert.ok(SUBS.entertainment.some(s => s.key === 'tickets'));
  assert.ok(SUBS.entertainment.some(s => s.key === 'photos-posters'), 'the old key stays');
  assert.equal(ent('Pink Floyd at the Fillmore Auditorium Full Ticket - PSA NM-MT 8', 'tickets', 'music').sub, 'tickets');
  assert.equal(ent('1986 Bob Seger and the Silver Bullet Band "American Storm Tour" Unused Backstage Cloth Passes (12)', 'other', 'music').sub, 'tickets');
  // a signed promo photo that also includes a pass is a photo
  assert.equal(ent('Rick James Signed 8 x 10 Promo Photo Plus 1982 "Throwin\' Down Tour" Band Member ID and Access Pass', 'photos', 'music').sub, 'photos-posters');
});

test('P6: a graded card filed as sports memorabilia is a sports card', () => {
  const mem = (title: string, drill = 'baseball') => taxonOf({ artist: 'sports-memorabilia', subCat: 'memorabilia', drill, title });
  assert.deepEqual(mem('Extremely Rare 1888 E223 G&B Chewing Gum Roger Connor Portrait - SGC VG-EX 4 - POP 1'), { cat: 'sports-cards', sub: 'singles', sport: 'baseball' });
  assert.equal(mem('1887 to 1889 N172 Old Judge Collection (5) Including Jim Mutrie').sub, 'lots');
  assert.equal(memIsCard('1959 Bazooka Bob Cerv Short Print SGC Authentic'), 'singles');
  // pins, pennants, postcards, empty boxes are not cards
  for (const t of ['1935 Quaker Oats Metal Babe Ruth Pin PSA-Graded Collection (8) - PSA 7 (3)', '1916 BF2 Ferguson Bakery Felt Pennant Fred Merkle SGC Authentic',
    '1962 Holiday Inn Postcard Mickey Mantle, With Bat In Lounge - PSA GEM MT 10', '1952 Topps Baseball Empty 5-Cent Wax, 24-Count Display Box']) {
    assert.equal(memIsCard(t), null, t);
  }
});

test('P7: passes and magazine covers leave the Equipment junk drawer', () => {
  assert.equal(sportsMemSubOf('San Marino Grand Prix Pass from Ayrton Senna\'s Final Race - PSA NM-MT 8', 'equipment'), 'tickets');
  assert.equal(sportsMemSubOf('Aug. 1992 Beckett Basketball Monthly Michael Jordan Cover (No Barcode) - PSA 8.0', 'equipment'), 'programs');
  assert.equal(sportsMemSubOf('Iwo Jima: John Bradley Signed First Day Cover', 'equipment'), 'equipment');
  assert.equal(sportsMemSubOf('2022 Shohei Ohtani ASICS M4S Professional Model Bat - PSA/DNA LOA', 'equipment'), 'equipment');
  assert.equal(taxonOf({ artist: 'sports-memorabilia', subCat: 'memorabilia', drill: 'baseball', title: 'Boston Braves Pass - Jackie Robinson Debut Season - PSA VG 3' }).sub, 'tickets');
});

test('P8: a signed jersey / bat is an autograph, not a trophy, whatever the house slug', () => {
  assert.equal(sportsMemSubOf('1980 USA Men\'s Hockey "Miracle On Ice" Gold Medal Multi-Signed Jersey (19 Signatures)', 'trophies'), 'autographs');
  assert.equal(sportsMemSubOf('MLB 500 Home Run Club Multi-Signed, Inscribed Rawlings Adirondack Pro Trophy Model Bat (#153/300)', 'trophies'), 'autographs');
  assert.equal(sportsMemSubOf('Alex Ovechkin Signed, Inscribed Stanley Cup Replica Trophy - 11 x 25 x 11 - Fanatics', 'trophies'), 'trophies');
  assert.equal(sportsMemSubOf('1980 NBA All-Star Game Trophy Presented By Washington Bullets', 'trophies'), 'trophies');
});

test('P9: Trio / Pair lots are lots; one slab with a second number in its name is a single', () => {
  for (const t of ['1962 Topps PSA NM 7 Trio: Early Wynn, Jim Landis, and Floyd Robinson', '2020 Panini Mosaic Football #211 Jordan Love Rookie PSA GEM MINT 10 Trio',
    'Signed 1973 and 1974 Topps, O-Pee-Chee, and Venezuelan League Frank White Trio - PSA/DNA and Beckett', 'Signed 1964 Topps and Topps Venezuelan #128 Mickey Lolich Pair - Beckett',
    '1954 Hunter Wieners Harvey Haddix and Solly Hemus Pair', 'Signed 1974 Topps #20 Nolan Ryan and #40 Jim Palmer Pair - PSA/DNA',
    '2015 Leaf 25th Pure Auto Green #A-AJ1 Aaron Judge Signed Rookie Card Complete Set (#/5) - Featuring All Five Copies In Print Run']) {
    assert.equal(isCardLotTitle(t), true, t);
  }
  for (const t of ['1959 Fleer Ted Williams #71 Ted\'s Hitting Fundamentals #1 - PSA MINT 9', '98 SkyBox Hoops High Voltage #14 Michael Jordan #HV14 Michael Jordan - BGS GEM MINT 9.5',
    '2022 Topps Pristine Pair Dual Autographs #PPDA-TO Mike Trout/Shohei Ohtani Dual-Signed Card (#01/25) - PSA GEM MT 10',
    '1959 Topps #543 Corsair Outfield Trio with Roberto Clemente PSA NM 7', '04 Flair Final Edition Autograph Collection #AC-DWW Dwayne Wade Signed Card (#161/200) - BGS NM-MT 8',
    '2025 Panini National Treasures NFL Gear Trio Materials Shield Tag #GTM-JHF Lamar Jackson/Derrick Henry/Zay Flowers Patch Card (#1/1) - PSA GEM MT 10']) {
    assert.equal(isCardLotTitle(t), false, t);
  }
  // the view-time read follows the title over a stale 'card-lots' stamp
  assert.equal(taxonOf({ artist: 'graded-cards', subCat: 'card-lots', drill: 'baseball', title: '1959 Fleer Ted Williams #73 "Ted Hitting Fundamentals #3" PSA MINT 9' }).sub, 'singles');
});

test('P10 / P11: the Massacre, Prohibition and the Capone family are Crime', () => {
  assert.deepEqual(ent("Saint Valentine's Day Massacre: The Detroit Free Press Newspaper (February 15, 1929)", 'other', 'historic'), { cat: 'historical', sub: 'crime' });
  assert.deepEqual(ent('Prohibition: 1923 Liquor Prescription for Whiskey', 'other', 'historic'), { cat: 'historical', sub: 'crime' });
  assert.deepEqual(ent("Albert 'Bites' Capone (2) Original Photographs", 'photos'), { cat: 'historical', sub: 'crime' });
  assert.deepEqual(ent("Vincent 'The Chin' Gigante Oversized 1957 Press Photo", 'photos'), { cat: 'historical', sub: 'crime' });
  // a Lincoln letter stays historic
  assert.deepEqual(ent('Colonial Currency of the Thirteen Colonies', 'other', 'historic'), { cat: 'historical', sub: 'historic' });
});

test('P12: a film production piece is entertainment, not Military or Sports', () => {
  assert.deepEqual(ent('Ghost Recon Soldier Tactical Costume from John Wick: Chapter 3 - Parabellum - Ursa Authentic OOA', 'worn-personal', 'military'), { cat: 'entertainment', sub: 'props-costumes', domain: 'film-tv' });
  assert.equal(taxonOf({ artist: 'sports-memorabilia', subCat: 'memorabilia', drill: 'boxing-mma', title: 'Antonio Tarver "Mason Dixon" Production-Made Boxing Trunks from Rocky Balboa (2006) - Ursa Authentic OOA' }).cat, 'entertainment');
  assert.equal(taxonOf({ artist: 'game-used', subCat: 'game-used', drill: 'boxing-mma', title: '1977 I Am the Greatest: The Adventures of Muhammad Ali Original Production Hand-Painted Animation Cel' }).sub, 'animation');
  assert.ok(isShowbizTitle('John Cena "Mr. 206" Production-Worn Bathrobe Ensemble from Die Hart (2020-Present)'));
  // a sports lot "from <event> (<year>)" is a game piece: the strict read
  assert.equal(isFilmProductionTitle('Patrick Mahomes Game-Worn Jersey from Super Bowl LVII (2023)'), false);
  assert.equal(taxonOf({ artist: 'game-used', subCat: 'game-used', drill: 'football', title: 'Patrick Mahomes Game-Worn Jersey from Super Bowl LVII (2023)' }).cat, 'sports-memorabilia');
});

test('P13: music / film objects under a science slug are entertainment', () => {
  assert.equal(scienceCultureSlugOf('AC/DC - "Can I Sit Next to You, Girl" - Vinyl Only Record - Albert Productions - 1974'), 'music-memorabilia');
  assert.equal(scienceCultureSlugOf('Hollywood Palladium Flyer - Featuring Nirvana, Dinosaur Jr. - 8.5 x 11'), 'music-memorabilia');
  assert.equal(scienceCultureSlugOf('Star Trek: The Next Generation (1987-94) Bajoran Antares Class Freighter Shooting Scale Model'), 'movie-tv');
  assert.equal(scienceCultureSlugOf('Edison Concert Phonograph with Cylinder Records'), null);
  assert.equal(scienceCultureSlugOf('Tyrannosaurus Rex Tooth'), null);
  assert.deepEqual(taxonOf({ artist: 'fossils', subCat: 'fossils', title: 'Hollywood Palladium Flyer - Featuring Nirvana, Dinosaur Jr. - 8.5 x 11' }), { cat: 'entertainment', sub: 'photos-posters', domain: 'music' });
});

test('P14: a Mercury capsule named alone is Mercury & Gemini', () => {
  assert.equal(taxonOf({ artist: 'space-exploration', subCat: 'space', title: 'Aurora 7 Flown Heat Shield' }).sub, 'mercury-gemini');
  assert.equal(taxonOf({ artist: 'space-exploration', subCat: 'space', title: 'Mariner 5 Contractor Display Model' }).sub, 'space-other');
});

test('P15: a yearless Pokémon title with a WotC set name is vintage', () => {
  assert.equal(taxonOf({ artist: 'pokemon', subCat: 'pokemon-cards', title: 'Pokemon Japanese Jungle #25 Pikachu - PSA MINT 9' }).sub, 'vintage');
  assert.equal(taxonOf({ artist: 'pokemon', subCat: 'pokemon-cards', title: 'Pokemon Japanese Team Rocket Returns #5' }).sub, 'modern');
  // a stamped era still wins
  assert.equal(taxonOf({ artist: 'pokemon', subCat: 'pokemon-cards', drill: 'classic', title: 'Pokemon Jungle tribute' }).sub, 'classic');
});

test('labels: one vocabulary — subcat-labels reads the taxonomy sub labels; no slug leaks', () => {
  assert.equal(subCatLabel('cards'), subLabel('sports-cards', 'singles'));
  assert.equal(subCatLabel('card-lots'), subLabel('sports-cards', 'lots'));
  assert.equal(subCatLabel('wax'), subLabel('sports-cards', 'sealed-wax'));
  assert.equal(subCatLabel('pokemon-sealed'), subLabel('tcg', 'sealed'));
  assert.equal(subCatLabel('cel-art'), subLabel('entertainment', 'animation'));
  assert.equal(subCatLabel('military'), subLabel('historical', 'military'));
  assert.equal(subCatLabel('photos'), 'Photos', 'unsigned photos never read "Signed photos"');
  // the audit's leaked slugs all have labels now
  for (const slug of ['wax', 'cel-art', 'programs', 'pokemon-lots', 'pokemon-memorabilia', 'equipment', 'tcg-other', 'crime', 'aviation']) {
    assert.ok(SUBCAT_LABELS[slug] && SUBCAT_LABELS[slug] !== slug, slug);
  }
  // sealed product reads the same in both card categories; card eras share one scheme
  assert.equal(subLabel('sports-cards', 'sealed-wax'), subLabel('tcg', 'sealed'));
  for (const l of [subLabel('tcg', 'vintage'), subLabel('tcg', 'classic'), subLabel('tcg', 'modern'), subCatLabel('era-vintage'), subCatLabel('era-classic'), subCatLabel('era-modern')]) {
    assert.match(l, /^(?:Vintage|Classic|Modern) \([^)]+\)$/, l);
  }
  // no two subs inside a category share a label, and none is a bare "Other"
  for (const [cat, subs] of Object.entries(SUBS)) {
    const labels = subs.map(s => s.label);
    assert.equal(new Set(labels).size, labels.length, cat);
    assert.ok(!labels.includes('Other'), cat);
  }
});

test('precision guards measured on the 625k-lot corpus scan', () => {
  // "passes" the verb, a Wright Flyer, the Philadelphia Flyers
  assert.equal(cultureObjectOf('Abraham Lincoln: Lincoln passes an accusation of Confederate bribery onto Salmon Chase'), null);
  assert.equal(cultureObjectOf('Ramones Collection of (13) Passes'), 'ticket');
  assert.equal(cultureObjectOf('Dec. 17, 1903 – Wright Brothers Flyer Wing Fabric Flown At Kitty Hawk'), null);
  assert.equal(cultureObjectOf('Philadelphia Flyers'), null);
  // the Prohibition PARTY is politics; a Wacky Packages artist named Gambino is no mobster
  assert.equal(ent('PROHIBITION FOR PRESIDENT JOSHUA LEVERING BUTTON FROM 1896.', 'other', 'political').sub, 'political');
  assert.equal(ent('2012 Topps "Wacky Packages" Postcard Bonus Original Card Artwork - Artist Sam Gambino', 'other').cat, 'entertainment');
  // an athlete-SIGNED cartoon cel stays a sports autograph; card / press-pin "production artwork" stays sports
  assert.equal(isFilmProductionTitle('Mickey Mantle Signed LE 1992 Warner Bros. Bugs Bunny Animation Cel - UDA'), false);
  assert.equal(isFilmProductionTitle('1966 Philadelphia "Green Berets" Original Production Artwork For Wax Wrapper with Final Issued Version'), false);
  assert.equal(isFilmProductionTitle('Goofy production drawing from How to Play Baseball Production Drawing'), true);
  // an iMac vinyl banner and a Star Wars NES cartridge are tech
  assert.equal(scienceCultureSlugOf("Original Apple 'Bondi Blue' iMac Vinyl Banner"), null);
  assert.equal(scienceCultureSlugOf('Star Wars: The Empire Strikes Back - Nintendo (NES) Development Prototype Cartridge - Wata PRO'), null);
  // a garment named WORN outranks the costume sketch sold with it
  assert.equal(ent('CARRIE UNDERWOOD 2014 CMA AWARDS WORN RANDI RAHM CUSTOM DRESS AND COSTUME SKETCH', 'worn-personal', 'music').sub, 'props-costumes');
});

test('subLabelOf / catLabelOf: the lot-level display helpers', () => {
  const lot = { artist: 'sports-cards', subCat: 'cards', drill: 'baseball', title: '1952 Topps #311 Mickey Mantle PSA 8' };
  assert.equal(subLabelOf(lot), 'Singles');
  assert.equal(catLabelOf(lot), 'Sports Cards');
  assert.equal(subLabelOf({ artist: 'entertainment-memorabilia', subCat: 'tickets', title: 'Woodstock Single-Day Admission Ticket (August 16, 1969) - PSA NM-MT 8' }), subLabel('entertainment', 'tickets'));
  // memoised per object, but a changed field re-derives
  const l2: { artist: string; subCat: string; title?: string } = { artist: 'pokemon', subCat: 'pokemon-cards' };
  assert.equal(taxonOf(l2).sub, 'modern');
  l2.title = 'Pokemon Base Set Charizard #4';
  assert.equal(taxonOf(l2).sub, 'vintage');
});
