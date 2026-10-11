import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EVENTS, isEventName, createThrottle, optedOut, track, eventsEnabled } from '../analytics';
import { isHouseOutbound, isPickOpenControl } from '../../components/retention/trackers';

test('event vocabulary is fixed and matches the newest track_event migration', () => {
  const sql = fs.readFileSync(new URL('../../../supabase/migrations/0009_growth_loop.sql', import.meta.url), 'utf8');
  const m = sql.match(/allowed constant text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(m, 'allow-list present in the migration');
  const server = Array.from(m![1].matchAll(/'([a-z_]+)'/g)).map(x => x[1]).sort();
  assert.deepEqual([...EVENTS].sort(), server, 'client EVENTS === server allow-list');
  assert.equal(isEventName('save_lot'), true);
  assert.equal(isEventName('qs_done'), true);
  assert.equal(isEventName('drop table'), false);
  assert.equal(isEventName(undefined), false);
});

test('events carry no identity: track() sends only the event name', () => {
  const src = fs.readFileSync(new URL('../analytics.ts', import.meta.url), 'utf8');
  assert.match(src, /body: JSON\.stringify\(\{ p_event: event \}\)/);
  assert.match(src, /credentials: 'omit'/);
});

test('throttle: per-event session cap', () => {
  const allow = createThrottle(3);
  assert.deepEqual([1, 2, 3, 4].map(() => allow('save_lot')), [true, true, true, false]);
  assert.equal(allow('unsave_lot'), true, 'caps are per event');
});

test('throttle: onceKey counts a keyed event once (profile_view per session)', () => {
  const allow = createThrottle();
  assert.equal(allow('profile_view', 'p'), true);
  assert.equal(allow('profile_view', 'p'), false);
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

test('pick open: the card / row / link counts, its side controls do not', () => {
  const ctl = (attrs: Record<string, string>) => ({ getAttribute: (k: string) => attrs[k] ?? null, hasAttribute: (k: string) => k in attrs });
  assert.equal(isPickOpenControl(null), false, 'a click on bare text opens nothing');
  assert.equal(isPickOpenControl(ctl({ 'aria-label': 'Comps for X' })), true, 'the phone row');
  assert.equal(isPickOpenControl(ctl({ 'aria-label': 'View comparable sales for X' })), true);
  assert.equal(isPickOpenControl(ctl({ href: '/lot?id=abc' })), true);
  assert.equal(isPickOpenControl(ctl({ 'aria-label': 'Save lot' })), false);
  assert.equal(isPickOpenControl(ctl({ 'aria-label': 'Remove from saved' })), false);
  assert.equal(isPickOpenControl(ctl({ 'aria-label': 'More like this: X', 'aria-pressed': 'false' })), false);
  assert.equal(isPickOpenControl(ctl({ 'aria-label': 'Not for me: X' })), false);
  assert.equal(isPickOpenControl(ctl({ 'aria-haspopup': 'menu' })), false);
  assert.equal(isPickOpenControl(ctl({ role: 'menuitem' })), false);
  assert.equal(isPickOpenControl(ctl({ 'aria-label': 'Add X auction to calendar' })), false);
  assert.equal(isPickOpenControl(ctl({ role: 'link' })), false, 'a folded note searches, it does not open');
  assert.equal(isPickOpenControl(ctl({ href: 'https://goldin.co/x', 'aria-label': 'View X at Goldin' })), false);
});
