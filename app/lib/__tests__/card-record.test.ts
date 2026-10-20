/**
 * W17 CARD SALES LABELS — the card's own record printed beside its value
 * reads the value's window: every count and window printed equals the engine
 * stamp (value.n, value.cardTier, value.poolIds, cardComps.r), the all-time
 * figure prints dated, and the hammer value is told apart from all-in sales.
 */
import { pinClock } from './helpers/pin-clock';
pinClock('2026-10-09T16:00:00Z');
import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import {
  spanOf, spanText, cardRecordStamp, cardRecordOf, rungView, cardValueBasis, valueRowFlags, inCardWindow,
  CARD_WINDOW_Y, CARD_SINGLE_Y, CARD_HL_Y, ladderBasisText,
} from '../card-record';
import { lotFace, fmtFace } from '../lot-face';
import type { AuctionLot } from '../../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const UP = path.join(ROOT, 'public/data/ray/upcoming.json');
const NOW = Date.parse('2026-10-09T12:00:00Z');

// the 1951 Bowman Mantle SGC 3 as served Oct 9 2026 (the audit's lot)
const MANTLE_SALES = [
  { d: '2026-08-16', p: 24600 }, { d: '2026-04-19', p: 21525 }, { d: '2023-11-02', p: 10370 },
  { d: '2023-11-02', p: 10004 }, { d: '2023-10-01', p: 13542 },
];
const mantle = (cc: Record<string, unknown> = {}, v: Record<string, unknown> = {}) => ({
  id: 'goldin-mantle', artist: 'sports-cards', title: '1951 Bowman #253 Mickey Mantle Rookie Card - SGC VG 3',
  status: 'upcoming', auctionHouse: 'Goldin', saleDate: '2026-10-17', currentBid: 4750,
  value: {
    poolIds: ['rea-177106', 'rea-193078'], n: 2, compValueUsd: 23356, low: 15905, high: 39238, compRatio: null, signal: null,
    estimateUsd: 23356, vsBid: null, confidence: 'medium', exact: null, basis: 'card-comp', cardTier: 'exact',
    expectedHammerUsd: 19144, bandLowUsd: 13037, bandHighUsd: 32162, maxBidUsd: 16617, premiumFactor: 1.22, ...v,
  },
  cardComps: { med: 10370, n: 11, lastSales: MANTLE_SALES, gradeLadder: [], ...cc },
  signal: null,
} as unknown as AuctionLot);

test('the engine and the page share one window (build-market imports card-record)', () => {
  assert.strictEqual(CARD_WINDOW_Y, 1);
  assert.strictEqual(CARD_SINGLE_Y, 0.5);
  assert.strictEqual(CARD_HL_Y, 0.25);
  const bm = readFileSync(path.join(ROOT, 'scripts/build-market.ts'), 'utf8');
  assert.match(bm, /import \{ CARD_WINDOW_Y, CARD_SINGLE_Y, CARD_HL_Y, cardRecordStamp \} from '\.\.\/app\/lib\/card-record'/);
  assert.doesNotMatch(bm, /const CARD_WINDOW_Y\s*=/, 'no private copy of the window');
});

test('the value basis: the engine count and window, per tier', () => {
  assert.strictEqual(cardValueBasis({ basis: 'card-comp', cardTier: 'exact', n: 2 }), 'from 2 sales of this card & grade in the last year');
  // a lone exact sale prices only inside CARD_SINGLE_Y
  assert.strictEqual(cardValueBasis({ basis: 'card-comp', cardTier: 'exact', n: 1 }), 'from 1 sale of this card & grade in the last 6 months');
  // (the weighting rides the value's leader row length budget unsaid — the count and window are the claim)
  assert.strictEqual(cardValueBasis({ basis: 'card-comp', cardTier: 'exact', n: 7 }), 'from 7 sales of this card & grade in the last year');
  // the TCG tier has no recency window — it never claims one
  assert.strictEqual(cardValueBasis({ basis: 'card-comp', cardTier: 'tcg-exact', n: 3 }), 'from 3 sales of this card & grade, newest weighted most');
  assert.doesNotMatch(cardValueBasis({ basis: 'card-comp', cardTier: 'tcg-grade-adj', n: 3 })!, /last year/);
  assert.strictEqual(cardValueBasis({ basis: 'hedonic', n: 3 }), null);
});

