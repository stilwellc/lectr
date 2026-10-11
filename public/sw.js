/* lectr service worker — web push for watched lots, plus a coherent
 * last-seen-book cache so a returning visitor paints instantly.
 *
 * PUSH (unchanged in effect): receives pushes from scripts/push-send.ts and
 * opens the lot when one is tapped.
 *   Payload contract (JSON): { title, body, url, tag } — scripts/lib/push-plan.ts
 *     url  — a same-origin path ("/lot?id=abc", "/profile#signals"); anything
 *            else opens /profile
 *     tag  — collapses repeats for the same lot × kind on the device
 *
 * CACHE (W22, Oct 11 2026). Every data change on lectr ships as a whole
 * Cloudflare Pages deploy (nightly crawl, the 4-hourly close board), so the
 * unit of coherence is the DEPLOY, named by first/index.json's `ver` (the
 * content hash of the first-screen payloads, which the HTML also bakes as
 * NEXT_PUBLIC_FS_VERSION). The worker keeps ONE generation — that deploy's
 * HTML pages + its phase-1 book files — and serves a page only together with
 * the book of the same generation:
 *   - navigation      a cached page of the current generation → served at once
 *                     (stale-while-revalidate); the network copy (navigation
 *                     preload) is read behind it. A new deploy downloads its
 *                     whole phase-1 book into a NEW cache, re-checks the
 *                     deploy did not flip mid-download, then switches the
 *                     pointer. The next visit paints the new book.
 *                     Generation older than MAX_GEN_AGE → network first.
 *   - /_next/static/  content-hashed → cache-first.
 *   - book files      (the unversioned phase-1 eight) → from the generation
 *                     of the page that asked; a page that came from the
 *                     network reads the network. Never mixed: a cached page
 *                     never gets another deploy's book from this worker.
 *   - first/*.json?v= self-versioned slices → kept in their own generation.
 *   - everything else (lots-* shards, ?v=/?cb= fetches, Supabase, /api/,
 *     cross-origin photos, anything with credentials) is NOT touched — the
 *     browser's HTTP cache handles the versioned shards as before.
 * Storage: one generation (+ the previous one while its pages finish), page
 * and asset caches trimmed by count, extras by count.
 *
 * ESCAPE HATCHES
 *   - any URL with ?sw=off  → caching off on this device (caches deleted,
 *     push untouched); ?sw=on turns it back on. (app/components/ServiceWorker)
 *   - remote: set CACHE_ENABLED = false and deploy. /sw.js is served
 *     no-cache (public/_headers), browsers re-check it on navigation; the new
 *     worker deletes every lectr cache on activate and passes all requests
 *     through. Never unregister to kill caching — that drops push subscriptions.
 *   - self-heal: a cached page whose code chunk 404s (the deploy that built
 *     it is gone) purges the page cache and asks the tab to reload once.
 */
const CACHE_ENABLED = true;

const PREFIX = 'lectr-sw1-';
const STATIC = PREFIX + 'static';
const PAGES = PREFIX + 'pages';
const CTL = PREFIX + 'ctl';
const DATA = PREFIX + 'data-';
const STATE_KEY = '/__lectr-sw/state';

/** the phase-1 book (app/hooks/useRayData loadRayData) — unversioned URLs */
const BOOK = ['stats', 'meta', 'upcoming', 'backtest', 'market', 'close-board', 'receipts', 'close-k']
  .map(n => '/data/ray/' + n + '.json');
/** smaller unversioned files pages read after the book; cached per
 *  generation only when the network is confirmed to serve that generation */
const EXTRA_RE = /^\/data\/ray\/(players|refs|id-aliases|search-meta|cat-stats|status)\.json$|^\/data\/ray\/pages\/[a-z0-9-]+\.json$/;
const SLICE_RE = /^\/data\/ray\/first\/[a-z0-9-]+\.json$/;
const ASSET_RE = /^\/(brand\/[^/]+\.(png|svg|webp|jpg)|icon\.png|apple-icon\.png|manifest\.webmanifest|favicon\.ico)$/;
/** OAuth / magic-link returns: always the network */
const AUTH_QS = /(^|[?&])(code|error|error_description|access_token|token_hash)=/;

