/**
 * In-category facets (app/lib/facets): card kind + era read from the title,
 * the entertainment domain from the taxonomy, era/graded-raw exclusivity, and
 * chips that cut nothing are dropped. Labels wave (Oct 9): grader + grade
 * behind 'Graded', Signed across categories, TCG language, Single items,
 * Flown, entertainment franchises behind their domain, watch complications,
 * Fine Art medium, and the lot-card badges.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotFacets, passesFacets, toggleFacet, facetChips, facetCatOf, facetsFor, cardBadgesOf, multiCountOf, isSignedTitle, FACET_LABEL } from '../facets';
import { passesTriage, TRIAGE_DEFAULTS, triageFromParams, triageToParams, patchTriage } from '../feed-filters';

const card = (title: string, sub = 'cards') => ({ artist: 'sports-cards', subCat: sub, drill: 'baseball', title });

test('card facets from the title', () => {
  const f = lotFacets(card('2018 Topps Chrome Update #HMT1 Shohei Ohtani Rookie Card Signed (#12/25) - PSA GEM MT 10'));
  for (const k of ['graded', 'rookie', 'numbered', 'era-modern']) assert.ok(f.has(k), k);
  assert.ok(!f.has('raw'));
  const pre = lotFacets(card('1909-11 T206 White Border Honus Wagner'));
  assert.ok(pre.has('raw') && pre.has('era-prewar'));
  assert.ok(lotFacets(card('2026 Topps Pristine Popular Demand Autograph Relic Orange #PDAR-SO Shohei Ohtani Signed Game-Used Relic Card (#05/25) - Topps Encased')).has('relic'));
});

test('a sealed box is not a rookie, and has no graded/raw', () => {
  const f = lotFacets({ artist: 'unopened-wax', subCat: 'wax', drill: 'baseball', title: '2018 Topps Chrome Baseball Factory-Sealed Hobby Jumbo Box (12 Packs) - Possible Shohei Ohtani Rookie Cards' });
  assert.ok(!f.has('rookie') && !f.has('raw') && !f.has('graded'));
  assert.ok(f.has('era-modern'));
});

test('entertainment domain facet', () => {
  assert.ok(lotFacets({ artist: 'entertainment-memorabilia', subCat: 'props', drill: 'hollywood', title: 'x' }).has('film-tv'));
  assert.ok(lotFacets({ artist: 'music-memorabilia', subCat: 'instruments', title: 'y' }).has('music'));
});

test('toggle: eras OR together, graded xor raw, kinds AND', () => {
  // Oct 9: one any-of set (era, grade, complication…) multi-selects and ORs
  assert.deepEqual(toggleFacet(['era-prewar', 'rookie'], 'era-modern'), ['era-prewar', 'rookie', 'era-modern']);
  assert.ok(passesFacets(card('2018 Topps Chrome #1 Ohtani Rookie - PSA 10'), ['era-prewar', 'era-modern']));
  assert.ok(!passesFacets(card('2018 Topps Chrome #1 Ohtani Rookie - PSA 10'), ['era-prewar', 'era-vintage']));
  assert.ok(passesFacets(card('2018 Topps Chrome #1 Ohtani Rookie - PSA 10'), ['graded', 'psa', 'g9', 'g10']));
  assert.ok(!passesFacets(card('2018 Topps Chrome #1 Ohtani Rookie - PSA 10'), ['graded', 'psa', 'g9', 'g95']));
  assert.deepEqual(toggleFacet(['graded'], 'raw'), ['raw']);
  assert.deepEqual(toggleFacet(['graded', 'rookie'], 'rookie'), ['graded']);
  assert.ok(passesFacets(card('2018 Topps Chrome #1 Ohtani Rookie - PSA 10'), ['graded', 'rookie']));
  assert.ok(!passesFacets(card('2018 Topps Chrome #1 Ohtani Rookie - PSA 10'), ['raw']));
});

test('chips: categories without facets, all-or-nothing chips dropped', () => {
  assert.equal(facetCatOf(null, [{ artist: 'charles-eames', subCat: 'seating' }]), null);
  assert.equal(facetCatOf(null, [card('a'), card('b')]), 'sports-cards');
  const pool = [card('2018 Topps #1 A Rookie - PSA 10'), card('2019 Topps #2 B - PSA 9')];
  const keys = facetChips('sports-cards', pool, []).map(c => c.key);
  assert.ok(keys.includes('rookie'), 'splits the pool');
  assert.ok(!keys.includes('graded'), 'every lot graded → cuts nothing');
  assert.ok(!keys.includes('era-prewar'), 'matches nothing');
});

test('triage: fx filters, round-trips the URL, clears on a category change', () => {
  const f: typeof TRIAGE_DEFAULTS = { ...TRIAGE_DEFAULTS, cat: 'sports-cards', fx: ['rookie'] };
  assert.ok(passesTriage(card('2018 Topps #1 A Rookie - PSA 10'), f));
  assert.ok(!passesTriage(card('2019 Topps #2 B - PSA 9'), f));
  const p = new URLSearchParams(); triageToParams(f, p);
  assert.equal(p.get('fx'), 'rookie');
  assert.deepEqual(triageFromParams(p).fx, ['rookie']);
  assert.deepEqual(patchTriage(f, { cat: 'tcg' }).fx, []);
  assert.deepEqual(patchTriage(f, { win: 'today' }).fx, ['rookie']);
});

test('a picked domain keeps its sibling offered', () => {
  const pool = [
    { artist: 'entertainment-memorabilia', subCat: 'props', drill: 'hollywood', title: 'a' },
    { artist: 'music-memorabilia', subCat: 'instruments', title: 'b' },
    { artist: 'entertainment-memorabilia', subCat: 'other', title: 'c' },
  ];
  assert.deepEqual(facetChips('entertainment', pool, ['film-tv']).map(c => c.key), ['film-tv', 'music']);
  assert.deepEqual(toggleFacet(['film-tv'], 'music'), ['music']);
});

const tcg = (title: string, sub = 'vintage') => ({ artist: 'pokemon', subCat: '', drill: sub, title });
const space = (title: string, flown?: boolean) => ({ artist: 'space-exploration', subCat: 'space', drill: 'apollo', title, flown });
const hist = (title: string) => ({ artist: 'entertainment-memorabilia', subCat: 'documents', drill: 'political', title });
const ent = (title: string, drill = 'hollywood') => ({ artist: 'entertainment-memorabilia', subCat: 'props', drill, title });

test('grader + grade bucket from the slab', () => {
  const f = lotFacets(card('1994 Flair #340 Alex Rodriguez Rookie PSA GEM MINT 10'));
  for (const k of ['graded', 'psa', 'g10']) assert.ok(f.has(k), k);
  assert.ok(lotFacets(card('99 Fleer E-X Century #6 Grant Hill (#29/85) - BGS GEM MINT 9.5')).has('g95'));
  assert.ok(lotFacets(card('1962 Topps #387 Lou Brock Rookie SGC VG+ 3.5')).has('g6'));
  assert.ok(lotFacets(card('1961 Topps #247 Billy Goodman PSA NM-MT 8')).has('g7'));
  const a = lotFacets(card('1909-1911 T206 White Border George Manion Southern Leaguer SGC Authentic'));
  assert.ok(a.has('sgc') && a.has('gauth'));
  const t = lotFacets(tcg('1997 Pokemon Japanese Rocket Gang #135 Dark Jolteon - TAG GEM MINT 10'));
  for (const k of ['graded', 'tag', 'g10', 'lang-ja']) assert.ok(t.has(k), k);
});

test('grader chips only after Graded, grade chips only after a grader', () => {
  const top = facetsFor('sports-cards').map(d => d.key);
  assert.ok(!top.includes('psa') && !top.includes('g10'));
  const g = facetsFor('sports-cards', ['graded']).map(d => d.key);
  assert.ok(g.includes('psa') && g.includes('sgc') && !g.includes('g10'));
  const p = facetsFor('sports-cards', ['graded', 'psa']).map(d => d.key);
  assert.ok(p.includes('g10') && p.includes('g9'));
  assert.ok(!p.includes('sgc'), 'a picked grader steps its siblings aside');
  // children sit right after their parent, before the other kinds
  assert.deepEqual(p.slice(0, 4), ['graded', 'raw', 'psa', 'g10']);
  // a shared link carrying a child keeps its chip on screen
  assert.ok(facetsFor('sports-cards', ['g10']).some(d => d.key === 'g10'));
});

test('toggle: Raw / un-picking Graded / switching grader clears the children', () => {
  assert.deepEqual(toggleFacet(['graded', 'psa', 'g10', 'rookie'], 'raw'), ['rookie', 'raw']);
  assert.deepEqual(toggleFacet(['graded', 'psa', 'g10'], 'graded'), []);
  assert.deepEqual(toggleFacet(['graded', 'psa', 'g10'], 'psa'), ['graded']);
  assert.deepEqual(toggleFacet(['graded', 'psa', 'g10'], 'g9'), ['graded', 'psa', 'g10', 'g9']);
  assert.deepEqual(toggleFacet(['graded', 'psa'], 'bgs'), ['graded', 'bgs']);
  assert.deepEqual(toggleFacet(['film-tv', 'fr-starwars'], 'music'), ['music']);
});

test('Signed: one key across categories, words not products', () => {
  assert.ok(lotFacets(hist('Andrew Jackson Document Signed as President, Appointing a Major by Brevet')).has('auto'));
  assert.ok(lotFacets(space('Alan Shepard Autograph Letter Signed')).has('auto'));
  assert.ok(lotFacets(ent('Beatles Signatures', 'music')).has('auto'));
  assert.ok(lotFacets(card('2019 Topps #700 Vladimir Guerrero Jr. Signed Rookie Card - PSA GEM MT 10')).has('auto'));
  assert.ok(!isSignedTitle('Gibson Les Paul Signature Model Guitar'));
  assert.ok(!isSignedTitle('Neil Armstrong Facsimile Signed Photograph'));
  assert.ok(!isSignedTitle('Richard Nixon 1968 Campaign Headquarters Sign'));
  assert.ok(isSignedTitle('Eric Clapton Signed Signature Model Stratocaster'));
  assert.equal(FACET_LABEL.auto, 'Signed');
});

test('multi-item lots: counts, words, and the shapes that are one object', () => {
  assert.equal(multiCountOf('Apollo 8 (4) Original Red-Numbered NASA Photographs'), 4);
  assert.equal(multiCountOf('Lot of 12 Press Photos'), 12);
  assert.equal(multiCountOf('Widespread Panic All-Access Pass & Tour Credentials Pair'), 2);
  assert.equal(multiCountOf('Production-Made Wand from Fantastic Beasts (2016) - 14 in'), null, 'a year is not a count');
  assert.equal(multiCountOf('1973 Oakland Athletics Team-Signed Baseball (31 Signatures)'), null);
  assert.equal(multiCountOf('Apollo Astronauts (11) Signed Cover with Bean, Mitchell'), null);
  assert.equal(multiCountOf('Jerry West Multi-Signed (3), Multi-Inscribed Lakers Jersey'), null);
  assert.equal(multiCountOf('Mario Lemieux Game-Used Jersey - Matched to (4) Games'), null);
  assert.ok(lotFacets(space('Apollo 11 Set of (11) Original Red-Numbered NASA Photographs')).has('multi'));
  assert.ok(lotFacets(space('Neil Armstrong Signed Photograph')).has('single'));
});

test('Flown: the stamped flag or the title, never unflown', () => {
  assert.ok(lotFacets(space('Apollo 14 Flown Handkerchief')).has('flown'));
  assert.ok(lotFacets(space('Skylab 3 Cassette Tape [Attested Flown by Amy Bean]')).has('flown'));
  assert.ok(lotFacets(space('Robbins Medallion', true)).has('flown'));
  assert.ok(!lotFacets(space('STS-8 Unflown Robbins Medallion')).has('flown'));
  assert.ok(!lotFacets(hist('Lindbergh Flown Cover')).has('flown'), 'space only');
});

test('TCG language: named, else English; memorabilia has none', () => {
  assert.ok(lotFacets(tcg('2000 Pokemon Chinese Base Set #30 Ivysaur - PSA MINT 9')).has('lang-zh'));
  assert.ok(lotFacets(tcg('1999 Pokemon Base Set Holo #6 Gyarados - PSA GEM MT 10')).has('lang-en'));
  const chips = facetChips('tcg', [tcg('a Japanese #1 - PSA 10'), tcg('b #2 - PSA 9'), tcg('c Korean #3 - PSA 8')], []).map(c => c.key);
  assert.ok(chips.includes('lang-ja') && chips.includes('lang-en') && !chips.includes('lang-zh'));
});

test('franchise chips appear under their domain; a franchise names a missing domain', () => {
  assert.ok(!facetsFor('entertainment').some(d => d.key === 'fr-starwars'));
  const film = facetsFor('entertainment', ['film-tv']).map(d => d.key);
  assert.ok(film.includes('fr-starwars') && film.includes('fr-disney') && !film.includes('fr-beatles'));
  const f = lotFacets({ artist: 'entertainment-memorabilia', subCat: 'other', drill: '', title: 'Beatles: Ringo Starr Signed Photograph' });
  assert.ok(f.has('fr-beatles') && f.has('music') && f.has('auto'));
  assert.ok(!lotFacets(ent('Harrison Ford Signed Photograph')).has('fr-beatles'));
});

test('watch complications and Fine Art medium', () => {
  const w = lotFacets({ artist: 'patek-philippe', subCat: 'wristwatches', title: 'A yellow gold perpetual calendar chronograph wristwatch with moonphases' });
  for (const k of ['cx-perpetual', 'cx-chrono', 'cx-moon']) assert.ok(w.has(k), k);
  assert.ok(lotFacets({ artist: 'henri-matisse', subCat: 'originals', formKey: 'work-on-paper', title: 'Rouge et or' }).has('on-paper'));
  assert.ok(lotFacets({ artist: 'francis-bacon', subCat: 'originals', formKey: 'painting', title: 'Study for a Figure' }).has('painting'));
  assert.ok(!lotFacets({ artist: 'andy-warhol', subCat: 'prints', formKey: 'print', title: 'Marilyn' }).has('painting'));
});

test('the strip stays short: top-level chip counts per category', () => {
  assert.equal(facetsFor('space-science').length, 3);
  assert.equal(facetsFor('historical').length, 2);
  assert.equal(facetsFor('entertainment').length, 4);
  assert.equal(facetsFor('tcg').length, 5);
  assert.equal(facetsFor('sports-cards').length, 10);
});

test('cardBadgesOf: max two, most informative first, facet vocabulary', () => {
  assert.deepEqual(cardBadgesOf(card('2019 Topps #700 Vladimir Guerrero Jr. Rookie Card - PSA GEM MT 10')), ['PSA 10', 'Rookie']);
  assert.deepEqual(cardBadgesOf(card('86 Star #117 Michael Jordan - BGS GEM MINT 9.5')), ['BGS 9.5']);
  assert.deepEqual(cardBadgesOf(card('1909-1911 T206 White Border George Manion Southern Leaguer SGC Authentic')), ['SGC Authentic']);
  assert.deepEqual(cardBadgesOf(card('2019 Topps #700 Vladimir Guerrero Jr. Signed Rookie Card')), ['Rookie', 'Signed']);
  assert.deepEqual(cardBadgesOf(tcg('1997 Pokemon Japanese Rocket Gang #135 Dark Jolteon - TAG GEM MINT 10')), ['TAG 10', 'Japanese']);
  assert.deepEqual(cardBadgesOf(space('Apollo 17 Flown Flag with Letter Signed by Ron Evans')), ['Signed', 'Flown']);
  assert.deepEqual(cardBadgesOf(space('Apollo 8 (4) Original Red-Numbered NASA Photographs')), ['Lot of 4']);
  assert.deepEqual(cardBadgesOf(ent('Michael Jackson Signed Photograph - 11 x 14', 'music')), ['Signed', 'Michael Jackson']);
  assert.deepEqual(cardBadgesOf({ artist: 'patek-philippe', subCat: 'wristwatches', title: 'A steel world time chronograph wristwatch' }), ['Chronograph', 'GMT']);
  assert.deepEqual(cardBadgesOf({ artist: 'unopened-wax', subCat: 'wax', drill: 'baseball', title: '2018 Topps Chrome Hobby Box - Possible Ohtani Rookie Cards' }), []);
  assert.deepEqual(cardBadgesOf({ artist: 'andy-warhol', subCat: 'prints', title: 'Marilyn' }), []);
});