test('the stamp: the last year’s median + n and the span on file, as of the build', () => {
  const st = cardRecordStamp(MANTLE_SALES.concat([{ d: '2021-12-05', p: 9000 }, { d: '2022-03-01', p: 9500 }]), NOW);
  assert.deepStrictEqual(st.r, { med: 23063, n: 2 });
  // 7 sales: 2021, 2022, 2023 ×3, 2026 ×2 — 2022–23 holds four of them
  assert.deepStrictEqual(st.s, { y0: 2021, y1: 2026, m0: 2022, m1: 2023 });
  // the engine year is 365.25 days: inside it in, past it out
  assert.ok(inCardWindow('2025-10-10', NOW));
  assert.ok(!inCardWindow('2025-10-09', NOW));
  assert.ok(!inCardWindow('2026-10-10', NOW), 'a sale after the build is never "in the last year"');
  assert.deepStrictEqual(cardRecordStamp([{ d: '2019-01-01', p: 5 }], NOW).r, { med: null, n: 0 });
});

test('the all-time figure prints dated', () => {
  assert.strictEqual(spanText(11, { y0: 2021, y1: 2026, m0: 2021, m1: 2023 }), 'since 2021 · 11 sales, most 2021–23');
  assert.strictEqual(spanText(2, { y0: 2023, y1: 2023, m0: 2023, m1: 2023 }), '2 sales, 2023');
  assert.strictEqual(spanText(11, null), '11 sales on file');
  assert.deepStrictEqual(spanOf(['1999-01-01', '2001-01-01', '2001-05-01']), { y0: 1999, y1: 2001, m0: 2001, m1: 2001 });
});

test('Mantle SGC 3 (pre-W17 data): the figure beside the $19K value is the last year’s, the all-time one labelled', () => {
  const f = lotFace(mantle());
  assert.strictEqual(f.value!.text, fmtFace(19144));
  assert.strictEqual(f.card!.basis, 'from 2 sales of this card & grade in the last year');
  assert.strictEqual(f.card!.window, 'year');
  assert.strictEqual(f.card!.n, 2);
  assert.strictEqual(f.card!.med, Math.round((24600 + 21525) / 2));
  assert.strictEqual(f.card!.head, `${fmtFace(23063)} median · 2 sales in the last year`);
  assert.strictEqual(f.card!.sub, 'median · 2 sales in the last year · all-time $10K, 11 sales');
  assert.ok(!/\$10K median · 11 sales$/.test(f.card!.head), 'never the bare all-time median');
  // hammer value vs all-in sales, said once
  assert.strictEqual(f.card!.note, `Realized prices — winning bid plus buyer’s premium. The lectr value ${fmtFace(19144)} is the expected hammer, before premium: ${fmtFace(23356)} all-in at 22%.`);
  // the rows the value read: the two 2026 sales
  assert.deepStrictEqual(valueRowFlags(mantle(), MANTLE_SALES), [true, true, false, false, false]);
});

test('Mantle SGC 3 (W17 stamp): the stamp is the printed count, and the all-time figure is dated', () => {
  const ids = MANTLE_SALES.map((s, i) => ({ ...s, id: i === 0 ? 'rea-193078' : i === 1 ? 'rea-177106' : `x${i}` }));
  const lot = mantle({ lastSales: ids, r: { med: 23063, n: 2 }, s: { y0: 2021, y1: 2026, m0: 2021, m1: 2023 } });
  const f = lotFace(lot);
  assert.strictEqual(cardRecordOf(lot)!.recentFrom, 'stamp');
  assert.strictEqual(f.card!.n, 2);
  assert.strictEqual(f.card!.allTime, '$10K median · since 2021 · 11 sales, most 2021–23');
  assert.strictEqual(f.card!.sub, 'median · 2 sales in the last year · all-time $10K, 11 sales since 2021');
  // ids mark the rows, not their order
  assert.deepStrictEqual(valueRowFlags(lot, ids), [true, true, false, false, false]);
});

