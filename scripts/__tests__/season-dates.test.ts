/**
 * season-dates.test.ts — REA / Huggins & Scott sales are dated by their real
 * close (scripts/lib/sale-close-dates.ts), not seasonToDate's mid-month stub.
 * The stub read REA Summer as known at July's end (closes mid-August), REA
 * Fall at October's end (closes early December) and H&S "2022 February" at
 * February's end (closed April 7) — lookahead in every replay cut between.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saleCloseFor, parseSaleLabel, SALE_CLOSE_DATES, GALLERY_CLOSE_DATES, galleryCloseFor, galleryStubClose, labelStub } from '../lib/sale-close-dates';
import { seasonToDate } from '../lib/sports-crawl';
import { redateSeasonSales, redateGalleryStubs } from '../lib/corpus-normalize';
import { knownKey } from '../../app/lib/value';

test('cited closes: REA Summer/Fall and H&S month labels land on the real close day', () => {
  assert.deepEqual(pick(saleCloseFor('REA', '2019 Summer')), { date: '2019-08-18', precision: 'day' });
  assert.deepEqual(pick(saleCloseFor('REA', '2025 Fall')), { date: '2025-12-07', precision: 'day' });
  assert.deepEqual(pick(saleCloseFor('REA', '2019 Spring')), { date: '2019-03-24', precision: 'day' });
  assert.deepEqual(pick(saleCloseFor('Huggins & Scott', '2022 February')), { date: '2022-04-07', precision: 'day' });
  assert.deepEqual(pick(saleCloseFor('Huggins & Scott', '2025 Summer')), { date: '2025-09-04', precision: 'day' });
  assert.deepEqual(pick(saleCloseFor('Huggins & Scott', '2008 June')), { date: '2008-07-10', precision: 'day' });
  // label order / case tolerant
  assert.equal(saleCloseFor('REA', 'Summer 2019')!.date, '2019-08-18');
  assert.deepEqual(parseSaleLabel('2022 february'), { year: '2022', word: 'february' });
});

test('fallbacks: unknown season → quarter end; H&S month → end of month+2; an uncited REA month keeps the stub', () => {
  assert.deepEqual(pick(saleCloseFor('REA', '2027 Summer')), { date: '2027-09-30', precision: 'season' });
  assert.deepEqual(pick(saleCloseFor('Huggins & Scott', '2027 Winter')), { date: '2027-03-31', precision: 'season' });
  assert.deepEqual(pick(saleCloseFor('Huggins & Scott', '2018 June')), { date: '2018-08-31', precision: 'season' });
  assert.deepEqual(pick(saleCloseFor('Huggins & Scott', '2030 December')), { date: '2031-02-28', precision: 'season' });
  assert.equal(saleCloseFor('REA', '2027 January'), null, 'an uncited REA monthly sale keeps the in-month stub');
  assert.equal(saleCloseFor('Lelands', '2019 Summer'), null, 'gallery houses: only a dropdown label they printed');
  assert.equal(saleCloseFor('SCP', '2019 Summer'), null, 'other houses untouched');
  // a sold row is never future-dated: the bound clamps to the day it is read
  assert.equal(saleCloseFor('REA', '2027 Summer', '2027-08-20')!.date, '2027-08-20');
});

test('seasonToDate: house-aware resolves the table; house-less keeps the stub (Lelands gallery path)', () => {
  assert.equal(seasonToDate('2019 Summer', 'REA'), '2019-08-18');
  // REA monthly ("Encore") sales: the cited close (re-audit: rea Jan 2025 closed Sun Jan 19)
  assert.equal(seasonToDate('2026 January', 'REA'), '2026-01-18');
  assert.equal(seasonToDate('2025 January', 'REA'), '2025-01-19');
  assert.equal(seasonToDate('2027 January', 'REA'), '2027-01-15');
  // gallery houses resolve their own dropdown labels
  assert.equal(seasonToDate('Fall, 2023 Premier Auction', 'Love of the Game'), '2023-11-25');
  assert.equal(seasonToDate('Fall, 2025 Premier Auction - Closes Nov. 29, 2025', 'Love of the Game'), '2025-11-29');
  assert.equal(seasonToDate('2019 Spring Classic'), '2019-04-15');
  assert.equal(seasonToDate('2019 Summer'), '2019-07-15');
  assert.equal(seasonToDate('2026 Winter'), '2026-02-15');
});

test('table sanity: every close is a real date in its label year; fallbacks bound every cited close', () => {
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const SEASON_END: Record<string, string> = { winter: '03-31', spring: '06-30', summer: '09-30', fall: '12-31' };
  for (const [house, rows] of Object.entries(SALE_CLOSE_DATES)) {
    for (const [label, row] of Object.entries(rows)) {
      assert.match(row.close, /^\d{4}-\d{2}-\d{2}$/, `${house} ${label}`);
      assert.equal(new Date(row.close + 'T00:00:00Z').toISOString().slice(0, 10), row.close, `${house} ${label} valid day`);
      const p = parseSaleLabel(label)!;
      assert.equal(row.close.slice(0, 4), p.year, `${house} ${label} closes in its label year`);
      assert.ok(row.src.length > 10, `${house} ${label} cites a source`);
      const se = SEASON_END[p.word];
      if (se) assert.ok(row.close <= `${p.year}-${se}`, `${house} ${label} ≤ the season-end fallback`);
      const mi = MONTHS.indexOf(p.word);
      if (house === 'REA' && mi >= 0) {
        const m2 = String(mi + 1).padStart(2, '0');
        assert.equal(row.close.slice(0, 7), `${p.year}-${m2}`, `REA ${label} closes inside its label month (the stub month stays a bound)`);
      }
      if (house === 'Huggins & Scott' && mi >= 0) {
        const bound = new Date(Date.UTC(+p.year, mi + 3, 0)).toISOString().slice(0, 10);
        assert.ok(row.close <= bound, `${label} ${row.close} ≤ ${bound} (the H&S month fallback is conservative)`);
        assert.ok(row.close >= `${p.year}-${String(mi + 1).padStart(2, '0')}-01`, `${label} never closes before its label month`);
      }
    }
  }
});

test('redateSeasonSales: stub rows move to the close (fxAsOf follows); real closes, REA monthly and other houses untouched; idempotent', () => {
  const rows: Record<string, unknown>[] = [
    { id: 'rea-57561', auctionHouse: 'REA', saleName: '2019 Summer', saleDate: '2019-07-15', datePrecision: 'month', fxAsOf: '2019-07-15', status: 'sold' },
    { id: 'rea-fall', auctionHouse: 'REA', saleName: '2025 Fall', saleDate: '2025-10-15', datePrecision: 'month', fxAsOf: '2025-10-15', status: 'sold' },
    { id: 'hugginsscott-2022-february-1', auctionHouse: 'Huggins & Scott', saleName: '2022 February', saleDate: '2022-02-15', datePrecision: 'month', fxAsOf: '2022-02-15', status: 'sold' },
    { id: 'hugginsscott-2018-november-52', auctionHouse: 'Huggins & Scott', saleName: '2018 November', saleDate: '2018-11-15', datePrecision: 'month', status: 'sold' },
    { id: 'hugginsscott-2018-june-1', auctionHouse: 'Huggins & Scott', saleName: '2018 June', saleDate: '2018-06-15', datePrecision: 'month', status: 'sold' },
    { id: 'rea-jan', auctionHouse: 'REA', saleName: '2026 January', saleDate: '2026-01-15', datePrecision: 'month', status: 'sold' },
    { id: 'rea-jan27', auctionHouse: 'REA', saleName: '2027 January', saleDate: '2027-01-15', datePrecision: 'month', status: 'sold' },
    { id: 'hugginsscott-2026-summer-1', auctionHouse: 'Huggins & Scott', saleName: '2026 Summer', saleDate: '2026-09-10', saleDateTime: '2026-09-10T22:01:00-04:00', status: 'sold' },
    { id: 'rea-live', auctionHouse: 'REA', saleName: '2026 Summer', saleDate: '2026-07-15', datePrecision: 'month', saleDateTime: '2026-08-16T23:40:00-04:00', status: 'sold' },
    { id: 'lelands-1', auctionHouse: 'Lelands', saleName: '2019 Summer', saleDate: '2019-07-15', datePrecision: 'month', status: 'sold' },
  ];
  const r = redateSeasonSales(rows as never, new Date('2026-10-05T12:00:00Z'));
  const by = Object.fromEntries(rows.map(l => [l.id as string, l]));
  assert.equal(r.total, 6);
  assert.deepEqual(pickRow(by['rea-57561']), { saleDate: '2019-08-18', datePrecision: 'day', fxAsOf: '2019-08-18' });
  assert.deepEqual(pickRow(by['rea-fall']), { saleDate: '2025-12-07', datePrecision: 'day', fxAsOf: '2025-12-07' });
  assert.deepEqual(pickRow(by['hugginsscott-2022-february-1']), { saleDate: '2022-04-07', datePrecision: 'day', fxAsOf: '2022-04-07' });
  assert.equal(by['hugginsscott-2018-november-52'].datePrecision, 'day', 'cited close on the 15th → day, not month');
  assert.deepEqual(pickRow(by['hugginsscott-2018-june-1']), { saleDate: '2018-08-31', datePrecision: 'season', fxAsOf: undefined });
  assert.deepEqual(pickRow(by['rea-jan']), { saleDate: '2026-01-18', datePrecision: 'day', fxAsOf: undefined });
  assert.deepEqual(pickRow(by['rea-jan27']), { saleDate: '2027-01-15', datePrecision: 'month', fxAsOf: undefined });
  assert.equal(by['hugginsscott-2026-summer-1'].saleDate, '2026-09-10');
  assert.equal(by['rea-live'].saleDate, '2026-07-15', 'a row with a parsed saleDateTime is never touched here');
  assert.equal(by['lelands-1'].saleDate, '2019-07-15');
  assert.equal(redateSeasonSales(rows as never, new Date('2026-10-05T12:00:00Z')).total, 0, 'idempotent');
});

test('the lookahead is gone: REA 2019 Summer is not known at an Aug 1 cut, H&S 2022 February not at a Mar 15 cut', () => {
  const summer = { auctionHouse: 'REA', saleName: '2019 Summer', saleDate: '2019-07-15', datePrecision: 'month' };
  const hs = { auctionHouse: 'Huggins & Scott', saleName: '2022 February', saleDate: '2022-02-15', datePrecision: 'month' };
  assert.ok(knownKey(summer) < '2019-08-01' && knownKey(hs) < '2022-03-15', 'the stub was known before the sale closed');
  redateSeasonSales([summer, hs] as never, new Date('2026-10-05T12:00:00Z'));
  assert.ok(!(knownKey(summer) < '2019-08-01'));
  assert.ok(!(knownKey(hs) < '2022-03-15'));
  assert.ok(knownKey(summer) < '2019-08-19', 'known the day after the close');
});

function pick(c: { date: string; precision: string } | null) { return c && { date: c.date, precision: c.precision }; }
function pickRow(l: Record<string, unknown>) { return { saleDate: l.saleDate, datePrecision: l.datePrecision, fxAsOf: l.fxAsOf }; }

// ── gallery houses (Lelands / Love of the Game / Memory Lane) ─────────────────
test('gallery tables: every close is a real day in its label year and cites a source', () => {
  for (const [house, rows] of Object.entries(GALLERY_CLOSE_DATES)) {
    for (const [label, row] of Object.entries(rows)) {
      assert.ok(row.src.length > 10, `${house} ${label} cites a source`);
      const stub = labelStub(label);
      assert.ok(stub, `${house} ${label} carries a year (the crawler only dates those)`);
      if (!row.close) continue;
      assert.equal(new Date(row.close + 'T00:00:00Z').toISOString().slice(0, 10), row.close, `${house} ${label} valid day`);
      assert.equal(row.close.slice(0, 4), stub!.slice(0, 4), `${house} ${label} closes in its label year`);
    }
  }
});

test('galleryStubClose: unique cited sale → its day; shared stub → latest close as a bound; any uncited candidate → abstain', () => {
  // lotg-…: "Fall, 2023 Premier Auction" stub 10-15, closed Sat Nov 25 2023 (re-audit verified)
  assert.deepEqual(galleryStubClose('Love of the Game', '2023-10-15'), { date: '2023-11-25', precision: 'day' });
  // "2016 Ringside Auction" has no season word → June stub; closed Nov 26 2016
  assert.deepEqual(galleryStubClose('Love of the Game', '2016-06-15'), { date: '2016-11-26', precision: 'day' });
  // 2024-07-15 = Summer 2024 Set Builder (Jul 13) OR Summer 2024 Premier (Sep 28) → bound at Sep 28
  assert.deepEqual(galleryStubClose('Love of the Game', '2024-07-15'), { date: '2024-09-28', precision: 'season' });
  // legacy winter→December stub: "Winter, 2014 Auction" was stamped 2014-12-15, closed Feb 1 2014
  assert.deepEqual(galleryStubClose('Love of the Game', '2014-12-15'), { date: '2014-02-01', precision: 'day' });
  // "Winter, 2015 Set Builder's Auction" (close not found) shares 2015-12-15 → abstain
  assert.equal(galleryStubClose('Love of the Game', '2015-12-15'), null);
  // lelands-…: "2019 Spring Classic" closed Fri Jun 7 2019; "Summer Classic 2022" Sat Sep 17 2022
  assert.deepEqual(galleryStubClose('Lelands', '2019-04-15'), { date: '2019-06-07', precision: 'day' });
  assert.deepEqual(galleryStubClose('Lelands', '2022-07-15'), { date: '2022-09-17', precision: 'day' });
  // 2024-12-15 = legacy winter stub of "2024 Winter Pop-Up" (uncited) + "2024 Winter Classic" → abstain
  assert.equal(galleryStubClose('Lelands', '2024-12-15'), null);
  // August 2007 Lelands - Gaynor: no source → abstain
  assert.equal(galleryStubClose('Lelands', '2007-08-15'), null);
  // a 15th that IS a cited close and no label stubs to it (2026 Summer Classic closed Aug 15)
  assert.deepEqual(galleryStubClose('Lelands', '2026-08-15'), { exact: true });
  // memorylane-…: Spring Break 2015 closed Sat May 9 2015; "The Find Winter 2012" closed Dec 15 2012
  assert.deepEqual(galleryStubClose('Memory Lane', '2015-04-15'), { date: '2015-05-09', precision: 'day' });
  assert.deepEqual(galleryStubClose('Memory Lane', '2012-02-15'), { date: '2012-12-15', precision: 'day' });
  assert.equal(galleryStubClose('Memory Lane', '2022-04-15'), null, 'Spring Rarities 2022: close not found');
  assert.equal(galleryStubClose('REA', '2023-10-15'), null, 'not a gallery house');
  assert.equal(galleryStubClose('Love of the Game', '2023-11-25'), null, 'not a stub');
  assert.equal(galleryCloseFor('Love of the Game', 'Summer, 2025 Premier Auction - Closes August 9')!.date, '2025-08-09');
  assert.equal(galleryCloseFor('Love of the Game', 'Spring, 2026 Premier Auction', '2026-04-01')!.date, '2026-04-01', 'never future-dated');
});

test('redateGalleryStubs: stub rows move to the cited close (fxAsOf follows); real closes, uncited stubs and other houses untouched; idempotent', () => {
  const rows: Record<string, unknown>[] = [
    { id: 'lotg-34109', auctionHouse: 'Love of the Game', saleName: null, saleDate: '2023-10-15', datePrecision: 'month', fxAsOf: '2023-10-15', status: 'sold' },
    { id: 'lotg-36566', auctionHouse: 'Love of the Game', saleName: null, saleDate: '2024-07-15', datePrecision: 'month', status: 'sold' },
    { id: 'lelands-94211', auctionHouse: 'Lelands', saleName: null, saleDate: '2019-04-15', datePrecision: 'month', status: 'sold' },
    { id: 'lelands-120421', auctionHouse: 'Lelands', saleName: null, saleDate: '2024-12-15', datePrecision: 'month', status: 'sold' },
    { id: 'lelands-live', auctionHouse: 'Lelands', saleName: null, saleDate: '2026-08-15', datePrecision: 'month', status: 'sold' },
    { id: 'memorylane-34700', auctionHouse: 'Memory Lane', saleName: null, saleDate: '2015-04-15', datePrecision: 'month', status: 'sold' },
    { id: 'memorylane-real', auctionHouse: 'Memory Lane', saleName: null, saleDate: '2026-06-06', status: 'sold' },
    { id: 'lotg-named', auctionHouse: 'Love of the Game', saleName: 'Summer 2024 Set Builder Auction', saleDate: '2024-07-15', datePrecision: 'month', status: 'sold' },
    { id: 'lelands-dt', auctionHouse: 'Lelands', saleName: null, saleDate: '2019-04-15', datePrecision: 'month', saleDateTime: '2019-06-07T21:00:00-04:00', status: 'sold' },
    { id: 'rea-x', auctionHouse: 'REA', saleName: null, saleDate: '2019-04-15', datePrecision: 'month', status: 'sold' },
  ];
  const r = redateGalleryStubs(rows as never, new Date('2026-10-06T12:00:00Z'));
  const by = Object.fromEntries(rows.map(l => [l.id as string, l]));
  assert.equal(r.total, 5);
  assert.equal(r.exact, 1);
  assert.deepEqual(pickRow(by['lotg-34109']), { saleDate: '2023-11-25', datePrecision: 'day', fxAsOf: '2023-11-25' });
  assert.deepEqual(pickRow(by['lotg-36566']), { saleDate: '2024-09-28', datePrecision: 'season', fxAsOf: undefined });
  assert.deepEqual(pickRow(by['lotg-named']), { saleDate: '2024-07-13', datePrecision: 'day', fxAsOf: undefined }, 'a stored saleName picks its own sale');
  assert.deepEqual(pickRow(by['lelands-94211']), { saleDate: '2019-06-07', datePrecision: 'day', fxAsOf: undefined });
  assert.deepEqual(pickRow(by['lelands-120421']), { saleDate: '2024-12-15', datePrecision: 'month', fxAsOf: undefined });
  assert.deepEqual(pickRow(by['lelands-live']), { saleDate: '2026-08-15', datePrecision: 'day', fxAsOf: undefined });
  assert.deepEqual(pickRow(by['memorylane-34700']), { saleDate: '2015-05-09', datePrecision: 'day', fxAsOf: undefined });
  assert.equal(by['memorylane-real'].datePrecision, undefined);
  assert.equal(by['lelands-dt'].saleDate, '2019-04-15', 'a row with a parsed saleDateTime is never touched here');
  assert.equal(by['rea-x'].saleDate, '2019-04-15');
  const again = redateGalleryStubs(rows as never, new Date('2026-10-06T12:00:00Z'));
  assert.equal(again.total + again.exact, 0, 'idempotent');
});

test('the gallery lookahead is gone: LOTG Fall 2023 not known at a Nov 1 cut; ML The Find Winter 2012 not at a Mar 1 2012 cut', () => {
  const lotg = { auctionHouse: 'Love of the Game', saleDate: '2023-10-15', datePrecision: 'month' };
  const ml = { auctionHouse: 'Memory Lane', saleDate: '2012-02-15', datePrecision: 'month' };
  assert.ok(knownKey(lotg) < '2023-11-01' && knownKey(ml) < '2012-03-01', 'the stub was known before the sale closed');
  redateGalleryStubs([lotg, ml] as never, new Date('2026-10-06T12:00:00Z'));
  assert.ok(!(knownKey(lotg) < '2023-11-25') && knownKey(lotg) < '2023-11-26');
  assert.ok(!(knownKey(ml) < '2012-12-15'));
});
