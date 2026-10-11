import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pinClock } from './helpers/pin-clock';

pinClock('2026-10-11T12:00:00Z');
process.env.NEXT_PUBLIC_FS_VERSION = 'old0';

import { freshAction, updatedLine, READ_SCROLL_PX } from '../fresh-book';
import { swGenCache } from '../sw-register';
import {
  BOOK_FILES, prepareNewBook, bookOnScreen, triggerFullLoad,
  __loadRayDataForTests, __resetRayDataForTests, type PreparedBook,
} from '../../hooks/useRayData';

// ── the contract with public/sw.js (no message-format change: W25 listens to
// what the worker already sends and reads the cache it already keeps) ──────
const swSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'sw.js'), 'utf8');

test('the page reads the very cache the worker writes a generation into', () => {
  const prefix = swSrc.match(/const PREFIX = '([^']+)'/)?.[1];
  const data = swSrc.match(/const DATA = PREFIX \+ '([^']+)'/)?.[1];
  assert.ok(prefix && data, 'sw.js PREFIX / DATA');
  assert.equal(swGenCache('abc123'), `${prefix}${data}abc123`);
});

test('the page builds the same eight files the worker stores per generation', () => {
  const self: Record<string, unknown> = { location: { origin: 'https://lectr.bid' }, addEventListener: () => {} };
  vm.runInNewContext(swSrc, { self, URL, Response, Headers, setTimeout, clearTimeout, console });
  const BOOK = (self.__lectrSw as { BOOK: string[] }).BOOK;
  assert.deepEqual([...BOOK].sort(), BOOK_FILES.map(n => `/data/ray/${n}.json`).sort());
});

test('the worker announces a whole generation as { type, genReady, lastCrawl } after the pointer flips', () => {
  const at = swSrc.indexOf('genReady: v.ver, lastCrawl: v.lastCrawl');
  assert.ok(at > 0, 'genReady broadcast');
  assert.ok(swSrc.lastIndexOf('writeState({ ...st, gen: v.ver', at) > 0, 'pointer written before the broadcast');
  assert.match(swSrc.slice(at - 200, at), /type: 'lectr-sw'/);
});

// ── when: silently, or offered ──────────────────────────────────────────────
test('freshAction: an untouched page swaps silently; any touch or scroll offers', () => {
  assert.equal(freshAction({ touched: false, scrollY: 0 }), 'swap');
  assert.equal(freshAction({ touched: false, scrollY: READ_SCROLL_PX }), 'swap');
  assert.equal(freshAction({ touched: false, scrollY: READ_SCROLL_PX + 1 }), 'offer', 'a restored scroll is a reader');
  assert.equal(freshAction({ touched: true, scrollY: 0 }), 'offer');
});

test('updatedLine: the crawl date in the offline line\'s grammar', () => {
  assert.equal(updatedLine('2026-10-11T06:12:00Z'), 'Book updated OCT 11');
  assert.equal(updatedLine(''), 'Book updated');
  assert.equal(updatedLine('nope'), 'Book updated');
});

// ── the swap: one deploy at a time ──────────────────────────────────────────
type Lot = { id: string; status: string; title?: string; signal?: unknown };
const book = (crawl: string, lots: Lot[]): Record<string, unknown> => ({
  stats: {}, meta: { lastCrawl: crawl, sources: ['x'], totalLots: lots.length },
  upcoming: { generatedAt: crawl, lots }, backtest: null, market: { generatedAt: crawl },
  'close-board': { generatedAt: crawl, bids: {} }, receipts: null, 'close-k': undefined,
});
const OLD = book('2026-10-10T06:00:00Z', [{ id: 'a', status: 'upcoming', title: 'old a' }, { id: 'b', status: 'upcoming' }]);
const NEW = book('2026-10-11T06:00:00Z', [{ id: 'a', status: 'upcoming', title: 'new a' }, { id: 'c', status: 'upcoming' }]);
const corpus = (tag: string): Lot[] => [{ id: 'a', status: 'upcoming', title: `${tag} shard a` }, { id: 's1', status: 'sold', title: tag }];

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
let netBook: Record<string, unknown> = OLD;
let gens: Record<string, Record<string, unknown>> = {};
let shardGate: Promise<void> | null = null;
const fetched: string[] = [];

(globalThis as { fetch: unknown }).fetch = async (input: string) => {
  const url = String(input);
  fetched.push(url);
  const u = new URL(url, 'https://lectr.bid');
  const m = u.pathname.match(/^\/data\/ray\/([a-z-]+)\.json$/);
  if (m && !u.search && m[1] in netBook) return netBook[m[1]] === undefined ? new Response('', { status: 404 }) : json(netBook[m[1]]);
  if (u.pathname === '/data/ray/lots-index.json') return json({ shards: 1 });
  if (u.pathname === '/data/ray/lots-0.json') {
    const isNew = u.searchParams.get('v') === '2026-10-11T06:00:00Z';
    if (shardGate && !isNew) await shardGate; // holds the OLD book's corpus only
    return json(corpus(isNew ? 'new' : 'old'));
  }
  return new Response('', { status: 404 });
};
(globalThis as { caches: unknown }).caches = {
  has: async (name: string) => Object.keys(gens).some(v => swGenCache(v) === name),
  open: async (name: string) => {
    const v = Object.keys(gens).find(k => swGenCache(k) === name);
    return {
      match: async (p: string) => {
        const f = v && p.match(/^\/data\/ray\/([a-z-]+)\.json$/)?.[1];
        return f && gens[v][f] !== undefined ? json(gens[v][f]) : undefined;
      },
    };
  },
};

