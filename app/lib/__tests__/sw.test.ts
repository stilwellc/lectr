import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { swToggle, readStamp, offlineLine } from '../sw-register';

// public/sw.js is plain browser JS — load it in a sandbox with a stub `self`
// and read the pure request policy it exposes
const ORIGIN = 'https://lectr.bid';
const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'sw.js'), 'utf8');
const events: string[] = [];
const self: Record<string, unknown> = {
  location: { origin: ORIGIN },
  addEventListener: (t: string) => { events.push(t); },
};
vm.runInNewContext(src, { self, URL, Response, Headers, setTimeout, clearTimeout, console });
const sw = self.__lectrSw as {
  route: (req: unknown, origin: string) => string | null;
  pageKey: (u: string) => string;
  slicesIn: (html: string) => string[];
  codeSig: (html: string) => string;
  BOOK: string[];
};

const req = (url: string, o: { mode?: string; method?: string; auth?: boolean } = {}) => ({
  url: url.startsWith('http') ? url : ORIGIN + url,
  method: o.method || 'GET',
  mode: o.mode || 'cors',
  headers: new Headers(o.auth ? { authorization: 'Bearer x' } : {}),
});

test('push handlers are still installed', () => {
  for (const t of ['push', 'notificationclick', 'install', 'activate', 'fetch', 'message']) assert.ok(events.includes(t), t);
});

test('route: pages, hashed assets, the book, slices', () => {
  assert.equal(sw.route(req('/', { mode: 'navigate' }), ORIGIN), 'page');
  assert.equal(sw.route(req('/lot?id=abc', { mode: 'navigate' }), ORIGIN), 'page');
  assert.equal(sw.route(req('/_next/static/chunks/abc.js'), ORIGIN), 'immutable');
  assert.equal(sw.route(req('/_next/static/media/x.woff2'), ORIGIN), 'immutable');
  assert.equal(sw.route(req('/brand/lectr-nav.png'), ORIGIN), 'asset');
  for (const b of sw.BOOK) assert.equal(sw.route(req(b), ORIGIN), 'book', b);
  assert.equal(sw.route(req('/data/ray/first/home.json?v=77f4d568f7d3'), ORIGIN), 'slice');
  assert.equal(sw.route(req('/data/ray/players.json'), ORIGIN), 'extra');
  assert.equal(sw.route(req('/data/ray/pages/lot-idx-00.json'), ORIGIN), 'extra');
});

test('route: never Supabase, the API, auth, credentials, writes, or the big versioned shards', () => {
  assert.equal(sw.route(req('https://tiwrdomqydtnmgljsqsi.supabase.co/rest/v1/lots'), ORIGIN), null);
  assert.equal(sw.route(req('/api/lot?id=1'), ORIGIN), null);
  assert.equal(sw.route(req('/data/ray/meta.json', { auth: true }), ORIGIN), null);
  assert.equal(sw.route(req('/data/ray/meta.json', { method: 'POST' }), ORIGIN), null);
  assert.equal(sw.route(req('/profile?code=abc', { mode: 'navigate' }), ORIGIN), null, 'OAuth return');
  assert.equal(sw.route(req('/data/ray/lots-3.json?v=2026-10-08'), ORIGIN), null, 'HTTP cache owns the shards');
  assert.equal(sw.route(req('/data/ray/lots-index.json?v=2026-10-08'), ORIGIN), null);
  assert.equal(sw.route(req('/data/ray/sold-ledger-0.json?v=x'), ORIGIN), null);
  assert.equal(sw.route(req('/data/ray/meta.json?cb=123'), ORIGIN), null, 'the skew re-check is a cache-bust');
  assert.equal(sw.route(req('/data/ray/first/home.json'), ORIGIN), null, 'an unversioned slice');
  assert.equal(sw.route(req('/data/ray/first/index.json'), ORIGIN), null, 'the deploy marker is always the network');
  assert.equal(sw.route(req('/sw.js'), ORIGIN), null);
  assert.equal(sw.route(req('/data/ray/upcoming.json', { mode: 'navigate' }), ORIGIN), null);
  assert.equal(sw.route(req('https://images.example.com/a.jpg'), ORIGIN), null);
  assert.equal(sw.route(req('/makers/__next._tree.txt'), ORIGIN), null, 'RSC payloads stay on the network');
});

test('pageKey: one key per static page', () => {
  assert.equal(sw.pageKey(ORIGIN + '/lot?id=abc'), ORIGIN + '/lot');
  assert.equal(sw.pageKey(ORIGIN + '/makers/'), ORIGIN + '/makers');
  assert.equal(sw.pageKey(ORIGIN + '/makers.html'), ORIGIN + '/makers');
  assert.equal(sw.pageKey(ORIGIN + '/'), ORIGIN + '/');
  assert.equal(sw.pageKey(ORIGIN + '/index.html'), ORIGIN + '/');
});

test('slicesIn / codeSig read the exported HTML', () => {
  const html = '<link rel="preload" href="/data/ray/first/home.json?v=77f4d568f7d3" as="fetch" crossorigin="anonymous"/>'
    + '<script src="/_next/static/chunks/b.js" async=""></script><script src="/_next/static/chunks/a.js" async=""></script>';
  assert.deepEqual([...sw.slicesIn(html)], ['/data/ray/first/home.json?v=77f4d568f7d3']);
  assert.equal(sw.codeSig(html), '/_next/static/chunks/a.js|/_next/static/chunks/b.js');
});

test('escape hatch + freshness line', () => {
  assert.equal(swToggle('?sw=off'), 'off');
  assert.equal(swToggle('?a=1&sw=on'), 'on');
  assert.equal(swToggle('?sw=maybe'), null);
  assert.equal(readStamp('2026-10-08T12:00:14.138Z'), 'OCT 8');
  assert.equal(offlineLine('2026-10-08T12:00:14.138Z'), 'Offline — showing the book as last read OCT 8');
  assert.equal(offlineLine(''), 'Offline — figures may be out of date');
});
