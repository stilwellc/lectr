import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personOf, filmOf, missionOf, subjectOf, castOf, actOf, cardGroupOf } from '../subject';
import { teamOf, teamCardOf, productLineOf, pokemonSetOf, programOf, instrumentBrandOf } from '../subject-groups';
import { makerLineOf, registerPlayerDossiers } from '../lot-labels';
import { craftTitle, expandLeadYear, splitTitle } from '../../utils';
import { makerHref } from '../entity/retired';

test('subject: the signer / athlete leading a memorabilia title', () => {
  assert.equal(personOf('Sylvester Stallone Signed Rocky IV Photograph - 16x20 - Beckett'), 'Sylvester Stallone');
  assert.equal(personOf('Reggie Bush Game-Used, Photo-Matched, Signed USC Trojans Jersey'), 'Reggie Bush');
  assert.equal(personOf('Al Capone Original Photograph - PSA Type I'), 'Al Capone');
  assert.equal(personOf('Winston Churchill Signature'), 'Winston Churchill');
  assert.equal(personOf('Sep. 29, 1996 Kobe Bryant Signed Pre-Rookie Type I Original Photo'), 'Kobe Bryant');
  assert.equal(personOf('94 Mario Lemieux Game-Used, Photo-Matched Pittsburgh Penguins Home Jersey'), 'Mario Lemieux');
  assert.equal(personOf('Edward H. White II Signed Photograph'), 'Edward H. White II');
  // NFL Auction: promo + team lead
  assert.equal(personOf('Crucial Catch - Titans Jeffery Simmons Signed Game Worn Jersey (10/23/22) Size 46'), 'Jeffery Simmons');
  // the pipeline-stamped athlete counts when the title LEADS with it
  assert.equal(personOf('1999 Tiger Woods Oversized Type I Original Photo by Paul Bojanower', 'Tiger Woods'), 'Tiger Woods');
  assert.equal(personOf('May 25, 2015 Weekly Baseball Shohei Ohtani Cover (Japan) - PSA 9.2', 'Shohei Ohtani'), 'Shohei Ohtani');
});

test('subject: (r5) a duo files under its first-named; three names never', () => {
  assert.equal(personOf('Michael J. Fox, Christopher Lloyd Dual-Signed 2011 Nike Mags'), 'Michael J. Fox');
  assert.equal(personOf('Mickey Mantle and Allie Reynolds Dual-Signed Banquet Program - JSA LOA'), 'Mickey Mantle');
  assert.equal(personOf('1972 Tom Seaver/Joe Namath Type I Original Photo - 7 x 9 - PSA/DNA'), 'Tom Seaver');
  assert.equal(personOf('1970s Glenn Frey, The Eagles Type I Original Photo by L.F.I. - 8 x 10 - PSA/DNA'), 'Glenn Frey');
  assert.equal(personOf('1980s Annie Lennox, Eurythmics Type I Original Photo by L.F.I. - 8 x 5.5'), 'Annie Lennox');
  assert.equal(personOf('Kobe Bryant, Michael Jordan Type I Original Photo', 'Kobe Bryant'), 'Kobe Bryant');
  assert.equal(personOf('John Glenn, Charles Conrad, and Gordon Cooper (3) Signed Photographs'), null);
  assert.equal(personOf('Fred Haise, Gerry Griffin, Jerry Bostick Signed Oversized Photograph'), null);
});

