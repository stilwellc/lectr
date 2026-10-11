/**
 * Portfolio (THE DESK v3 §6) — the pure reads on fixtures. The clock is
 * pinned (the index and the timing read key on the current year).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinClock } from '../../../lib/__tests__/helpers/pin-clock';
import type { AuctionLot } from '../../../types';
import type { EntityDetail, EntitySummary } from '../../../lib/entity/model';
import {
  collectionIndex, noIndexNote, pieceMarks, pieceOf, pieceRow, recordRead, timingRead, totalsOf, trendRead, yearOfNow,
  type EntityRead,
} from '../portfolio';
import { houseTier, soldNowOf, SELLER_RATE, COMMISSION_NOTE } from '../commission';
import { portfolioCsv, csvFilename, CSV_COLUMNS } from '../csv';

pinClock('2026-10-09T20:00:00Z');
const NOW = Date.now();
const YEAR = yearOfNow(NOW);

function lot(over: Partial<AuctionLot> & { id: string }): AuctionLot {
  return {
    artist: 'andy-warhol', title: 'Cow (F. & S. II.11)', auctionHouse: "Sotheby's", saleName: 'Prints', currency: 'USD',
    saleDate: '2024-06-12', lotNumber: '1', imageUrl: '', url: 'https://example.test/lot/1', category: 'print',
    estimateLow: 10000, estimateHigh: 15000, hammerPrice: 20000, priceUsd: 25400, status: 'sold', bidCount: null, currentBid: null,
    ...over,
  } as unknown as AuctionLot;
}

const yearly = (rows: [number, number | null, number][], partial?: number): EntityDetail['yearly'] =>
  rows.map(([y, med, n]) => (y === partial ? { y, med, n, partial: true as const } : { y, med, n }));

function detail(y: EntityDetail['yearly'], top: EntityDetail['top'] = []): EntityDetail {
  return { yearly: y, houses: [], cats: [], top, recent: [] };
}
function summary(over: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id: 'mk:andy-warhol', kind: 'maker', market: 'art', label: 'Andy Warhol', discipline: null, face: null, page: null,
    sold: 100, sold12m: 41, med12m: 33000, med12mN: 41, medScope: null, record: null, spark: null, sparkN: null, yoy: null,
    verified: null, thin: false, caps: { compare: true, follow: null, dossier: true },
    ...over,
  };
}

/* ── the piece ─────────────────────────────────────────────────────── */

test('pieceOf: what the reader paid beats the realized price, and says so', () => {
  const p = pieceOf(lot({ id: 'a' }), { paidUsd: 27000 });
  assert.deepEqual(p.bought, { usd: 27000, basis: 'paid', day: '2024-06-12', year: 2024 });
  assert.equal(p.entityId, 'mk:andy-warhol');
});

test('pieceOf: with no recorded price the realized price is the bought figure, labelled realized', () => {
  const p = pieceOf(lot({ id: 'a' }), null);
  assert.deepEqual(p.bought, { usd: 25400, basis: 'realized', day: '2024-06-12', year: 2024 });
});

test('pieceOf: a row with no price falls back to the sold ledger; none at all = no bought figure', () => {
  const p = pieceOf(lot({ id: 'a', priceUsd: null, saleDate: '' }), null, [18000, '2023-03-01']);
  assert.deepEqual(p.bought, { usd: 18000, basis: 'realized', day: '2023-03-01', year: 2023 });
  assert.equal(pieceOf(lot({ id: 'b', priceUsd: null }), null).bought, null);
});

test('pieceOf: a settled row without an engine value has NO appraisal and no sold-now figure (never re-appraised)', () => {
  const p = pieceOf(lot({ id: 'a' }), null);
  assert.equal(p.appraisal, null);
  assert.equal(p.soldNow, null);
});

