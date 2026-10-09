/**
 * Oct 9 2026: an edition serial "(#58/200)" numbers a print run, not a card —
 * it filed ~2k Goldin jerseys, posters, photos and cels under sports cards.
 * Real titles from the live book + the Goldin segment scan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goldinSportKind } from '../lib/classify';

test('edition-serial objects leave sports cards', () => {
  assert.equal(goldinSportKind('Shohei Ohtani Signed 2023 American League All-Star Game Jersey (#12/23) - Fanatics'), 'autographs');
  assert.equal(goldinSportKind('Willie Mays Signed Lithograph LE (#969/1000) - Beckett LOA'), 'autographs');
  assert.equal(goldinSportKind('Jack Nicklaus Framed 1963 Masters Tournament Photo (#170/2071) - 16 x 17.5'), 'type-1-photos');
  assert.equal(goldinSportKind('Tiger Woods PGA Tournament-Worn, Signed Nike Golf Polo Shirt (#1/1) - UDA COA (2008), Beckett LOA'), 'game-used');
});

test('pop pieces in the Sport book go to culture, sports objects stay sports', () => {
  assert.equal(goldinSportKind('1987 Looney Tunes Signed Animation Cel Road Runner Signed by Artist Chuck Jones (#58/200) - 15.25 x 17.25 - Grad Authentication Digital LOA'), 'entertainment-memorabilia');
  assert.equal(goldinSportKind('Pearl Jam Chicago Green Artist Proof Variant Poster (#8/300) - 18 x 24'), 'entertainment-memorabilia');
  assert.notEqual(goldinSportKind('2010 Atlantic Coast Conference Championship Watch With Original Box'), 'entertainment-memorabilia');
  assert.notEqual(goldinSportKind('Manu Ginobli Signed Nike Zoom Touch Sneakers - Beckett LOA (2)'), 'entertainment-memorabilia');
});

test('serial-numbered CARDS stay cards', () => {
  for (const t of [
    '2020 Panini National Treasures Purple #48 Patrick Mahomes II (#15/50) - Jersey Number – SGC MT 9',
    '16 Panini Select Red Jersey-Orange Prizm #36 Cristiano Ronaldo (#021/149) – SGC MT+ 9.5',
    '1995 Classic 5 Sport Autograph 225 Barry Bonds Signed Card (#136/225) - PSA Authentic, PSA/DNA GEM MT 10',
    '2026 Topps Pristine Popular Demand Autograph Relic Orange #PDAR-SO Shohei Ohtani Signed Game-Used Relic Card (#05/25) - Topps Encased',
    '2022 SportKings Volume 3 Icons Cut Signature #ICON-29 Jackie Robinson Signed Card - PSA NM-MT 8',
  ]) assert.equal(goldinSportKind(t), 'sports-cards', t);
});

test('a card-used PHOTO is still a photo', () => {
  assert.notEqual(goldinSportKind('1947 Brooklyn Dodgers Picture Pack Jackie Robinson - Rookie Card-Used Photo and Highest Graded Example - PSA MINT 9, Pop 1'), 'sports-cards');
  assert.notEqual(goldinSportKind('1965 Muhammad Ali/Sonny Liston Type II Photo by Neil Leifer - Possibly Finest PSA-Certified Example of #1 Most Iconic Sports Photo'), 'sports-cards');
});
