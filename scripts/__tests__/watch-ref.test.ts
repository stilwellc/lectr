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
import { readWatchReference, vetReference, splitWatchRef, refSuffixMaterial, readWatchKey, readDescriptionReference } from '../../app/lib/watch-ref';
import { coarseWatchMaterial } from '../../app/lib/comps';
import { watchMaterialCoarse, numericWatchRef } from '../../app/lib/identity';
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
  // (Oct 6 re-audit) the whole printed ref — the four-group cut read a different reference
  assert.equal(watchKey({ title: 'OMEGA | GLOBEMASTER, REF.130.30.39.21.02.001, A STAINLESS STEEL WRISTWATCH' }), '130.30.39.21.02.001');
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
  // (Oct 6: AP's material code is not part of the key: 26240ST/26240OR are one reference)
  assert.equal(readWatchReference('Audemars Piguet 26240ST Royal Oak Chronograph', 'audemars-piguet'), '26240');
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

/* ── Oct 6 2026 identity fix wave: core reference + suffix material, glued
   text, whole loose tokens, 2-digit Patek refs, description fallback, ONE
   material reader. Titles are real Oct 5 corpus titles. */

test('Patek/AP material suffixes leave the key and feed the material reader', () => {
  const pk = (t: string) => readWatchKey(t, 'patek-philippe')?.key;
  assert.equal(pk('PATEK PHILIPPE, REF. 3970EP DIAMOND INDEX PLATINUM'), '3970');
  assert.equal(pk('Reference 5015J | A yellow gold automatic wristwatch'), '5015');
  assert.equal(pk('Nautilus, Reference 5740/1G-001 | A white gold perpetual calendar'), '5740/1');
  assert.equal(pk("REF. 5268/200R-001, MOVEMENT NO. 7'450'514"), '5268/200');
  assert.equal(readWatchKey('ROYAL OAK, REF.25820SP, A PLATINUM AND STAINLESS STEEL', 'audemars-piguet')?.key, '25820');
  assert.equal(readWatchKey('reference 15204or.oo.1240or.01 royal oak openworked', 'audemars-piguet')?.key, '15204');
  // Rolex letter suffixes are models, not metals: kept
  assert.equal(readWatchKey('ROLEX Ref. 116500LN Daytona', 'rolex')?.key, '116500ln');
  assert.deepEqual(splitWatchRef('patek-philippe', '5711/1a'), { core: '5711/1', material: 'steel' });
  assert.deepEqual(splitWatchRef('audemars-piguet', 'ba25682.002qua'), { core: '25682', material: 'gold' });
  assert.equal(splitWatchRef('patek-philippe', '20044m').core, '20044m');            // a clock ref, untouched
  // the suffix is the material when the text names none
  assert.equal(refSuffixMaterial('World Time, Ref: 5110G-001, Sold 5th June 2004', 'patek-philippe'), 'gold');
  assert.equal(coarseWatchMaterial({ title: 'Royal Oak Quantieme Perpetuel Automatique, No.041, Ref: 25686PT, Circa 1992', medium: null, artist: 'audemars-piguet' }), 'platinum');
  assert.equal(coarseWatchMaterial({ title: 'Aquanaut, Ref: 5165A, Purchased 30 January 2008', medium: null, artist: 'patek-philippe' }), 'steel');
});

test('glued catalogue text, whole loose tokens, Swiss thousands marks', () => {
  assert.equal(readWatchReference('ref 6032pink gold chronograph wristwatch circa 1961', 'rolex'), '6032');
  assert.equal(readWatchReference('submariner, ref 5513stainless steel wristwatch with braceletcirca 1984', 'rolex'), '5513');
  assert.equal(readWatchReference('ref 2499possibly unique and highly important', 'patek-philippe'), '2499');
  assert.equal(readWatchReference('nautilus, ref 5711plimited edition platinum and diamond-set wristwatch', 'patek-philippe'), '5711');
  assert.equal(readWatchReference('Ref: 55229B10, c. 1980s', 'cartier'), '55229b10');               // was truncated to 55229b
  assert.equal(readWatchReference("A LADY'S 18K WHITE GOLD WRISTWATCH SIGNED AUDEMARS PIGUET, REF. 66'714BC/", 'audemars-piguet'), '66714');
  assert.equal(readWatchReference('Rolex GMT-Master Ref. 1675 a fine example', 'rolex'), '1675');  // not "1675a"
});