test('subject: (r5) qualifiers, parentheses, possessives, royals, debuts, surnames that are cities', () => {
  assert.equal(personOf('Fred Haise Oversized Signed Photograph'), 'Fred Haise');
  assert.equal(personOf('Harry S. Truman Oversized Twice-Signed Photograph'), 'Harry S. Truman');
  assert.equal(personOf('1984 Eddie Van Halen (Van Halen) Type I Original Photo by L.F.I.'), 'Eddie Van Halen');
  assert.equal(personOf('David Bowie "Let\'s Dance" Signed Album Cover - JSA'), 'David Bowie');
  assert.equal(personOf('Liza Minnelli\'s Rodolfo Valentino Award (1975)'), 'Liza Minnelli');
  assert.equal(personOf('J. Edgar Hoover\'s (2) Dress Canes'), 'J. Edgar Hoover');
  assert.equal(personOf('1989 Kurt Cobain\'s Washburn Force Type I Original Photo by Tim Paton'), 'Kurt Cobain');
  assert.equal(personOf('Queen Victoria Letter Signed to the King of Madagascar'), 'Queen Victoria');
  assert.equal(personOf('King Edward VIII Typed Letter Signed'), 'King Edward VIII');
  assert.equal(personOf('Elly De La Cruz MLB Debut Full Ticket - Reds vs. Dodgers - PSA NM-MT 8'), 'Elly De La Cruz');
  assert.equal(personOf('Jim Brown 2nd Career Game Ticket Stub - Pittsburgh Steelers vs. Cleveland Browns'), 'Jim Brown');
  assert.equal(personOf('1980s Whitney Houston Type I Original Photo by L.F.I.'), 'Whitney Houston');
  assert.equal(personOf('Grover Cleveland Typed Letter Signed'), 'Grover Cleveland');
  assert.equal(personOf('U. S. Grant Document Signed as President'), 'Ulysses S. Grant');
  assert.equal(personOf('Walt "Clyde" Frazier Signed New York Knicks Jersey - Beckett'), 'Walt Frazier');
  assert.equal(personOf('Shai Gilgeous-Alexander Signed Jersey'), 'Shai Gilgeous-Alexander');
  assert.equal(personOf('Collection of James Stewart Vintage Studio Photographs'), 'James Stewart');
  assert.equal(personOf('Laurence Olivier as Romeo Theatrical Costume Design Artwork'), 'Laurence Olivier');
  assert.equal(personOf('Soundgarden Type I Original Photo by Andrew Catlin'), 'Soundgarden');
  // never: a guitar-brand possessive-less lead, a bare apostrophe, a name ending in an initial, a city-led team
  assert.equal(personOf("Guns N' Roses Band-Signed Drumhead (4 Signatures)"), null);
  assert.equal(personOf('Pink Floyd U.S. Debut Full Ticket - Winterland Ballroom'), null);
  assert.equal(personOf('Boston Red Sox Signed Baseball'), null);
  assert.equal(personOf('Rutherford B. Hayes War-Dated Autograph Note Signed'), null);
  assert.equal(personOf('Computer Pioneers (5) Signature Display - Steve Wozniak, David Packard'), null);
});

test('subject: casts, teams and run-on leads stay unnamed as PERSONS', () => {
  assert.equal(personOf('Mar. 31, 1985 Hulk Hogan, Mr. T WrestleMania I Program', 'Hulk Hogan'), null);
  assert.equal(personOf('1964 St. Louis Cardinals Team-Signed ONL Giles Baseball (28 Signatures)', 'St. Louis'), null);
  assert.equal(personOf('1928 Philadelphia A\'s Outfielders Type I Original Photo by Wide World Photos'), null);
  assert.equal(personOf('Mercury Seven Fully Signed Photograph and Orville Wright Signed 1926 Pilot’s License'), null);
  assert.equal(personOf('1980s Michael Jackson Victory Tour Type I Original News Service Photo'), null);
  // the stamped name, never a run-on: "Iron Man 2 Robert Downey Jr." is not Iron Man's
  assert.equal(personOf('2010 Iron Man 2 Robert Downey Jr. "Tony Stark" Screen-Used Hammer Industries F1 Race Car', 'Iron Man'), null);
  // a set name leading the athlete is not a person ("Salutation Exhibits Joe DiMaggio")
  assert.equal(personOf('46 Salutation Exhibits Joe DiMaggio Signed Card - PSA Authentic', 'Joe DiMaggio'), null);
});

