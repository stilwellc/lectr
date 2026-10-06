/**
 * season-dates.test.ts — REA / Huggins & Scott sales are dated by their real
 * close (scripts/lib/sale-close-dates.ts), not seasonToDate's mid-month stub.
 * The stub read REA Summer as known at July's end (closes mid-August), REA
 * Fall at October's end (closes early December) and H&S "2022 February" at
 * February's end (closed April 7) — lookahead in every replay cut between.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saleCloseFor, parseSaleLabel, SALE_CLOSE_DATES } from '../lib/sale-close-dates';
import { seasonToDate } from '../lib/sports-crawl';
import { redateSeasonSales } from '../lib/corpus-normalize';
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

test('fallbacks: unknown season → quarter end; H&S month → end of month+2; REA monthly keeps the stub', () => {
  assert.deepEqual(pick(saleCloseFor('REA', '2027 Summer')), { date: '2027-09-30', precision: 'season' });
  assert.deepEqual(pick(saleCloseFor('Huggins & Scott', '2027 Winter')), { date: '2027-03-31', precision: 'season' });
  assert.deepEqual(pick(saleCloseFor('Huggins & Scott', '2018 June')), { date: '2018-08-31', precision: 'season' });
  assert.deepEqual(pick(saleCloseFor('Huggins & Scott', '2030 December')), { date: '2031-02-28', precision: 'season' });
  assert.equal(saleCloseFor('REA', '2026 January'), null, 'REA monthly sales close inside their month');
  assert.equal(saleCloseFor('Lelands', '2019 Summer'), null, 'other houses untouched');
  // a sold row is never future-dated: the bound clamps to the day it is read
  assert.equal(saleCloseFor('REA', '2027 Summer', '2027-08-20')!.date, '2027-08-20');
});

test('seasonToDate: house-aware resolves the table; house-less keeps the stub (Lelands gallery path)', () => {
  assert.equal(seasonToDate('2019 Summer', 'REA'), '2019-08-18');
  assert.equal(seasonToDate('2026 January', 'REA'), '2026-01-15');
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
    { id: 'hugginsscott-2026-summer-1', auctionHouse: 'Huggins & Scott', saleName: '2026 Summer', saleDate: '2026-09-10', saleDateTime: '2026-09-10T22:01:00-04:00', status: 'sold' },
    { id: 'rea-live', auctionHouse: 'REA', saleName: '2026 Summer', saleDate: '2026-07-15', datePrecision: 'month', saleDateTime: '2026-08-16T23:40:00-04:00', status: 'sold' },
    { id: 'lelands-1', auctionHouse: 'Lelands', saleName: '2019 Summer', saleDate: '2019-07-15', datePrecision: 'month', status: 'sold' },
  ];
  const r = redateSeasonSales(rows as never, new Date('2026-10-05T12:00:00Z'));
  const by = Object.fromEntries(rows.map(l => [l.id as string, l]));
  assert.equal(r.total, 5);
  assert.deepEqual(pickRow(by['rea-57561']), { saleDate: '2019-08-18', datePrecision: 'day', fxAsOf: '2019-08-18' });
  assert.deepEqual(pickRow(by['rea-fall']), { saleDate: '2025-12-07', datePrecision: 'day', fxAsOf: '2025-12-07' });
  assert.deepEqual(pickRow(by['hugginsscott-2022-february-1']), { saleDate: '2022-04-07', datePrecision: 'day', fxAsOf: '2022-04-07' });
  assert.equal(by['hugginsscott-2018-november-52'].datePrecision, 'day', 'cited close on the 15th → day, not month');
  assert.deepEqual(pickRow(by['hugginsscott-2018-june-1']), { saleDate: '2018-08-31', datePrecision: 'season', fxAsOf: undefined });
  assert.deepEqual(pickRow(by['rea-jan']), { saleDate: '2026-01-15', datePrecision: 'month', fxAsOf: undefined });
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
