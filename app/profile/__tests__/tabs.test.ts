/**
 * THE DESK TABS (Oct 20 2026): the 16 rooms live under six tabs and only the
 * active tab mounts. The owner's rule — never remove a feature — means every
 * id anything can link to (a room, an anchor inside a room, a tab, a g-chord,
 * a push notification's /profile#x) must resolve to the tab that holds it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { DeskData } from '../desk/types';
import type { DeskInternals } from '../desk/provider';

(Module as unknown as { _extensions: Record<string, (m: unknown, f: string) => void> })._extensions['.css'] = () => {};
declare const require: NodeRequire;
const { SECTIONS, TABS, EVERY_TAB, SUB_ANCHORS, tabOf, tabHash, sectionByKey, tabItemsOf, mountedSections } =
  require('../desk/sections') as typeof import('../desk/sections');

const ROOT = path.join(__dirname, '..', '..', '..');
const desk = { now: 0, signedIn: false, book: [], fullLoaded: true, fullError: false, lastCrawl: null, saved: [], savedIds: new Set<string>(), metaFor: () => null,
  collection: [], ownedIds: new Set<string>(), ledger: new Map(), ledgerLoaded: false, taste: null, follows: [{ kind: 'maker', key: 'kaws', label: 'KAWS' }], price: { minUsd: null, maxUsd: null },
  recs: [1, 2, 3].map(k => ({ lot: { id: `rec-${k}`, title: `Pick ${k}`, artist: 'andy-warhol', status: 'upcoming', saleDate: null, saleDateTime: null, auctionHouse: 'Phillips' } })),
  closingPicks: [], lastVisitMs: null } as unknown as DeskData;
const live = (over: Partial<DeskInternals> = {}): DeskInternals => ({
  deskView: true, signedOutView: false, watchFirst: true, upcoming: [{}, {}], todayShows: true, hasMarket: true, unseenAlerts: 0,
  hasRecordRoom: true, record: { n: 7, realized: 1, med: 7.4, split: null, series: [] }, collection: { rows: [{}, {}], appraisedN: 0, totalAppraised: 0, totalPaid: 0, deltaPct: null, appraisedPaidN: 0 },
  historyCount: 8, orphanIds: [], settledCount: 7, other: [],
  ...over,
} as unknown as DeskInternals);

test('every room lives under a real tab, and every tab holds a room', () => {
  const ids = new Set(TABS.map(t => t.id));
  for (const s of SECTIONS) assert.ok(ids.has(s.tab), `${s.id} → ${s.tab}`);
  for (const t of TABS) assert.ok(SECTIONS.some(s => s.tab === t.id && !EVERY_TAB.has(s.id)), `tab ${t.id} has no room`);
});

test('tabOf: rooms, tab hashes, anchors inside rooms, week days; unknown → null; every-tab rooms → null', () => {
  for (const s of SECTIONS) assert.equal(tabOf(s.id), EVERY_TAB.has(s.id) ? null : s.tab, s.id);
  for (const t of TABS) assert.equal(tabOf(tabHash(t.id)), t.id);
  for (const [a, room] of Object.entries(SUB_ANCHORS)) assert.equal(tabOf(a), SECTIONS.find(s => s.id === room)!.tab, a);
  assert.equal(tabOf('week-2026-10-20'), 'week');
  assert.equal(tabOf('settled'), 'owned');
  assert.equal(tabOf('nope'), null);
  assert.equal(tabOf('tab-nope'), null);
  assert.equal(tabOf('account'), null);
  assert.equal(tabOf(''), null);
});

test('a tab hash is never a room id (a tab click can not land on, or report missing, a room)', () => {
  for (const t of TABS) assert.ok(!SECTIONS.some(s => s.id === tabHash(t.id)), tabHash(t.id));
});

test('every g-chord opens a tab (or rides under every tab)', () => {
  for (const s of SECTIONS.filter(x => x.key)) {
    const sec = sectionByKey(s.key)!;
    assert.ok(tabOf(sec.id) || EVERY_TAB.has(sec.id), `g ${s.key} → ${sec.id}`);
  }
});

/** every in-page link target on the desk, the service worker and the push planner */
function linkTargets(): { id: string; where: string }[] {
  const out: { id: string; where: string }[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
      if (!/\.(tsx?|js)$/.test(e.name)) continue;
      // comments describe links, they aren't links
      const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const m of Array.from(src.matchAll(/href=["{`']#([a-z][a-z0-9-]*)["`'}]/g))) out.push({ id: m[1], where: path.relative(ROOT, p) });
      for (const m of Array.from(src.matchAll(/jump\(['"]([a-z][a-z0-9-]*)['"]/g))) out.push({ id: m[1], where: path.relative(ROOT, p) });
      for (const m of Array.from(src.matchAll(/href:\s*['"]#([a-z][a-z0-9-]*)['"]/g))) out.push({ id: m[1], where: path.relative(ROOT, p) });
    }
  };
  walk(path.join(ROOT, 'app', 'profile'));
  for (const f of ['public/sw.js', 'scripts/lib/push-plan.ts']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const m of Array.from(fs.readFileSync(p, 'utf8').matchAll(/\/profile#([a-z][a-z0-9-]*)/g))) out.push({ id: m[1], where: f });
  }
  return out;
}

test('every #link and jump() target on the desk resolves to the tab that holds it', () => {
  const ok = new Set(['desk', 'desk-details', 'desk-tabs', 'dt-panel']);
  const bad = linkTargets().filter(({ id }) => !ok.has(id) && !tabOf(id) && !EVERY_TAB.has(id));
  assert.deepEqual(bad, [], `unresolved: ${bad.map(b => `#${b.id} (${b.where})`).join(', ')}`);
});

test('per-tab order: the rooms each tab mounts, in desk order', () => {
  const secs = mountedSections(desk, live());
  const of = (t: string) => secs.filter(s => s.tab === t && !EVERY_TAB.has(s.id)).map(s => s.id);
  // one job per tab: Watching holds only your watches
  assert.deepEqual(of('watching'), ['watching']);
  assert.deepEqual(of('week'), ['week']);
  assert.deepEqual(of('budget').filter(id => id === 'budget'), of('budget'));
  // order, not presence: each room keeps its own when() gate
  const owned = of('owned');
  assert.deepEqual(owned, ['portfolio', 'collection', 'history'].filter(id => owned.includes(id)));
  assert.ok(owned.length >= 2, `owned tab mounts ${owned.join(',')}`);
  assert.deepEqual(of('record'), ['record']);
});

test('tabItemsOf: one item per tab; every-tab rooms never become a room pill', () => {
  const items = tabItemsOf(desk, live());
  assert.deepEqual(items.map(t => t.id), TABS.map(t => t.id));
  for (const t of items) for (const r of t.items) assert.ok(!EVERY_TAB.has(r.id), r.id);
});