const MAX_GEN_AGE = 7 * 24 * 3600e3; // older generation → network first
const NET_TIMEOUT = 4000;            // …falling back to it after this
const VERIFIED_FOR = 10 * 60e3;      // network-ver confirmation window for extras
const STATIC_MAX = 400;
const PAGES_MAX = 40;
const SLICES_MAX = 40;
const EXTRAS_MAX = 40;
const MIN_FREE = 80 * 1024 * 1024; // never take the last of a device's quota

/** classify a request — pure (tested in app/lib/__tests__/sw.test.ts) */
function route(req, origin) {
  if (!CACHE_ENABLED || req.method !== 'GET') return null;
  let url;
  try { url = new URL(req.url); } catch (_) { return null; }
  if (url.origin !== origin) return null;
  if (req.headers && req.headers.get && req.headers.get('authorization')) return null;
  const p = url.pathname;
  if (p === '/sw.js' || p.startsWith('/api/') || p.startsWith('/__')) return null;
  if (req.mode === 'navigate') {
    if (AUTH_QS.test(url.search)) return null;
    // a page, never a file (a navigation to /data/…json is the network's)
    if (/\.[a-z0-9]+$/i.test(p) && !/\.html$/i.test(p)) return null;
    return 'page';
  }
  if (p.startsWith('/_next/static/')) return 'immutable';
  if (ASSET_RE.test(p)) return 'asset';
  if (SLICE_RE.test(p)) return /^\?v=[A-Za-z0-9._-]+$/.test(url.search) ? 'slice' : null;
  if (url.search) return null; // ?v= shards (HTTP cache), ?cb= cache-busts
  if (BOOK.includes(p)) return 'book';
  if (EXTRA_RE.test(p)) return 'extra';
  return null;
}

/** one cached page per route: the static export serves the same HTML for
 *  every query (/lot?id=…), and Cloudflare strips .html + trailing slash */
function pageKey(u) {
  const url = new URL(u);
  const p = url.pathname.replace(/\.html$/i, '').replace(/\/index$/, '').replace(/\/+$/, '') || '/';
  return url.origin + p;
}

/** the first-screen slices a page's HTML preloads (same generation) */
function slicesIn(html) {
  const out = [];
  const re = /href="(\/data\/ray\/first\/[a-z0-9-]+\.json\?v=[A-Za-z0-9._-]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1].replace(/&amp;/g, '&'));
  return out;
}

/** the code a page runs — its script chunks; a change means a code deploy */
function codeSig(html) {
  const out = [];
  const re = /<script[^>]+src="(\/_next\/static\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out.sort().join('|');
}

self.__lectrSw = { route, pageKey, slicesIn, codeSig, BOOK };

// ── state (the generation pointer) ──────────────────────────────────────────
let stateMem = null;
async function readState() {
  if (stateMem) return stateMem;
  try {
    const c = await caches.open(CTL);
    const r = await c.match(STATE_KEY);
    stateMem = r ? await r.json() : {};
  } catch (_) { stateMem = {}; }
  return stateMem;
}
async function writeState(next) {
  stateMem = next;
  try {
    const c = await caches.open(CTL);
    await c.put(STATE_KEY, new Response(JSON.stringify(next), { headers: { 'content-type': 'application/json' } }));
  } catch (_) { /* in-memory still holds it */ }
}

async function wipeCaches(keepCtl) {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith(PREFIX) && !(keepCtl && k === CTL)).map(k => caches.delete(k)));
}

/** keep the newest `max` entries (Cache keys come back in insertion order) */
async function trim(name, max, filter) {
  try {
    const c = await caches.open(name);
    const keys = (await c.keys()).filter(r => !filter || filter(r));
    for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
  } catch (_) { /* best effort */ }
}

// ── per-tab generation map ──────────────────────────────────────────────────
// which generation a tab's HTML came from: its book requests are served from
// that generation only. 'net' = the HTML came from the network.
const clientGen = new Map();
const offlineClients = new Set();
function mapClient(id, gen) {
  if (!id) return;
  clientGen.delete(id);
  clientGen.set(id, gen);
  if (clientGen.size > 60) clientGen.delete(clientGen.keys().next().value);
}
function noteOffline(id) {
  if (!id || offlineClients.has(id)) return;
  offlineClients.add(id);
  if (offlineClients.size > 60) offlineClients.delete(offlineClients.values().next().value);
  self.clients.get(id).then(c => c && c.postMessage({ type: 'lectr-sw', offline: true, lastCrawl: (stateMem || {}).lastCrawl || '' })).catch(() => {});
}