test('2-digit Patek refs are references, not the model line', () => {
  assert.equal(readWatchKey('Calatrava, Ref: 96, Circa 1960', 'patek-philippe')?.key, '96');
  assert.equal(readWatchKey('a gold wristwatch circa 1940 ref 96j calatrava mvt 920055', 'patek-philippe')?.key, '96');
  // a 2-digit "ref" on a Rolex is not a Rolex reference: the model line stays
  assert.equal(readWatchKey('Rolex Submariner Ref: 14, steel', 'rolex')?.key, 'submariner');
});

test('description fallback: labelled refs only, watches only', () => {
  assert.equal(readDescriptionReference("Rolex. A 14k gold self-winding wristwatch with curved shoulders Oyster Perpetual, Ref.6092, so called 'Bombay', circa 1952", 'rolex'), '6092');
  assert.equal(readDescriptionReference('signed Patek Philippe, Geneve, No.1616249, recent with quartz movement', 'patek-philippe'), null);
  const lots = [
    { ...W('patek-philippe', 'PATEK PHILIPPE GOLD BRACELET WATCH'), formKey: 'wristwatch', description: 'PATEK PHILIPPE GOLD BRACELET WATCH signed Patek Philippe & Co., Geneve, ref. 2591, no. 780491, c. 1956', reference: null },
    { ...W('patek-philippe', '2007'), formKey: 'unknown', description: 'limited edition patek philippe lithograph depicting a ref.5098p 2007', reference: null },
  ];
  enrichWatchReferences(lots);
  assert.deepEqual(lots.map(l => l.reference), ['2591', null]);
});

test('ONE material reader: steel-and-gold is two-tone, a two-tone DIAL is not', () => {
  const m = (title: string, artist?: string) => watchMaterialCoarse({ title, medium: null, artist });
  assert.equal(m("'ZENITH' DAYTONA, REF 16523 STAINLESS STEEL AND YELLOW GOLD CHRONOGRAPH WRISTWATCH"), 'two-tone');
  assert.equal(m('Patek Philippe. A Rare 18k Gold Chronograph Wristwatch with Two-Tone Dial'), 'gold');
  assert.equal(m('a stainless steel wristwatch with tropical two-tone sector dial, circa 1940'), 'steel');
  assert.equal(m("Cartier: A 1920's gold Santos wristwatch , the white dial with Roman numerals and blued steel moon hands"), 'gold');
  assert.equal(m('a yellow gold concealed dial bracelet watch, circa 1970s'), 'gold');
  assert.equal(m('Omega. Montre bracelet en acier mouvement mécanique Ref: 131.019, Circa 1960'), 'steel');
  // identity and comps read the same
  const t = { title: 'Rolex Submariner Ref 16613 yellow gold and stainless steel', medium: null };
  assert.equal(watchMaterialCoarse(t), coarseWatchMaterial(t));
  // the exact-identity key is the core reference
  assert.equal(numericWatchRef({ artist: 'patek-philippe', reference: '5970' }), 'patek-philippe|5970');
});

