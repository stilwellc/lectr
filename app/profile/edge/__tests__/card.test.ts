/**
 * THE DESK CARD — its numbers and its lines on fixtures (the drawing is a
 * thin canvas layer over cardLines; the clock is pinned).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinClock } from '../../../lib/__tests__/helpers/pin-clock';
pinClock('2026-10-11T12:00:00-04:00');

import type { AuctionLot } from '../../../types';
import type { SavedMeta } from '../../../lib/account';
import type { Follow } from '../../../lib/follows';
import { cardNumbersOf, cardNamesOf, cardLines, cardHasNumber, CARD_W, CARD_H } from '../card';
import { EDGE_MIN_N } from '../edge';

const NOW = Date.now();

function lot(p: Partial<AuctionLot> & { id: string }): AuctionLot {
  return {
    artist: 'andy-warhol', title: 'Flowers', auctionHouse: 'Bonhams', saleDate: '2026-10-20',
    status: 'upcoming', priceUsd: null, estimateLow: 8000, estimateHigh: 12000, currency: 'USD',
    category: 'print', imageUrl: null, url: 'https://x', ...p,
  } as unknown as AuctionLot;
}
const meta = (savedAt: string): SavedMeta => ({ savedAt, estMid: null, signalPct: null, bidCount: null });
const noFollows: Follow[] = [];

test('watching = Σ estimate midpoint over the live watches that carry one; lots counts every live watch', () => {
  const n = cardNumbersOf({
    now: NOW, follows: noFollows, record: { n: 0, med: null }, graded: 0,
    saved: [
      lot({ id: 'a' }),                                                  // mid 10,000
      lot({ id: 'b', estimateLow: 5000, estimateHigh: null }),           // one-sided: 5,000
      lot({ id: 'c', estimateLow: null, estimateHigh: null }),           // live, unpriced
      lot({ id: 'd', status: 'sold', priceUsd: 9000, saleDate: '2026-09-01' }),  // settled: not watching
    ],
    metaFor: () => null,
  });
  assert.equal(n.watchingLots, 3);
  assert.equal(n.watchingPriced, 2);
  assert.equal(n.watchingUsd, 15000);
  assert.equal(n.dateLabel, 'Oct 11, 2026');
});

test('the names: followed names first (never a house), then the makers saved most, ties to the most recent save (R1#19)', () => {
  const metas: Record<string, SavedMeta> = {
    a: meta('2026-09-01T00:00:00Z'), b: meta('2026-09-02T00:00:00Z'), c: meta('2026-09-03T00:00:00Z'),
    d: meta('2026-09-04T00:00:00Z'), e: meta('2026-09-05T00:00:00Z'),
  };
  const saved = [
    lot({ id: 'a', artist: 'andy-warhol' }), lot({ id: 'b', artist: 'andy-warhol' }),
    lot({ id: 'c', artist: 'pablo-picasso' }),
    lot({ id: 'd', artist: 'alexander-calder' }),
    lot({ id: 'e', artist: 'henri-matisse' }),
  ];
  const metaFor = (id: string) => metas[id] ?? null;
  // no follows: most-saved first, ties to the most recent save
  const n = cardNumbersOf({ now: NOW, follows: noFollows, record: { n: 0, med: null }, graded: 0, saved, metaFor });
  assert.equal(n.names.length, 3);
  assert.match(n.names[0], /Warhol/);
  assert.match(n.names[1], /Matisse/);     // most recent of the one-save names
  assert.match(n.names[2], /Calder/);

  // follows lead: KAWS (followed, never saved) stands first; the house is skipped; the most-saved fill the rest
  const followed = cardNumbersOf({
    now: NOW, record: { n: 0, med: null }, graded: 0, saved, metaFor,
    follows: [{ kind: 'house', key: 'Phillips', label: 'Phillips' }, { kind: 'maker', key: 'kaws', label: 'KAWS' }] as Follow[],
  });
  assert.equal(followed.names[0], 'KAWS');
  assert.match(followed.names[1], /Warhol/);
  assert.match(followed.names[2], /Matisse/);
  assert.equal(followed.names.length, 3);

  // a followed name that is also saved is not listed twice
  const dup = cardNumbersOf({
    now: NOW, record: { n: 0, med: null }, graded: 0, saved, metaFor,
    follows: [{ kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' }] as Follow[],
  });
  assert.equal(dup.names.filter(x => /Warhol/.test(x)).length, 1);
  assert.equal(dup.names[0], 'Andy Warhol');

  // follows only, no saves
  const only = cardNumbersOf({
    now: NOW, record: { n: 0, med: null }, graded: 0, saved: [], metaFor: () => null,
    follows: [{ kind: 'house', key: 'Phillips', label: 'Phillips' }, { kind: 'maker', key: 'kaws', label: 'KAWS' }] as Follow[],
  });
  assert.deepEqual(only.names, ['KAWS']);
  // four follows: the card names three
  const four = cardNamesOf([], () => null, (['A', 'B', 'C', 'D'] as const).map(l => ({ kind: 'maker', key: l, label: l })) as unknown as Follow[]);
  assert.deepEqual(four, ['A', 'B', 'C']);
});

test('cardHasNumber: a card of dashes (nothing on the block, no record line) is not offered for download', () => {
  const base = { watchingLots: 0, watchingUsd: 0, watchingPriced: 0, names: ['KAWS'], dateLabel: 'Oct 11, 2026' };
  assert.equal(cardHasNumber(cardLines({ ...base, record: { n: 0, med: null }, graded: 0 })), false);
  assert.equal(cardHasNumber(cardLines({ ...base, record: { n: 7, med: 8.4 }, graded: 2 })), false, 'a record under the gate is not a number on the card');
  assert.equal(cardHasNumber(cardLines({ ...base, record: { n: 7, med: 8.4 }, graded: EDGE_MIN_N })), true);
  assert.equal(cardHasNumber(cardLines({ ...base, watchingLots: 2, watchingUsd: 12000, watchingPriced: 2, record: { n: 0, med: null }, graded: 0 })), true);
});

test('the record line prints only at EDGE_MIN_N graded calls; under it the card says why', () => {
  const base = { watchingUsd: 412000, watchingLots: 12, watchingPriced: 9, names: ['Andy Warhol'], dateLabel: 'Oct 11, 2026' };
  const under = cardLines({ ...base, record: { n: 7, med: 8.4 }, graded: EDGE_MIN_N - 1 });
  assert.equal(under.record, null);
  assert.equal(under.recordNote, `${EDGE_MIN_N - 1} calls graded · the record prints at ${EDGE_MIN_N}`);
  const none = cardLines({ ...base, record: { n: 0, med: null }, graded: 0 });
  assert.equal(none.recordNote, 'no calls graded yet');

  const ok = cardLines({ ...base, record: { n: 7, med: 8.4 }, graded: 5 });
  assert.deepEqual(ok.record, { figure: '+8%', tone: 'up', rest: 'vs estimate · 7 judged · 5 calls graded' });
  assert.equal(ok.recordNote, null);
  assert.equal(ok.headline.figure, '$412K');
  assert.equal(ok.sub, '12 lots to the hammer · 9 of 12 priced, at estimate midpoint');
  assert.equal(ok.foot, 'lectr.bid · Oct 11, 2026 · rendered on this device');

  const down = cardLines({ ...base, record: { n: 3, med: -12.6 }, graded: 3 });
  assert.equal(down.record!.figure, '−13%');
  assert.equal(down.record!.tone, 'down');
});

test('an empty block prints an em dash, never $0', () => {
  const l = cardLines({ watchingUsd: 0, watchingLots: 0, watchingPriced: 0, record: { n: 0, med: null }, graded: 0, names: [], dateLabel: 'Oct 11, 2026' });
  assert.equal(l.headline.figure, '—');
  assert.equal(l.sub, 'nothing on the block');
  assert.equal(CARD_W, 1200);
  assert.equal(CARD_H, 630);
});
