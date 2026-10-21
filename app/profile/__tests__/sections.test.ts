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
const { SECTIONS, mountedSections, railItemsOf, sectionByKey, keysLegend, slot, unfilledSections, missingSection } = require('../desk/sections') as typeof import('../desk/sections');

const desk = { now: 0, signedIn: false, book: [], fullLoaded: true, fullError: false, lastCrawl: null, saved: [], savedIds: new Set<string>(), metaFor: () => null,
  collection: [], ownedIds: new Set<string>(), ledger: new Map(), ledgerLoaded: false, taste: null, follows: [{ kind: 'maker', key: 'kaws', label: 'KAWS' }], price: { minUsd: null, maxUsd: null }, recs: [1, 2, 3].map(k => ({ lot: { id: `rec-${k}`, title: `Pick ${k}`, artist: 'andy-warhol', status: 'upcoming', saleDate: null, saleDateTime: null, auctionHouse: 'Phillips' } })), closingPicks: [], lastVisitMs: null } as unknown as DeskData;
/** nothing at all: no save, no pick, no follow, no band — the cold desk */
const coldDesk = { ...desk, follows: [], recs: [] } as unknown as DeskData;

/** the internals a live desk hands the registry (only what metas read) */
const live = (over: Partial<DeskInternals> = {}): DeskInternals => ({
  deskView: true, signedOutView: false, watchFirst: true, upcoming: [{}, {}], todayShows: true, hasMarket: true, unseenAlerts: 0,
  hasRecordRoom: true, record: { n: 7, realized: 1, med: 7.4, split: null, series: [] }, collection: { rows: [{}, {}], appraisedN: 0, totalAppraised: 0, totalPaid: 0, deltaPct: null, appraisedPaidN: 0 },
  historyCount: 8, orphanIds: [], settledCount: 7, other: [],
  ...over,
} as unknown as DeskInternals);
const emptyCollection = { rows: [], appraisedN: 0, totalAppraised: 0, appraisedPaid: 0, totalPaid: 0, deltaPct: null, appraisedPaidN: 0, pendingOwned: [] };

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

test('registry: the five Phase-2 sections are mounted on their reserved ids + keys; each meta takes the contract\'s DeskData', () => {
  for (const [id, key] of [['week', 'd'], ['budget', 'b'], ['portfolio', 'p'], ['names', 'n'], ['edge', 'e']]) {
    const s = SECTIONS.find(x => x.id === id);
    assert.ok(s, `${id} registered`);
    assert.equal(s!.key, key);
    assert.ok(s!.Component, `${id} mounts`);
    const m = s!.meta(desk, live());
    assert.ok(m && m.id === id, `${id} meta answers for an empty desk (quiet, never null)`);
    // nothing saved / owned: Your week, Portfolio and Edge are quiet; a follow
    // gives Budget (a taste) and Names (a name) something to say
    assert.equal(m!.quiet, ['week', 'portfolio', 'edge'].includes(id), `${id} quiet = ${['week', 'portfolio', 'edge'].includes(id)} on this fixture`);
  }
  assert.equal(sectionByKey('d')?.id, 'week');
  assert.equal(sectionByKey('w')?.id, 'watching');
  assert.equal(sectionByKey('z'), undefined);
  // a reserved slot still mounts nothing and shows no pill
  const r = slot('later', 'Later', 'l', 'desk', SECTIONS[0].mark!, 'today');
  assert.equal(r.Component, null); assert.equal(r.meta(desk, live()), null);
});

test('registry: the desk order — Today, Your week, Watching, For you (+ sign-in when signed out), Budget, Portfolio, Market, Names, Signals, Record, Edge, Collection, History, Account', () => {
  const order = SECTIONS.map(s => s.id);
  const want = ['today', 'week', 'watching', 'for-you', 'signin', 'budget', 'portfolio', 'market', 'names', 'signals', 'record', 'edge', 'collection', 'history', 'becomes', 'account'];
  assert.deepEqual(order, want);
});

test('a live desk mounts its rooms in order and builds the rail from their metas, parted now · picks · desk', () => {
  const i = live();
  // a live desk whose contract carries saves and an owned piece: every room mounts
  const full = { ...desk, saved: [{ id: 's1' }], collection: [{ id: 'c1' }], ownedIds: new Set(['c1']) } as unknown as DeskData;
  assert.deepEqual(mountedSections(full, i).map(s => s.id), ['today', 'week', 'watching', 'for-you', 'budget', 'portfolio', 'market', 'names', 'signals', 'record', 'edge', 'collection', 'history', 'account']);
  // (Oct 11 review) the data-needing rooms gate on data (the when() pattern): with nothing saved / owned,
  // Portfolio and Edge do NOT mount — no dead pill — and the index (becomes) lists them with their taps
  assert.deepEqual(mountedSections(desk, i).map(s => s.id), ['today', 'week', 'watching', 'for-you', 'budget', 'market', 'names', 'signals', 'record', 'collection', 'history', 'becomes', 'account']);
  assert.deepEqual(unfilledSections(desk, i).map(s => s.id), ['portfolio', 'edge']);
  const rail = railItemsOf(full, i);
  assert.deepEqual(rail.map(r => r.id), ['today', 'week', 'watching', 'for-you', 'budget', 'portfolio', 'market', 'names', 'signals', 'record', 'edge', 'collection', 'history']);
  assert.deepEqual(rail.map(r => r.group), ['now', 'now', 'now', 'picks', 'picks', 'picks', 'picks', 'picks', 'picks', 'desk', 'desk', 'desk', 'desk']);
  // nothing closes on this fixture: Your week folds (quiet pill, still a link); Portfolio counts its piece; Edge has no graded call yet
  assert.deepEqual(rail.filter(r => r.quiet).map(r => r.id), ['week']);
  const by = Object.fromEntries(rail.map(r => [r.id, r]));
  assert.equal(by.watching.count, 2);
  assert.equal(by['for-you'].count, 3);
  assert.equal(by.signals.count, 1);
  assert.equal(by.record.count, '+7%'); assert.equal(by.record.tone, 'up');
  assert.equal(by.collection.count, '2'); // none marked by the engine, nothing bought: the piece count
  assert.equal(by.history.count, 8);
  assert.equal(by.watching.hint, 'g then w');
});