type Payload = { allLots: Lot[]; lastCrawl: string; fullLoaded: boolean };
const onScreen = async () => (await __loadRayDataForTests()) as Payload;
const ids = (p: Payload) => p.allLots.map(l => l.id).join(',');

beforeEach(() => {
  __resetRayDataForTests();
  netBook = OLD; gens = { new1: NEW }; shardGate = null; fetched.length = 0;
});

test('a new generation is built off-screen and goes on screen only at commit, whole', async () => {
  assert.equal(ids(await onScreen()), 'a,b');
  const before = fetched.length;
  const prepared = await prepareNewBook('new1') as PreparedBook;
  assert.ok(prepared && typeof prepared === 'object');
  assert.deepEqual(fetched.slice(before), [], 'the new book never comes from the network');
  assert.equal(prepared.lastCrawl, '2026-10-11T06:00:00Z');
  assert.equal(ids(await onScreen()), 'a,b', 'nothing moves before commit');
  assert.equal(prepared.commit(), true);
  const p = await onScreen();
  assert.equal(ids(p), 'a,c');
  assert.equal(p.allLots[0].title, 'new a');
  assert.equal(p.lastCrawl, '2026-10-11T06:00:00Z');
  assert.equal(bookOnScreen(), 'new1');
  assert.equal(prepared.commit(), false, 'a commit lands once');
  assert.equal(await prepareNewBook('new1'), null, 'already on screen');
});

test('the deploy already on screen, a missing generation, or a holed one: no swap', async () => {
  await onScreen();
  assert.equal(await prepareNewBook('old0'), null, 'the page\'s own deploy');
  assert.equal(await prepareNewBook('gone'), null, 'no cache for it');
  gens = { holed: { ...NEW, upcoming: undefined } };
  assert.equal(await prepareNewBook('holed'), null, 'no upcoming.json in the generation');
  assert.equal(ids(await onScreen()), 'a,b');
});

test('a loaded corpus is rebuilt at the new crawl before the swap — never old shards under new rows', async () => {
  await onScreen();
  triggerFullLoad();
  await new Promise(r => setTimeout(r, 20));
  assert.equal((await onScreen()).fullLoaded, true);
  assert.equal((await onScreen()).allLots.find(l => l.id === 's1')?.title, 'old');
  const prepared = await prepareNewBook('new1') as PreparedBook;
  assert.ok(fetched.includes('/data/ray/lots-0.json?v=2026-10-11T06%3A00%3A00Z'));
  assert.equal(prepared.commit(), true);
  const p = await onScreen();
  assert.equal(p.fullLoaded, true);
  assert.equal(p.allLots.find(l => l.id === 's1')?.title, 'new');
  assert.equal(p.allLots.find(l => l.id === 'a')?.title, 'new a', 'the new eager row wins over its shard');
  assert.ok(!p.allLots.some(l => l.id === 'b'), 'the old book\'s rows are gone');
});

test('a tier that starts loading after prepare makes commit refuse (prepare again)', async () => {
  await onScreen();
  const prepared = await prepareNewBook('new1') as PreparedBook;
  triggerFullLoad(); // the reader opened a corpus surface meanwhile
  assert.equal(prepared.commit(), false);
  await new Promise(r => setTimeout(r, 20));
  const again = await prepareNewBook('new1') as PreparedBook;
  assert.equal(again.commit(), true);
  assert.equal((await onScreen()).allLots.find(l => l.id === 's1')?.title, 'new');
});

test('an old-book corpus still downloading never lands over a swapped-in book', async () => {
  await onScreen();
  let open!: () => void;
  shardGate = new Promise(r => { open = r; });
  triggerFullLoad(); // the OLD book's phase 2, held at the gate
  const prepared = await prepareNewBook('new1') as PreparedBook;
  assert.equal(prepared.commit(), true);
  assert.equal((await onScreen()).allLots.find(l => l.id === 's1')?.title, 'new');
  open(); // the old corpus arrives late
  await new Promise(r => setTimeout(r, 20));
  const p = await onScreen();
  assert.equal(p.allLots.find(l => l.id === 's1')?.title, 'new');
  assert.ok(!p.allLots.some(l => l.id === 'b'));
});

test('no book loaded yet: the new generation is adopted and phase 1 reads it whole', async () => {
  assert.equal(await prepareNewBook('new1'), 'adopted');
  const p = await onScreen();
  assert.equal(ids(p), 'a,c');
  assert.equal(bookOnScreen(), 'new1');
  assert.ok(!fetched.some(u => u === '/data/ray/upcoming.json'), 'not the network\'s copy');
});

test('an adopted generation evicted before phase 1 falls back to the network book', async () => {
  assert.equal(await prepareNewBook('new1'), 'adopted');
  gens = {};
  const p = await onScreen();
  assert.equal(ids(p), 'a,b');
  assert.equal(bookOnScreen(), 'old0');
});