test('subject: the film a screen-used / production piece comes from', () => {
  assert.equal(filmOf('Eminem "B-Rabbit" Screen-Worn Costume Ensemble from 8 Mile (2002) - Auction House COA'), '8 Mile');
  assert.equal(filmOf('Project Hail Mary (2026) Production-Made Rocky Maquette - 10 x 9.5'), 'Project Hail Mary');
  assert.equal(filmOf('Production-Made Grav Charge Stunt Prop from Season 2 of The Mandalorian (2020) - 2 x 1.25'), 'The Mandalorian');
  assert.equal(filmOf('Retractable Knife Prop from The Crazies - Robert Griffon Jr. LOA, Ursa Authentic OOA'), 'The Crazies');
  assert.equal(filmOf('Star Wars: Andor Production-Made "Zap Rod" Prop - 28 x 3.5 - Coronado Trading OOA'), 'Star Wars: Andor');
  assert.equal(filmOf('Screen-Used Ephialtes Prosthetic Makeup Display from 300 (2006) - 9 x 8.5'), '300');
  // two productions → no one film; a pronoun lead is not a title
  assert.equal(filmOf('Set of (3) Costume Pieces and Storyboard Art from Batman Returns (1992) and Batman Forever (1995)'), null);
  assert.equal(filmOf('Johnny Weissmuller Signed Photograph from His Debut Year as Tarzan (1932)'), null);
  assert.equal(filmOf('Production Made Ham Leg Prop from Various Star Wars Productions - Ursa Authentic OOA'), null);
});

test('subject: the one space mission a lot names', () => {
  assert.equal(missionOf('Apollo 15 Crew-Signed Commemorative Cover'), 'Apollo 15');
  assert.equal(missionOf('Gemini 12 Flown Checklist - Signed and Flight-Certified by Buzz Aldrin'), 'Gemini 12');
  assert.equal(missionOf('Skylab II Flown Heat Shield Plug'), 'Skylab 2');
  assert.equal(missionOf('Sally Ride\'s Pair of Handwritten STS-41-G Mission Diaries'), 'STS-41-G');
  assert.equal(missionOf('NASA (4) Original Red-Numbered Photographs for Gemini 11, Gemini 12, and Apollo 14'), null);
});

test('subject: readers per pseudo-maker — film before person on Film & TV, mission first on space', () => {
  assert.deepEqual(subjectOf({ artist: 'movie-tv', title: 'Lady Gaga Screen-Used, Photo-Matched Piano From A Star is Born (2018) - 52 x 60' }), { name: 'A Star is Born', kind: 'film' });
  assert.deepEqual(subjectOf({ artist: 'movie-tv', title: 'Ralph Macchio Screen-Used, Photo-Matched "The Karate Kid Part II" Kimono' }), { name: 'Ralph Macchio', kind: 'person' });
  assert.deepEqual(subjectOf({ artist: 'space-exploration', title: 'Buzz Aldrin Signed Apollo 11 Lunar Communion Chalice Replica' }), { name: 'Apollo 11', kind: 'mission' });
  assert.deepEqual(subjectOf({ artist: 'space-exploration', title: 'Neil Armstrong Signed Photograph' }), { name: 'Neil Armstrong', kind: 'person' });
  // a real maker is never re-read
  assert.equal(subjectOf({ artist: 'andy-warhol', title: 'Marilyn Monroe Signed Photograph' }), null);
});