test('pieceOf: the appraisal is the engine’s own stamp — expectedAllIn, expected hammer, n, confidence', () => {
  const v = { poolIds: [], n: 12, compValueUsd: 30000, low: 24000, high: 36000, compRatio: 1.2, signal: null, estimateUsd: 12500, vsBid: null, confidence: 'high' as const, exact: null, expectedHammerUsd: 24000 };
  const p = pieceOf(lot({ id: 'a', status: 'upcoming', priceUsd: null, value: v as AuctionLot['value'] }), { paidUsd: 20000 });
  assert.deepEqual(p.appraisal, { allIn: 30000, hammer: 24000, compN: 12, confidence: 'high' });
  // Sotheby's = estimate tier: 10% off the expected hammer
  assert.deepEqual(p.soldNow, { net: 21600, commission: 2400, rate: 0.10, tier: 'estimate', house: "Sotheby's" });
});

test('pieceOf: a ×5-insane engine ratio is no appraisal (verdict’s own sanity rule)', () => {
  const v = { poolIds: [], n: 3, compValueUsd: 90000, low: 1, high: 1, compRatio: 7, signal: null, estimateUsd: 12500, vsBid: null, confidence: 'low' as const, exact: null };
  assert.equal(pieceOf(lot({ id: 'a', value: v as AuctionLot['value'] }), null).appraisal, null);
});

/* ── the seller’s side ─────────────────────────────────────────────── */

test('commission: one assumed rate per house tier, named as an assumption', () => {
  assert.equal(houseTier("Christie's"), 'estimate');
  assert.equal(houseTier('Goldin'), 'collectibles');
  assert.equal(houseTier('Wright'), 'specialist');
  assert.equal(houseTier(null), 'specialist');
  assert.deepEqual(soldNowOf(10000, 'REA'), { net: 9500, commission: 500, rate: SELLER_RATE.collectibles, tier: 'collectibles', house: 'REA' });
  assert.equal(soldNowOf(null, 'REA'), null);
  assert.equal(soldNowOf(0, 'REA'), null);
  assert.match(COMMISSION_NOTE, /assumption, not a quote/);
  assert.match(COMMISSION_NOTE, /10% at the estimate houses/);
});

/* ── the entity reads ──────────────────────────────────────────────── */

test('recordRead: the summary’s record, titled from the detail’s top rows; flags when the record IS the piece', () => {
  const top = [{ id: 'x1', img: null, p: 195040000, d: '2022-05-08', t: 'Shot Sage Blue Marilyn', h: "Christie's", cat: 'Paintings' }];
  const ent: EntityRead = { detail: detail([], top), summary: summary({ record: { p: 195040000, d: '2022-05-08' } }) };
  const r = recordRead({ id: 'a' }, ent);
  assert.deepEqual(r, { usd: 195040000, day: '2022-05-08', title: 'Shot Sage Blue Marilyn', house: "Christie's", id: 'x1', yours: false });
  assert.equal(recordRead({ id: 'x1' }, ent)?.yours, true);
  // no summary record: the detail's top sale
  assert.equal(recordRead({ id: 'a' }, { detail: detail([], top), summary: null })?.usd, 195040000);
  assert.equal(recordRead({ id: 'a' }, null), null);
  assert.equal(recordRead({ id: 'a' }, { detail: detail([]), summary: summary() }), null);
});

test('trendRead: the entity’s yoy in /makers’ words — direction only for a clear move', () => {
  const clear = trendRead({ detail: null, summary: summary({ yoy: { pct: 12.4, n: 320, basis: 'matched', lo: 4, hi: 21 } }) });
  assert.equal(clear?.text, '+12%');
  assert.equal(clear?.dir, 'up');
  assert.equal(clear?.basis, 'same items, both years · 320 matched');
  assert.match(clear!.title, /a clear rise/);
  const unclear = trendRead({ detail: null, summary: summary({ yoy: { pct: -3, n: 40, basis: 'median', lo: -20, hi: 15 } }) });
  assert.equal(unclear?.dir, undefined);
  assert.equal(unclear?.text, '−3%');
  assert.match(unclear!.title, /no clear move/);
  assert.equal(trendRead({ detail: null, summary: summary() }), null);
  assert.equal(trendRead(null), null);
});

