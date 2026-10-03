/**
 * Watch reference reader (app/lib/watch-ref.ts) + its three consumers:
 * comps.watchKey (the comp key the crawler stamps), identity-enrich
 * extractReference (the enrichment fallback) and corpus-normalize
 * enrichWatchReferences (re-derives + heals stored rows). Titles are real
 * corpus titles (Sep 28 2026 measurement).
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { watchKey, watchKeyKind } from '../../app/lib/comps';
import { readWatchReference, vetReference } from '../../app/lib/watch-ref';
import { extractReference } from '../lib/identity-enrich';
import { enrichWatchReferences } from '../lib/corpus-normalize';

const W = (artist: string, title: string): any => ({ id: 'x', artist, title, category: 'object', auctionHouse: 'Bonhams', saleDate: '2026-01-01', status: 'sold' });

test('labelled refs: every printed label form, keys unchanged for forms the old reader read', () => {
  // unchanged (old reader)
  assert.equal(watchKey({ title: 'ROLEX Ref. 116500LN Daytona' }), '116500ln');
  assert.equal(watchKey({ title: 'Patek Philippe reference 5711/1A-010 Nautilus' }), '5711/1a');
  assert.equal(watchKey({ title: 'Audemars Piguet: Royal Oak, ref. 26328OR.OO.D002CR.01.' }), '26328or');
  // colon / accent / "No." / glued label — used to fall to the model NAME or a serial
  assert.equal(watchKey({ title: 'Military Submariner, Ref: 5513, Circa 1975' }), '5513');
  assert.equal(watchKey({ title: 'Constellation, Ref: 2782/2799, Circa 1954' }), '2782/2799');
  assert.equal(watchKey({ title: 'Omega. Montre bracelet Réf. 2619, Circa 1944' }), '2619');
  assert.equal(watchKey({ title: 'SIGNED ROLEX, REF. NO. 8940, CIRCA 1965' }), '8940');
  assert.equal(watchKey({ title: 'Audemars Piguet. A fine 18ct gold wristwatch with dateRef: 77113, Movement No 81440, Case No. C85748' }), '77113');
  assert.equal(watchKeyKind({ title: 'Military Submariner, Ref: 5513' }), 'ref');
  assert.equal(watchKeyKind({ title: 'Rolex Submariner, stainless steel' }), 'model-name');
});

test('Omega dotted refs are not truncated to the collection code', () => {
  assert.equal(watchKey({ title: 'OMEGA | GLOBEMASTER, REF.130.30.39.21.02.001, A STAINLESS STEEL WRISTWATCH' }), '130.30.39.21');
  assert.equal(watchKey({ title: 'Omega Speedmaster Ref: 145.022-69' }), '145.022');
  assert.equal(watchKey({ title: "Speedmaster 'Ed White', Ref: ST 105.003-65, Circa 1967" }), '105.003');
  // a 4-digit core already names the model and keeps its old key
  assert.equal(watchKey({ title: 'Omega Speedmaster Professional Ref. 3570.50.00' }), '3570');
});

test('movement / case / serial numbers are never a reference', () => {
  const r = (a: string, t: string) => extractReference(W(a, t));
  assert.equal(r('audemars-piguet', 'Audemars Piguet. A fine 18K gold dual time zone automatic wristwatch with date and power reserveCase no. 68594, movement no. 341662'), null);
  assert.equal(r('patek-philippe', 'Case No. 236087, Movement No. 122624, Circa 1900s'), null);
  assert.equal(r('rolex', 'Rolex. a 9ct gold wristwatch case numbered 311500, hallmarked for glasgow 1928 33mm'), null);
  assert.equal(r('audemars-piguet', 'Audemars Piguet: 18k gold. Mechanical movement with manual winding, cal. 2003/1. 1960s.'), null);
  assert.equal(r('cartier', 'Cartier. an 18k gold rectangular wristwatch signed cartier paris, movement no. 243558, circa 1940'), null);
  // but the real ref beside them is read
  assert.equal(r('patek-philippe', 'PATEK PHILIPPE. REF. 130, MOVEMENT NO. 867\'336, CASE NO. 653\'358'), '130');
});

test('bare refs only in the brand shape; bare model words and cross-brand lines rejected', () => {
  assert.equal(readWatchReference('A steel Rolex 116610LN with box and papers', 'rolex'), '116610ln');
  assert.equal(readWatchReference('Audemars Piguet 26240ST Royal Oak Chronograph', 'audemars-piguet'), '26240st');
  assert.equal(readWatchReference('Cartier Tank Française W51002Q3 steel', 'cartier'), 'w51002q3');
  assert.equal(readWatchReference('Rolex: a 9ct gold midsize wristwatch signed rolex, 57371, london hallmark 1949', 'rolex'), null);
  assert.equal(readWatchReference('Rolex, Oyster, Precision, wristwatch, 34,5 mm.', 'rolex'), null);            // bare "oyster"
  assert.equal(readWatchReference("Audemars Piguet 'Tank Chinoise' yellow gold", 'audemars-piguet'), null);   // Cartier line on AP
  assert.equal(readWatchReference('Must de Cartier 21, Circa 1990', 'cartier'), 'mustdecartier');
  assert.equal(readWatchReference("CARTIER: 'PANTHÈRE' BROOCH", 'cartier'), 'panthere');                     // accent-folded
  assert.equal(readWatchReference("CARTIER: 'PANTHÉRE DE CARTIER' WRISTWATCH", 'cartier'), 'panthere');
});

test('vetReference: extraction refs that are serials are rejected', () => {
  assert.equal(vetReference('patek-philippe', '863474', 'Ref. 130, movement No. 863474'), false);
  assert.equal(vetReference('rolex', '14221', 'Rolex precision, movement no. 14221, case no. 385777'), false);
  assert.equal(vetReference('rolex', '1675', 'GMT-Master, Ref:1675, Made in 1966'), true);
  assert.equal(vetReference('omega', 'constellation', 'Omega Constellation'), false);
  assert.equal(vetReference('patek-philippe', '5711/1A', 'Nautilus 5711/1A'), true);
});

test('enrichWatchReferences re-derives: heals serials and model names, leaves other makers alone', () => {
  const lots = [
    { ...W('audemars-piguet', 'Case no. 13120, Movement no. 71079, 1970\'s'), reference: '13120' },
    { ...W('rolex', 'Military Submariner, Ref: 5513, Circa 1975'), reference: 'submariner' },
    { ...W('omega', 'Omega Ref: 145.022-69'), reference: null },
    { ...W('rolex', 'Rolex GMT-Master Ref. 1675'), reference: '1675' },
    { ...W('breitling', 'Breitling movement no. 12345'), reference: '12345' },
  ];
  const filled = enrichWatchReferences(lots as any);
  assert.equal(filled, 1);
  assert.deepEqual(lots.map(l => l.reference), [null, '5513', '145.022', '1675', '12345']);
  // idempotent
  enrichWatchReferences(lots as any);
  assert.deepEqual(lots.map(l => l.reference), [null, '5513', '145.022', '1675', '12345']);
});