test('maker line: memorabilia subjects take the slot; athletes link to an EXISTING dossier only', () => {
  const ent = makerLineOf({ artist: 'entertainment-memorabilia', title: 'Sylvester Stallone Signed Rocky IV Photograph - 16x20 - Beckett' });
  assert.deepEqual(ent, { name: 'Sylvester Stallone', href: makerHref('entertainment-memorabilia') });
  const t = 'Kobe Bryant Signed, Framed Los Angeles Lakers Jersey - 42x34 - Steiner';
  // before the dossier index lands: the maker link stands
  assert.equal(makerLineOf({ artist: 'autographs', title: t, playerName: 'Kobe Bryant', playerSlug: 'kobe-bryant' }).href, makerHref('autographs'));
  registerPlayerDossiers(['kobe-bryant']);
  const kobe = { artist: 'autographs', title: t, playerName: 'Kobe Bryant', playerSlug: 'kobe-bryant' };
  assert.deepEqual(makerLineOf(kobe), { name: 'Kobe Bryant', href: '/player?id=kobe-bryant' });
  // a name with no dossier, or one the pipeline didn't stamp, keeps the maker link
  assert.equal(makerLineOf({ artist: 'game-used', title: 'Crucial Catch - Eagles Jack Stoll Game Worn Jersey (10/13/2024) Size 44', playerName: 'Jack Stoll', playerSlug: 'jack-stoll' }).href, makerHref('game-used'));
  assert.equal(makerLineOf({ artist: 'autographs', title: t }).href, makerHref('autographs'));
  // nothing readable → the pseudo-maker label, unchanged
  assert.equal(makerLineOf({ artist: 'autographs', title: 'Moneyball Multi-Signed Oakland Athletics Jersey (48 Signatures)' }).name, 'Autographs');
  registerPlayerDossiers([]);
});

test('lead year: Goldin 2-digit years widen only when the century is certain', () => {
  assert.equal(expandLeadYear('87 Fleer #57 Michael Jordan Rookie Card - PSA 8'), '1987 Fleer #57 Michael Jordan Rookie Card - PSA 8');
  assert.equal(expandLeadYear('08 Upper Deck Exquisite #1 LeBron James'), '2008 Upper Deck Exquisite #1 LeBron James');
  assert.equal(expandLeadYear('24 FC Barcelona Topps Focus Snapshots Autographs Orange #SALM Lionel Messi'), '2024 FC Barcelona Topps Focus Snapshots Autographs Orange #SALM Lionel Messi');
  assert.equal(expandLeadYear('11 T206 White Border Ty Cobb, Bat on Shoulder'), '1911 T206 White Border Ty Cobb, Bat on Shoulder');
  assert.equal(expandLeadYear('09-11 T206 Honus Wagner'), '1909-11 T206 Honus Wagner');
  assert.equal(expandLeadYear('13 M101-2 Sporting News Supplements Ty Cobb'), '1913 M101-2 Sporting News Supplements Ty Cobb');
  assert.equal(expandLeadYear('85 Star #195 Michael Jordan Rookie Card'), '1985 Star #195 Michael Jordan Rookie Card');
  // a name lead: Goldin only, 27–99 only
  assert.equal(expandLeadYear('94 Mario Lemieux Game-Used Jersey', 'Goldin'), '1994 Mario Lemieux Game-Used Jersey');
  assert.equal(expandLeadYear('94 Mario Lemieux Game-Used Jersey'), '94 Mario Lemieux Game-Used Jersey');
  assert.equal(expandLeadYear('26 Babe Ruth Sliding Type I Original Photo', 'Goldin'), '26 Babe Ruth Sliding Type I Original Photo');
  assert.equal(expandLeadYear('14 Fernando Torres Match-Worn, Signed Chelsea Jersey', 'Goldin'), '14 Fernando Torres Match-Worn, Signed Chelsea Jersey');
  // (Oct 9) a 19th-century format is now widened to 18xx — the card parser
  // keys it 1892 (the shared lead-year rule), so the title shows 1892 too
  // instead of the bare "92" that read as 1992
  assert.equal(expandLeadYear('92 John H. Ryder Studio Cabinet Cy Young Rookie Card', 'Goldin'), '1892 John H. Ryder Studio Cabinet Cy Young Rookie Card');
  // never another number, never a non-year lead
  assert.equal(expandLeadYear('25 Cats Name(d) Sam and One Blue Pussy', "Christie's"), '25 Cats Name(d) Sam and One Blue Pussy');
  assert.equal(expandLeadYear('15-Year-Old Lewis Hamilton Race-Worn Fire Suit', 'Goldin'), '15-Year-Old Lewis Hamilton Race-Worn Fire Suit');
  assert.equal(expandLeadYear('1986 Fleer #57 Michael Jordan', 'Goldin'), '1986 Fleer #57 Michael Jordan');
  assert.equal(craftTitle('97 Flair Showcase Basketball Factory-Sealed Hobby Box (24 Packs)', 'Goldin'), '1997 Flair Showcase Basketball Factory-Sealed Hobby Box (24 Packs)');
  assert.equal(splitTitle('94 Mario Lemieux Game-Used', 'Goldin').short, '1994 Mario Lemieux Game-Used');
});