// network book bodies a page is downloading right now — a generation build
// running beside it reuses them instead of downloading the book twice
const inflight = new Map();

let verified = { ver: '', at: 0 };
async function networkVer() {
  const r = await fetch('/data/ray/first/index.json', { cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || typeof j.ver !== 'string' || !j.ver) return null;
  verified = { ver: j.ver, at: Date.now() };
  return { ver: j.ver, lastCrawl: typeof j.lastCrawl === 'string' ? j.lastCrawl : '' };
}

function okBasic(r) {
  return r && r.ok && r.status === 200 && r.type === 'basic' && !r.redirected;
}
function isJson(r) { return (r.headers.get('content-type') || '').includes('json'); }

/** download one deploy's phase-1 book into its own cache, then flip the
 *  pointer — only if the deploy is still the same one at the end */
const building = new Map();
function buildGen(v, sliceUrls) {
  if (building.has(v.ver)) return building.get(v.ver);
  const job = (async () => {
    const name = DATA + v.ver;
    const c = await caches.open(name);
    try {
      // room for a generation (the book is ~14MB unpacked) or no cache at all
      const est = self.navigator.storage && self.navigator.storage.estimate ? await self.navigator.storage.estimate() : null;
      if (est && est.quota && est.quota - (est.usage || 0) < MIN_FREE) throw new Error('no room');
      await Promise.all(BOOK.map(async (path) => {
        const pending = inflight.get(path);
        let r = pending ? await pending.catch(() => null) : null;
        if (!okBasic(r)) r = await fetch(path, { cache: 'no-cache' });
        if (r.status === 404) return; // an optional file this deploy lacks
        if (!okBasic(r) || !isJson(r)) throw new Error('book ' + path + ' ' + r.status);
        await c.put(path, r);
      }));
      for (const s of sliceUrls) await putSlice(c, s, v.ver);
      const again = await networkVer();
      if (!again || again.ver !== v.ver) throw new Error('deploy moved during build');
    } catch (e) {
      await caches.delete(name);
      return false;
    }
    const st = await readState();
    const prev = st.gen && st.gen !== v.ver ? st.gen : st.prev;
    await writeState({ ...st, gen: v.ver, prev: prev || '', lastCrawl: v.lastCrawl, storedAt: Date.now() });
    // keep the previous generation for tabs still reading it; drop the rest
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(DATA) && k !== name && k !== DATA + prev).map(k => caches.delete(k)));
    // tabs may swap to the new book in place (nothing listens yet — the
    // next visit paints it)
    self.clients.matchAll({ type: 'window' }).then(cs => cs.forEach(c => c.postMessage({ type: 'lectr-sw', genReady: v.ver, lastCrawl: v.lastCrawl }))).catch(() => {});
    return true;
  })().finally(() => building.delete(v.ver));
  building.set(v.ver, job);
  return job;
}

async function putSlice(cache, url, ver) {
  if (!url.endsWith('?v=' + encodeURIComponent(ver)) && !url.endsWith('?v=' + ver)) return;
  if (await cache.match(url)) return;
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (okBasic(r) && isJson(r)) await cache.put(url, r);
  } catch (_) { /* the page fetches it itself */ }
}

