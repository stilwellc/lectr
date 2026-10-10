import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityKeyOf, parseEntityId, entityPageOf, subEntityLabel, CAT_MARKET } from '../entity/key';
import { lotSubjectOf, pokemonSpeciesOf } from '../maker-subjects';
import { registerPlayerDossiers } from '../lot-labels';
import { MARKET_CATS, CATS } from '../taxonomy';

const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${artist}-${title}`.slice(0, 40), artist, title, status: 'sold', saleDate: '2026-05-01', ...extra });

test('entity key: makers by slug; a lot not by its maker has no entity', () => {
  assert.equal(entityKeyOf(lot('andy-warhol', 'Marilyn')), 'mk:andy-warhol');
  assert.equal(entityKeyOf(lot('rolex', 'Rolex Daytona Ref. 6263')), 'mk:rolex');
  // the attribution guard (app/lib/attribution): appropriation / "after" rows
  assert.equal(entityKeyOf(lot('andy-warhol', 'Richard Pettibone (B. 1938) Marilyn')), null);
  assert.equal(entityKeyOf(lot('andy-warhol', 'Affiche publicitaire Pop Art d\'après Andy Warhol pour le parfum Chanel No. 5')), null);
});

test('entity key: a player\'s cards and memorabilia are one player entity', () => {
  assert.equal(entityKeyOf(lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8')), 'pl:mickey-mantle');
  assert.equal(entityKeyOf(lot('game-used', 'Mickey Mantle Game-Used Louisville Slugger Bat')), 'pl:mickey-mantle');
});

test('entity key: subjects and sets carry their market; unnamed lots file by clean category', () => {
  assert.equal(entityKeyOf(lot('space-exploration', 'Apollo 11 Flown Beta Cloth Patch')), 'sj:science|m:apollo-11');
  assert.equal(entityKeyOf(lot('pokemon', '1999 Pokemon Base Set Holo #4 Charizard - PSA 9')), 'sj:tcg|k:charizard');
  assert.match(String(entityKeyOf(lot('unopened-wax', '1986 Fleer Basketball Wax Box (36 Packs) - BBCE Certified'))), /^st:sports\|s:1986-fleer-basketball/);
  assert.equal(entityKeyOf(lot('pokemon', 'Pokemon Booster Box Sealed')), 'cs:tcg:modern');
  // the science collections no reader covers keep their collection
  assert.equal(entityKeyOf(lot('meteorites', 'Large Gibeon Iron Meteorite Slice')), 'cs:space-science:meteorites');
  assert.equal(entityKeyOf(lot('fossils', 'Allosaurus Tooth')), 'cs:space-science:fossils');
});

test('entity key: never depends on the dossier registry', () => {
  const l1 = lot('autographs', 'Elvis Presley Signed Photograph', { playerSlug: 'elvis-presley' });
  const before = entityKeyOf({ ...l1 });
  registerPlayerDossiers(['elvis-presley']);
  const after = entityKeyOf({ ...l1 });
  registerPlayerDossiers([]);
  assert.equal(before, after);
});

test('pokémon species: variants of one species are one row', () => {
  for (const n of ['Charizard', 'Dark Charizard', "Blaine's Charizard", 'Charizard VMAX', 'Mega Charizard X ex', 'M Charizard EX', 'Charizard G Lv.X', 'Shining Charizard', 'Charizard (Glurak)', 'Charizard, No Rarity Symbol', 'Gold Star Charizard']) {
    assert.equal(pokemonSpeciesOf(n), 'Charizard', n);
  }
  for (const n of ['Ivy Pikachu', 'Red Cheeks Pikachu', 'Special Delivery Pikachu', 'Pikachu VMAX', "Mega Tokyo's Pikachu"]) assert.equal(pokemonSpeciesOf(n), 'Pikachu', n);
  // a trainer card or a tag team keeps its card name
  assert.equal(pokemonSpeciesOf("Giovanni's Scheme"), "Giovanni's Scheme");
  assert.equal(pokemonSpeciesOf('Mewtwo & Mew GX'), 'Mewtwo & Mew GX');
  assert.equal(pokemonSpeciesOf('Ho-Oh'), 'Ho-Oh');
  assert.equal(lotSubjectOf(lot('pokemon', '2000 Pokemon Gym Heroes 1st Edition Holo #2 Blaine\'s Charizard - PSA 9'))?.key, 'k:charizard');
});

test('entity id: parse, market and page', () => {
  assert.deepEqual(
    (({ kind, market, slug }) => ({ kind, market, slug }))(parseEntityId('mk:rolex')!),
    { kind: 'maker', market: 'watches', slug: 'rolex' });
  assert.equal(parseEntityId('pl:babe-ruth')!.market, 'sports');
  const sj = parseEntityId('sj:culture|f:8-mile')!;
  assert.equal(sj.kind, 'subject'); assert.equal(sj.market, 'culture'); assert.equal(sj.subjectKey, 'f:8-mile'); assert.equal(sj.subKind, 'film');
  assert.equal(parseEntityId('st:tcg|s:base-set')!.kind, 'set');
  const cs = parseEntityId('cs:historical:political')!;
  assert.equal(cs.kind, 'sub'); assert.equal(cs.market, 'culture');
  assert.equal(parseEntityId('xx:nope'), null);
  assert.equal(parseEntityId('cs:not-a-cat:x'), null);
  assert.equal(entityPageOf('mk:andy-warhol'), '/makers/andy-warhol');
  assert.equal(entityPageOf('pl:babe-ruth'), '/player?id=babe-ruth');
  assert.equal(entityPageOf('sj:tcg|k:charizard'), '/entity?id=sj%3Atcg%7Ck%3Acharizard');
  assert.equal(subEntityLabel('sports-cards', 'singles'), 'Sports Cards · Singles');
  assert.equal(subEntityLabel('space-science', 'meteorites'), 'Meteorites');
});

test('entity id: every clean category maps to the market whose strip it heads', () => {
  for (const c of CATS) {
    const m = CAT_MARKET[c.key];
    assert.ok(MARKET_CATS[m]?.includes(c.key), `${c.key} → ${m}`);
  }
});
