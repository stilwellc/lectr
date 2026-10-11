/**
 * W23 (Oct 11 2026) — the lot page reads as ONE lot, ONE number:
 *   1. "no engine read" never prints over a lot that prints a lectr value
 *      (an abstain that held back only the flag or the max bid);
 *   2. the lot page and the comps modal print money in ONE format — lot-face
 *      fmtFace — never the whole-K formatPrice beside it ($1,272 read "$1K
 *      bid" over "projected close ~$3.3K");
 *   3. the projected close is held against the PRINTED likely range, never
 *      an unprinted "floor".
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync } from 'fs';
import path from 'path';
import { decisionOf, decisionParts, lotFace } from '../lot-face';
import type { AuctionLot } from '../../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const NOW = Date.parse('2026-10-09T20:00:00Z');

const base = (o: Partial<AuctionLot>): AuctionLot => ({
  id: 'x', title: 'A lot', artist: 'andy-warhol', auctionHouse: "Christie's", saleName: 'Post-War',
  status: 'upcoming', saleDate: '2026-10-14', estimateLow: 2_390_000, estimateHigh: 3_330_000, ...o,
} as unknown as AuctionLot);

test('an abstain that held back the flag (a value still prints) is not "no engine read"', () => {
  // the live Christie's Diamond Dust Shoes shape: flag:purity, low confidence
  // (no certified floor → no max bid), a full expected-hammer read
  const l = base({ value: {
    abstain: 'flag:purity', confidence: 'low', n: 15, basis: 'comp', compValueUsd: 3_307_341, low: 2_063_781, high: 6_551_842,
    expectedHammerUsd: 2_612_574, bandLowUsd: 1_612_329, bandHighUsd: 5_272_002, maxBidUsd: 2_249_309, premiumFactor: 1.266,
    compRatio: 0.56, estimateUsd: null, signal: null, exact: null, poolIds: [],
  } } as unknown as Partial<AuctionLot>);
  const f = lotFace(l);
  assert.ok(f.value, 'the lot prints a lectr value');
  assert.equal(f.maxBid, null, 'no certified max bid at low confidence');
  const d = decisionOf(l, NOW, f);
  assert.equal(d.abstained, false);
  assert.ok(!decisionParts(d).includes('no engine read'), decisionParts(d).join(' · '));
});

test('an engine that abstained outright still says so', () => {
  const l = base({ value: { abstain: 'thin', n: 0 } } as unknown as Partial<AuctionLot>);
  const d = decisionOf(l, NOW);
  assert.equal(lotFace(l).value, null);
  assert.equal(d.abstained, true);
  assert.ok(decisionParts(d).includes('no engine read'));
});

test('the lot page and the modal print money through fmtFace only', () => {
  for (const f of ['app/components/LotPage.tsx', 'app/components/ComparableModal.tsx']) {
    const c = src(f);
    assert.doesNotMatch(c, /\bformatPrice\(/, `${f}: no whole-K formatPrice beside the face figures`);
  }
  const page = src('app/components/LotPage.tsx');
  // the projected close names the printed likely range, not an unprinted floor
  assert.match(page, /under the likely low/);
  assert.doesNotMatch(page, /`\$\{pc\.allInText\} vs \$\{formatPrice/);
});