test('subject (r5): bands and acts', () => {
  assert.equal(actOf('1964 The Beatles Type I Original Photo by MirrorPic/London'), 'The Beatles');
  assert.equal(actOf('The Police Signed Oversized Photograph'), 'The Police');
  assert.equal(actOf('1973 The Jackson 5 Type I Original Photo by L.F.I.'), 'The Jackson 5');
  assert.equal(actOf('Aerosmith - "Aerosmith" Signed Vinyl Sleeve - PSA/DNA'), 'Aerosmith');
  assert.equal(actOf('Eddie Vedder - Firenze Rocks Festival Concert Poster - Signed by Van Horton'), 'Eddie Vedder');
  // venues, dates and non-music runs are no act
  assert.equal(actOf('July 13-14, 2006 - Radio City Music Hall - Bob Weir & RatDog All Access Passes Pair (2)'), null);
  assert.equal(actOf('The Simpsons Production Script No. 4F24 "Lisa the Simpson"'), null);
  assert.equal(personOf('The Who: Daltrey and Entwistle Signed Album - Tommy'), 'The Who');
});

test('subject (r5): a cast piece files under its work', () => {
  assert.equal(castOf('1995 Party of Five Cast-Signed S2, Ep. 5 "Change Partners...and Dance" Script'), 'Party of Five');
  assert.equal(castOf('Star Trek Cast-Signed Photograph'), 'Star Trek');
  assert.equal(castOf("Ron Zimmerman's Cast-Signed The Michael Richards Show Script"), null);
  assert.deepEqual(subjectOf({ artist: 'movie-tv', title: 'The Godfather Cast Signed Poster' }), { name: 'The Godfather', kind: 'film' });
});

test('subject (r5): team-signed pieces → the team-season; team cards → the team', () => {
  assert.equal(teamOf('1986 New York Mets Team-Signed Baseball (25 Signatures)'), '1986 New York Mets');
  assert.equal(teamOf('1980 World Series Champion Philadelphia Phillies Team-Signed Poster (37 Signatures)'), '1980 Philadelphia Phillies');
  assert.equal(teamOf('92 Chicago Bulls Championship Starting 5 Multi-Signed Type I Original Photo'), '1992 Chicago Bulls');
  assert.equal(teamOf('Cincinnati Reds "Big Red Machine" Multi-Signed ONL White Baseball (11 Signatures)'), 'Cincinnati Reds');
  assert.equal(teamOf('1964 St. Louis Cardinals Team-Signed ONL Giles Baseball (28 Signatures)'), '1964 St. Louis Cardinals');
  // a game, two seasons, or a team not leading is no team's piece
  assert.equal(teamOf('Elly De La Cruz MLB Debut Full Ticket - Reds vs. Dodgers'), null);
  assert.equal(teamOf('1961/1998 New York Yankees Team-Signed, Framed Bat/Jersey Displays'), null);
  assert.equal(teamOf('Moneyball Multi-Signed Oakland Athletics Jersey (48 Signatures)'), null);
  assert.equal(teamOf('Kobe Bryant Signed, Framed Los Angeles Lakers Jersey'), null);
  assert.equal(teamCardOf('1957 Topps #171 Boston Red Sox Team PSA NM 7'), 'Boston Red Sox');
  assert.deepEqual(subjectOf({ artist: 'autographs', title: '1986 New York Mets Team-Signed Baseball' }), { name: '1986 New York Mets', kind: 'team' });
});

