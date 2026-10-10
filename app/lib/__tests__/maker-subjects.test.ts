import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotSubjectOf, subjectRowKeyOf, groupBySubject, OTHER } from '../maker-subjects';
import { makerLiveLots, sortByPriority, feedQueryMatches, feedSearchHref } from '../maker-pool';
import { byPriority } from '../priority';
import { TRIAGE_DEFAULTS } from '../feed-filters';

const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${artist}-${title}`.slice(0, 40), artist, title, status: 'upcoming', saleDate: '2026-10-20', ...extra });

test('maker-subjects: a card files under its player, memorabilia under the same player row', () => {
  const card = lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8');
  const bat = lot('game-used', 'Mickey Mantle Game-Used Louisville Slugger Bat');
  const a = lotSubjectOf(card), b = lotSubjectOf(bat);
  assert.equal(a?.name, 'Mickey Mantle');
  assert.equal(a?.kind, 'player');
  assert.equal(a?.key, 'p:mickey-mantle');
  assert.equal(b?.key, 'p:mickey-mantle');
  assert.equal(subjectRowKeyOf(card), 'sports|p:mickey-mantle');
});

test('maker-subjects: missions, Pokémon, franchises, solo acts', () => {
  assert.equal(lotSubjectOf(lot('space-exploration', 'Apollo 11 Flown Beta Cloth Patch'))?.key, 'm:apollo-11');
  assert.equal(lotSubjectOf(lot('pokemon', '1999 Pokemon Base Set Holo #4 Charizard - PSA 9'))?.name, 'Charizard');
  const sw = lotSubjectOf(lot('movie-tv', 'Stormtrooper Helmet from Star Wars: A New Hope (1977) Screen-Used'));
  assert.equal(sw?.kind, 'franchise');
  assert.equal(sw?.name, 'Star Wars');
  // a solo act's franchise facet joins the person row
  const mj = lotSubjectOf(lot('entertainment-memorabilia', 'Collection of Michael Jackson Tour Ephemera'));
  assert.equal(mj?.key, 'p:michael-jackson');
});

test('maker-subjects: art / design / watches never get subject rows; unnamed lots fall to the remainder', () => {
  assert.equal(subjectRowKeyOf(lot('andy-warhol', 'Marilyn')), null);
  assert.equal(subjectRowKeyOf(lot('pokemon', 'Pokemon Booster Box Sealed')), `tcg|${OTHER}`);
});

test('maker-subjects: every collection lot lands in exactly one group', () => {
  const lots = [
    lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8'),
    lot('game-used', 'Mickey Mantle Game-Used Louisville Slugger Bat'),
    lot('pokemon', 'Pokemon Booster Box Sealed'),
    lot('andy-warhol', 'Marilyn'),
  ];
  const g = groupBySubject(lots);
  let n = 0;
  g.forEach(x => { n += x.lots.length; });
  assert.equal(n, 3);
  assert.equal(g.get('sports|p:mickey-mantle')?.lots.length, 2);
});

test('maker-pool: sortByPriority is byPriority\'s order; makerLiveLots is the row\'s list', () => {
  const now = Date.parse('2026-10-09T16:00:00-04:00');
  const lots = [
    lot('andy-warhol', 'A', { estimateLow: 1000, estimateHigh: 2000 }),
    lot('andy-warhol', 'B', { estimateLow: 100000, estimateHigh: 200000 }),
    lot('andy-warhol', 'C', { estimateLow: 10000, estimateHigh: 20000, saleDate: '2026-10-10' }),
    lot('andy-warhol', 'D'),
  ];
  const want = lots.slice().sort(byPriority(now)).map(l => l.title);
  assert.deepEqual(sortByPriority(lots, now).map(l => l.title), want);
  assert.equal(makerLiveLots(lots, 'andy-warhol', TRIAGE_DEFAULTS, { today: '2026-10-09' }).length, 4);
  assert.equal(makerLiveLots(lots, 'kaws', TRIAGE_DEFAULTS, { today: '2026-10-09' }).length, 0);
});

test('maker-pool: the feed search link carries the query and the triage', () => {
  assert.equal(feedQueryMatches(lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8'), 'mantle'), true);
  assert.equal(feedSearchHref('sports', 'Mantle', { ...TRIAGE_DEFAULTS, win: 'week' }), '/sports?q=Mantle&tab=all&win=week');
  assert.equal(feedSearchHref('all', 'x', TRIAGE_DEFAULTS), '/?q=x&tab=all');
});

test('maker-subjects (r5): teams, sets, programs and instrument makers get their own rows', () => {
  assert.equal(subjectRowKeyOf(lot('autographs', '1986 New York Mets Team-Signed Baseball (25 Signatures)')), 'sports|t:1986-new-york-mets');
  assert.equal(subjectRowKeyOf(lot('unopened-wax', '1986 Fleer Basketball Unopened Wax Box (36 Packs)')), 'sports|s:1986-fleer-basketball');
  // a set lot of the same product shares the wax row
  assert.equal(subjectRowKeyOf(lot('sports-cards', '1986 Fleer Basketball Complete Set (132)')), 'sports|s:1986-fleer-basketball');
  assert.equal(subjectRowKeyOf(lot('pokemon', '1999 Pokemon Base Set Unlimited Factory-Sealed Booster Box (36 Packs)')), 'tcg|s:base-set');
  assert.equal(subjectRowKeyOf(lot('space-exploration', 'Apollo Command Module Globe Valve')), 'science|m:apollo');
  assert.equal(subjectRowKeyOf(lot('entertainment-memorabilia', '1984 Gibson Les Paul Custom - Cherry Sunburst')), 'culture|b:gibson');
  assert.equal(lotSubjectOf(lot('graded-cards', '1957 Topps #171 Boston Red Sox Team PSA NM 7', { playerName: 'Boston Red Sox' }))?.key, 't:boston-red-sox');
  // an act read off the title joins its franchise row; "The X" and "X" are one act; a solo act stays the person
  assert.equal(lotSubjectOf(lot('entertainment-memorabilia', '1964 The Beatles Type I Original Photo by MirrorPic/London'))?.key, 'fr:fr-beatles');
  assert.equal(lotSubjectOf(lot('entertainment-memorabilia', 'The Clash Signed Album'))?.key, lotSubjectOf(lot('entertainment-memorabilia', 'Clash Band-Signed Vinyl Record Sleeve'))?.key);
  assert.equal(lotSubjectOf(lot('entertainment-memorabilia', 'Michael Jackson Signed Photograph'))?.key, 'p:michael-jackson');
});

test('maker-subjects (r5): hyphenated and nickname players; un-numbered cards by the stamped athlete', () => {
  assert.equal(lotSubjectOf(lot('graded-cards', '89 Fleer #64 Kareem Abdul-Jabbar - PSA GEM MT 10'))?.key, 'p:kareem-abdul-jabbar');
  assert.equal(lotSubjectOf(lot('graded-cards', '1959 Topps #480 Red Schoendienst PSA NM-MT 8'))?.key, 'p:red-schoendienst');
  // a run-on caption keeps its leading name
  assert.equal(lotSubjectOf(lot('graded-cards', '1959 Topps #468 Duke Snider Play Brings L.A. Victory PSA NM-MT 8'))?.name, 'Duke Snider');
  assert.equal(lotSubjectOf(lot('graded-cards', '1928 Exhibits Frank Frisch PSA VG-EX 4', { playerName: 'Frank Frisch' }))?.key, 'p:frank-frisch');
  // the stamped name never claims a multi-signed piece
  assert.equal(lotSubjectOf(lot('sports-cards', 'Michael Jordan/Larry Bird/Magic Johnson Multi-Signed Poster Display', { playerName: 'Michael Jordan' })), null);
  assert.equal(lotSubjectOf(lot('autographs', 'Signed 1989 Score #645 Randy Johnson Rookie PSA/DNA GEM MINT 10'))?.key, 'p:randy-johnson');
});

const stamped = (artist: string, title: string, name: string, slug: string) => lot(artist, title, { status: 'sold', playerName: name, playerSlug: slug });

test('maker-subjects (P3): player-stamped memorabilia the title readers miss files under the athlete', () => {
  // lower-case desk title, no verb after the name, a lot-number lead, ALL CAPS, accents
  assert.equal(lotSubjectOf(stamped('game-used', 'michael jordan 1998 nba finals ‘the last dance’ game worn jersey | game 1', 'Michael Jordan', 'michael-jordan'))?.key, 'p:michael-jordan');
  assert.equal(lotSubjectOf(stamped('game-used', 'Michael Jordan 1992 Olympic "Dream Team" Game-Used, Photo-Matched Jersey', 'Michael Jordan', 'michael-jordan'))?.key, 'p:michael-jordan');
  assert.equal(lotSubjectOf(stamped('autographs', '182 Mickey Mantle Signed "The Mick" 1st Ed Hardcover Book', 'Mickey Mantle', 'mickey-mantle'))?.key, 'p:mickey-mantle');
  assert.equal(lotSubjectOf(stamped('sports-memorabilia', 'BABE RUTH AUTOGRAPHED LETTER (PSA/DNA 8 NM-MT) 1947', 'Babe Ruth', 'babe-ruth'))?.key, 'p:babe-ruth');
  assert.equal(lotSubjectOf(stamped('game-used', 'alperen şengün houston rockets 2026 nba playoffs game worn jersey', 'Alperen Şengün', 'alperen-sengun'))?.key, 'p:alperen-sengun');
  // an athlete who LEADS the title beats the team the title also names
  assert.equal(lotSubjectOf(stamped('game-used', '1938 Lou Gehrig New York Yankees Game-Used Road Jersey', 'Lou Gehrig', 'lou-gehrig'))?.key, 'p:lou-gehrig');
});

test('maker-subjects (P3): the stamp never files a group piece, a highlight, a second party or a non-name', () => {
  const key = (l: ReturnType<typeof stamped>) => lotSubjectOf(l)?.key ?? null;
  assert.notEqual(key(stamped('autographs', 'joe dimaggio, yogi berra, whitey ford and phil rizzuto multi-signed portrait', 'Joe DiMaggio', 'joe-dimaggio')), 'p:joe-dimaggio');
  assert.equal(key(stamped('autographs', 'Fantastic Famous Player Series Signed Bats with Ted Williams', 'Ted Williams', 'ted-williams')), null);
  assert.equal(key(stamped('memorabilia', '1912 Wright & Ditson Framed Boston Red Sox Silk w/Tris Speaker', 'Tris Speaker', 'tris-speaker')), null);
  assert.notEqual(key(stamped('memorabilia', '51 muhammad ali & george chuvalo from-the-camera negatives (8)', 'Muhammad Ali', 'muhammad-ali')), 'p:muhammad-ali');
  assert.equal(key(stamped('tickets-passes', '1964 st. louis cardinals vs. new york yankees world series ticket', 'St. Louis', 'st-louis')), null);
  assert.equal(key(stamped('equipment-artifacts', '160 Vintage Yankee Stadium Scoreboard Letter', 'Yankee Stadium', 'yankee-stadium')), null);
  assert.equal(key(stamped('autographs', '2014 Bowman Inception #PA-AJ Aaron Judge Prospect Auto PSA 9/10', 'Aaron Judge Prospect', 'aaron-judge-prospect')), null);
  // sealed product is nobody's
  assert.notEqual(key(stamped('unopened-wax', '1986 Fleer Basketball Wax Box Michael Jordan Rookie Year', 'Michael Jordan', 'michael-jordan')), 'p:michael-jordan');
  // a stamp the title does not spell is not used
  assert.equal(key(stamped('game-used', 'chicago bulls 1996 nba finals game used floor section', 'Michael Jordan', 'michael-jordan')), null);
  // the team read keeps a team-signed ball
  assert.equal(key(stamped('autographs', '1931 St. Louis Cardinals World Champions Team Signed Ball', 'Frankie Frisch', 'frankie-frisch'))?.startsWith('t:'), true);
});
