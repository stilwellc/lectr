/**
 * Card year parse (app/lib/cards.ts) — a leading LOT NUMBER is not a year.
 * Memory Lane / Lelands / Love of the Game titles lead with the lot number:
 * "77 1962 Topps …" parsed year 1977 (the bare two-digit branch fired on the
 * lot number), and "13 1959 Topps …" parsed 2013. Sep 28 2026.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { parseCard, playerOf, cardKey } from '../../app/lib/cards';

test('a lot number before a 4-digit year is skipped, never read as a 2-digit year', () => {
  assert.equal(parseCard('77 1962 Topps #200 Mickey Mantle PSA 5').year, '1962');
  assert.equal(parseCard('13 1959 Topps Baseball All Star #553 Orlando Cepeda Signed').year, '1959');
  assert.equal(parseCard('2 1991-92 Fleer #29 Michael Jordan PSA 9').year, '1991-92');
  assert.equal(parseCard('1204 2020 Panini Prizm #278 Joe Burrow Rookie - PSA 10').year, '2020');
});

test('the set name and card identity are read past the lot number', () => {
  const c = parseCard('77 1962 Topps #200 Mickey Mantle - PSA 5');
  assert.equal(c.setName, 'Topps');
  assert.equal(c.cardNo, '200');
  assert.equal(c.playerSlug, 'mickey-mantle');
  assert.equal(cardKey(c), cardKey(parseCard('1962 Topps #200 Mickey Mantle - PSA 5')));
});

test('no regressions on the forms without a lot number', () => {
  assert.equal(parseCard("'96 Topps #1 Ken Griffey Jr.").year, '1996');
  assert.equal(parseCard('96-97 Fleer #1 Michael Jordan').year, '1996');
  assert.equal(parseCard('21 Topps Chrome #1 Shohei Ohtani').year, '2021');
  assert.equal(parseCard('2020 Panini Prizm #278 Joe Burrow - PSA 10').year, '2020');
  assert.equal(parseCard('2020 Panini Prizm #278 Joe Burrow - PSA 10').setName, 'Panini Prizm');
  assert.equal(parseCard('1986 Fleer #57 Michael Jordan Rookie - PSA 8').year, '1986');
  assert.equal(parseCard('Michael Jordan signed photo').year, null);
});

test('playerOf: a lot-numbered card-style object title routes to the card parser; object titles are unchanged', () => {
  assert.equal(playerOf('21 1978 Topps Baseball #707 Paul Molitor Signed Rookie', 'autographs').playerSlug, 'paul-molitor');
  // an object title past a lot number is NOT re-read (it would mint a team name as a player)
  assert.equal(playerOf('2 1991-92 Chicago Bulls Eastern Conference Champions Team-Signed Poster', 'autographs').playerSlug, null);
  assert.equal(playerOf('1986 Michael Jordan Game-Worn Jersey', 'game-used').playerSlug, 'michael-jordan');
});
