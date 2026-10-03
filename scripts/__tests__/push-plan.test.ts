import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planSends, closeKindFor, classifyPushError, dedupeKey, isFreshHammer, payloadFor, shouldRetire,
  type LiveLot, type SettledLot, type Watch,
} from '../lib/push-plan';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const live = (id: string, closeInMs: number | null, extra: Partial<LiveLot> = {}): LiveLot => ({
  id, title: `Lot ${id}`, auctionHouse: 'Goldin', saleDate: iso(NOW + (closeInMs ?? 0)).slice(0, 10),
  saleDateTime: closeInMs == null ? null : iso(NOW + closeInMs), currentBid: 500, value: { compValueUsd: 1200 }, ...extra,
});
const base = (o: Partial<Parameters<typeof planSends>[0]>) => planSends({
  usersWithSubs: new Set(['u1', 'u2']), watches: [], live: new Map(), settled: new Map(),
  sent: new Set(), forecasts: new Map(), now: NOW, ...o,
});

test('closeKindFor: timed windows', () => {
  assert.equal(closeKindFor(live('a', 30 * 60_000), NOW), 'close1');
  assert.equal(closeKindFor(live('a', 89 * 60_000), NOW), 'close1');
  assert.equal(closeKindFor(live('a', 2 * H), NOW), 'close24');
  assert.equal(closeKindFor(live('a', 24 * H), NOW), 'close24');
  assert.equal(closeKindFor(live('a', 25 * H), NOW), null);
  assert.equal(closeKindFor(live('a', -60_000), NOW), null, 'already closed');
});

test('closeKindFor: date-only sale gets close24 today/tomorrow only, never close1', () => {
  assert.equal(closeKindFor({ id: 'd', saleDate: '2026-10-03' }, NOW), 'close24');
  assert.equal(closeKindFor({ id: 'd', saleDate: '2026-10-04' }, NOW), 'close24');
  assert.equal(closeKindFor({ id: 'd', saleDate: '2026-10-05' }, NOW), null);
  assert.equal(closeKindFor({ id: 'd', saleDate: 'garbage' }, NOW), null);
});

test('dedupe: a lot already in push_log for user×kind is never planned again', () => {
  const watches: Watch[] = [{ user_id: 'u1', lot_id: 'a' }, { user_id: 'u2', lot_id: 'a' }];
  const plan = base({ watches, live: new Map([['a', live('a', 5 * H)]]), sent: new Set([dedupeKey('u1', 'a', 'close24')]) });
  assert.deepEqual(plan.map(p => [p.userId, p.kind, p.lotIds]), [['u2', 'close24', ['a']]]);
});

test('dedupe: close24 sent does not block close1; alias ids collapse to one push', () => {
  const watches: Watch[] = [{ user_id: 'u1', lot_id: 'a' }, { user_id: 'u1', lot_id: 'a~' }];
  const plan = base({ watches, live: new Map([['a', live('a', 40 * 60_000)]]), sent: new Set([dedupeKey('u1', 'a', 'close24')]) });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'close1');
  assert.equal(dedupeKey('u1', 'a~', 'close1'), dedupeKey('u1', 'a', 'close1'));
});

test('users without a subscription are skipped', () => {
  const plan = base({ watches: [{ user_id: 'u9', lot_id: 'a' }], live: new Map([['a', live('a', 5 * H)]]) });
  assert.equal(plan.length, 0);
});

test('volume cap: overflow collapses into one summary that still logs every lot', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const plan = base({
    watches: ids.map(id => ({ user_id: 'u1', lot_id: id })),
    live: new Map(ids.map((id, i) => [id, live(id, (2 + i) * H)])),
  });
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.slice(0, 2).map(p => p.lotIds[0]), ['a', 'b'], 'soonest first');
  assert.deepEqual(plan[2].lotIds, ['c', 'd', 'e']);
  assert.match(plan[2].payload.title, /3 more watched lots close within 24 hours/);
  assert.equal(plan[2].payload.url, '/profile');
});

test('hammer: fresh sold lot with forecast snapshot; stale or unsold never', () => {
  const settled = new Map<string, SettledLot>([
    ['s1', { id: 's1~', title: 'Mantle 1952 Topps', house: 'Heritage', status: 'sold', price_usd: 12500, sale_date: '2026-10-02' }],
    ['s2', { id: 's2', status: 'sold', price_usd: 900, sale_date: '2026-09-01' }],
    ['s3', { id: 's3', status: 'bought_in', price_usd: null, sale_date: '2026-10-02' }],
  ]);
  const plan = base({
    watches: ['s1', 's2', 's3'].map(id => ({ user_id: 'u1', lot_id: id })),
    settled, forecasts: new Map([['s1', 11000]]),
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'hammer');
  assert.equal(plan[0].payload.body, 'Sold for $13K at Heritage (lectr forecast $11K).');
  assert.equal(plan[0].payload.url, '/lot?id=s1');
  assert.equal(isFreshHammer(settled.get('s2')!, NOW), false);
});

test('hammer without a captured forecast says nothing about one', () => {
  const p = payloadFor('hammer', { id: 'x', title: 'A', price: 800 });
  assert.equal(p.body, 'Sold for $800.');
});

test('payloads: close copy carries bid + forecast, date-only says the day, no advice words', () => {
  const p = payloadFor('close24', { id: 'x', title: 'Rolex 1675', house: 'Phillips', bid: 9000, forecast: 14000 });
  assert.equal(p.title, 'Closes within 24 hours: Rolex 1675');
  assert.equal(p.body, 'On the block at Phillips · bid $9K · lectr forecast $14K.');
  const d = payloadFor('close24', { id: 'x', title: 'A', dateOnly: true, sameDay: true });
  assert.match(d.title, /^Sells today/);
  for (const t of [p.title, p.body, d.title]) assert.doesNotMatch(t, /\b(buy|bid now|don't miss|hurry)\b/i);
});

test('classifyPushError: 404/410 prune, 429/5xx/network retry, 4xx error', () => {
  assert.equal(classifyPushError(404), 'prune');
  assert.equal(classifyPushError(410), 'prune');
  assert.equal(classifyPushError(429), 'retry');
  assert.equal(classifyPushError(503), 'retry');
  assert.equal(classifyPushError(undefined), 'retry');
  assert.equal(classifyPushError(403), 'error');
  assert.equal(classifyPushError(413), 'error');
  assert.equal(shouldRetire(79), false);
  assert.equal(shouldRetire(80), true);
});
