/**
 * W14 data hygiene (Oct 11 2026):
 *   · Christie's wrong-sale rows (suffix-stripped sale URLs) relabelled to the
 *     legacy sale the page really was — idempotent;
 *   · ONE print ↔ original verdict for the two art category rules
 *     (artCategoryFix + normalizeArtCategory fought over 42 published rows);
 *   · the reclass ladder runs to a fixed point (a later rule's move is no
 *     longer finished by the NEXT normalize), the original-card-art exemption
 *     is shared, and the watch description reference reads the form this pass
 *     stamps — normalize(normalize(x)) === normalize(x) on the Oct 5 corpus;
 *   · the value book pools the published rows as-is (no re-normalize);
 *   · the Christie's / Sotheby's enrichment attempt policy (scope, per-lot
 *     record, backoff, order).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../app/types';
import { repairChristiesWrongSaleRows, christiesSaleNameFromTitle, CHRISTIES_WRONG_SALES } from '../lib/christies-sale-repair';
import { christiesSaleNameOf, parseChristiesSaleSlug } from '../lib/houses/christies';
import { artMediumVerdict, artCategoryFix, reclassifyLot, sportsHousePopKind, sportsHouseCardLotKind, DROP } from '../lib/classify';
import { normalizeArtCategory, enrichWatchReferences } from '../lib/corpus-normalize';
import { buildValueBook } from '../emit-value-book';
import { enrichInScope, enrichDue, recordEnrichAttempt, selectEnrichBatch } from '../lib/houses/enrich';

// ── 1 · Christie's wrong-sale repair ──
const C = (id: string, saleName: string, saleDate: string, extra: Record<string, unknown> = {}) =>
  ({ id, auctionHouse: "Christie's", saleName, saleDate, ...extra });

test('wrong-sale: every mapping names the slug the crawler stored it under', () => {
  for (const w of CHRISTIES_WRONG_SALES) {
    assert.equal(christiesSaleNameOf(w.slug), w.wrongName, w.slug);
    // the stripped slug is the SALE-ID form — the page was sale id <num>
    const ref = parseChristiesSaleSlug(w.slug)!;
    assert.equal(ref.room, null, w.slug);
    assert.equal(ref.num, w.saleId, w.slug);
    assert.match(w.day, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('wrong-sale: rows relabelled to the legacy sale (real published rows), idempotent', () => {
  const rows = [
    C('christies-auc-5735860', 'Picasso Ceramics', '2013-11-15'), // Babbage, Fine Printed Books and Manuscripts
    C('christies-auc-5736332', 'Picasso Ceramics', '2013-11-15'),
    C('christies-auc-5764045', 'Rare Watches Including Watches For Ela', '2014-01-23'), // American silver
    C('christies-auc-5883728', 'Auction', '2015-04-14'), // Jewellery (csk 10545)
    C('christies-auc-5812197', 'Art Contemporain Vente Du Jour', '2014-06-24'), // Matisse, London Impressionist/Modern Evening
    C('christies-auc-5800980', '20th 21st Century Paris Evening Sale Including Thinking Italian', '2014-06-05'), // Cheval-Blanc 1947
    C('christies-auc-5807428', 'Art Moderne', '2014-06-11'), // a sale-local day one off the page's UTC day still matches
  ];
  const r = repairChristiesWrongSaleRows(rows);
  assert.equal(r.total, 7);
  assert.deepEqual(rows.map(x => x.saleName), [
    'Fine Printed Books And Manuscripts', 'Fine Printed Books And Manuscripts', 'Important American Silver', 'Jewellery',
    'Impressionist Modern Evening Sale', 'Finest Rarest Wines Spirits Including The Collection Of Sir Alex Ferguson Cbe',
    'South Asian Modern Contemporary Art',
  ]);
  assert.equal(repairChristiesWrongSaleRows(rows).total, 0, 'second pass matches nothing');
});

test('wrong-sale: the real sales of those names, other houses and other crawlers are untouched', () => {
  const rows = [
    C('christies-auc-6610394', '20th 21st Century Paris Evening Sale Including Thinking Italian', '2026-10-22'), // the real Paris sale
    C('christies-auc-6553798', 'Picasso Ceramics', '2013-06-17'), // a real Picasso Ceramics sale
    C('christies-auc-6486590', 'Rare Watches Including Watches For Ela', '2024-11-10'),
    C('christies-auc-5000001', 'Picasso Ceramics', '2013-11-18'), // 3 days off — not the legacy sale
    { id: 'christies-nov25-x', auctionHouse: "Christie's", saleName: 'Picasso Ceramics', saleDate: '2013-11-15' }, // not the auction crawler
    { id: 'sothebys-x', auctionHouse: "Sotheby's", saleName: 'Picasso Ceramics', saleDate: '2013-11-15' },
  ];
  const before = rows.map(x => x.saleName);
  assert.equal(repairChristiesWrongSaleRows(rows).total, 0);
  assert.deepEqual(rows.map(x => x.saleName), before);
});

test('wrong-sale: the stored saleName style is the Title-Cased slug words', () => {
  assert.equal(christiesSaleNameFromTitle('Fine Printed Books and Manuscripts'), 'Fine Printed Books And Manuscripts');
  assert.equal(christiesSaleNameFromTitle('Old Masters, 19th Century and Impressionist Art'), 'Old Masters 19th Century And Impressionist Art');
  assert.equal(christiesSaleNameFromTitle('Impressionist/Modern Evening Sale'), 'Impressionist Modern Evening Sale');
});

// ── 4 · unique medium vs print process ──
test('art verdict: a unique hand medium beats a print process word — and a dimension fraction is not an edition', () => {
  const cases: [string, string, 'original' | 'print' | null][] = [
    ['Snail Shell, 1970, gouache on paper, 29  3/8 x 43 1/8 in.', 'gouache on paper', 'original'], // Calder: "3/8" read as an edition
    ['Vavoom, 1992, ink on paper, 16.7/8  by 20.7/8  in.', 'ink on paper', 'original'], // Pettibon
    ['Unitlted (Anatomy), 1982, Oilstick on paper, 29-1/2 x 21-7/8 in.', 'Oilstick on paper', 'original'], // Basquiat
    ['Lobster (Red)', 'acrylic and silkscreen ink on canvas20 x 16 in', 'original'], // Warhol painting
    ['Heart-Shaped Candy Box (True Love)', 'synthetic polymer paint and silkscreen ink on canvas10 x 8 in', 'original'],
    ['Untitled (Marilyn)', 'silkscreen ink on paper', 'original'], // the houses' unique-screen-work language
    ["Men's Health", 'silkscreen ink', 'original'], // Eddie Martinez
    ['Baigneuse au pouf rouge', 'oil over etching Image size: 10 x 7 in', 'original'],
    ['Jodhpur IX', 'Watercolor, on wove paper, framed.', 'original'],
  ];
  for (const [t, m, want] of cases) assert.equal(artMediumVerdict(t, m), want, `${t} | ${m}`);
});

test('art verdict: print processes with no hand medium are prints — screenprints on canvas included', () => {
  const cases: [string, string, 'original' | 'print' | null][] = [
    ['Untitled (Wedding Invitation)', 'Screenprint in colors on canvas', 'print'], // Haring
    ['Portrait of Joseph Beuys', 'Screenprint in gold ink on canvas', 'print'], // the ink is the print's colour
    ['wallpaper (A Piece of My Workshop)', 'silkscreen on canvas mounted on burlap', 'print'], // Calder
    ['Cover Image (Rose) for 1¢ Life Book', 'screenprint in colors on linen cover of unbound book', 'print'],
    ['Painting on Canvas, from Paintings series', '', 'print'], // Lichtenstein — the series is the edition evidence
    ['Marilyn', 'screenprint ink on paper', 'print'], // a portfolio sheet: "screenprint ink" is unique only on canvas
    ['Colombe Volant', 'crayon Lithographie en couleurs sur vélin d\'Arches', 'print'], // "Signée au crayon" signature remnant
    ['Clown, 1989', 'aquatinte en couleurs sur papier vélin Hahnemühle Signée au crayon', 'print'],
    ['Signed print', 'lithograph, signed and numbered in pencil', 'print'],
    ['One plate, In the Bottom of My Garden', 'Offset lithograph and watercolor on wove paper', 'print'], // hand-coloured offset
    ['Still Life with Red Jar', 'screenprint in colors on Lanaquarelle Watercolor', 'print'], // a paper name
    ['Lincoln Center Ticket', 'Screenprint in colors on opaque acrylic paper', 'print'],
    ['Étreinte I', 'Linocut with rincé encre de Chine on Arches paper', 'print'],
    ['Untitled', 'acrylic and silkscreen ink on canvas, edition of 50', 'print'], // edition evidence wins
  ];
  for (const [t, m, want] of cases) assert.equal(artMediumVerdict(t, m), want, `${t} | ${m}`);
  // no medium evidence → no verdict (the older rules decide)
  assert.equal(artMediumVerdict('Watercolor Study', ''), null);
  assert.equal(artMediumVerdict('Selected Self-Published Books', 'ink'), null);
});

test('art verdict: the ladder and normalize agree, so neither moves the row back (the 42 fights)', () => {
  const rows = [
    { artist: 'alexander-calder', category: 'print', title: 'Snail Shell, 1970, gouache on paper, 29  3/8 x 43 1/8 in.', medium: 'gouache on paper' },
    { artist: 'raymond-pettibon', category: 'print', title: 'Vavoom, 1992, ink on paper, 16.7/8  by 20.7/8  in.', medium: 'ink on paper' },
    { artist: 'jean-michel-basquiat', category: 'print', title: 'Unitlted (Anatomy), 1982, Oilstick on paper, 29-1/2 x 21-7/8 in.', medium: 'Oilstick on paper' },
    { artist: 'keith-haring', category: 'print', title: 'Untitled (Wedding Invitation)', medium: 'Screenprint in colors on canvas' },
    { artist: 'keith-haring', category: 'print', title: 'Portrait of Joseph Beuys', medium: 'Screenprint in gold ink on canvas' },
    { artist: 'andy-warhol', category: 'print', title: 'Flowers', medium: 'acrylic and silkscreen ink on canvas5 x 5 in' },
  ];
  const want = ['original', 'original', 'original', 'print', 'print', 'original'];
  rows.forEach((r, i) => {
    const a = artCategoryFix(r as never);
    if (a) r.category = a;
    const quiet = console.log; console.log = () => {};
    try { normalizeArtCategory([r] as never); } finally { console.log = quiet; }
    assert.equal(r.category, want[i], r.title);
    // and again: both rules now leave it
    assert.equal(artCategoryFix(r as never), null, `ladder again: ${r.title}`);
    const before = r.category; normalizeArtCategory([r] as never); assert.equal(r.category, before, `normalize again: ${r.title}`);
  });
});

// ── 5 · normalize idempotency ──
test('reclass ladder runs to a fixed point: graded-cards → pop → evicted happens in ONE pass, not two', () => {
  // card-lots-nonsport sends a cardish non-sport graded lot to pop-memorabilia;
  // the earlier sports-house-pop rule evicts it — formerly only on the NEXT pass
  const l = { auctionHouse: 'REA', artist: 'graded-cards', category: 'object', title: '1888 A2 Allen & Ginter "American Indian Chiefs" Album' };
  const r = reclassifyLot(l as never);
  assert.equal(r.drop, true);
  // a memorabilia → autographs move that the non-athlete rule (earlier in the
  // ladder) then re-homes, all in one call; the second call moves nothing
  const m = { auctionHouse: 'Huggins & Scott', artist: 'memorabilia', category: 'object', title: 'Harry Truman Signed 1925 Check in Framed Display' };
  reclassifyLot(m as never);
  const after = m.artist;
  assert.deepEqual(reclassifyLot(m as never), { fired: [], drop: false });
  assert.equal(m.artist, after);
});

test('original card artwork is a unique piece in BOTH sports-house rules (no evict-on-pass-2)', () => {
  const t = '1962 Topps "Civil War News" #67 "Deadly Duel" - Original Card Artwork';
  assert.equal(sportsHouseCardLotKind({ auctionHouse: 'REA', artist: 'graded-cards', title: t } as never), 'pop-memorabilia');
  assert.equal(sportsHousePopKind(t), null);
  const l = { auctionHouse: 'REA', artist: 'graded-cards', category: 'object', title: t };
  assert.equal(reclassifyLot(l as never).drop, false);
  assert.equal(l.artist, 'pop-memorabilia');
  assert.deepEqual(reclassifyLot(l as never), { fired: [], drop: false });
  // a non-sport CARD still leaves
  assert.equal(sportsHousePopKind('1962 Topps Civil War News #67 Deadly Duel PSA 8'), DROP);
});

test('watch description reference reads the form this pass stamps, not a stale formKey', () => {
  const l = {
    artist: 'patek-philippe', category: 'object', formKey: 'object-edition', reference: null,
    title: 'Patek Philippe. An 18K gold cushion-shaped wristwatch SIGNED PATEK PHILIPPE, GENEVE, NO. 1',
    description: 'Patek Philippe. An 18K gold cushion-shaped wristwatch. Signed Patek Philippe, Geneve, No. 198410, Ref. 3543, Case No. 2672401',
  };
  const quiet = console.log; console.log = () => {};
  try { enrichWatchReferences([l] as never); } finally { console.log = quiet; }
  assert.equal(l.reference, '3543');
});

// ── 2 · the value book reads published rows as-is ──
test('value book: no re-normalize — the published player id is the pooled one', () => {
  // published: build-market's athlete id. A re-normalize read the title's
  // lead words instead ("crucial-catch" — Oct 11 equivalence check)
  const lots = [0, 1, 2, 3].map(i => ({
    id: `gu${i}`, artist: 'game-used', category: 'object', auctionHouse: 'NFL Auction', status: 'sold',
    title: `Crucial Catch - Saints Demario Davis Game Worn Jersey (10/0${i + 1}/2023) Size 44`,
    playerSlug: 'demario-davis', playerName: 'Demario Davis',
    priceUsd: 900 + i * 10, realizedUsd: 900 + i * 10, saleDate: `2026-0${i + 1}-15`,
  })) as unknown as AuctionLot[];
  const quiet = console.log; console.log = () => {};
  let book: ReturnType<typeof buildValueBook>;
  try { book = buildValueBook(lots); } finally { console.log = quiet; }
  assert.deepEqual(book.context.filter(c => c.kind === 'player-object').map(c => c.k), ['demario-davis|game-used']);
  assert.equal((lots[0] as unknown as { playerSlug: string }).playerSlug, 'demario-davis', 'rows untouched by cleanup');
});

// ── 3 · enrichment attempt policy ──
const E = (o: Record<string, unknown>) => ({
  id: 'x', auctionHouse: "Christie's", artist: 'andy-warhol', status: 'sold', saleDate: '2026-09-01',
  url: 'https://www.christies.com/en/lot/lot-6534343', medium: null, dimensions: null, year: null, ...o,
}) as unknown as AuctionLot;

test('enrich scope: art / design makers on the page shapes the parser reads', () => {
  assert.equal(enrichInScope(E({})), true);
  assert.equal(enrichInScope(E({ url: 'https://www.christies.com/en/lot/lot-6534343?ldp_breadcrumb=back' })), true);
  assert.equal(enrichInScope(E({ artist: 'rolex' })), false, 'a watch — the art-material regexes never read it');
  assert.equal(enrichInScope(E({ url: 'https://onlineonly.christies.com/sso?ObjectID=25241.51&LotNumber=51' })), false);
  assert.equal(enrichInScope(E({ url: 'https://www.christies.com/en/private-sales/privateitems/private-item-SN00697776-001' })), false);
  assert.equal(enrichInScope(E({ auctionHouse: "Sotheby's", url: 'https://www.sothebys.com/en/buy/auction/2026/modernites-pf2616/lepine-jaune' })), true);
  assert.equal(enrichInScope(E({ auctionHouse: "Sotheby's", url: 'https://www.sothebys.com/en/auctions/ecatalogue/2011/contemporary-art-n08766/lot.368.html' })), false);
  assert.equal(enrichInScope(E({ auctionHouse: 'Phillips', artist: 'rolex', url: 'https://www.phillips.com/detail/x' })), true, 'other houses unchanged');
});

test('enrich backoff: a sold lot waits 1 / 2 / 4 days and stops after 3 empty attempts', () => {
  const l = E({});
  assert.equal(enrichDue(l, '2026-10-11'), true);
  recordEnrichAttempt(l, 0, '2026-10-11');
  assert.equal(enrichDue(l, '2026-10-11'), false, 'not twice a day');
  assert.equal(enrichDue(l, '2026-10-12'), true, '1 day after attempt 1');
  recordEnrichAttempt(l, 1, '2026-10-12'); // filled one field, still missing others
  assert.equal(enrichDue(l, '2026-10-13'), false);
  assert.equal(enrichDue(l, '2026-10-14'), true, '2 days after attempt 2');
  recordEnrichAttempt(l, 0, '2026-10-14');
  assert.equal(enrichDue(l, '2026-10-17'), false);
  assert.equal(enrichDue(l, '2026-10-18'), true, '4 days after attempt 3');
  recordEnrichAttempt(l, 0, '2026-10-18');
  assert.deepEqual((l as unknown as { enrichTries: unknown }).enrichTries, { n: 4, e: 3, last: '2026-10-18' });
  assert.equal(enrichDue(l, '2027-01-01'), false, 'three empty attempts: done');
});

test('enrich backoff: an upcoming lot daily, at most 5 tries', () => {
  const l = E({ status: 'upcoming', saleDate: '2026-10-23' });
  for (let d = 11; d <= 15; d++) { assert.equal(enrichDue(l, `2026-10-${d}`), true); recordEnrichAttempt(l, 0, `2026-10-${d}`); }
  assert.equal(enrichDue(l, '2026-10-16'), false);
});

test('enrich order: never-tried first, then upcoming, then newest; out-of-scope and backed-off lots counted, not fetched', () => {
  const tried = E({ id: 'tried', saleDate: '2026-10-01' });
  recordEnrichAttempt(tried, 0, '2026-10-01');
  const lots = [
    tried,
    E({ id: 'old', saleDate: '2001-05-01' }),
    E({ id: 'up', status: 'upcoming', saleDate: '2026-10-23' }),
    E({ id: 'new', saleDate: '2026-10-05' }),
    E({ id: 'watch', artist: 'rolex' }),
    E({ id: 'done', medium: 'oil on canvas', dimensions: '10 x 10 in', year: '1960' }),
    E({ id: 'backoff', saleDate: '2026-10-09', enrichTries: { n: 3, e: 3, last: '2026-10-09' } }),
  ];
  const r = selectEnrichBatch(lots, '2026-10-11');
  assert.deepEqual(r.batch.map(l => l.id), ['up', 'new', 'old', 'tried']);
  assert.equal(r.outOfScope, 1);
  assert.equal(r.backedOff, 1);
});