test('a card with no sale in the last year prints its all-time median, dated, and says so', () => {
  const lot = mantle({ med: 7800, n: 13, lastSales: [{ d: '2022-08-14', p: 26400 }], r: { med: null, n: 0 }, s: { y0: 2008, y1: 2022, m0: 2019, m1: 2022 } },
    { n: 0, cardTier: undefined, basis: undefined });
  const f = lotFace({ ...lot, value: null } as AuctionLot);
  assert.strictEqual(f.card!.window, 'all');
  assert.strictEqual(f.card!.med, 7800);
  assert.strictEqual(f.card!.head, '$7.8K all-time median · since 2008 · 13 sales, most 2019–22 · none in the last year');
});

test('grade-ladder rungs: the last year’s median when the grade sold in it, else all-time, dated', () => {
  const y = rungView({ g: 'PSA 3', med: 15490, n: 25, rn: 3, rmed: 18000, y0: 2008, y1: 2026, m0: 2019, m1: 2023 }, fmtFace);
  assert.strictEqual(y.price, 18000);
  assert.strictEqual(y.basis, 'year');
  assert.strictEqual(y.meta, '3 sales in the last year · all-time $15K, 25 since 2008');
  const a = rungView({ g: 'SGC 2.5', med: 4305, n: 3, rn: 0, rmed: null, y0: 2021, y1: 2023, m0: 2021, m1: 2023 }, fmtFace);
  assert.strictEqual(a.price, 4305);
  assert.strictEqual(a.meta, 'all-time, 3 sales 2021–23 · none in the last year');
  // unstamped data: labelled all-time, never passed off as current
  const u = rungView({ g: 'PSA 1', med: 7170, n: 12 }, fmtFace);
  assert.strictEqual(u.meta, 'all-time median · 12 sales');
  assert.strictEqual(ladderBasisText([{ g: 'PSA 1', med: 1, n: 2 }]), 'all-time medians, never means');
});

test('the served book: every printed card count and window equals the engine stamp', { skip: !existsSync(UP) }, () => {
  const u = JSON.parse(readFileSync(UP, 'utf8')) as { generatedAt: string; lots: AuctionLot[] };
  const asOf = Date.parse(u.generatedAt);
  let checked = 0, eligible = 0;
  for (const l of u.lots) {
    const v = l.value as (AuctionLot['value'] & { cardTier?: string; abstain?: string }) | null | undefined;
    if (!v || v.basis !== 'card-comp' || v.cardTier !== 'exact' || !l.cardComps) continue;
    if (typeof v.abstain === 'string' && v.abstain.startsWith('card:')) continue;
    eligible++;
    const f = lotFace(l);
    if (!f.value) continue;
    // the basis prints the engine's n
    assert.ok(f.card!.basis!.startsWith(`from ${v.n} ${v.n === 1 ? 'sale' : 'sales'} of this card & grade in the last`), l.id);
    const rows = l.cardComps.lastSales.filter(s => s.p > 0);
    const flags = valueRowFlags(l, rows);
    // the marked rows are the engine's pool, and every one sits in the window as of the build
    assert.strictEqual(flags.filter(Boolean).length, Math.min(v.n, rows.length), l.id);
    rows.forEach((r, i) => { if (flags[i]) assert.ok(inCardWindow(r.d, asOf), `${l.id} row ${i}`); });
    // the last-year figure's n is the engine's n
    const rec = cardRecordOf(l, asOf)!;
    if (rec.recent && rec.recentFrom !== 'rows') assert.strictEqual(rec.recent.n, v.n, l.id);
    if (l.cardComps.r) assert.strictEqual(l.cardComps.r.n, v.n, `${l.id}: stamp r.n = value.n`);
    checked++;
  }
  // not vacuous, and the face prints most of the engine's exact-tier cards —
  // judged against what the book holds tonight, not a fixed market size: the
  // exact-tier count swings with the houses' calendars (Oct 19 2026: REA's sale
  // closed and it fell 486 → 18 overnight, and a `> 100` floor blocked every deploy)
  assert.ok(checked > 0 && checked >= Math.ceil(eligible / 2), `checked ${checked} of ${eligible} exact-tier cards`);
});