test('subject (r5): sealed wax / set lots → product line + year', () => {
  assert.equal(productLineOf('97 Upper Deck SP Basketball Factory-Sealed Hobby Box (30 Packs)'), '1997 Upper Deck SP Basketball');
  assert.equal(productLineOf('1986 Fleer Basketball Unopened Wax Box (36 Packs)'), '1986 Fleer Basketball');
  assert.equal(productLineOf('1963 Fleer Football Complete Set (88) With Checklist'), '1963 Fleer Football');
  assert.equal(productLineOf('1969 Topps Football-Series 2 Unopened 10-Cent Wax Pack (12 Cards)'), '1969 Topps Football');
  assert.equal(productLineOf('1969 Topps Baseball High-Grade Complete Set (664)'), '1969 Topps Baseball');
  // a card number, a featured player, an unknown issuer → no line
  assert.equal(productLineOf('2017 Panini Donruss Rated Rookie #327 Patrick Mahomes PSA-Graded Collection (10)'), null);
  assert.equal(productLineOf('1985 FTCC "The Three Stooges" Second Series Unopened Box (36 Packs)'), null);
  assert.deepEqual(cardGroupOf({ artist: 'sports-cards', title: '1960 Topps Football Near Set (125/132) - Featuring Jim Brown' }), { name: '1960 Topps Football', kind: 'set' });
  // a single card is never a set
  assert.equal(cardGroupOf({ artist: 'sports-cards', title: '1952 Berk Ross Mickey Mantle - PSA EX-MT 6' }), null);
});

test('subject (r5): sealed Pokémon → the set', () => {
  assert.equal(pokemonSetOf('2004 Pokemon EX Team Rocket Returns Factory-Sealed Booster Box (36 Packs) - Possible Gold Star Holo Torchic'), 'Team Rocket Returns');
  assert.equal(pokemonSetOf('1999 Pokemon Base Set Unlimited Factory-Sealed Booster Box (36 Packs)'), 'Base Set');
  assert.equal(pokemonSetOf('2000 Pokemon Base Set 2 Factory-Sealed Booster Box (36 Packs)'), 'Base Set 2');
  assert.equal(pokemonSetOf('2021 Pokemon Sword & Shield Evolving Skies Factory-Sealed Pokemon Center Elite Trainer Box'), 'Evolving Skies');
  assert.equal(pokemonSetOf('2009 Pokemon Japanese Beat of the Frontier 1st Edition Factory-Sealed Booster Box'), 'Beat of the Frontier (Japanese)');
  // the "Possible …" tail never names the set
  assert.equal(pokemonSetOf('2025 Pokemon Mega Heroes Factory-Sealed Tin Collection - Possible Team Rocket\'s Mewtwo'), 'Mega Heroes');
  assert.equal(cardGroupOf({ artist: 'pokemon', title: '2003 Pokemon Skyridge Holo #H9 Gengar - BGS PRISTINE 10' }), null);
});

test('subject (r5): space programs, instrument makers', () => {
  assert.equal(programOf('Apollo Command Module Globe Valve'), 'Apollo');
  assert.equal(programOf('Apollo-Soyuz Test Project Backup Crew Signed Cover'), 'Apollo-Soyuz');
  assert.equal(programOf('Space Shuttle ILC Dover TMG Training Glove'), 'Space Shuttle');
  assert.deepEqual(subjectOf({ artist: 'space-exploration', title: 'Apollo 11 Flown Beta Cloth Patch' }), { name: 'Apollo 11', kind: 'mission' });
  assert.deepEqual(subjectOf({ artist: 'space-exploration', title: 'Apollo Block II Crew Harness Assembly' }), { name: 'Apollo', kind: 'program' });
  assert.equal(instrumentBrandOf('1984 Gibson Les Paul Custom - Cherry Sunburst (#80754562) - Includes Original Gibson Hardshell Case'), 'Gibson');
  assert.equal(instrumentBrandOf('Fender DG-15 Acoustic Guitar - Black'), 'Fender');
  // a signed instrument is its signer's
  assert.equal(instrumentBrandOf('Gibson Les Paul Signed by Slash'), null);
});
