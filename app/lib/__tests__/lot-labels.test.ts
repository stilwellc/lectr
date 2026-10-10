import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makerLineOf } from '../lot-labels';

test('maker line: a parsed card names its player, linked to the player dossier', () => {
  const m = makerLineOf({ artist: 'graded-cards', title: '1954 Topps #1 Ted Williams PSA NM-MT+ 8.5' });
  assert.equal(m.name, 'Ted Williams');
  assert.equal(m.href, '/player?id=ted-williams');
});

test('maker line: the Pokémon on a numbered card; sealed product keeps the maker', () => {
  assert.equal(makerLineOf({ artist: 'pokemon', title: '2003 Pokemon Skyridge Holo #H9 Gengar - BGS PRISTINE 10' }).name, 'Gengar');
  assert.equal(makerLineOf({ artist: 'pokemon', title: '2005 Pokemon EX Deoxys Factory-Sealed Booster Box (36 Packs)' }).name, 'Pokémon');
});

test('maker line: real makers and memorabilia are untouched', () => {
  assert.equal(makerLineOf({ artist: 'andy-warhol', title: 'Marilyn' }).href, '/makers/andy-warhol');
  const sealed = makerLineOf({ artist: 'sports-cards', title: '97 Flair Showcase Basketball Factory-Sealed Hobby Box (24 Packs)' });
  assert.equal(sealed.href, '/makers/sports-cards');
});

import { labelLineOf, subColumnOf } from '../lot-labels';

test('label line: quiet subs give way to badges; loud subs lead', () => {
  const card = { artist: 'graded-cards', title: '1952 Topps #311 Mickey Mantle - PSA VG+ 3.5' };
  assert.equal(labelLineOf(card), 'PSA 3.5');
  assert.equal(subColumnOf(card), 'PSA 3.5');
  const ent = { artist: 'movie-tv', subCat: 'worn-personal', drill: 'hollywood', title: 'Production-Used Command Battle Droid Head Prop from Star Wars' };
  assert.ok(labelLineOf(ent).startsWith('Props'));
});

import { labelTagOf, catSubLineOf, searchTextOf, drillLabelOf } from '../lot-labels';

test('tag / cat·sub line: the lead badge or the sub; Other subs drop on the lot page', () => {
  assert.equal(labelTagOf({ artist: 'rolex', subCat: 'wristwatches', title: 'A fine and rare platinum chronograph wristwatch' }), 'Chronograph');
  assert.equal(labelTagOf({ artist: 'andy-warhol', subCat: 'prints', title: 'Mao, 1972' }), 'Prints & Multiples');
  assert.equal(catSubLineOf({ artist: 'pokemon', subCat: 'pokemon-cards', drill: 'vintage', title: '1997 Pokemon Japanese Promo #1 Trophy Pikachu - PSA 8' }), 'Pokémon & TCG · Vintage (1996–2003)');
  assert.equal(catSubLineOf({ artist: 'roy-lichtenstein', subCat: 'other', title: 'Cow Triptych' }), 'Fine Art');
});

test('search text: the printed label vocabulary is searchable (player, grade, Rookie)', () => {
  const card = { artist: 'graded-cards', title: '1960 Topps #148 Carl Yastrzemski Rookie PSA MINT 9', auctionHouse: 'REA' };
  const h = searchTextOf(card);
  for (const w of ['carl yastrzemski', 'psa 9', 'rookie', 'sports cards', 'rea']) assert.ok(h.includes(w), w);
  assert.equal(searchTextOf(card), h);
});

test('drill label: one-sub drills print the sub; sport × kind reads Sport · Kind; the rest stand', () => {
  assert.equal(drillLabelOf('pokemon-era:vintage', "Vintage ≤'02"), 'Vintage (1996–2003)');
  assert.equal(drillLabelOf('cards:football', 'Football · cards'), 'Football · Cards');
  assert.equal(drillLabelOf('memorabilia:olympics', 'Olympics · memorabilia'), 'Olympics · Memorabilia');
  assert.equal(drillLabelOf('rolex:daytona', 'Daytona · Rolex'), 'Daytona · Rolex');
  assert.equal(drillLabelOf('cards-era:modern', 'Modern cards (2000+)'), 'Modern cards (2000+)');
});
