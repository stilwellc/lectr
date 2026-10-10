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
