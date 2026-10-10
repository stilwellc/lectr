import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMisattributed, notByMaker } from '../attribution';

test('attribution (r5): appropriation and other-artist-first rows are not the maker\'s', () => {
  // the shard bug: Sturtevant's Warhol Flowers under Andy Warhol
  assert.equal(isMisattributed('andy-warhol', 'STURTEVANT (1924-2014) Warhol Flowers'), true);
  assert.equal(isMisattributed('andy-warhol', "STURTEVANT (1924-2014) Study for Warhol's Marilyn"), true);
  assert.equal(isMisattributed('andy-warhol', "Richard Pettibone (b. 1938) Andy Warhol, 'Flowers', 1965"), true);
  assert.equal(isMisattributed('andy-warhol', 'RICHARD AVEDON (1923-2004) Andy Warhol and members of the Factory'), true);
  assert.equal(isMisattributed('pablo-picasso', 'BRASSAÏ (1899-1984) Atelier de Picasso, vers 1933'), true);
  assert.equal(isMisattributed('pablo-picasso', 'Christian Zervos (1889-1970) Pablo Picasso, 1881-1973 - Catalogue raisonné'), true);
  assert.equal(isMisattributed('henri-matisse', 'Ugo Untoro (B. 1970) Dinner Table After Matisse'), true);
  assert.equal(isMisattributed('ed-ruscha', 'standard station (night) after ed ruscha (from pictures of cars)'), true);
  assert.equal(isMisattributed('george-nakashima', 'A massive walnut coffee table in the style of George Nakashima'), true);
  assert.equal(isMisattributed('alexander-calder', 'Homage to Calder (from XXe Siècle)'), true);
  assert.equal(notByMaker('pablo-picasso', 'School of Paris, Still Life'), true);
});

test('attribution (r5): the maker\'s own work, collaborations and illustrated books stay', () => {
  assert.equal(isMisattributed('andy-warhol', 'Andy Warhol (1928-1987) Flowers'), false);
  assert.equal(isMisattributed('andy-warhol', 'Marilyn Monroe (Marilyn), from Marilyn (F. & S. II.31)'), false);
  assert.equal(isMisattributed('andy-warhol', 'Jean-Michel Basquiat (1960-1988) & Andy Warhol (1928-1987) Untitled'), false);
  assert.equal(isMisattributed('pierre-jeanneret', 'Le Corbusier (1887-1965), and Pierre Jeanneret, Chandigarh armchair'), false);
  assert.equal(isMisattributed('pablo-picasso', "[PICASSO] - Honoré de BALZAC (1799-1850). Le Chef-d'œuvre inconnu. Paris: Ambroise Vollard, 1931"), false);
  assert.equal(isMisattributed('pablo-picasso', 'Picasso (Pablo) -- Apollinaire (Guillaume): Les Mamelles de Tirésias, six lithographed plates by Picasso; 12 plates after Picasso'), false);
  assert.equal(isMisattributed('pablo-picasso', "PABLO PICASSO L'Enterrement du Compte d'Orgaz, d'après Picasso, Plate 196 from Series 347"), false);
  assert.equal(isMisattributed('henri-matisse', 'JOYCE, James (1882-1941). Ulysses, with six full-page etchings and twenty sketches by Henri Matisse'), false);
  assert.equal(isMisattributed('henri-matisse', 'JOYCE, James (1882-1941) & Henri MATISSE (1869-1954, illustrator). Ulysses … 6 soft-ground etched plates by and after Matisse'), false);
  // a TRACKED maker leading is left to the reclassifier, which re-files the lot under them
  assert.equal(isMisattributed('pablo-picasso', 'ROY LICHTENSTEIN (1923-1997) Still Life with Picasso, from Hommage à Picasso'), false);
  // a description that merely starts with "After" is no qualifier
  assert.equal(isMisattributed('andy-warhol', 'Andy Warhol (1928-1987) Mick Jagger', 'After his 1975 portrait sitting, Warhol…'), false);
});