test('a signed-out desk with a follow: no Watching, no Record/Collection/History, no Portfolio/Edge (nothing saved); the sign-in line and the index mount; rail = For you + Budget + Names + Signals', () => {
  const i = live({ deskView: false, signedOutView: true, watchFirst: false, upcoming: [], todayShows: false, hasMarket: false, hasRecordRoom: false, record: null, collection: emptyCollection as never, historyCount: 0, settledCount: 0 });
  // nothing live: the picks lead, Your week follows the sign-in line
  assert.deepEqual(mountedSections(desk, i).map(s => s.id), ['today', 'for-you', 'signin', 'week', 'budget', 'market', 'names', 'signals', 'becomes', 'account']);
  const rail = railItemsOf(desk, i);
  assert.deepEqual(rail.filter(r => !r.quiet).map(r => r.id), ['for-you', 'budget', 'names', 'signals']);
  assert.deepEqual(rail.filter(r => r.quiet).map(r => r.id), ['week']);
  // the rooms this desk doesn't have, in desk order, each with its fill + tap
  assert.deepEqual(unfilledSections(desk, i).map(s => s.id), ['watching', 'portfolio', 'record', 'edge', 'collection', 'history']);
  for (const s of unfilledSections(desk, i)) assert.ok(s.fill && s.fill.text && s.fill.how && s.fill.tap.href, `${s.id} has a fill`);
});

test('a follows-only desk (signed in, nothing saved): picks lead; Market when a follow is a name; the index lists the rest', () => {
  const i = live({ deskView: false, signedOutView: false, watchFirst: false, upcoming: [], hasRecordRoom: false, record: null, collection: emptyCollection as never, historyCount: 0, settledCount: 0 });
  // nothing live: the picks lead, Your week follows them
  assert.deepEqual(mountedSections(desk, i).map(s => s.id), ['today', 'for-you', 'week', 'budget', 'market', 'names', 'signals', 'becomes', 'account']);
  assert.deepEqual(railItemsOf(desk, i).filter(r => !r.quiet).map(r => r.id), ['today', 'for-you', 'budget', 'market', 'names', 'signals']);
});

test('the COLD desk (nothing at all): masthead + Today (gates itself) + For you (the quick start) + Signals + the index + Account — no empty rooms, no dead pills', () => {
  const i = live({ deskView: false, signedOutView: false, watchFirst: false, upcoming: [], todayShows: false, hasMarket: false, hasRecordRoom: false, record: null, collection: emptyCollection as never, historyCount: 0, settledCount: 0 });
  assert.deepEqual(mountedSections(coldDesk, i).map(s => s.id), ['today', 'for-you', 'market', 'signals', 'becomes', 'account']);
  assert.deepEqual(railItemsOf(coldDesk, i).map(r => r.id), ['for-you', 'signals']);
  assert.deepEqual(unfilledSections(coldDesk, i).map(s => s.id), ['week', 'watching', 'budget', 'portfolio', 'names', 'record', 'edge', 'collection', 'history']);
  // a deep link to a missing room resolves to its fill; a mounted room or an unknown id to nothing
  const mounted = mountedSections(coldDesk, i);
  assert.equal(missingSection('record', mounted)?.fill?.how, 'it fills as your watches settle');
  assert.equal(missingSection('for-you', mounted), null);
  assert.equal(missingSection('nope', mounted), null);
  // a stated band alone brings the Budget desk (it has a band to plan against)
  const banded = { ...coldDesk, price: { minUsd: 1000, maxUsd: 50_000 } } as unknown as DeskData;
  assert.ok(mountedSections(banded, i).some(s => s.id === 'budget'));
});

test('keysLegend: every keyed section, mounted ones marked live', () => {
  const legend = keysLegend(mountedSections(desk, live()));
  assert.equal(legend.find(k => k.key === 'w')?.live, true);
  assert.equal(legend.find(k => k.key === 'd')?.live, true);
  assert.equal(legend.find(k => k.key === 'a')?.live, true);
  assert.ok(legend.every(k => k.label.length > 0));
});
