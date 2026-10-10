/**
 * (r6) Pre-war / oddball single cards name their player: the catalog reader
 * no longer reads a T206 back + print run ("Piedmont/350", "150/25"), an
 * issuer's "&" ("Dockman & Sons") or a pose's "with" as a second subject, and
 * a card the slot readers can't name (numberless, or a slot run that is not a
 * person) takes the ONE known player it names (rosterCardPlayerOf, gated by
 * knownPlayerSet). A known slot read, an unknown rookie's clean slot name,
 * two subjects, lots, sealed product and multi-signed pieces are left alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, rosterCardPlayerOf, cardLadderKey, playerSlugOf } from '../../app/lib/cards';
import { lotSubjectOf } from '../../app/lib/maker-subjects';

const KNOWN = new Set(['ty-cobb', 'christy-mathewson', 'jake-atz', 'bob-bescher', 'roger-bresnahan', 'willie-keeler', 'johnny-evers',
  'stan-musial', 'lou-gehrig', 'mickey-mantle', 'rogers-hornsby', 'honus-wagner', 'yogi-berra', 'sam-crawford', 'frank-frisch',
  'satchel-paige', 'kimi-antonelli', 'tris-speaker', 'joe-dimaggio', 'babe-ruth', 'jackie-robinson', 'bob-ross',
  'ted-williams', 'gil-hodges', 'harry-kane', 'coast-biscuit', 'bob-bowman']);

test('catalog cards: back/print-run slashes, an issuer "&", a pose "with" are one card', () => {
  for (const [t, p] of [
    ['11 T206 White Border Christy Mathewson, White Cap - Piedmont/350 - PSA VG 3', 'Christy Mathewson'],
    ['11 T206 White Border Jake Atz - Sweet Caporal 350/30 - PSA EX+ 5.5', 'Jake Atz'],
    ['11 T206 White Border Ty Cobb, Portrait, Red Background - Piedmont 350-460/25 - PSA VG 3 (MC)', 'Ty Cobb'],
    ['11 T206 White Border Ty Cobb, Bat On Shoulder - Piedmont/150 - PSA Authentic Altered', 'Ty Cobb'],
    ['1909 E92 Dockman & Sons Bob Bescher SGC GOOD+ 2.5', 'Bob Bescher'],
    ['11 T206 White Border Willie Keeler, With Bat - Piedmont 350/25 - SGC VG 3', 'Willie Keeler'],
    ['1909-1911 T206 White Border Johnny Evers with Bat, Chicago on Shirt SGC VG 3', 'Johnny Evers'],
    ['1909-11 T206 White Border Ty Cobb Portrait Green Background', 'Ty Cobb'],
    ['1910 E98 Christy Mathewson', 'Christy Mathewson'],
  ] as const) {
    const c = parseCard(t);
    assert.equal(c.player, p, t);
    assert.ok(cardLadderKey(c), `keyed: ${t}`);
    assert.equal(lotSubjectOf({ artist: 'graded-cards', title: t } as never)?.name, p, `/makers row: ${t}`);
  }
  // a numbered card is untouched
  assert.equal(parseCard('1933 Goudey #53 Babe Ruth').player, 'Babe Ruth');
});

test('catalog cards: a real second subject still abstains', () => {
  for (const t of [
    '1911 T201 Mecca Double Folders Sam Crawford/Ty Cobb - PSA EX 5',
    '1911 T201 Mecca Double Folder Tris Speaker/Gardner',
    '13 M101-2 Sporting News Supplements George Gibson/Arthur Raymond - PSA PR 1',
    '1889 N172 Old Judge John Kelly and Jim Powell SGC VG 3',
  ]) assert.equal(parseCard(t).catalog ?? null, null, t);
});

test('numberless oddball cards: the one known player before the grade', () => {
  const cases: [string, string][] = [
    ['1954 Red Heart Stan Musial - PSA EX-MT 6', 'Stan Musial'],
    ['1925 Exhibits Lou Gehrig Rookie Card - PSA VG-EX 4 - POP 4', 'Lou Gehrig'],
    ['1952 Berk Ross Mickey Mantle - PSA EX-MT 6', 'Mickey Mantle'],
    ['1916 Tango Eggs Roger Bresnahan - PSA EX 5 - Pop 2', 'Roger Bresnahan'],
    ['1933 Worch Cigars Rogers Hornsby - SGC EX 5 - Pop 2', 'Rogers Hornsby'],
    ['1951 Wheaties, Hand Cut Stan Musial - PSA MINT 9', 'Stan Musial'],
    ['1936 S & S Game Card Frank Frisch SGC NM/MT 8', 'Frank Frisch'],
    ['1948 Cleveland Indians Picture Pack Satchel Paige - SGC VG 3', 'Satchel Paige'],
    ['1911 M116 Sporting Life Hans (Honus) Wagner, Pastel Background - PSA NM 7', 'Honus Wagner'],
    ['1947 Tip Top Bread Larry "Yogi" Berra Rookie Card - PSA NM 7', 'Yogi Berra'],
    ['Extremely Rare 1903 E107 Breisch Williams Christy Mathewson Rookie Card - SGC FR 1.5', 'Christy Mathewson'],
    ['2025 Topps Eccellenza F1 Black Kimi Antonelli Rookie Card (#08/10) - PSA MINT 9', 'Kimi Antonelli'],
  ];
  for (const [t, p] of cases) {
    const r = rosterCardPlayerOf(t, KNOWN);
    assert.equal(r.player, p, t);
    assert.equal(r.playerSlug, playerSlugOf(p));
  }
});

test('numberless reader abstains: no roster, unknown name, numbered, two subjects, lots, sealed, multi-signed', () => {
  for (const t of [
    '1954 Red Heart Stan Musial - PSA EX-MT 6',
  ]) assert.equal(rosterCardPlayerOf(t, undefined).player, null, 'no roster → no guess');
  for (const t of [
    '1910 T210 Red Border Weldon - Old Mill Cigarettes - SGC GD+ 2.5',          // nobody known
    '1959 Topps #221 Bob Bowman PSA NM-MT 8',                                  // a known slot read stands
    '2025 Topps X Bob Ross The Joy Of Baseball Autographs Indian Yellow #93D Caden Dana Signed Rookie Card', // an unknown rookie's clean slot name stands
    '1911 D311 Pacific Coast Biscuit Bernard, Los Angeles - SGC VG+ 3.5 - Pop 1', // an issue name is not a player
    '1911 T201 Mecca Double Folders Sam Crawford/Ty Cobb - PSA EX 5',          // two subjects
    '1936 R313 National Chicle Fine Pen Premium Joe DiMaggio/Hank Erickson - DiMaggio Rookie Card - SGC VG 3',
    '1948 Bowman Baseball Uncut Panel (16 Cards) - Featuring Yogi Berra, Stan Musial, Warren Spahn Rookie Cards - 8 x 10',
    '1966 Philadelphia Football Unopened Wax Pack (6 Cards) - Possible Dick Butkus',
    '1905 W601 Sporting Life Cleveland Naps Team Composite - Featuring Nap Lajoie, Addie Joss, Elmer Flick - 13 x 14',
    '1931-1932 Exhibits 4-on-1 with Klein/Whitney/Benge/Arlett SGC POOR 10',
    '1980-1981 Topps Basketball Larry Bird/Julius Erving/Magic Johnson Rookie PSA NM 7',
    '1947 Leaf Jackie Robinson and Babe Ruth Multi-Signed Card',
  ]) assert.equal(rosterCardPlayerOf(t, KNOWN).player, null, t);
});

test('numbered cards whose slot run is not a person', () => {
  for (const [t, p] of [
    ['1949 Bowman #50 Jackie Robinson Inaugural Bowman Card - PSA MINT 9', 'Jackie Robinson'],
    ['Unique 1932 U.S. Caramel (R328) #32 Signed Babe Ruth - PSA Authentic; PSA/DNA MINT 9 Autograph', 'Babe Ruth'],
    ['1938 Goudey Heads-Up #250 Period-Signed Joe DiMaggio - PSA VG-EX+ 4.5; PSA/DNA MINT 9 Autograph', 'Joe DiMaggio'],
    ['1959 Fleer Ted Williams #1 The Early Years - PSA MINT 9', 'Ted Williams'],
    ['1960 Topps #388 Gil Hodges\' Winning Homer PSA NM-MT 8', 'Gil Hodges'],
    ['24 Topps Chrome Bundesliga Diamond Anniversary Relic #DAR-HK Harry Kane Diamond Relic Card (#1/1)', 'Harry Kane'],
    ['1922 E121 American Caramel Series of 120 "Babe" Ruth Holding Ball (Babe in Quotes) - SGC VG-EX 4', 'Babe Ruth'],
  ] as const) assert.equal(rosterCardPlayerOf(t, KNOWN).player, p, t);
  for (const t of ['1961 Topps #41 NL Batting Leaders with Willie Mays and Roberto Clemente PSA NM 7', '1966 Topps #34 Checklist PSA MINT 9'])
    assert.equal(rosterCardPlayerOf(t, KNOWN).player, null, t);
});

test('the stamped athlete files the lot under its player row on /makers', () => {
  const t = '1952 Berk Ross Mickey Mantle - PSA EX-MT 6';
  assert.equal(lotSubjectOf({ artist: 'graded-cards', title: t } as never), null);
  const np = rosterCardPlayerOf(t, KNOWN);
  const s = lotSubjectOf({ artist: 'graded-cards', title: t, playerName: np.player, playerSlug: np.playerSlug } as never);
  assert.equal(s?.key, 'p:mickey-mantle');
  assert.equal(s?.kind, 'player');
  // a numbered card whose slot run is not a person falls through to the stamp
  const t2 = '1949 Bowman #50 Jackie Robinson Inaugural Bowman Card - PSA MINT 9; MBA Bronze Diamond Certification';
  assert.equal(lotSubjectOf({ artist: 'graded-cards', title: t2 } as never), null);
  const np2 = rosterCardPlayerOf(t2, KNOWN);
  assert.equal(lotSubjectOf({ artist: 'graded-cards', title: t2, playerName: np2.player, playerSlug: np2.playerSlug } as never)?.key, 'p:jackie-robinson');
});
