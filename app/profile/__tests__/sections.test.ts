/**
 * THE SECTION REGISTRY — its shape is the contract Phase 2 mounts against:
 * unique ids and keys, the reserved slots present and quiet, the rail built
 * only from mounted sections, in order, parted into its three groups.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { DeskData } from '../desk/types';
import type { DeskInternals } from '../desk/provider';

// the registry binds the rooms, and a room's graph imports a stylesheet
// (ComparableModalLazy → .css) Node cannot parse: stub the extension, then
// load the registry (the imports above are types only)
(Module as unknown as { _extensions: Record<string, (m: unknown, f: string) => void> })._extensions['.css'] = () => {};
declare const require: NodeRequire;
const { SECTIONS, mountedSections, railItemsOf, sectionByKey, keysLegend } = require('../desk/sections') as typeof import('../desk/sections');

const desk = { now: 0, signedIn: false, book: [], fullLoaded: true, fullError: false, lastCrawl: null, saved: [], savedIds: new Set<string>(), metaFor: () => null,
  collection: [], ownedIds: new Set<string>(), ledger: new Map(), ledgerLoaded: false, taste: null, follows: [{ kind: 'maker', key: 'kaws', label: 'KAWS' }], price: { minUsd: null, maxUsd: null }, recs: [{}, {}, {}], lastVisitMs: null } as unknown as DeskData;

/** the internals a live desk hands the registry (only what metas read) */
const live = (over: Partial<DeskInternals> = {}): DeskInternals => ({
  deskView: true, signedOutView: false, watchFirst: true, upcoming: [{}, {}], todayShows: true, hasMarket: true, unseenAlerts: 0,
  hasRecordRoom: true, record: { n: 7, realized: 1, med: 7.4, split: null, series: [] }, collection: { rows: [{}, {}], appraisedN: 0, totalAppraised: 0, totalPaid: 0, deltaPct: null, appraisedPaidN: 0 },
  historyCount: 8, orphanIds: [], settledCount: 7, other: [],
  ...over,
} as unknown as DeskInternals);

test('registry: ids and keys are unique; every id is a valid hash anchor', () => {
  const ids = SECTIONS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const keys = SECTIONS.map(s => s.key).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length);
  for (const id of ids) assert.match(id, /^[a-z][a-z-]*$/);
  for (const k of keys) assert.match(k, /^[a-z]$/);
  // j and k walk rows — never section keys
  assert.ok(!keys.includes('j') && !keys.includes('k'));
});

test('registry: the Phase-2 slots are reserved (id + key), mount nothing and show no pill', () => {
  for (const [id, key] of [['week', 'd'], ['budget', 'b'], ['portfolio', 'p'], ['names', 'n'], ['edge', 'e']]) {
    const s = SECTIONS.find(x => x.id === id);
    assert.ok(s, `${id} reserved`);
    assert.equal(s!.key, key);
    assert.equal(s!.Component, null);
    assert.equal(s!.meta(desk, live()), null);
  }
  assert.equal(sectionByKey('d')?.id, 'week');
  assert.equal(sectionByKey('w')?.id, 'watching');
  assert.equal(sectionByKey('z'), undefined);
});

test('registry: the desk order — Today, [week], Watching, For you, [budget, portfolio], Market, [names], Signals, Record, [edge], Collection, History, Account', () => {
  const order = SECTIONS.map(s => s.id);
  const want = ['today', 'week', 'watching', 'for-you', 'budget', 'portfolio', 'signin', 'market', 'names', 'signals', 'record', 'edge', 'collection', 'history', 'becomes', 'account'];
  assert.deepEqual(order, want);
});

test('a live desk mounts its rooms in order and builds the rail from their metas, parted now · picks · desk', () => {
  const i = live();
  assert.deepEqual(mountedSections(desk, i).map(s => s.id), ['today', 'watching', 'for-you', 'market', 'signals', 'record', 'collection', 'history', 'account']);
  const rail = railItemsOf(desk, i);
  assert.deepEqual(rail.map(r => r.id), ['today', 'watching', 'for-you', 'market', 'signals', 'record', 'collection', 'history']);
  assert.deepEqual(rail.map(r => r.group), ['now', 'now', 'picks', 'picks', 'picks', 'desk', 'desk', 'desk']);
  const by = Object.fromEntries(rail.map(r => [r.id, r]));
  assert.equal(by.watching.count, 2);
  assert.equal(by['for-you'].count, 3);
  assert.equal(by.signals.count, 1);
  assert.equal(by.record.count, '+7%'); assert.equal(by.record.tone, 'up');
  assert.equal(by.collection.count, 2); // none appraised from comps: the piece count
  assert.equal(by.history.count, 8);
  assert.equal(by.watching.hint, 'g then w');
});

test('a signed-out desk: no Watching, no Record/Collection/History; the sign-in line and the ghost mount (Market mounts and gates itself); rail = For you + Signals', () => {
  const i = live({ deskView: false, signedOutView: true, watchFirst: false, upcoming: [], todayShows: false, hasMarket: false, hasRecordRoom: false, record: null, collection: { rows: [], appraisedN: 0, totalAppraised: 0, totalPaid: 0, deltaPct: null, appraisedPaidN: 0 } as never, historyCount: 0, settledCount: 0 });
  assert.deepEqual(mountedSections(desk, i).map(s => s.id), ['today', 'for-you', 'signin', 'market', 'signals', 'becomes', 'account']);
  assert.deepEqual(railItemsOf(desk, i).map(r => r.id), ['for-you', 'signals']);
});

test('a follows-only desk (signed in, nothing saved): picks lead; Market when a follow is a name; ghost + CTAs', () => {
  const i = live({ deskView: false, signedOutView: false, watchFirst: false, upcoming: [], hasRecordRoom: false, record: null, collection: { rows: [], appraisedN: 0, totalAppraised: 0, totalPaid: 0, deltaPct: null, appraisedPaidN: 0 } as never, historyCount: 0, settledCount: 0 });
  assert.deepEqual(mountedSections(desk, i).map(s => s.id), ['today', 'for-you', 'market', 'signals', 'becomes', 'account']);
  assert.deepEqual(railItemsOf(desk, i).map(r => r.id), ['today', 'for-you', 'market', 'signals']);
});

test('keysLegend: every keyed section, mounted ones marked live, reserved ones not yet', () => {
  const legend = keysLegend(mountedSections(desk, live()));
  assert.equal(legend.find(k => k.key === 'w')?.live, true);
  assert.equal(legend.find(k => k.key === 'd')?.live, false);
  assert.equal(legend.find(k => k.key === 'a')?.live, true);
  assert.ok(legend.every(k => k.label.length > 0));
});