test('timingRead: the 12-month median against the last five complete years — high, low, within', () => {
  const ys = yearly([[2020, 30000, 50], [2021, 32000, 60], [2022, 35000, 70], [2023, 31000, 80], [2024, 29000, 90], [2025, 30500, 95], [2026, 40000, 30]], 2026);
  const high = timingRead({ detail: detail(ys), summary: summary({ med12m: 36000, med12mN: 41 }) }, YEAR);
  assert.equal(high?.kind, 'high');
  assert.equal(high?.years, 5);
  assert.equal(high?.text, '12-mo median at a 5-yr high · n 41');
  // the window is 2021–2025: 2020 and the partial 2026 are outside it
  assert.equal(high?.lo, 29000);
  assert.equal(high?.hi, 35000);
  const low = timingRead({ detail: detail(ys), summary: summary({ med12m: 20000, med12mN: 41 }) }, YEAR);
  assert.equal(low?.text, '12-mo median at a 5-yr low · n 41');
  const within = timingRead({ detail: detail(ys), summary: summary({ med12m: 30000, med12mN: 41 }) }, YEAR);
  assert.equal(within?.kind, 'within');
  assert.match(within!.text, /^12-mo median \$30K inside its 5-yr range \$29K–\$35K · n 41$/);
});

test('timingRead: n-gated on both sides — a thin 12-month median or fewer than three gated years = no read', () => {
  const ys = yearly([[2021, 32000, 60], [2022, 35000, 70], [2023, 31000, 80], [2024, 29000, 90], [2025, 30500, 95]]);
  assert.equal(timingRead({ detail: detail(ys), summary: summary({ med12m: 36000, med12mN: 4 }) }, YEAR), null);
  const thinYears = yearly([[2021, 32000, 2], [2022, 35000, 3], [2023, 31000, 80], [2024, 29000, 90], [2025, 30500, 4]]);
  assert.equal(timingRead({ detail: detail(thinYears), summary: summary({ med12m: 36000, med12mN: 41 }) }, YEAR), null);
  const threeYears = yearly([[2021, 32000, 2], [2022, 35000, 30], [2023, 31000, 80], [2024, 29000, 90], [2025, 30500, 4]]);
  const r = timingRead({ detail: detail(threeYears), summary: summary({ med12m: 36000, med12mN: 41 }) }, YEAR);
  assert.equal(r?.years, 3);
  assert.equal(r?.text, '12-mo median at a 3-yr high · n 41');
  assert.equal(timingRead(null, YEAR), null);
});

/* ── the index ─────────────────────────────────────────────────────── */

const WARHOL = detail(yearly([[2022, 40000, 600], [2023, 41000, 580], [2024, 30000, 590], [2025, 33000, 550], [2026, 27000, 360]], 2026));

test('pieceMarks: the piece joins at what was paid in its bought year and moves with the maker’s yearly median', () => {
  const p = pieceOf(lot({ id: 'a', saleDate: '2024-06-12' }), { paidUsd: 30000 });
  const r = pieceMarks(p, { detail: WARHOL, summary: null }, YEAR);
  assert.ok(r.marks);
  assert.deepEqual(r.marks!.map(m => [m.year, Math.round(m.value), m.n, m.partial]), [
    [2024, 30000, 590, false],
    [2025, 33000, 550, false],
    [2026, 27000, 360, true],
  ]);
});

test('pieceMarks: a year under five sales is a gap, never a bridge', () => {
  const thin = detail(yearly([[2023, 41000, 580], [2024, 30000, 590], [2025, 33000, 2], [2026, 27000, 360]], 2026));
  const p = pieceOf(lot({ id: 'a', saleDate: '2024-06-12' }), { paidUsd: 30000 });
  const r = pieceMarks(p, { detail: thin, summary: null }, YEAR);
  assert.deepEqual(r.marks!.map(m => m.year), [2024, 2026]);
});

