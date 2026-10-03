import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, isEventName, createThrottle, optedOut, track, eventsEnabled } from '../analytics';
import { isHouseOutbound } from '../../components/retention/OutboundTracker';
import { icsFileName } from '../../components/retention/AddToCalendar';

test('event vocabulary is fixed and matches migration 0008', async () => {
  const fs = await import('node:fs');
  const sql = fs.readFileSync(new URL('../../../supabase/migrations/0008_return_loop.sql', import.meta.url), 'utf8');
  const m = sql.match(/allowed constant text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(m, 'allow-list present in the migration');
  const server = Array.from(m![1].matchAll(/'([a-z_]+)'/g)).map(x => x[1]).sort();
  assert.deepEqual([...EVENTS].sort(), server, 'client EVENTS === server allow-list');
  assert.equal(isEventName('save_lot'), true);
  assert.equal(isEventName('drop table'), false);
  assert.equal(isEventName(undefined), false);
});

test('throttle: per-event session cap', () => {
  const allow = createThrottle(3);
  assert.deepEqual([1, 2, 3, 4].map(() => allow('save_lot')), [true, true, true, false]);
  assert.equal(allow('unsave_lot'), true, 'caps are per event');
});

test('throttle: onceKey counts a keyed event once (maxbid_view per lot)', () => {
  const allow = createThrottle();
  assert.equal(allow('maxbid_view', 'lot-1'), true);
  assert.equal(allow('maxbid_view', 'lot-1'), false);
  assert.equal(allow('maxbid_view', 'lot-2'), true);
});

test('throttle rejects unknown names', () => {
  const allow = createThrottle();
  assert.equal(allow('nope' as never), false);
});

test('GPC / DNT opt out; missing navigator is treated as opted out', () => {
  assert.equal(optedOut({ globalPrivacyControl: true }), true);
  assert.equal(optedOut({ doNotTrack: '1' }), true);
  assert.equal(optedOut({ doNotTrack: 'unspecified' }), false);
  assert.equal(optedOut({}), false);
  assert.equal(optedOut(undefined), true);
});

test('track() is inert without a window (never throws)', () => {
  assert.equal(typeof eventsEnabled, 'boolean');
  assert.doesNotThrow(() => track('save_lot'));
});

test('outbound detection: only off-site "View at <house>" links', () => {
  assert.equal(isHouseOutbound('View at Goldin ↗', 'https://goldin.co/item/1', 'lectr.bid'), true);
  assert.equal(isHouseOutbound('  View at Christie’s', 'http://christies.com/x', 'lectr.bid'), true);
  assert.equal(isHouseOutbound('View at Goldin', '/lot/x', 'lectr.bid'), false, 'same-origin');
  assert.equal(isHouseOutbound('Comps', 'https://goldin.co/item/1', 'lectr.bid'), false);
  assert.equal(isHouseOutbound('View at X', 'javascript:alert(1)', 'lectr.bid'), false);
});

test('ics file name is filesystem-safe', () => {
  assert.equal(icsFileName('goldin-123'), 'lectr-goldin-123.ics');
  assert.equal(icsFileName('a/b:c~'), 'lectr-a-b-c-.ics');
});
