import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, shardOf, refCompact } from '../search-tokens';
import { matchRefs, type RefRow } from '../search-index';
import { refLabel } from '../../utils';

const REFS: RefRow[] = [
  { maker: 'patek-philippe', ref: '5711', n: 24, med: 66000 },
  { maker: 'patek-philippe', ref: '5711/1a', n: 67, med: 97000 },
  { maker: 'patek-philippe', ref: 'nautilus', n: 91, med: 14000 },
  { maker: 'rolex', ref: '1675', n: 226, med: 16000 },
  { maker: 'rolex', ref: '16750', n: 41, med: 11000 },
  { maker: 'rolex', ref: '126720vtnr', n: 9, med: 22000 },
  { maker: 'audemars-piguet', ref: 'royaloakoffshore', n: 181, med: 16000 },
];
const top = (q: string) => matchRefs(q, REFS, refLabel, 3).map(h => `${h.row.maker}:${h.row.ref}`);

test('tokenize folds diacritics, drops stop words and single chars', () => {
  assert.deepEqual(tokenize('CARTIER: "PANTHÈRE" Brooch of the A'), ['cartier', 'panthere', 'brooch']);
  assert.deepEqual(tokenize('Ref. 5711/1A-010'), ['ref', '5711', '1a', '010']);
});

test('shardOf honours split prefixes', () => {
  assert.equal(shardOf('5711'), '57');
  assert.equal(shardOf('carter', new Set(['ca'])), 'car');
  assert.equal(shardOf('ca', new Set(['ca'])), 'ca');
  assert.equal(refCompact('5711/1A'), '57111a');
});

test('reference numbers land on the dossier first', () => {
  assert.equal(top('5711')[0], 'patek-philippe:5711');
  assert.equal(top('Patek 5711')[0], 'patek-philippe:5711');
  assert.equal(top('126720VTNR')[0], 'rolex:126720vtnr');
  assert.equal(top('Rolex 1675')[0], 'rolex:1675');
  assert.equal(top('5711/1A')[0], 'patek-philippe:5711/1a');
  assert.equal(top('royal oak offshore')[0], 'audemars-piguet:royaloakoffshore');
  assert.deepEqual(top('rolex'), []);
});
