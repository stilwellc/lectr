/**
 * Fine-art comps at the top end (Oct 10 2026). QA: the $9.3M Warhol
 * "5 Deaths Twice II" printed a $135K comps median in the modal — the
 * context rows answered to none of the engine's pool guards, the size gate
 * mis-read flush units ("41in."), and the form pool mixed every tier of the
 * maker's record. These pin the three fixes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../app/types';
import { parseDims, guardedMedian, contextComps, appraiseLot, COMP_TIER } from '../../app/lib/comps';

let seq = 0;
const lot = (o: Partial<AuctionLot>): AuctionLot => ({
  id: `t-${++seq}`, artist: 'andy-warhol', title: `Untitled ${seq}`, category: 'original',
  auctionHouse: "Christie's", saleName: '', saleDate: '2024-05-01', currency: 'USD',
  status: 'sold', url: '', formKey: 'painting', medium: 'acrylic and silkscreen ink on canvas',
  ...o,
} as AuctionLot);

test('parseDims: the leading measurement unit wins (flush "in.", cm-first strings)', () => {
  assert.deepEqual(parseDims('48 x 41in. (122 x 104cm.)'), [48, 41]);
  const cmFirst = parseDims('122 x 104 cm (48 x 41 in.)')!;
  assert.ok(Math.abs(cmFirst[0] - 48.03) < 0.01 && Math.abs(cmFirst[1] - 40.94) < 0.01);
  assert.deepEqual(parseDims('40 x 40 in. (101.6 x 101.6 cm.)'), [40, 40]);
  assert.deepEqual(parseDims('24 x 18"'), [24, 18]);
  const cm = parseDims('35.6 by 30.5 cm.')!;
  assert.ok(Math.abs(cm[0] - 14.016) < 0.01);
  // 'including' is not an inch token
  const inc = parseDims('50 x 40 cm, including frame')!;
  assert.ok(Math.abs(inc[0] - 19.685) < 0.01);
});

test('guardedMedian: floor ≥3, dispersion ≤2.5, ×5 estimate scale', () => {
  assert.equal(guardedMedian([100, 200], 150), null, 'pool floor');
  assert.equal(guardedMedian([100, 120, 130], 120), 120);
  assert.equal(guardedMedian([10, 100, 1000, 10000], null), null, 'dispersed pool says nothing');
  assert.equal(guardedMedian([100, 110, 120], 9_000), null, 'off the estimate scale');
  assert.equal(guardedMedian([100, 110, 120], null), 110, 'no estimate → no scale test');
});

test('context: a $9.3M painting never prints a median off small/late works', () => {
  const anchor = lot({ id: 'deaths', title: '5 Deaths Twice II', status: 'upcoming', estimateLow: 7_980_000, estimateHigh: 10_640_000, dimensions: '51.2 x 76.7cm.' });
  // the maker's commission-tier record: estimates $80–200K, realized ~$130K
  const pool = Array.from({ length: 9 }, (_, i) => lot({ title: `Portrait ${i}`, estimateLow: 80_000, estimateHigh: 120_000 + i * 10_000, priceUsd: 120_000 + i * 5_000 }));
  const ctx = contextComps(anchor, [anchor, ...pool]);
  assert.equal(ctx.median, null);
  assert.equal(ctx.rows.length, 0, 'no pool → the modal renders the "no comparable sales clear the gates" state');
});

test('context + appraisal: art reads through the estimate-tier band', () => {
  const anchor = lot({ id: 'anchor', title: 'Big Canvas', status: 'upcoming', estimateLow: 3_000_000, estimateHigh: 4_000_000 });
  const tierComps = Array.from({ length: 4 }, (_, i) => lot({ title: `Tier work ${i}`, estimateLow: 2_500_000, estimateHigh: 3_500_000, priceUsd: 3_200_000 + i * 200_000 }));
  // a low-tier mass that would otherwise dominate the median
  const lowTier = Array.from({ length: 12 }, (_, i) => lot({ title: `Small work ${i}`, estimateLow: 60_000, estimateHigh: 80_000, priceUsd: 700_000 + i * 1_000 }));
  // a comp with no pre-sale estimate carries no tier evidence
  const noEst = lot({ title: 'Unknown tier', priceUsd: 3_000_000 });
  const book = [anchor, ...tierComps, ...lowTier, noEst];
  const ctx = contextComps(anchor, book);
  assert.equal(ctx.rows.length, 4);
  assert.ok(ctx.rows.every(r => r.title.startsWith('Tier work')));
  assert.equal(ctx.median, 3_500_000);
  const ap = appraiseLot(anchor, book)!;
  assert.ok(ap);
  assert.equal(ap.kind, 'form');
  assert.equal(ap.n, 4);
  assert.equal(ap.value, 3_500_000);
  assert.equal(COMP_TIER.ratio, 2);
});

test('the tier band is art/design only — a watch pool is untouched', () => {
  const w = (o: Partial<AuctionLot>) => lot({ artist: 'rolex', category: 'object', formKey: 'wristwatch', medium: null as unknown as string, reference: '16520', title: 'Rolex Daytona ref. 16520 stainless steel', ...o });
  const anchor = w({ id: 'w-anchor', status: 'upcoming', estimateLow: 20_000, estimateHigh: 30_000 });
  // comps priced at the same scale, but no pre-sale estimates at all
  const comps = Array.from({ length: 5 }, (_, i) => w({ priceUsd: 25_000 + i * 1_000 }));
  const ap = appraiseLot(anchor, [anchor, ...comps]);
  assert.ok(ap, 'estimate-less watch comps still read');
  assert.equal(ap!.n, 5);
});
