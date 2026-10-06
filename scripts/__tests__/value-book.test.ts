/**
 * The Starling value book (scripts/emit-value-book.ts) — the Oct 6 2026 audit
 * rules, on hand-built lots: card grade qualifiers / Authentic / unparsed
 * slabs / multi-card lots never pool into a clean or raw key, the engine's
 * comp exclusions + shape gate apply to every sale, watch pools split off
 * gem / special-dial / other-material variants (or abstain), dual-reference
 * watch keys never ship, watch rows need n ≥ 5 and a tight band, one recent
 * sale cannot carry a decade-old pool's median, and the header carries
 * builtAt + engineVersion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../app/types';
import {
  cardBookId, isDualWatchRef, watchSaleClass, purifyPool, aggregatePool, saleAdmission, keyForLot,
  buildValueBook, BOOK_VERSION, WATCH_MIN_N,
} from '../emit-value-book';
import { ENGINE_VERSION } from '../../app/lib/value';

const card = (title: string, o: Record<string, unknown> = {}): AuctionLot =>
  ({ id: title, title, artist: 'sports-cards', category: 'object', auctionHouse: 'Goldin', status: 'sold', priceUsd: 100, realizedUsd: 100, saleDate: '2026-01-10', ...o }) as unknown as AuctionLot;
const watch = (title: string, o: Record<string, unknown> = {}): AuctionLot =>
  ({ id: title + Math.random(), title, artist: 'rolex', category: 'object', auctionHouse: "Christie's", status: 'sold', reference: '124300', ...o }) as unknown as AuctionLot;
const keyOf = (r: ReturnType<typeof cardBookId>) => (r && typeof r === 'object' ? r.key : r);

test('cards: a clean grade keys PLAYER|YEAR|SET|NO|GRADE; qualifiers / Authentic / unparsed graders never do', () => {
  assert.equal(keyOf(cardBookId(card('1968 Topps #177 Nolan Ryan Rookie - PSA NM-MT 8'))), 'nolan-ryan|1968|topps|177|PSA8');
  assert.equal(keyOf(cardBookId(card('1968 Topps #177 Nolan Ryan Rookie - PSA MINT 9 (OC)'))), 'grade-qualifier');
  assert.equal(keyOf(cardBookId(card('1968 Topps #177 Nolan Ryan Rookie - PSA 7 MK'))), 'grade-qualifier');
  assert.equal(keyOf(cardBookId(card('1968 Topps #177 Nolan Ryan Rookie - PSA Authentic'))), 'grade-authentic');
  assert.equal(keyOf(cardBookId(card('1968 Topps #177 Nolan Ryan Rookie - SGC 96'))), 'grade-unparsed');
  // graders outside the engine parser's set are still never 'raw'
  assert.equal(keyOf(cardBookId(card('1968 Topps #177 Nolan Ryan Rookie TGA 2.5'))), 'slab-unkeyed');
  assert.equal(keyOf(cardBookId(card('1989 Score #257 Barry Sanders Signed Rookie Card - BAS Authentic, Beckett 10'))), 'slab-unkeyed');
  assert.equal(keyOf(cardBookId(card('1931 W517 #4 Babe Ruth'))), 'babe-ruth|1931|w517|4|raw');
});

test('cards: multi-card lots, serials and condition-flagged sales never key; the variant rides along', () => {
  assert.equal(keyOf(cardBookId(card('1931 W517 #4 Babe Ruth and #46 Joe Sewell'))), 'multi-card');
  assert.equal(keyOf(cardBookId(card('2020 Panini Prizm #249 Ja Morant Rookie Gold (#04/10) - PSA 10'))), 'serial');
  assert.equal(keyOf(cardBookId(card('1931 W517 #4 Babe Ruth (Trimmed)'))), 'condition');
  // the $151,652 signed W517 Ruth that priced the RAW key: a PSA/DNA-slabbed
  // autograph with no card grade is never a raw sale
  assert.equal(keyOf(cardBookId(card('1931 W517 #4 Babe Ruth (Throwing) Autographed Card PSA/DNA MINT 9 Auto.'))), 'slab-unkeyed');
  const auto = cardBookId(card('80 O-Pee-Chee #18 Wayne Gretzky Signed Rookie Card - PSA NM 7, PSA/DNA GEM MT 10'));
  assert.ok(auto && typeof auto === 'object');
  assert.equal(auto.key, 'wayne-gretzky|1980|o-pee-chee|18|PSA7');
  assert.match(auto.variant, /auto/);
  assert.match(auto.variant, /ag:10/);
  const base = cardBookId(card('1957 Topps #77 Bill Russell Rookie SP PSA 7 NM'));
  assert.ok(base && typeof base === 'object');
  assert.equal(base.variant, '', "'SP' is a descriptor, not a parallel");
  // multi-lots (the shape gate) and comp-excluded sales are out of every pool
  assert.equal(saleAdmission(card('Lot of (5) 1989 Score #257 Barry Sanders cards')), 'multi-lot');
  assert.equal(saleAdmission(card('1989 Score #257 Barry Sanders', { compExclude: 'price-under-10' })), 'comp-exclude');
  assert.equal(saleAdmission(card('1989 Score #257 Barry Sanders')), null);
});

test('cards: a pool is held to one variant — a minority signed copy leaves, a split pool abstains', () => {
  const s = (usd: number, variant: string) => ({ p: [usd, Date.parse('2025-01-01')] as [number, number], date: '2025-01-01', variant });
  const pur = purifyPool({ v: 'sports-cards', sales: [s(840, ''), s(960, ''), s(1100, ''), s(151652, 'auto|ag:9')] });
  assert.equal(pur.abstain, null);
  assert.deepEqual(pur.sales.map(x => x.p[0]), [840, 960, 1100]);
  assert.equal(pur.variant, undefined, 'base card');
  assert.equal(purifyPool({ v: 'sports-cards', sales: [s(1, ''), s(2, ''), s(3, 'auto'), s(4, 'auto')] }).abstain, 'card-variant-mixed');
});

test('watches: a dual-stamped reference pair is never a key; a slash suffix is part of the reference', () => {
  assert.equal(isDualWatchRef('rolex|5513/5517'), true);
  assert.equal(isDualWatchRef('rolex|5517/5513'), true);
  assert.equal(isDualWatchRef('patek-philippe|5711/1a'), false);
  assert.equal(isDualWatchRef('patek-philippe|3700/031'), false);
  assert.equal(isDualWatchRef('patek-philippe|5723/112r'), false);
  assert.equal(keyForLot(watch('Military Submariner, Ref: 5513/5517, Circa 1975', { reference: '5513/5517' })), 'watch-dual-ref');
});

test('watches: gem / special-dial markers are read, sapphire crystal and movement rubies are not gems', () => {
  assert.deepEqual(watchSaleClass({ title: 'A stainless steel wristwatch with sapphire crystal, 31 jewels', medium: '' }), { markers: [], mat: 'steel' });
  assert.deepEqual(watchSaleClass({ title: 'An 18K gold and diamond-set wristwatch', medium: '' }).markers, ['gem:diamond']);
  assert.ok(watchSaleClass({ title: "Oyster 'tiffany blue', reference 124300", medium: '' }).markers.includes('sp:tiffany'));
  assert.ok(watchSaleClass({ title: 'reference 126610ln submariner secret service engraved case back', medium: '' }).markers.includes('sp:secret-service'));
  assert.ok(watchSaleClass({ title: 'oyster perpetual 41 with green lacquered dial', medium: '' }).markers.length > 0);
});

test('watches: minority variants leave the pool; a marker the whole reference carries stays', () => {
  const s = (usd: number, title: string) => ({ p: [usd, Date.parse('2025-06-01')] as [number, number], date: '2025-06-01', watch: watchSaleClass({ title, medium: '' }) });
  const pur = purifyPool({ v: 'watches', sales: [
    s(9000, 'stainless steel'), s(9500, 'stainless steel'), s(10000, 'stainless steel'), s(9800, 'steel'),
    s(55000, "stainless steel, 'turquoise blue' dial"), s(30000, 'stainless steel, diamond-set bezel'),
  ] });
  assert.equal(pur.abstain, null);
  assert.deepEqual(pur.sales.map(x => x.p[0]), [9000, 9500, 10000, 9800]);
  assert.equal(pur.mat, 'steel');
  assert.equal(pur.split, true);
  // every 3960 is the anniversary edition — intrinsic, kept
  const ann = purifyPool({ v: 'watches', sales: [1, 2, 3, 4, 5].map(i => s(20000 + i, "Officier 'Anniversary Edition', yellow gold")) });
  assert.equal(ann.sales.length, 5);
});

test('watches: a mixed-material reference prices its CHEAPEST documented material, else abstains', () => {
  const s = (usd: number, title: string) => ({ p: [usd, Date.parse('2025-06-01')] as [number, number], date: '2025-06-01', watch: watchSaleClass({ title, medium: '' }) });
  const steel = [60000, 62000, 65000, 64000, 63000].map(u => s(u, 'stainless steel daytona'));
  const gold = [120000, 125000, 118000, 130000].map(u => s(u, '18K gold daytona'));
  const pur = purifyPool({ v: 'watches', sales: [...steel, ...gold] });
  assert.equal(pur.mat, 'steel');
  assert.equal(pur.sales.length, 5);
  // the cheap material too thin to carry a row on its own → abstain
  const pur2 = purifyPool({ v: 'watches', sales: [...steel.slice(0, 3), ...gold] });
  assert.equal(pur2.abstain, 'watch-material-mixed');
});

test('aggregatePool: watch rows need n ≥ 5 and a band within 2.5×; cards still ship n=3 as thin', () => {
  const REF = Date.parse('2026-10-06');
  const at = (usd: number, d = '2026-03-01'): [number, number] => [usd, Date.parse(d)];
  const r3 = aggregatePool('rolex|126610ln', 'watches', [at(18900), at(44450), at(50800)], '2026-03-01', REF);
  assert.deepEqual(r3, { abstain: 'watch-n' });
  assert.equal(WATCH_MIN_N, 5);
  const wide = aggregatePool('rolex|124300', 'watches', [8000, 9000, 10000, 12000, 18000, 22000, 30000, 38000].map(u => at(u)), '2026-03-01', REF);
  assert.ok('abstain' in wide && wide.abstain === 'watch-band' || 'abstain' in wide && wide.abstain === 'dispersion');
  const ok = aggregatePool('rolex|116500ln', 'watches', [30000, 31000, 32000, 33000, 34000].map(u => at(u)), '2026-03-01', REF);
  assert.ok('row' in ok && ok.row.med === 32000 && ok.row.conf === 'medium');
  const thin = aggregatePool('x|1|s|1|PSA9', 'sports-cards', [at(100), at(110), at(120)], '2026-03-01', REF);
  assert.ok('row' in thin && thin.row.conf === 'thin');
});

test('aggregatePool: one recent sale cannot carry a decade-old pool (effective-n guard)', () => {
  const REF = Date.parse('2026-10-06');
  const sales: [number, number][] = [
    [230, Date.parse('2005-09-15')], [840, Date.parse('2016-04-15')], [960, Date.parse('2017-10-15')],
    [1410, Date.parse('2008-04-15')], [900, Date.parse('2012-04-15')], [151652, Date.parse('2023-08-27')],
  ];
  const r = aggregatePool('babe-ruth|1931|w517|4|raw', 'sports-cards', sales, '2023-08-27', REF);
  assert.ok('row' in r);
  assert.ok(r.row.med < 1500, `median ${r.row.med} must not be the lone recent sale`);
});

test('buildValueBook: header carries builtAt + engineVersion + bookVersion; excluded sales never pool', () => {
  const lots: AuctionLot[] = [];
  for (let i = 0; i < 6; i++) lots.push(card(`1989 Score #257 Barry Sanders Rookie Card ${i}`, { id: `c${i}`, priceUsd: 50 + i, realizedUsd: 50 + i, saleDate: `2026-0${i + 1}-02` }));
  lots.push(card('1989 Score #257 Barry Sanders Rookie Card - PSA Authentic', { id: 'auth', priceUsd: 900, realizedUsd: 900, saleDate: '2026-08-01' }));
  lots.push(card('1989 Score #257 Barry Sanders Rookie Card X', { id: 'junk', priceUsd: 5000, realizedUsd: 5000, saleDate: '2026-08-02', compExclude: 'price-vs-estimate' }));
  const book = buildValueBook(lots);
  assert.equal(book.schema, 1);
  assert.equal(book.engineVersion, ENGINE_VERSION);
  assert.equal(book.bookVersion, BOOK_VERSION);
  assert.ok(!Number.isNaN(Date.parse(book.builtAt)));
  const row = book.rows.find(r => r.k === 'barry-sanders|1989|score|257|raw');
  assert.ok(row, 'the raw row ships');
  assert.equal(row.n, 6, 'the Authentic slab and the comp-excluded sale stay out');
  assert.ok(row.med < 100);
  assert.equal(book.audit.skipped['grade-authentic'], 1);
  assert.equal(book.audit.skipped['comp-exclude'], 1);
});

test('watch variant helpers have ONE source (app/lib/comps) shared with the value book', async () => {
  const comps = await import('../../app/lib/comps');
  const vb = await import('../emit-value-book');
  assert.equal(vb.watchSaleClass, comps.watchSaleClass);
  assert.equal(vb.isDualWatchRef, comps.isDualWatchRef);
  assert.equal(vb.WATCH_MIN_N, comps.WATCH_MIN_N);
  // a minority gem-set sale leaves; a dominant material keeps the unstated sales
  const S = (p: number, title: string) => ({ p, c: comps.watchSaleClass({ title, medium: '' }) });
  const pool = [S(10, 'Rolex 126610LN steel'), S(11, 'Rolex 126610LN stainless steel'), S(12, 'Rolex 126610LN'),
    S(10.5, 'Rolex 126610LN steel'), S(40, 'Rolex 126610LN steel diamond bezel')];
  const r = comps.purifyWatchSales(pool, s => s.c, s => s.p, 3);
  assert.deepEqual(r.sales.map(s => s.p), [10, 11, 12, 10.5]);
  assert.equal(r.mat, 'steel');
  assert.equal(r.abstain, null);
});
