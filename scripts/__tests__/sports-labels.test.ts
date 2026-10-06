/**
 * Sports labeling wave (Oct 6 2026) — the player / card-key error classes the
 * categorization re-audits left standing. Every fixture is a real corpus
 * title from the DEV autopsy (md5-even half of the hand-labelled samples) or
 * its corpus sweep.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { parseCard, cardKey, cardLadderKey, playerOf } from '../../app/lib/cards';
import { cardRepeatKey } from '../sub-markets';
import { restampCardPlayer } from '../lib/corpus-normalize';
import type { AuctionLot } from '../../app/types';

const key = (t: string) => cardKey(parseCard(t));
const rk = (t: string) => cardRepeatKey({ title: t, _card: parseCard(t) } as unknown as AuctionLot);
const KNOWN = new Set(['babe-ruth', 'ted-williams', 'stan-musial', 'pete-rose', 'mickey-mantle']);

test('SGC legacy 100-point grades read as the 10-point grade', () => {
  assert.equal(parseCard('1911 T205 Gold Border Arthur Fletcher SGC EX 60').gradeNum, 5);
  assert.equal(parseCard('1915 Cracker Jack #1 Otto Knabe (SGC 88 NM/MT)').gradeNum, 8);
  assert.equal(parseCard('1963 Topps #446 Whitey Ford SGC NM+ 86').gradeNum, 7.5);
  assert.equal(parseCard('1909-11 T206 White Borders Nap Lajoie (Throwing) - SGC 20 Fair 1.5').gradeNum, 1.5);
  // a legacy 10 only beside POOR; a modern SGC 10 stays 10
  assert.equal(parseCard('1909 E95 Philadelphia Caramel Ty Cobb SGC POOR 10').gradeNum, 1);
  assert.equal(parseCard('2018 Topps Chrome #150 Ronald Acuna Jr. Rookie Card - SGC GEM MINT 10').gradeNum, 10);
  // the REA "SGC 60" and the H&S "SGC EX 5" sale of one card share a key
  assert.equal(key('1954 Bowman #66 Ted Williams SGC EX 60'), key('1954 Bowman #66 Ted Williams SGC EX 5'));
  assert.equal(parseCard('1934 Goudey #35 Ernie Lombardi w/ auto – SGC AUT').gradeTag, 'A');
});

test('a leading "Signed" / "Autographed" no longer hides the year', () => {
  const c = parseCard('Signed 1958 Topps Football #62 Jim Brown Rookie PSA VG-EX 4 with MINT 9 Signature');
  assert.equal(c.year, '1958'); assert.equal(c.setName, 'Topps Football'); assert.equal(c.player, 'Jim Brown');
  assert.equal(c.auto, true); assert.equal(c.autoGrade, '9');
  assert.ok(key('Signed 1981 Donruss #538 Tim Raines Rookie - PSA/DNA'));
  assert.equal(parseCard('Autographed 1954 Bowman #65 Mickey Mantle').auto, true);
});

test("Goldin's '#'-less card numbers key the card", () => {
  assert.equal(key('2019 Topps 475 Pete Alonso Rookie Card – PSA GEM MT 10'), key('2019 Topps #475 Pete Alonso Rookie Card - PSA GEM MT 10'));
  const c = parseCard('2022 Bowman Draft Bd80 Elly De La Cruz Rookie Card – PSA MINT 9');
  assert.equal(c.cardNo, 'BD80'); assert.equal(c.setName, 'Bowman Draft'); assert.equal(c.playerSlug, 'elly-de-la-cruz');
  // the number before the name, never a set token before it
  assert.equal(parseCard('2022 Topps F1 Turbo Attax 330 Max Verstappen – PSA MINT 9').cardNo, '330');
  // a series number, a sealed box, a grade, a multi-card set are never a card number
  assert.equal(parseCard('2021 Topps Series 2 Baseball Factory-Sealed Hobby Box (24 Packs) - Possible Jazz Chisholm').player, null);
  assert.equal(parseCard('87 Fleer Basketball Complete Set (132) - Featuring PSA MINT 9 Michael Jordan Rookie Card').cardNo, null);
  assert.equal(parseCard('1959 Fleer Ted Williams 13 1939-Ted Shows He Will Stay – PSA NM-MT 8').cardNo, null);
});

test('pre-war catalog cards: colour surnames, nicknames, issue names, provenance', () => {
  assert.equal(parseCard('1909-1911 T206 White Border Mordecai Brown Portrait PSA GOOD+ 2.5').playerSlug, 'mordecai-brown');
  assert.equal(parseCard('1910 E98 Anonymous "Set of 30" Red Dooin PSA NM 7 - Red Background').playerSlug, 'red-dooin');
  const cobb = parseCard('1910 E98 Set of 30 Red Ty Cobb - CGC GEM MINT 10 - Pop 2');
  assert.equal(cobb.playerSlug, 'ty-cobb'); assert.equal(cobb.multi, false);
  assert.equal(parseCard('1909-1911 T206 White Border Joe "Iron Man" McGinnity SGC VG 40').playerSlug, 'joe-mcginnity');
  assert.equal(parseCard('1919 T213 Coupon Cigarettes (Type 3) Eddie Collins PSA GOOD 2').playerSlug, 'eddie-collins');
  const brown = parseCard('1909-1911 T206 White Border George Brown Washington SGC EX/NM 6 (Paul Pollard Collection)');
  assert.equal(brown.playerSlug, 'george-brown'); assert.equal(brown.pose, 'washington');
  // the issue's own colour words still lead ("Brown Background")
  assert.equal(parseCard('1912 T207 Brown Background Mike Mitchell Cincinnati PSA GOOD 2').playerSlug, 'mike-mitchell');
  assert.equal(parseCard('1909-1911 T206 White Border Ty Cobb Portrait Green Background').pose, 'portrait-green-background');
});

test('card descriptors: Hand Cut, Jersey Number, Collector\'s Choice, long insert names', () => {
  assert.equal(parseCard('1966 Bazooka #7 Mickey Mantle Hand-Cut PSA 10 GEM MINT').playerSlug, 'mickey-mantle');
  assert.equal(parseCard('1960 Bazooka #13 Hand Cut Willie Mays PSA 10 GEM MINT').playerSlug, 'willie-mays');
  assert.equal(parseCard('19 Panini Cornerstones Quartz #91 Kevin Durant (#07/49) - Jersey Number - PSA MINT 9').variant, null);
  assert.equal(parseCard('95 Upper Deck Collector\'s Choice #204 Michael Jordan - PSA NM-MT 8').variant, null);
  assert.equal(parseCard('2022 Topps Triple Threads Rookies And Future Phenoms Autograph Relics Emerald #RFPAR-RC Roansy Contreras Signed Game-Used Relic Rookie Card (#42/50) – PSA NM-MT 8').setName,
    'Topps Triple Threads Rookies And Future Phenoms Autograph Relics Emerald');
});

test('object players: Sotheby\'s lower-case NBA titles', () => {
  assert.equal(playerOf('jase richardson orlando magic 2025-2026 game worn association edition jersey', 'game-used', KNOWN).player, 'Jase Richardson');
  assert.equal(playerOf('marcus morris sr. ‘christmas day’ philadelphia 76ers 2023-2024 game worn association edition jersey', 'game-used', KNOWN).playerSlug, 'marcus-morris-sr');
  assert.equal(playerOf('t.j. mcconnell indiana pacers 2024-2025 game worn icon edition jersey', 'game-used', KNOWN).player, 'T.J. Mcconnell');
  assert.equal(playerOf('jalen brunson worn ‘nba all-star game’ practice jersey', 'sports-memorabilia', KNOWN).player, 'Jalen Brunson');
  assert.equal(playerOf('game issued 2023-2024 miami heat basketball', 'game-used', KNOWN).player, null);
  assert.equal(playerOf('nike air force 1 eminem ‘shady records’ | size 10.5', 'sports-memorabilia', KNOWN).player, null);
});

test('object players: an unknown name + Signed + a sporting object; descriptors, teams and pairs never', () => {
  assert.equal(playerOf('Miguel Almiron Signed Newcastle United Home Jersey - Beckett', 'autographs', KNOWN).player, 'Miguel Almiron');
  assert.equal(playerOf('2013 Brian Wilson Autographed Los Angeles Dodgers Game Worn Home Jersey with Postseason Patch - PSA/DNA', 'game-used', KNOWN).player, 'Brian Wilson');
  assert.equal(playerOf('Star Pitcher Single Signed Baseball lot of (16)', 'autographs', KNOWN).player, null);
  assert.equal(playerOf('Sam Worthington Signed Photograph - 11 x 14 - PSA/DNA COA', 'autographs', KNOWN).player, null);
  assert.equal(playerOf('1981 & 1982 San Diego Padres Autographed Team Baseballs', 'memorabilia', KNOWN).player, null);
  // a pair keeps its lead-named player (the hand labels' convention)
  assert.equal(playerOf('Ted Williams and Stan Musial', 'autographs', KNOWN).player, 'Ted Williams');
  assert.equal(playerOf('Extraordinary Babe Ruth Single Signed Baseball', 'autographs', KNOWN).playerSlug, 'babe-ruth');
  assert.equal(playerOf('Pete Rose', 'autographs', KNOWN).playerSlug, 'pete-rose');
});

test('a sold card\'s stale playerName is re-read from the card parser', () => {
  const a = { title: '1933 DeLong Gum #7 Lou Gehrig (HOF) - PSA FR 1.5', playerName: 'DeLong Gum', playerSlug: 'delong-gum' };
  assert.equal(restampCardPlayer(a), 'card-player-restamped'); assert.equal(a.playerSlug, 'lou-gehrig');
  const b = { title: '1953 Topps Baseball Hall of Fame Collection (12)', playerName: 'Baseball Hall' };
  assert.equal(restampCardPlayer(b), 'card-player-cleared'); assert.equal(b.playerName, undefined);
  // no parsed player, but a roster athlete: kept
  const c = { title: 'Mickey Mantle Card Lot (5)', playerName: 'Mickey Mantle' };
  assert.equal(restampCardPlayer(c), null); assert.equal(c.playerName, 'Mickey Mantle');
  // same slug (diacritics only): untouched
  const d = { title: '2018 Panini Prizm #280 Luka Dončić Rookie Card - PSA GEM MT 10', playerName: 'Luka Doncic' };
  assert.equal(restampCardPlayer(d), null);
});

test('repeat-sale key: unparsed / Authentic slabs are not raw cards', () => {
  assert.equal(rk('1958 Topps #47 Roger Maris RC Autographed Card—BVG/JSA'), null);
  assert.equal(rk('1954 Bowman #66 Ted Williams SGC Authentic'), 'ted-williams|1954|bowman|66|SGCA');
  assert.equal(rk('1954 Bowman #66 Ted Williams'), 'ted-williams|1954|bowman|66|raw');
  assert.equal(rk('1954 Bowman #66 Ted Williams SGC EX 60'), 'ted-williams|1954|bowman|66|SGC5');
  assert.ok(rk('Autographed 1954 Bowman #65 Mickey Mantle')!.endsWith('|s'));
  assert.equal(cardLadderKey(parseCard('1909-1911 T206 White Border Mordecai Brown Portrait PSA GOOD+ 2.5')), 'mordecai-brown|t206|t206|-|p:portrait');
});