/* ── Oct 6 2026 categorization re-audit (class 7): real audit titles ── */
test('Omega: whole dotted refs, undotted labelled refs, no four-group cut', () => {
  assert.equal(readWatchKey("OMEGA. A RARE 18K GOLD LIMITED EDITION CHRONOGRAPH WRISTWATCH WITH BOX, MADE TO COMMEMORATE THE 50TH ANNIVERSARY, SIGNED OMEGA, SPEEDMASTER PROFESSIONAL, LIMITED EDITION 111/999, REF. 145.00.52, CASE NO. 48’305’719, MANUFACTURED IN 1992", 'omega')?.key, '145.00.52');
  assert.equal(readWatchKey('Reference 310.20.42.50.01.001 Speedmaster 50th Anniversary A limited edition stainless steel chronograph wristwatch, Circa 2019', 'omega')?.key, '310.20.42.50.01.001');
  // printed without dots: used to fall to the model name 'speedmaster'
  assert.equal(readWatchKey("OMEGA. A STAINLESS STEEL CHRONOGRAPH WRISTWATCH WITH BRACELET SIGNED OMEGA, SPEEDMASTER PROFESSIONAL, REF. ST 145022, MOVEMENT NO. 48'239'202, CIRCA 1", 'omega')?.key, '145.022');
  assert.equal(readWatchKey("OMEGA. A FINE AND ATTRACTIVE 18K WHITE GOLD AND DIAMOND-SET AUTOMATIC 5-COUNTER CHRONOGRAPH WRISTWATCH WITH DATE SIGNED OMEGA SPEEDMASTER, OLYMPIC GAMES COLLECTION MODEL, REF. 32158445251001, CASE NO. 4, 84'892'686, CIRCA 2012", 'omega')?.key, '321.58.44.52.51.001');
  assert.equal(readWatchKey('Constellation, Ref: ST168019, Purchased 24th December 1969', 'omega')?.key, '168.019');
  assert.equal(readWatchReference('omega | seamaster aqua terra, ref 25195100 limited edition stainless steel wristwatch with date and bracelet circa 2005', 'omega'), '2519');
  // non-Omega makers never read the undotted form
  assert.equal(readWatchKey('Rolex Ref. 116500 Daytona', 'rolex')?.key, '116500');
});

test('the typographic fraction slash (U+2044) is a slash, and "Ref. #" is a label', () => {
  assert.equal(readWatchKey('PATEK PHILIPPE. A HIGHLY IMPRESSIVE PLATINUM AUTOMATIC WRISTWATCH WITH BAGUETTE DIAMOND-SET BEZEL SIGNED PATEK PHILIPPE, GENEVE, REF. 5711⁄110P-001, CIRCA 2019', 'patek-philippe')?.key, '5711/110');
  assert.equal(readWatchKey("PATEK PHILIPPE. AN 18K WHITE GOLD BRACELET WATCH WITH ONYX DIAL REF. 4429⁄1, MOVEMENT NO. 1'394'576, CASE NO. 2'777'624, CIRCA 1981", 'patek-philippe')?.key, '4429/1');
  assert.equal(readWatchReference('A Patek Philippe, Geneve "Ellipse" gold and diamond integral bracelet wristwatch, reference #3545/5,', 'patek-philippe'), '3545/5');
});

test('enrichWatchReferences: a model NAME is not a reference — it moves to modelKey and the field is absent', () => {
  const lots: any[] = [
    { ...W('rolex', "A 'Submariner' wristwatch,"), reference: 'submariner' },
    { ...W('cartier', "CARTIER. A LADY'S 18K GOLD AND DIAMOND-SET OVAL WRISTWATCH SIGNED CARTIER, MODEL BAIGNOIRE, CASE NO. 805791"), reference: 'baignoire' },
    { ...W('omega', "Omega: An 18ct gold gentleman's Seamaster wristwatch") },
    { ...W('omega', 'Reference 310.20.42.50.01.001 Speedmaster 50th Anniversary'), reference: '310.20.42.50' },
    { ...W('patek-philippe', 'Case No. 236087, Movement No. 122624, Circa 1900s'), reference: null },
  ];
  enrichWatchReferences(lots);
  assert.deepEqual(lots.map(l => l.reference), [undefined, undefined, undefined, '310.20.42.50.01.001', null]);
  assert.ok(!('reference' in lots[0]) && !('reference' in lots[2]));
  assert.deepEqual(lots.slice(0, 3).map(l => l.modelKey), ['submariner', 'baignoire', 'seamaster']);
  // the comp key still reads the model line from the title (absent field → watchKey fallback)
  assert.equal(watchKey(lots[0]), 'submariner');
  // idempotent
  enrichWatchReferences(lots);
  assert.deepEqual(lots.map(l => l.reference), [undefined, undefined, undefined, '310.20.42.50.01.001', null]);
});
