/**
 * scripts/lib/sale-day.ts + corpus-normalize localizeSaleDates — saleDate is the
 * SALE-LOCAL calendar day, not the UTC day of the house stamp (Oct 2026 identity
 * audit: 369,558 Goldin lots a day late, 20,831 Christie's a day early, 5,147
 * Sotheby's). Fixtures are real corpus rows (id · stamp · verified date).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saleDayOf, saleTimeZone, parseStamp } from '../lib/sale-day';
import { localizeSaleDates, reconcileSaleDates } from '../lib/corpus-normalize';

test('Goldin: a 10 PM ET close is that night, extended bidding past midnight ET stays on it', () => {
  // goldin-202605-2017-1209-… Goldin Weekly (Thursday 10 PM ET) closes 2026-09-18T02:00Z
  assert.equal(saleDayOf('Goldin', '2026-09-18T02:00:00Z'), '2026-09-17');
  // naive microsecond stamps are UTC (same hour profile as the Z stamps)
  assert.equal(saleDayOf('Goldin', '2026-10-05T02:30:37.934456'), '2026-10-04');
  // extended bidding: 00:40 EDT Friday is still Thursday's sale
  assert.equal(saleDayOf('Goldin', '2026-09-18T04:40:00Z'), '2026-09-17');
  // winter (EST): 22:00 EST = 03:00Z
  assert.equal(saleDayOf('Goldin', '2026-01-16T03:00:00Z'), '2026-01-15');
  // a daytime stamp is untouched
  assert.equal(saleDayOf('Goldin', '2023-11-17T16:30:00'), '2023-11-17');
});

test("Christie's: www local-midnight stamps → the sale-location day; bare dates and genuine clocks", () => {
  // Important Watches, Dubai, 22 Mar 2019 (revolutionwatch.com) arrives as 20:00Z the day before
  assert.equal(saleDayOf("Christie's", '2019-03-21T20:00Z', { currency: 'USD' }), '2019-03-22');
  // 20th Century Day Sale, Hong Kong — local midnight 16:00Z
  assert.equal(saleDayOf("Christie's", '2026-09-29T16:00Z', { currency: 'HKD' }), '2026-09-30');
  // London BST midnight 23:00Z; Geneva CEST midnight 22:00Z
  assert.equal(saleDayOf("Christie's", '2026-10-14T23:00Z', { currency: 'GBP' }), '2026-10-15');
  assert.equal(saleDayOf("Christie's", '2026-05-11T22:00Z', { currency: 'CHF' }), '2026-05-12');
  // New York midnight 04:00Z, and a bare-date 00:00Z (Post-War Evening Sale, NY, 14 Nov 2007)
  assert.equal(saleDayOf("Christie's", '2026-05-12T04:00Z', { currency: 'USD' }), '2026-05-12');
  assert.equal(saleDayOf("Christie's", '2007-11-14T00:00Z', { currency: 'USD' }), '2007-11-14');
  // a genuine evening start (Impressionist Evening, NY, 6 Nov 2007 6:30 PM EST)
  assert.equal(saleDayOf("Christie's", '2007-11-06T23:30Z', { currency: 'USD' }), '2007-11-06');
  // onlineonly genuine close, read in the sale location named by the www feed
  assert.equal(saleTimeZone("Christie's", { saleName: 'Hong Kong Sale 24901' }), 'Asia/Hong_Kong');
  assert.equal(saleDayOf("Christie's", '2026-10-02T17:12:00.000Z', { saleName: 'Hong Kong Sale 24901', currency: 'USD' }), '2026-10-03');
  assert.equal(saleDayOf("Christie's", '2026-10-02T14:25:00.000Z', { saleName: 'New York Sale 24969' }), '2026-10-02');
});

test("Sotheby's: genuine instants read in the sale-currency zone", () => {
  // The Now & Contemporary Evening Auction, New York, 18 Nov 2025 7 PM EST
  assert.equal(saleDayOf("Sotheby's", '2025-11-19T00:00:00.000Z', { currency: 'USD' }), '2025-11-18');
  // NBA Auctions weekly finals close 9:30 PM ET
  assert.equal(saleDayOf("Sotheby's", '2026-07-21T01:30:00.000Z', { currency: 'USD' }), '2026-07-20');
  // Paris local-midnight date marker
  assert.equal(saleDayOf("Sotheby's", '2024-07-04T22:00:00.000Z', { currency: 'EUR' }), '2024-07-05');
  // Hong Kong afternoon
  assert.equal(saleDayOf("Sotheby's", '2026-04-05T06:00:00.000Z', { currency: 'HKD' }), '2026-04-05');
  // unknown zone → the UTC day (legacy behaviour, never a guess)
  assert.equal(saleDayOf("Sotheby's", '2026-04-05T23:00:00.000Z', { currency: 'XYZ' }), '2026-04-05');
});

test('MLB Auctions / NFL Auction: the GMT closeTime is read in ET (a 9:59 PM ET close is that night)', () => {
  // mlbauction-6414160 (astros) / -6408132 (rangers): API close 01:59Z = 9:59 PM EDT the day before
  // (date re-audit Oct 2026: stored 2026-09-07, closed 2026-09-06)
  assert.equal(saleDayOf('MLB Auctions', '2026-09-07T01:59:00.000Z'), '2026-09-06');
  assert.equal(saleDayOf('MLB Auctions', '2026-09-14T01:59:00.000Z'), '2026-09-13');
  // fixture item 6420023: 22:00Z = 6 PM EDT — the same day
  assert.equal(saleDayOf('MLB Auctions', '2026-09-30T22:00:00.000Z'), '2026-09-30');
  // NFL "Sep 16, 2026, 2:02:00 AM" GMT = 10:02 PM EDT Sep 15
  assert.equal(saleDayOf('NFL Auction', '2026-09-16T02:02:00.000Z'), '2026-09-15');
  assert.equal(saleTimeZone('MLB Auctions'), 'America/New_York');
});

test('sale-day: other houses and unreadable stamps abstain', () => {
  assert.equal(saleDayOf('REA', '2026-09-18T02:00:00Z'), null);
  assert.equal(saleDayOf('Goldin', ''), null);
  assert.equal(saleDayOf('Goldin', 'not a date'), null);
  assert.ok(Number.isNaN(parseStamp('2026-09-18')));
});

test('localizeSaleDates: re-derives the old UTC-day rows only; idempotent; reconcile keeps the local day', () => {
  type Row = Parameters<typeof localizeSaleDates>[0][number];
  const L = (o: Record<string, unknown>): Row => ({ id: 'x', title: 't', status: 'sold', ...o }) as unknown as Row;
  const lots = [
    L({ id: 'goldin', auctionHouse: 'Goldin', saleDate: '2026-09-18', saleDateTime: '2026-09-18T02:00:00Z', nativeCurrency: 'USD' }),
    L({ id: 'chr-gbp', auctionHouse: "Christie's", saleDate: '2026-10-14', saleDateTime: '2026-10-14T23:00Z', nativeCurrency: 'GBP' }),
    L({ id: 'sot-nba', auctionHouse: "Sotheby's", saleDate: '2026-07-21', saleDateTime: '2026-07-21T01:30:00.000Z', nativeCurrency: 'USD' }),
    // a saleDate that did NOT come from the stamp (crawl-day fallback) — reconcile owns it
    L({ id: 'other-src', auctionHouse: 'Goldin', saleDate: '2026-09-27', saleDateTime: '2026-09-18T02:00:00Z' }),
    // not a house this module owns
    L({ id: 'rea', auctionHouse: 'REA', saleDate: '2026-09-18', saleDateTime: '2026-09-18T02:00:00Z' }),
  ];
  const r = localizeSaleDates(lots);
  assert.equal(r.total, 3);
  assert.deepEqual(lots.map(l => l.saleDate), ['2026-09-17', '2026-10-15', '2026-07-20', '2026-09-27', '2026-09-18']);
  assert.equal(localizeSaleDates(lots).total, 0, 'idempotent');
  // reconcile reads the local day: the London row must not be dragged back to 10-14
  assert.equal(reconcileSaleDates(lots), 1); // only the crawl-day fallback row moves
  assert.deepEqual(lots.map(l => l.saleDate), ['2026-09-17', '2026-10-15', '2026-07-20', '2026-09-17', '2026-09-18']);
});