/** store a network page into the current generation (after its book) */
async function revalidate(netP, key, clientId) {
  let res;
  try { res = await netP; } catch (_) { noteOffline(clientId); return; }
  if (!okBasic(res) || !(res.headers.get('content-type') || '').includes('text/html')) return;
  const st0 = await readState();
  if (st0.off) return;
  let html, v;
  try {
    html = await res.clone().text();
    v = await networkVer();
  } catch (_) { noteOffline(clientId); return; }
  if (!v) return; // an unversioned deploy is never cached
  const ready = (await readState()).gen === v.ver || await buildGen(v, slicesIn(html));
  if (!ready) return;
  const st = await readState();
  if (st.gen !== v.ver) return;
  const pages = await caches.open(PAGES);
  const sig = codeSig(html);
  const headers = new Headers(res.headers);
  headers.set('x-lectr-gen', v.ver);
  headers.set('x-lectr-code', String(hash(sig)));
  // a code deploy (or a new generation) retires every page built before it:
  // their chunks are gone from the server
  for (const r of await pages.keys()) {
    const m = await pages.match(r);
    if (!m || m.headers.get('x-lectr-gen') !== v.ver || m.headers.get('x-lectr-code') !== String(hash(sig))) {
      if (r.url !== key) await pages.delete(r);
    }
  }
  await pages.put(key, new Response(html, { status: 200, statusText: 'OK', headers }));
  const data = await caches.open(DATA + v.ver);
  for (const s of slicesIn(html)) await putSlice(data, s, v.ver);
  await trim(PAGES, PAGES_MAX);
  await trim(DATA + v.ver, SLICES_MAX, r => SLICE_RE.test(new URL(r.url).pathname));
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function timeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// ── handlers ────────────────────────────────────────────────────────────────
async function onPage(event) {
  const req = event.request;
  const id = event.resultingClientId;
  const net = Promise.resolve(event.preloadResponse).then(r => r || fetch(req));
  const st = await readState();
  if (st.off) return net;
  const key = pageKey(req.url);
  let cached = null;
  if (st.gen && await caches.has(DATA + st.gen)) {
    const m = await (await caches.open(PAGES)).match(key);
    if (m && m.headers.get('x-lectr-gen') === st.gen) cached = m;
  }
  const young = st.storedAt && Date.now() - st.storedAt < MAX_GEN_AGE;
  // without a resultingClientId (older engines) the tab's book requests
  // could not be tied to this page's generation — network first there
  if (cached && young && id) {
    mapClient(id, st.gen);
    event.waitUntil(revalidate(net, key, id));
    return cached;
  }
  try {
    const res = cached ? await timeout(net, NET_TIMEOUT) : await net;
    mapClient(id, 'net');
    if (okBasic(res)) event.waitUntil(revalidate(Promise.resolve(res.clone()), key, id));
    return res;
  } catch (e) {
    if (cached) {
      mapClient(id, st.gen);
      noteOffline(id);
      event.waitUntil(revalidate(net, key, id).catch(() => {}));
      return cached;
    }
    throw e;
  }
}

async function onImmutable(event) {
  const req = event.request;
  const c = await caches.open(STATIC);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (okBasic(res)) {
    event.waitUntil(c.put(req, res.clone()).then(() => trim(STATIC, STATIC_MAX)).catch(() => {}));
  } else if (res.status === 404 && clientGen.get(event.clientId) && clientGen.get(event.clientId) !== 'net') {
    // this tab runs a cached page whose deploy is gone — drop the pages and
    // let the tab reload onto the network copy (it reloads once per session)
    event.waitUntil((async () => {
      await caches.delete(PAGES);
      const cl = await self.clients.get(event.clientId);
      if (cl) cl.postMessage({ type: 'lectr-sw', reload: true });
    })().catch(() => {}));
  }
  return res;
}

async function onAsset(event) {
  const req = event.request;
  const c = await caches.open(STATIC);
  const hit = await c.match(req);
  const net = fetch(req).then(r => {
    if (okBasic(r)) return c.put(req, r.clone()).then(() => r);
    return r;
  });
  if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

async function genFor(clientId) {
  const g = clientGen.get(clientId);
  return g && g !== 'net' && await caches.has(DATA + g) ? g : null;
}

async function onBook(event, kind) {
  const req = event.request;
  const path = new URL(req.url).pathname;
  const gen = await genFor(event.clientId);
  if (gen) {
    const hit = await (await caches.open(DATA + gen)).match(path);
    if (hit) return hit;
  }
  const p = fetch(req);
  if (kind === 'book' && !gen) {
    const tee = p.then(r => r.clone());
    tee.catch(() => {});
    inflight.set(path, tee);
    setTimeout(() => { if (inflight.get(path) === tee) inflight.delete(path); }, 60e3);
  }
  try {
    const res = await p;
    // an extra joins its generation only while the network is confirmed to
    // serve that very generation
    if (kind === 'extra' && gen && okBasic(res) && isJson(res)) {
      const st = await readState();
      if (gen === st.gen && verified.ver === gen && Date.now() - verified.at < VERIFIED_FOR) {
        event.waitUntil((async () => {
          await (await caches.open(DATA + gen)).put(path, res.clone());
          await trim(DATA + gen, EXTRAS_MAX, r => EXTRA_RE.test(new URL(r.url).pathname));
        })().catch(() => {}));
      }
    }
    return res;
  } catch (e) {
    // offline: the current generation's copy, if this tab has no generation
    const st = await readState();
    if (!gen && st.gen) {
      const hit = await caches.open(DATA + st.gen).then(c => c.match(path));
      if (hit) { noteOffline(event.clientId); return hit; }
    }
    throw e;
  }
}

async function onSlice(event) {
  const req = event.request;
  const url = new URL(req.url);
  const ver = decodeURIComponent(url.search.slice(3));
  const name = DATA + ver;
  if (await caches.has(name)) {
    const hit = await (await caches.open(name)).match(req.url);
    if (hit) return hit;
  }
  const res = await fetch(req);
  const st = await readState();
  if (okBasic(res) && isJson(res) && (st.gen === ver || building.has(ver))) {
    event.waitUntil(caches.open(name).then(c => c.put(req.url, res.clone())).catch(() => {}));
  }
  return res;
}

// ── lifecycle ───────────────────────────────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  await self.clients.claim();
  if (!CACHE_ENABLED) {
    await wipeCaches(false);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.disable().catch(() => {});
    return;
  }
  if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
  // drop caches of older worker versions and orphaned generations
  const st = await readState();
  const keep = new Set([STATIC, PAGES, CTL, DATA + (st.gen || ''), DATA + (st.prev || '')]);
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith(PREFIX) && !keep.has(k)).map(k => caches.delete(k)));
})()));

