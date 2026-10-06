/**
 * Edition sizes + labelled serials (app/lib/normalize.ts extractEdition /
 * extractSerials) and their corpus re-derivation (corpus-normalize
 * rederiveEditionsSerials). Texts are real corpus snippets (Oct 5 2026
 * corpus; judged samples in the identity fix wave).
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { extractEdition, extractSerial, extractSerials } from '../../app/lib/normalize';
import { rederiveEditionsSerials } from '../lib/corpus-normalize';

const ed = (t: string, d?: string) => {
  const e = extractEdition(t, d);
  return e.editionOf == null ? null : `${e.editionOf}/${e.editionTotal}`;
};

test('dimension fractions are not editions', () => {
  // christies-auc-5289148 · bonhams-17529-1123 · christies-auc-5176375 · bonhams-22666-295
  assert.equal(ed('Picasso', "charcoal on paper 25 7/8 x 20 in. (65.6 x 50.7 cm.)"), null);
  assert.equal(ed('untitled, 1986', '8 3/16 x 5in (20.8 x 12.7cm)'), null);
  assert.equal(ed('Taureau', 'marli aux feuilles 23cm (9 1/16in) diameter'), null);
  assert.equal(ed('Map', 'with wide margins, 1 ½-in. and 5/8-in. tears backed'), null);
  assert.equal(ed('Engine', 'brass cylinders 7/8in. bore x 13/16in stroke'), null);
  assert.equal(ed('Sheet', '10-7/8 x 8 in.'), null);
  // watch dial / calibre fractions
  assert.equal(ed('Omega', 'outer 1/5th seconds scale'), null);
  assert.equal(ed('Patek', 'outer 1/5 minute divisions'), null);
  assert.equal(ed('Patek', "manufactured in 2006 calibre 28-520/521, geneva seal"), null);
  assert.equal(ed('Patek', "circa 1915 calibre 19'''1/2, bi-metallic"), null);
});

test('real editions survive, including one behind a dimension fraction', () => {
  // bonhams-19088-12 · christies-auc-3684025: "in pencil"/"in ink" is not the unit
  assert.equal(ed('Chagall', 'lithograph in colours, 1956, signed and numbered 75/200 in pencil'), '75/200');
  assert.equal(ed('Photo', 'gelatin silver print, 14 x 11in. , numbered 6/250 in ink in margin.'), '6/250');
  // bonhams-13534-683: the old reader stopped at "23 1/2" and never saw 5/25
  assert.equal(ed('Warhol', 'concept car 59.5 x 77.5cm (23 1/2 x 30 1/2in) signed, numbered 5/25'), '5/25');
  // christies-auc-4924892: a whole number before only rules out inch denominators
  assert.equal(ed('Warhol', "numéroté et inscrit 'andy warhol 75 10/125 eawe'"), '10/125');
  assert.equal(ed('Goldin', 'Shohei Ohtani Signed Rookie Card (#11/25) - BGS GEM MINT 9'), '11/25');
  assert.equal(ed('Cartier', 'wristwatch, cartier,"tank" no.2/15,circa 1997'), '2/15');
});

test('serials: labelled, ≥4 digits, separators folded, case and movement apart', () => {
  // the old reader's garbage: "with" (6,646 rows), "40mm", "NO.4", masked digits
  assert.equal(extractSerial('Rolex', 'water resistant-type case with screw back'), null);
  assert.equal(extractSerial('Cartier', 'mechanical movement, case width 20mm'), null);
  assert.equal(extractSerial('Rolex', 'Ref:2917, Serial No.031***, Circa 1938'), null);
  assert.equal(extractSerial('Rolex', 'Movement No.N72****, Circa'), null);
  assert.equal(extractSerial('Patek', 'Movement: Cal. 727, manual'), null);
  assert.equal(extractSerial('Wright', "'Special' Case 1972 Persian walnut"), null);
  // christies: apostrophe thousands, both numbers kept apart
  assert.deepEqual(extractSerials('Patek', "MOVEMENT NO. 728'344, CASE NO. 647'668, CIRCA"), { serialNo: 'sn-647668', caseNo: '647668', movementNo: '728344' });
  // bonhams dotted · "Case Numbered:C 20953" · Sotheby's "mvt … case …" shorthand
  assert.deepEqual(extractSerials('x', 'Case No.2.609.916, Movement No.784.958, Sold'), { serialNo: 'sn-2609916', caseNo: '2609916', movementNo: '784958' });
  assert.equal(extractSerials('x', 'Case Numbered:C 20953, Movement No.28357').caseNo, 'C20953');
  assert.deepEqual(extractSerials('x', 'ref 5107g mvt 3253717 case 4233240 made in'), { serialNo: 'sn-4233240', caseNo: '4233240', movementNo: '3253717' });
  assert.equal(extractSerial('x', 'ref 16523 case a858414 daytona'), 'sn-A858414');
  assert.equal(extractSerial('x', 'SERIAL NO’: M646499 BRACELET'), 'sn-M646499');
  assert.equal(extractSerial('x', 'REF. 116710LN, CASE NO. 5Y59K609, CIRCA 2010'), 'sn-5Y59K609');
  assert.equal(extractSerial('x', 'CRASH MODEL, CASE NO. 188-91, CIRCA 1991'), 'sn-18891');
  // movement only → kind-qualified, never equal to a case number
  assert.equal(extractSerial('x', 'Patek Philippe, movement no. 1396396 Accompanied'), 'mvt-1396396');
  assert.notEqual(extractSerial('x', 'case no. 1396396'), extractSerial('x', 'movement no. 1396396'));
  // Cartier "<model code> <serial>"; a lone model code in a list is not the serial
  assert.equal(extractSerial('x', 'PASHA GOLF MODEL, REF. 30010, CASE NO. 1988 0094, CIRCA 1988'), 'sn-19880094');
  assert.equal(extractSerial('x', 'Tank Americaine, Case Nos. 1713 and SM10398, Circa'), null);
});

test('corpus re-derivation heals stored editions/serials and is idempotent', () => {
  const rows = [
    { id: 'a', schemaVersion: 2, title: 'Picasso', description: 'pencil on paper 10 7/8 x 8 in.', editionOf: 7, editionTotal: 8, editionMarker: null, serialNo: null },
    { id: 'b', schemaVersion: 2, title: 'Rolex', description: 'case with screw back, CASE NO. 694\'422, CIRCA 1960', editionOf: null, editionTotal: null, editionMarker: null, serialNo: 'with' },
    { id: 'c', schemaVersion: 2, title: 'Chagall', description: 'numbered 12/50', editionOf: 12, editionTotal: 50, editionMarker: null, serialNo: null },
    { id: 'd', title: 'REA card 3/4 in', editionOf: 3, editionTotal: 4 }, // not crawl-normalized: untouched
  ] as unknown as Parameters<typeof rederiveEditionsSerials>[0];
  const r1 = rederiveEditionsSerials(rows);
  assert.deepEqual(r1, { editions: 1, serials: 1 });
  assert.equal(rows[0].editionOf, null);
  assert.equal(rows[1].serialNo, 'sn-694422');
  assert.equal(rows[1].caseNo, '694422');
  assert.ok(!('movementNo' in rows[1]));
  assert.equal(rows[2].editionOf, 12);
  assert.equal(rows[3].editionOf, 3);
  assert.deepEqual(rederiveEditionsSerials(rows), { editions: 0, serials: 0 });
});