test('pieceMarks: every reason a piece has no index is named', () => {
  const base = lot({ id: 'a', saleDate: '2024-06-12' });
  assert.deepEqual(pieceMarks(pieceOf(lot({ id: 'a', priceUsd: null }), null), { detail: WARHOL, summary: null }, YEAR), { marks: null, reason: 'no bought price' });
  assert.deepEqual(pieceMarks(pieceOf(lot({ id: 'a', saleDate: '' }), { paidUsd: 1 }), { detail: WARHOL, summary: null }, YEAR), { marks: null, reason: 'no bought year' });
  // a collection bucket (cs:) is no one's index
  const cs = pieceOf(lot({ id: 'c', artist: 'sports-memorabilia', title: 'Game-used bat', category: 'unknown' }), null);
  assert.ok(!cs.entityId || cs.entityId.startsWith('cs:') || cs.entityId.startsWith('sj:'));
  if (cs.entityId?.startsWith('cs:')) assert.deepEqual(pieceMarks(cs, null, YEAR), { marks: null, reason: 'no named maker' });
  assert.deepEqual(pieceMarks(pieceOf(base, null), undefined, YEAR), { marks: null, reason: 'maker not read yet' });
  assert.deepEqual(pieceMarks(pieceOf(base, null), null, YEAR), { marks: null, reason: 'no maker history' });
  assert.deepEqual(pieceMarks(pieceOf(base, null), { detail: detail([]), summary: null }, YEAR), { marks: null, reason: 'no maker history' });
  const late = detail(yearly([[2025, 33000, 550], [2026, 27000, 360]], 2026));
  assert.deepEqual(pieceMarks(pieceOf(base, null), { detail: late, summary: null }, YEAR), { marks: null, reason: 'bought year under 5 sales' });
});

test('collectionIndex: pieces join in their bought year; a year any joined piece cannot be marked is a gap; the last point is the year so far', () => {
  const ROLEX = detail(yearly([[2022, 27720, 1328], [2023, 26857, 1263], [2024, 27635, 1275], [2025, 27940, 1011], [2026, 28160, 683]], 2026));
  const ents = new Map<string, EntityRead | null>([
    ['mk:andy-warhol', { detail: WARHOL, summary: null }],
    ['mk:rolex', { detail: ROLEX, summary: null }],
  ]);
  const a = pieceOf(lot({ id: 'a', saleDate: '2023-12-15' }), { paidUsd: 41000 });           // warhol, joins 2023
  const b = pieceOf(lot({ id: 'b', artist: 'rolex', saleDate: '2024-12-17', priceUsd: 27635 }), null); // rolex, joins 2024
  const c = pieceOf(lot({ id: 'c', priceUsd: null, saleDate: '2024-01-01' }), null);           // no bought price
  const r = collectionIndex([a, b, c], ents, YEAR);
  assert.deepEqual(r.included, ['a', 'b']);
  assert.deepEqual(r.excluded, [{ id: 'c', reason: 'no bought price' }]);
  assert.deepEqual(r.points.map(p => [p.label, p.value, p.pieces, p.partial]), [
    ['2023', 41000, 1, false],
    ['2024', 30000 + 27635, 2, false],
    ['2025', 33000 + Math.round(27635 * 27940 / 27635), 2, false],
    [`${YEAR} so far`, 27000 + 28160, 2, true],
  ]);
  assert.equal(r.bought, 41000 + 27635);
  assert.equal(r.latest?.label, `${YEAR} so far`);
});

