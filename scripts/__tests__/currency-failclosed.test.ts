/**
 * Currency fail-closed (Oct 6 2026): a currency the money layer cannot convert
 * is never relabelled USD — the crawler stamps no price/estimate and
 * compExcludes the row; DKK/SEK/NOK/JPY convert at dated Fed rates; the Bruun
 * Rasmussen rows already in the segments (DKK figures stamped USD at rate 1)
 * are re-derived by normalize.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCurrency, isoCurrencyToInternal, stampMoney, statusWithMoney, FX_UNKNOWN_EXCLUDE } from '../lib/houses/common';
import { parseChristiesCurrency } from '../lib/houses/christies';
import { fxRateFor, toUsdDated, FX_BY_YEAR } from '../../app/lib/normalize';
import { CURRENCIES, isCurrency } from '../../app/types';
import { restampBruunCurrency } from '../lib/corpus-normalize';

test('detectCurrency: known codes/symbols, bare $ is USD, unknown/ambiguous → null (never USD)', () => {
  assert.equal(detectCurrency('USD 10,000 - 20,000'), 'USD');
  assert.equal(detectCurrency('$'), 'USD');
  assert.equal(detectCurrency('HK$'), 'HKD');
  assert.equal(detectCurrency('AU$'), 'AUD');
  assert.equal(detectCurrency('£'), 'GBP');
  assert.equal(detectCurrency('CHF 5,000'), 'CHF');
  assert.equal(detectCurrency('DKK 40,000'), 'DKK');
  assert.equal(detectCurrency('SEK 12,000'), 'SEK');
  assert.equal(detectCurrency('NOK 9,000'), 'NOK');
  assert.equal(detectCurrency('JPY 1,000,000'), 'JPY');
  assert.equal(detectCurrency('CNY 800,000'), 'CNY');
  assert.equal(detectCurrency('RMB 800,000'), 'CNY');
  assert.equal(detectCurrency('¥ 800,000'), null, 'a bare yen sign is CNY or JPY — ambiguous');
  assert.equal(detectCurrency('INR 50,00,000'), null);
  assert.equal(detectCurrency('1,200 SGD'), null);
  assert.equal(detectCurrency(''), null);
  assert.equal(detectCurrency('Estimate on request'), null);
  assert.equal(parseChristiesCurrency('USD 12,600 USD 8,000 - 12,000'), 'USD');
  assert.equal(parseChristiesCurrency('INR 1,20,000'), null);
});

test('isoCurrencyToInternal: unknown ISO → null, case-insensitive, DKK known', () => {
  assert.equal(isoCurrencyToInternal('DKK'), 'DKK');
  assert.equal(isoCurrencyToInternal('dkk'), 'DKK');
  assert.equal(isoCurrencyToInternal('INR'), null);
  assert.equal(isoCurrencyToInternal(''), null);
  assert.equal(isoCurrencyToInternal(undefined), null);
});

test('stampMoney fail-closed: unknown currency → no price, no estimate, compExclude; sold → unknown-result', () => {
  const m = stampMoney({ isSold: true, nativeCurrency: null, saleDate: '2026-09-16', hammerNative: 12000, premiumNative: 15600, estLowNative: 10000, estHighNative: 12000, priceBasis: 'realized' });
  assert.equal(m.compExclude, FX_UNKNOWN_EXCLUDE);
  for (const k of ['realizedUsd', 'priceUsd', 'hammerUsd', 'estLowUsd', 'estHighUsd', 'estimateLow', 'estimateHigh', 'realizedNative', 'estLowNative'] as const) assert.equal(m[k], null, k);
  assert.equal((m as { currency?: string }).currency, undefined, 'never a USD label');
  assert.equal(statusWithMoney('sold', m), 'unknown-result');
  assert.equal(statusWithMoney('upcoming', m), 'upcoming');
  const ok = stampMoney({ isSold: true, nativeCurrency: 'DKK', saleDate: '2026-09-16', hammerNative: 14500, premiumNative: null, estLowNative: 10000, estHighNative: 12000, priceBasis: 'hammer-only' });
  assert.equal(ok.compExclude, undefined);
  assert.equal(statusWithMoney('sold', ok), 'sold');
  assert.equal(ok.estLowUsd, Math.round(10000 * FX_BY_YEAR.DKK[2026] * 100) / 100);
  assert.equal(ok.currency, 'DKK');
});

test('FX: every CURRENCIES entry has a full 2000–2026 dated row; DKK/SEK/NOK/JPY at Fed G.5A levels', () => {
  for (const c of CURRENCIES) for (let y = 2000; y <= 2026; y++) assert.ok(FX_BY_YEAR[c][y] > 0, `${c} ${y}`);
  assert.ok(isCurrency('JPY') && isCurrency('DKK') && isCurrency('SEK') && isCurrency('NOK'));
  assert.equal(fxRateFor('DKK', '2024-05-01').rate, 0.1450);   // G.5A 2024: 6.8950 DKK/USD
  assert.equal(fxRateFor('JPY', '2015-05-01').rate, 0.008261); // G.5A 2015: 121.05 JPY/USD
  assert.equal(fxRateFor('SEK', '2008-01-01').rate, 0.1519);
  assert.equal(fxRateFor('NOK', '2023-06-30').rate, 0.0946);
  // a yen figure converts to cents, not dollars-per-yen
  assert.equal(toUsdDated(1_000_000, 'JPY', '2026-03-01').usd, 6308);
});

test('restampBruunCurrency: BR rows stamped USD@1 are re-derived as DKK; idempotent; other rows untouched', () => {
  const br = {
    id: 'bonhams-brk_1008629-1E3C2B51D7CF', auctionHouse: 'Bruun Rasmussen', status: 'upcoming', saleDate: '2026-10-27',
    nativeCurrency: 'USD', currency: 'USD', fxRate: 1, fxAsOf: '2026-10-27',
    estLowNative: 40000, estHighNative: 40000, estLowUsd: 40000, estHighUsd: 40000, estimateLow: 40000, estimateHigh: 40000,
    hammerNative: null, premiumNative: null, realizedNative: null, hammerUsd: null, premiumUsd: null, realizedUsd: null, priceUsd: null,
  };
  const other = { ...br, id: 'bonhams-33077-1', auctionHouse: 'Bonhams' };
  const lots = [br, other] as never[];
  assert.equal(restampBruunCurrency(lots), 1);
  assert.equal(br.nativeCurrency, 'DKK');
  assert.equal(br.fxRate, FX_BY_YEAR.DKK[2026]);
  assert.equal(br.estLowUsd, Math.round(40000 * FX_BY_YEAR.DKK[2026] * 100) / 100); // ≈ $6,216, not $40,000
  assert.equal(br.estimateLow, br.estLowUsd);
  assert.equal(br.realizedUsd, null);
  assert.equal(other.estLowUsd, 40000);
  assert.equal(restampBruunCurrency(lots), 0, 'idempotent');
});