self.addEventListener('fetch', (event) => {
  const kind = route(event.request, self.location.origin);
  if (!kind) return; // the browser handles it exactly as without a worker
  if (stateMem && stateMem.off && kind !== 'page') return;
  const h = kind === 'page' ? onPage(event)
    : kind === 'immutable' ? onImmutable(event)
    : kind === 'asset' ? onAsset(event)
    : kind === 'slice' ? onSlice(event)
    : onBook(event, kind);
  event.respondWith(h);
});

self.addEventListener('message', (event) => {
  const d = event.data || {};
  const port = event.ports && event.ports[0];
  const id = event.source && event.source.id;
  if (d.type === 'lectr-sw-status') {
    event.waitUntil(readState().then(st => {
      const g = clientGen.get(id);
      if (port) port.postMessage({
        enabled: CACHE_ENABLED && !st.off,
        fromCache: !!g && g !== 'net',
        offline: offlineClients.has(id),
        gen: st.gen || '',
        lastCrawl: st.lastCrawl || '',
        storedAt: st.storedAt || 0,
      });
    }));
  } else if (d.type === 'lectr-sw-off') {
    event.waitUntil((async () => {
      await wipeCaches(true);
      await writeState({ off: true });
      clientGen.clear();
      if (port) port.postMessage({ ok: true });
    })());
  } else if (d.type === 'lectr-sw-on') {
    event.waitUntil((async () => {
      await writeState({});
      if (port) port.postMessage({ ok: true });
    })());
  } else if (d.type === 'lectr-sw-warm' && typeof d.path === 'string' && CACHE_ENABLED) {
    // the worker just took over a page that loaded without it: store that
    // page and its book now (HTTP-cache revalidations), so the very next
    // visit paints from here
    let url;
    try { url = new URL(d.path, self.location.origin); } catch (_) { return; }
    if (url.origin !== self.location.origin || route({ method: 'GET', url: url.href, mode: 'navigate', headers: null }, self.location.origin) !== 'page') return;
    event.waitUntil(revalidate(fetch(url.href, { credentials: 'same-origin' }), pageKey(url.href), id).catch(() => {}));
  }
});

function safePath(u) {
  try {
    const url = new URL(u, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/profile';
  } catch (_) {
    return '/profile';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data && event.data.text() }; }
  const title = String(data.title || 'lectr').slice(0, 120);
  const options = {
    body: String(data.body || '').slice(0, 300),
    tag: data.tag ? String(data.tag).slice(0, 120) : undefined,
    icon: '/brand/lectr-icon-512.png',
    badge: '/icon.png',
    data: { url: safePath(data.url || '/profile') },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/profile';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        await w.focus();
        if ('navigate' in w) return w.navigate(path).catch(() => self.clients.openWindow(path));
        return;
      }
    }
    return self.clients.openWindow(path);
  })());
});
