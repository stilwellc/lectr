/**
 * Pricing fix wave 2 (Oct 6 2026) — comp purity + hard comp boundaries
 * (app/lib/comp-purity.ts), on shapes from the hand-judged live comp sample.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIdentityLessTitle, isBareNameTitle, mediumConflict, compPurityFault, designatorConflict, designatorsOf,
  autographMaterialOf, subjectConflict, compBoundaryFault, type PurityLot,
} from '../../app/lib/comp-purity';

const rr = (title: string, o: Partial<PurityLot> = {}): PurityLot => ({ artist: 'entertainment-memorabilia', category: 'object', title, ...o });
const art = (artist: string, title: string, o: Partial<PurityLot> = {}): PurityLot => ({ artist, category: 'print', formKey: 'print', title, ...o });

test('identity-less titles: bare names, bracketed series, genre-only art, maker-only', () => {
  for (const t of ['J. Edgar Hoover', 'Sonny and Cher', 'Pope Pius XI', 'Supreme Court: Rehnquist, William', 'Grateful Dead: Jerry Garcia', 'Nicholas II']) {
    assert.ok(isBareNameTitle(t), t);
    assert.ok(isIdentityLessTitle(rr(t)), t);
  }
  assert.ok(isIdentityLessTitle(rr('[Apollo 11]')));
  for (const t of ['Sonny and Cher Signed Album - Super Stars Super Hits No. 2', 'Harry S. Truman Typed Letter Signed', 'Apollo 11: Red-numbered NASA photo of Apollo 11', 'Roy Orbison Album']) {
    assert.ok(!isIdentityLessTitle(rr(t)), t);
  }
  assert.ok(isIdentityLessTitle(art('pablo-picasso', 'Pablo Picasso (1881-1973) Nature morte')));
  assert.ok(isIdentityLessTitle(art('pablo-picasso', 'Tête')));
  assert.ok(!isIdentityLessTitle(art('pablo-picasso', 'Nature morte au gruyère')));
  assert.ok(!isIdentityLessTitle(art('pablo-picasso', 'Visage No. 101')));
  assert.ok(isIdentityLessTitle(art('andy-warhol', 'Andy Warhol (1928-1987)')));
  // an art title that is a name is a work, not a bare name ("Marilyn")
  assert.ok(!isIdentityLessTitle(art('andy-warhol', 'Marilyn')));
});

test('medium family + edition class conflicts (art/design only); same family never splits', () => {
  const etching = art('pablo-picasso', 'Femme torero II', { mediumCanon: 'etching' });
  assert.equal(mediumConflict(etching, art('pablo-picasso', 'Femme torero II', { mediumCanon: 'aquatint' })), null, 'intaglio family');
  assert.equal(mediumConflict(etching, art('pablo-picasso', 'Femme torero II', { mediumCanon: 'oil' })), 'medium');
  // Christie's prints the medium at the head of the description, the title in the medium field
  assert.equal(mediumConflict(etching, art('pablo-picasso', 'Femme Torero II', { medium: 'Femme Torero II', description: 'PABLO PICASSO Femme Torero II etching, 1934, on Montval paper' })), null);
  const print = art('andy-warhol', 'Self-Portrait', { medium: 'screenprint in colors, edition of 250' });
  const canvas = art('andy-warhol', 'Self-Portrait', { medium: 'synthetic polymer and silkscreen ink on canvas' });
  assert.ok(mediumConflict(print, canvas) != null);
  assert.equal(mediumConflict(rr('A letter', { mediumCanon: 'ink' }), rr('A photo', { mediumCanon: 'photograph' })), null, 'memorabilia: no medium rule');
  assert.equal(compPurityFault(rr('Harry S. Truman Typed Letter Signed'), rr('J. Edgar Hoover')), 'identity-less');
});

test('designators: same word, different numeral → conflict; years, counts, sizes, serials never designate', () => {
  assert.ok(designatorConflict('Apollo 13 Mission Report', 'Apollo 10 Mission Report'));
  assert.ok(designatorConflict('Apollo 11 (3) Original Red-Numbered NASA Photographs', "Apollo 1 Signed Photograph - Rare 'Type 1' Red-Numbered NASA Photo"));
  assert.ok(designatorConflict('Femme torero. II, from La Suite Vollard', 'Femme Torero, III (from La Suite Vollard)'));
  assert.ok(designatorConflict('Nicholas I Handwritten Letter', 'Nicholas II'));
  assert.ok(designatorConflict('STS-51-L Unflown Gold Robbins Medallion', 'STS-1 Unflown Robbins Medallion'));
  assert.ok(!designatorConflict('Femme torero. II, from La Suite Vollard', 'PABLO PICASSO (1881-1973) Femme Torero II, from La Suite Vollard'));
  assert.ok(!designatorConflict('Apollo 11 (3) Original Photographs', 'Apollo 11 (2) Original Photographs'), 'counts');
  assert.ok(!designatorConflict('Moon 1969 photograph', 'Moon 1972 photograph'), 'years');
  assert.ok(!designatorConflict('Print 36.8 x 26 cm', 'Print 40 x 30 cm'), 'sizes');
  assert.ok(!designatorConflict('Nelson Mandela Signed Booklet - I Am Prepared to Die', 'Nelson Mandela Booklet'), 'a pronoun is no numeral');
  assert.equal(designatorsOf('Visage No. 101').get('visage'), '101');
});

test('autograph material: signed / handwritten / abbreviations; explicit unsigned', () => {
  assert.equal(autographMaterialOf('Charles Lindbergh Signed Photograph'), true);
  assert.equal(autographMaterialOf('Nicholas I Handwritten Letter'), true);
  assert.equal(autographMaterialOf('Lincoln ALS to Seward'), true);
  assert.equal(autographMaterialOf('Charles Lindbergh (2) Original Vintage Photographs'), false);
  assert.equal(autographMaterialOf('Unsigned proof photograph'), false);
  assert.equal(autographMaterialOf(''), null);
});

test('subject: the target names a person the comp never names', () => {
  const pope = rr('Pope Clement XI Letter Signed', { entity: 'Pope Clement XI' });
  assert.ok(subjectConflict(pope, rr('Pope Pius XI Autograph Letter', { entity: 'Pope Pius XI' })));
  assert.ok(subjectConflict(pope, rr('Pope Pius XI')));
  assert.ok(!subjectConflict(pope, rr('Pope Clement XI Document Signed')));
  const floyd = rr('William Floyd Document Signed', { entity: 'William Floyd' });
  assert.ok(subjectConflict(floyd, rr('Pink Floyd Signed Album', { entity: 'Pink Floyd' })));
  assert.ok(!subjectConflict(rr('Robert H. Goddard Signature', { entity: 'Robert H. Goddard' }), rr('Robert H. Goddard Typed Letter Signed')));
  assert.ok(!subjectConflict(rr('Michael Jordan Game-Worn Jersey', { playerSlug: 'michael-jordan' }), rr('Michael Jordan Chicago Bulls Jersey', { entity: 'Michael Jordan Chicago' })));
  assert.ok(!subjectConflict(rr('Apollo 15 Crew-Signed Cover'), rr('Apollo 15 Cover')), 'no person on the target → no claim');
});

test('hard boundaries: signed vs unsigned, object class, designator; abstain without evidence', () => {
  const lind = rr('Charles Lindbergh (2) Original Vintage Photographs');
  assert.equal(compBoundaryFault(lind, rr('Charles Lindbergh Signed Photograph')), 'signed');
  assert.equal(compBoundaryFault(rr('1996 Atlanta Olympics Type 6 Torch'), rr('1996 Atlanta Olympics Participation Medal')), 'object');
  assert.equal(compBoundaryFault(rr('Apollo 13 Mission Report'), rr('Apollo 10 Mission Report')), 'designator');
  assert.equal(compBoundaryFault(rr('Apollo 14 Flown Heatshield Desk Set'), rr('Apollo 14 Flown Heatshield Slice in Lucite')), null);
  // art: designators gate, the memorabilia rules do not apply
  assert.equal(compBoundaryFault(art('andy-warhol', "Beef, from Campbell's Soup I"), art('andy-warhol', "Tomato, from Campbell's Soup II")), 'designator');
  assert.equal(compBoundaryFault(art('andy-warhol', 'Marilyn (signed)'), art('andy-warhol', 'Marilyn')), null);
  // watches: a reference is its own identity tier — never a designator conflict
  assert.equal(compBoundaryFault({ artist: 'rolex', title: 'Submariner Ref 5513' }, { artist: 'rolex', title: 'Submariner Ref 5512' }), null);
});
