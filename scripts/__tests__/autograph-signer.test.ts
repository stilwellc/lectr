/**
 * Autograph signer parser v3 (scripts/lib/autograph-signer.ts): "Topic:
 * Person" titles, regnal numerals, name-titles. Titles are real RR Auction
 * corpus titles (Oct 5 2026; judged samples in the identity fix wave).
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { parseSignerName, extractSignerSlug, SIGNER_PARSER_VERSION } from '../lib/autograph-signer';
import { recoverAutographSigners } from '../lib/corpus-normalize';

const slug = (title: string) => extractSignerSlug({ title });

test('Topic: Person — the signer is the person after the colon', () => {
  assert.equal(slug('Enola Gay: Paul Tibbets Signed Photograph'), 'paul-tibbets');
  assert.equal(slug('Horse Racing: Ron Turcotte Signed Photograph'), 'ron-turcotte');
  assert.equal(slug('Horse Racing: Turcotte, Ron Signed Photograph'), 'ron-turcotte');
  assert.equal(slug('Supreme Court: Benjamin Cardozo Handwritten Letter Signed'), 'benjamin-cardozo');
  assert.equal(slug('Our Gang: Darla Hood: Vintage signed photo from the Our Gang days'), 'darla-hood');
  assert.equal(slug('Beatles: Ringo Starr Signed Photograph'), 'ringo-starr');
});

test('Topic: <not a person> abstains — never a topic slug', () => {
  for (const t of [
    'Enola Gay: Tibbets and Sweeney Signed Photograph',
    'Horse Racing: Triple Crown Winners Signed Photographs',
    'Horse Racing: Kentucky Derby Winners Signed Photographs',
    'Iwo Jima: Lindberg and Wells Signed Photograph',
    'NY Yankees: Mantle, Ford, Berra, and Lemon Signed Photograph',
    'Supreme Court: Burger Court Typed Letter Signed',
    'Gettysburg: Iron Brigade Document Signed',
    'Academy Award Winners Signed Photograph',
    '1987 "The New York Yankees: An Illustrated History" Multi-Signed Book with Joe DiMaggio',
  ]) assert.equal(parseSignerName({ title: t }), null, t);
});

test('Person: <description> keeps the person before the colon', () => {
  assert.equal(slug('Jack Kerouac: Crisp triple-signed check'), 'jack-kerouac');
  assert.equal(slug('Robert E. Lee: Rare and desirable Lee signed portrait, transmitted directly from his widow'), 'robert-e-lee');
  assert.equal(slug('Marilyn Monroe: Scarce, early document signed twice by the soon-to-be icon:'), 'marilyn-monroe');
  assert.equal(slug('Walt Disney: Dazzling Disney signed book display'), 'walt-disney');
  assert.equal(slug('Benedict XV: IN HIS IMAGE: Devotional photo signed by BENEDICT XV'), 'benedict-xv');
  assert.equal(slug('Harry Houdini: GREAT ESCAPE: Dramatic performance photo signed by HOUDINI'), 'harry-houdini');
});

test('regnal numerals are identity; family suffixes still fold', () => {
  assert.equal(slug('King George III Document Signed'), 'george-iii');
  assert.equal(slug('King George II Signed Document'), 'george-ii');
  assert.equal(slug('Queen Elizabeth II Signed Document'), 'elizabeth-ii');
  assert.equal(slug('Pope John Paul II Typed Letter Signed'), 'pope-john-paul-ii');
  assert.notEqual(slug('Pope John Paul I Signed Photograph'), slug('Pope John Paul II Signed Photograph'));
  assert.equal(slug('Kaiser Wilhelm II Signed Document'), 'kaiser-wilhelm-ii');
  assert.equal(slug('Davis Love III Signed Photograph'), 'davis-love');
});

test('a title word that is part of the name is kept', () => {
  assert.equal(slug('Lady Bird Johnson Signed Photograph'), 'lady-bird-johnson');
  assert.equal(slug('Lady Gaga Signed Photograph'), 'lady-gaga');
  assert.equal(slug('Sir Edmund Hillary Signed Photograph'), 'edmund-hillary');
  assert.equal(slug('Robert Fulton Partial Autograph Document Signed'), 'robert-fulton');
});

test('normalize re-stamps v2 parser stamps under v3', () => {
  assert.equal(SIGNER_PARSER_VERSION, 3);
  const rows = [
    { id: 'a', artist: 'autographs', title: 'Enola Gay: Paul Tibbets Signed Photograph', entity: 'Enola Gay', entitySrc: 'sig-p2' },
    { id: 'b', artist: 'autographs', title: 'Horse Racing: Triple Crown Winners Signed Photographs', entity: 'Horse Racing', entitySrc: 'sig-p2' },
  ] as unknown as Parameters<typeof recoverAutographSigners>[0];
  recoverAutographSigners(rows);
  assert.equal(rows[0].entity, 'Paul Tibbets');
  assert.equal(rows[0].entitySrc, 'sig-p3');
  assert.ok(!rows[1].entity);
});
