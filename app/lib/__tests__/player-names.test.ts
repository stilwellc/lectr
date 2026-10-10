/* (r7, Oct 10) one athlete per player row — the joined / run-on / not-a-person
   names that minted spurious entity ids (pl:larry-yogi-berra,
   pl:babe-ruth-hits, pl:al-batting-leaders …). Titles are the live book's and
   the corpus's own. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotSubjectOf, canonPlayerName } from '../maker-subjects';
import { entityKeyOf } from '../entity/key';

const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${artist}-${title}`.slice(0, 40), artist, title, status: 'upcoming', saleDate: '2026-10-20', ...extra });
const key = (artist: string, title: string, extra: Record<string, unknown> = {}) => lotSubjectOf(lot(artist, title, extra))?.key ?? null;

test('player names (r7): a given name joined to its quoted nickname is one athlete', () => {
  // stamped "Larry Yogi Berra" — the fused reading — files under Yogi Berra
  assert.equal(key('autographs', 'Larry "Yogi" Berra Single Signed Baseball', { playerName: 'Larry Yogi Berra', playerSlug: 'larry-yogi-berra' }), 'p:yogi-berra');
  assert.equal(entityKeyOf(lot('autographs', 'Larry "Yogi" Berra Single Signed Baseball', { playerName: 'Larry Yogi Berra', playerSlug: 'larry-yogi-berra' })), 'pl:yogi-berra');
  assert.equal(key('autographs', 'Larry "Yogi" Berra Single Signed Baseball', { playerName: 'Yogi Berra', playerSlug: 'yogi-berra' }), 'p:yogi-berra');
  // a reader that dropped the nickname ("Larry Berra") gets it back when it IS the name
  assert.equal(key('game-used', '1960s Larry "Yogi" Berra Game-Used Bat'), 'p:yogi-berra');
  assert.equal(key('graded-cards', '1948 Bowman #6 Larry (Yogi) Berra PSA 7'), 'p:yogi-berra');
  // …and stays dropped when the given name is the hobby's name
  assert.equal(key('autographs', 'Walt "Clyde" Frazier Signed Basketball'), 'p:walt-frazier');
});

test('player names (r7): a hyphen-joined duo files under its first-named, never a fused id', () => {
  assert.equal(key('game-used', '1950s Yogi Berra-Phil Rizzuto Game-Worn Baseball Undershirt'), 'p:yogi-berra');
  // a hyphenated surname is one name
  assert.equal(canonPlayerName('Shai Gilgeous-Alexander', '2018 Prizm #170 Shai Gilgeous-Alexander PSA 10'), 'Shai Gilgeous-Alexander');
});

test('player names (r7): caption run-ons are trimmed back to the athlete', () => {
  assert.equal(key('graded-cards', '1961 Topps #401 Babe Ruth Hits 60th Homer PSA NM-MT 8'), 'p:babe-ruth');
  assert.equal(key('graded-cards', '1933 Goudey #6 Jimmy Dykes Age is 36 in Bio PSA 6 EX-MT'), 'p:jimmy-dykes');
  assert.equal(key('graded-cards', '1959 Topps #467 Hank Aaron Clubs World Series Homer PSA NM-MT 8'), 'p:hank-aaron');
  assert.equal(key('sports-cards', '2026 Panini The National VIP Gem #LY Lamine Yamal Diamond Relic Card (#1/1) - Panini Encased'), 'p:lamine-yamal');
  assert.equal(key('graded-cards', '1956 Topps #93 George Susce Jr. White Back PSA NM-MT 8'), 'p:george-susce-jr');
  assert.equal(key('equipment-artifacts', '1962 Roberto Clemente White Base Bobblehead Doll', { playerName: 'Roberto Clemente White', playerSlug: 'roberto-clemente-white' }), 'p:roberto-clemente');
  assert.equal(key('autographs', 'Michael Jordan UDA Signed Baseball', { playerName: 'Michael Jordan UDA', playerSlug: 'michael-jordan-uda' }), 'p:michael-jordan');
  assert.equal(key('programs-publications', '146 Babe Ruth Hits 3-Home Runs 1926 World Series Program', { playerName: 'Babe Ruth Hits', playerSlug: 'babe-ruth-hits' }), 'p:babe-ruth');
});

test('player names (r7): real three-word names keep every word', () => {
  for (const [n, t] of [
    ['Grover Cleveland Alexander', '1922 E120 Grover Cleveland Alexander PSA 4'],
    ['Sugar Ray Robinson', 'Sugar Ray Robinson Signed Photo'],
    ['Booker T. Washington', 'Booker T. Washington Signed Letter'],
    ['Pee Wee Reese', '1952 Topps #333 Pee Wee Reese PSA 6'],
    ['Jo Jo White', '1970 Topps #143 Jo Jo White PSA 8'],
    ['Ken Griffey Jr.', '1989 Upper Deck #1 Ken Griffey Jr. PSA 10'],
    ['Alperen Şengün', 'Alperen Şengün Signed Jersey'],
  ] as const) assert.equal(canonPlayerName(n, t), n, n);
});

test('player names (r7): subset / leaders / team / promo cards are no one athlete', () => {
  for (const t of [
    '1962 Topps #51 A.L. Batting Leaders PSA 8.5 NM-MT+',
    '1963 Topps #1 N. L. Batting Leaders with Hank Aaron, Frank Robinson, and Stan Musial PSA EX 5',
    '1977 Topps #6 Strikeout Leaders, Nolan Ryan/Tom Seaver - PSA GEM MT 10',
    '1958 Topps #351 Fence Busters with Hank Aaron and Ed Mathews PSA EX-MT 6',
    '1959 Topps #428 Buc Hill Aces PSA MINT 9',
    '1959 Topps #543 Corsair Outfield Trio with Roberto Clemente PSA NM 7',
  ]) assert.ok(!String(key('graded-cards', t)).startsWith('p:'), t);
  assert.notEqual(key('memorabilia', '1934 Quaker Oats Premium Photo Babe Ruth - PSA PR 1', { playerName: 'Quaker Oats Premium', playerSlug: 'quaker-oats-premium' }), 'p:quaker-oats-premium');
  // one-word signers and owners' possessives keep their rows
  assert.equal(key('autographs', 'Pele Signed Brazil Jersey - PSA/DNA COA'), 'p:pele');
  assert.equal(key('memorabilia', "1909 Jim Jeffries' Championship Boxing-Themed Playing Cards", { playerName: "Jim Jeffries'", playerSlug: 'jim-jeffries' }), 'p:jim-jeffries');
});