test('collectionIndex: a joined piece with a thin year opens a gap in the total for that year', () => {
  const thin = detail(yearly([[2023, 41000, 580], [2024, 30000, 590], [2025, 33000, 3], [2026, 27000, 360]], 2026));
  const ents = new Map<string, EntityRead | null>([['mk:andy-warhol', { detail: thin, summary: null }]]);
  const a = pieceOf(lot({ id: 'a', saleDate: '2023-12-15' }), { paidUsd: 41000 });
  const r = collectionIndex([a], ents, YEAR);
  assert.deepEqual(r.points.map(p => [p.year, p.value]), [[2023, 41000], [2024, 30000], [2025, null], [2026, 27000]]);
  assert.equal(r.latest?.year, 2026);
});

test('collectionIndex: nothing indexable = no points, every piece listed with its reason', () => {
  const a = pieceOf(lot({ id: 'a' }), null);
  const r = collectionIndex([a], new Map(), YEAR);
  assert.deepEqual(r.points, []);
  assert.equal(r.latest, null);
  assert.deepEqual(r.excluded, [{ id: 'a', reason: 'maker not read yet' }]);
  assert.equal(noIndexNote(r.excluded, true), '1 piece without an index (1 maker not read yet) — still reading');
  assert.equal(noIndexNote([{ id: 'a', reason: 'no bought price' }, { id: 'b', reason: 'no bought price' }, { id: 'c', reason: 'no named maker' }], false),
    '3 pieces without an index (2 no bought price, 1 no named maker)');
  assert.equal(noIndexNote([], false), null);
});

/* ── rows, totals, csv ─────────────────────────────────────────────── */

test('pieceRow + totalsOf: the newest mark, the reads, and the totals with their counts', () => {
  const ent: EntityRead = { detail: WARHOL, summary: summary({ med12m: 26000, med12mN: 360, yoy: { pct: -8, n: 300, basis: 'matched', lo: -12, hi: -4 } }) };
  const a = pieceOf(lot({ id: 'a', saleDate: '2024-06-12' }), { paidUsd: 30000 });
  const row = pieceRow(a, ent, YEAR);
  assert.equal(row.mark?.year, YEAR);
  assert.equal(Math.round(row.mark!.value), 27000);
  assert.equal(row.noIndex, null);
  assert.equal(row.trend?.text, '−8%');
  assert.equal(row.timing?.kind, 'low');
  const t = totalsOf([a, pieceOf(lot({ id: 'b' }), null)]);
  assert.deepEqual(t, { pieces: 2, bought: 55400, boughtN: 2, paidN: 1, appraised: 0, appraisedN: 0, soldNow: 0, soldNowN: 0 });
});

test('portfolioCsv: one header, one row per piece, every column, RFC quoting; filename from the desk clock', () => {
  const ent: EntityRead = { detail: WARHOL, summary: summary({ med12m: 26000, med12mN: 360, yoy: { pct: -8, n: 300, basis: 'matched', lo: -12, hi: -4 } }) };
  const a = pieceOf(lot({ id: 'a', title: 'Cow, "Pink" (F. & S. II.11)', saleDate: '2024-06-12' }), { paidUsd: 30000 });
  const csv = portfolioCsv([pieceRow(a, ent, YEAR), pieceRow(pieceOf(lot({ id: 'b' }), null), undefined, YEAR)]);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.equal(lines[0].split(',').length, CSV_COLUMNS.length);
  assert.match(lines[1], /^a,"Cow, ""Pink"" \(F\. & S\. II\.11\)",Andy Warhol,Sotheby's,2024-06-12,30000,what you paid,27000,2026,/);
  // the basis carries a comma → quoted; the fixture has four complete years inside the window
  assert.match(lines[1], /,-8,"same items, both years · 300 matched",12-mo median at a 4-yr low · n 360,/);
  assert.match(lines[2], /,25400,realized price,,,maker not read yet,,,,,,,,,,,,,,,https:\/\/example\.test\/lot\/1$/);
  assert.equal(csvFilename(NOW), 'lectr-portfolio-2026-10-09.csv');
});
