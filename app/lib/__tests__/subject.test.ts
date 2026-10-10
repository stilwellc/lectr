import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personOf, filmOf, missionOf, subjectOf } from '../subject';
import { makerLineOf, registerPlayerDossiers } from '../lot-labels';
import { craftTitle, expandLeadYear, splitTitle } from '../../utils';

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

test('subject: duos, casts, teams and run-on leads stay unnamed', () => {
  assert.equal(personOf('Michael J. Fox, Christopher Lloyd Dual-Signed 2011 Nike Mags'), null);
  assert.equal(personOf('Mar. 31, 1985 Hulk Hogan, Mr. T WrestleMania I Program', 'Hulk Hogan'), null);
  assert.equal(personOf('1964 St. Louis Cardinals Team-Signed ONL Giles Baseball (28 Signatures)', 'St. Louis'), null);
  assert.equal(personOf('1928 Philadelphia A\'s Outfielders Type I Original Photo by Wide World Photos'), null);
  assert.equal(personOf('Mercury Seven Fully Signed Photograph and Orville Wright Signed 1926 Pilot’s License'), null);
  assert.equal(personOf('1989 Kurt Cobain\'s Washburn Force Type I Original Photo by Tim Paton'), null);
  assert.equal(personOf('1980s Michael Jackson Victory Tour Type I Original News Service Photo'), null);
  assert.equal(personOf('Fred Haise Oversized Signed Photograph'), null);
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
  assert.deepEqual(ent, { name: 'Sylvester Stallone', href: '/makers/entertainment-memorabilia' });
  const t = 'Kobe Bryant Signed, Framed Los Angeles Lakers Jersey - 42x34 - Steiner';
  // before the dossier index lands: the maker link stands
  assert.equal(makerLineOf({ artist: 'autographs', title: t, playerName: 'Kobe Bryant', playerSlug: 'kobe-bryant' }).href, '/makers/autographs');
  registerPlayerDossiers(['kobe-bryant']);
  const kobe = { artist: 'autographs', title: t, playerName: 'Kobe Bryant', playerSlug: 'kobe-bryant' };
  assert.deepEqual(makerLineOf(kobe), { name: 'Kobe Bryant', href: '/player?id=kobe-bryant' });
  // a name with no dossier, or one the pipeline didn't stamp, keeps the maker link
  assert.equal(makerLineOf({ artist: 'game-used', title: 'Crucial Catch - Eagles Jack Stoll Game Worn Jersey (10/13/2024) Size 44', playerName: 'Jack Stoll', playerSlug: 'jack-stoll' }).href, '/makers/game-used');
  assert.equal(makerLineOf({ artist: 'autographs', title: t }).href, '/makers/autographs');
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
