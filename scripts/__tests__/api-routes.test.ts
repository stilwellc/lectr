/**
 * The read-only lot API (functions/_lib/api.ts) end to end over a FAKE R2:
 * scripts/emit-r2-index.ts writes a small synthetic book to a temp dir, a
 * fake bucket serves it (ranged GETs included), and every route is checked
 * against the answer the old client-side corpus path computed over the WHOLE
 * pool — the precompute (partitions, window, pages) must never change a number.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AuctionLot } from '../../app/types';
import { emitR2Index, orderRows } from '../emit-r2-index';
import { handleApi } from '../../functions/_lib/api';
import { Store, resetStoreMemo, type R2BucketLike } from '../../functions/_lib/store';
import { decodeSummary } from '../../app/lib/api';
import { signalWithPool, soldCompBand, cultureReferenceBand, appraiseLot, areComparable } from '../../app/lib/comps';
import { TABLE_MAX_PAGES, TABLE_PAGE, type Loc, type SummaryJson } from '../../functions/_lib/format';

// ── fake R2 over a directory ────────────────────────────────────────────────
class DirBucket implements R2BucketLike {
  gets: string[] = [];
  constructor(private root: string) {}
  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    this.gets.push(key);
    const f = path.join(this.root, key);
    if (!fs.existsSync(f)) return null;
    let buf = fs.readFileSync(f);
    if (options?.range) buf = buf.subarray(options.range.offset, options.range.offset + options.range.length);
    const u8 = new Uint8Array(buf);
    return {
      arrayBuffer: async () => u8.slice().buffer as ArrayBuffer,
      text: async () => Buffer.from(u8).toString('utf8'),
    };
  }
}
class FakeCache {
  store = new Map<string, { body: ArrayBuffer; headers: Headers; status: number }>();
  hits = 0;
  async match(req: Request) {
    const r = this.store.get(req.url);
    if (!r) return undefined;
    this.hits++;
    return new Response(r.body.slice(0), { status: r.status, headers: r.headers });
  }
  async put(req: Request, res: Response) { this.store.set(req.url, { body: await res.arrayBuffer(), headers: new Headers(res.headers), status: res.status }); }
}

// ── a synthetic book ─────────────────────────────────────────────────────────
let n = 0;
const lot = (o: Record<string, unknown>): AuctionLot => ({
  id: `t-${++n}`, artist: 'pablo-picasso', title: 'Untitled', category: 'print', auctionHouse: 'Christie\'s',
  saleDate: '2025-01-01', currency: 'USD', status: 'sold', url: 'https://example.com/x', ...o,
} as unknown as AuctionLot);

const houses = ['Christie\'s', 'Sotheby\'s', 'Bonhams', 'Phillips'];
const main: AuctionLot[] = [];
const archive: AuctionLot[] = [];
// picasso prints: two editions + generic prints, spread over houses and dates
for (let i = 0; i < 40; i++) {
  main.push(lot({
    title: i % 3 === 0 ? 'Le Repas Frugal, etching' : i % 3 === 1 ? 'Jacqueline au chapeau, linocut' : `Composition ${i}, lithograph`,
    medium: i % 3 === 1 ? 'linocut in colors' : 'etching', dimensions: `${10 + (i % 7)} x ${14 + (i % 5)} in.`,
    estimateLow: 10000 + i * 500, estimateHigh: 15000 + i * 500, priceUsd: 9000 + i * 900,
    auctionHouse: houses[i % 4], saleDate: `20${15 + (i % 10)}-0${1 + (i % 9)}-1${i % 9}`, formKey: 'print',
  }));
}
main.push(lot({ title: 'Femme assise, oil on canvas', category: 'original', medium: 'oil on canvas', formKey: 'painting', priceUsd: 2_500_000, estimateLow: 2e6, estimateHigh: 3e6, saleDate: '2025-05-14' }));
// sold long before the comps window → { np: true }
const old = lot({ title: 'Tête, oil on canvas', category: 'original', medium: 'oil on canvas', formKey: 'painting', priceUsd: 900_000, estimateLow: 6e5, estimateHigh: 8e5, saleDate: '2012-05-14' });
main.push(old);
main.push(lot({ title: 'Untitled, bought in print', status: 'bought_in', formKey: 'print', estimateLow: 5000, estimateHigh: 7000 }));
// the anchor: an upcoming print with an estimate (no engine call → client read)
const anchor = lot({ title: 'Le Repas Frugal, etching', medium: 'etching', dimensions: '12 x 15 in.', estimateLow: 8000, estimateHigh: 12000, status: 'upcoming', saleDate: '2026-11-01', formKey: 'print' });
main.push(anchor);
// an engine-called upcoming lot whose pool includes an OFF-WIRE extra id
const extra = lot({ id: 'off-wire-1', title: 'Composition X, lithograph', priceUsd: 33000, saleDate: '2019-03-03', formKey: 'print' });
const called = lot({
  title: 'Composition Y, lithograph', status: 'upcoming', saleDate: '2026-11-02', estimateLow: 10000, estimateHigh: 12000, formKey: 'print',
  value: { signal: { label: 'below comparable market' }, compRatio: 1.6, compValueUsd: 18000, n: 3, confidence: 'medium', poolIds: [main[2].id, main[5].id, 'off-wire-1'] },
});
main.push(called);
// rolex: same-reference wristwatches
for (let i = 0; i < 12; i++) {
  main.push(lot({
    artist: 'rolex', category: 'object', title: `Rolex Daytona ref. 116500 stainless steel ${i}`, medium: 'stainless steel', formKey: 'wristwatch',
    reference: i < 9 ? '116500' : '16520', priceUsd: 25000 + i * 1000, estimateLow: 20000, estimateHigh: 30000, auctionHouse: houses[i % 2], saleDate: `2024-0${1 + (i % 9)}-01`,
  }));
}
const watch = lot({ artist: 'rolex', category: 'object', title: 'Rolex Daytona ref. 116500 stainless steel', medium: 'stainless steel', formKey: 'wristwatch', reference: '116500', status: 'upcoming', estimateLow: 24000, estimateHigh: 32000, saleDate: '2026-12-01' });
main.push(watch);
// game-used (sports, archive tier): one athlete's jerseys across main + archive
for (let i = 0; i < 8; i++) {
  (i < 3 ? main : archive).push(lot({
    id: `goldin-${i}`, artist: 'game-used', category: 'object', title: `Game-worn jersey ${i} Jordan`, playerSlug: 'michael-jordan', playerName: 'Michael Jordan',
    sport: i % 2 ? 'Basketball' : 'Baseball', objectType: 'jersey', priceUsd: 5000 + i * 700, auctionHouse: 'Goldin', saleDate: `2023-0${1 + i}-02`,
  }));
}
const jersey = lot({ id: 'goldin-anchor', artist: 'game-used', category: 'object', title: 'Game-worn jersey Jordan', playerSlug: 'michael-jordan', sport: 'Basketball', objectType: 'jersey', status: 'sold', priceUsd: 8000, auctionHouse: 'Goldin', saleDate: '2026-01-01' });
archive.push(jersey);
// culture: subject × itemClass tier
for (let i = 0; i < 6; i++) {
  main.push(lot({
    artist: 'entertainment-memorabilia', category: 'object', title: `Star Wars prop ${i}`, subjectKeys: ['star-wars'], itemClass: 'prop',
    priceUsd: 4000 + i * 250, auctionHouse: 'Heritage', saleDate: `2022-0${1 + i}-05`,
  }));
}
const prop = lot({ artist: 'entertainment-memorabilia', category: 'object', title: 'Star Wars prop helmet', subjectKeys: ['star-wars'], itemClass: 'prop', status: 'sold', priceUsd: 4500, auctionHouse: 'Heritage', saleDate: '2025-02-02' });
main.push(prop);
// provenance: one object sold twice
const g1 = lot({ title: 'La Colombe, lithograph', repeatSaleGroupId: 'grp-1', priceUsd: 12000, saleDate: '2010-01-01', formKey: 'print' });
const g2 = lot({ title: 'La Colombe, lithograph', repeatSaleGroupId: 'grp-1', priceUsd: 18000, saleDate: '2025-06-01', formKey: 'print' });
main.push(g1, g2);
// a settled flag
const flagged = lot({ title: 'Flagged then sold', priceUsd: 21000, estimateLow: 10000, estimateHigh: 14000, saleDate: '2026-09-20', signal: { label: 'Below Market', pct: 40 } as unknown as AuctionLot['signal'] });
main.push(flagged);
// a deep maker table (more sold rows than the materialized pages)
for (let i = 0; i < TABLE_MAX_PAGES * TABLE_PAGE + 30; i++) {
  main.push(lot({ artist: 'kaws', category: i % 2 ? 'print' : 'original', title: `Companion ${i}`, priceUsd: 1000 + i, auctionHouse: houses[i % 3], saleDate: `2019-0${1 + (i % 9)}-1${i % 9}` }));
}

const eager = [anchor, called, watch];

let dir = '';
let bucket: DirBucket;
const call = async (p: string, init: RequestInit = {}, cache: FakeCache | null = null) =>
  handleApi(new Request(`https://lectr.test${p}`, init), { CORPUS: bucket }, {}, cache);
/** read a response like a browser would (stored gzip is passed through) */
const raw = async (res: Response) => {
  const b = Buffer.from(await res.arrayBuffer());
  return res.headers.get('Content-Encoding') === 'gzip' ? zlib.gunzipSync(b).toString('utf8') : b.toString('utf8');
};
const body = async (res: Response) => JSON.parse(await raw(res));
const NOW = new Date('2026-10-03T00:00:00Z');

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2api-'));
  emitR2Index({ main, archive, eager, extras: [extra], lastCrawl: '2026-10-02T16:02:52.000Z', now: NOW, compsDays: 730 }, dir);
  bucket = new DirBucket(dir);
  resetStoreMemo();
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('version + one lot + many lots', async () => {
  const v = await body(await call('/api/version'));
  assert.equal(v.lastCrawl, '2026-10-02T16:02:52.000Z');
  const j = await body(await call(`/api/lot/${main[3].id}`));
  assert.equal(j.lot.id, main[3].id);
  assert.equal(j.lot.title, main[3].title);
  // the archive tier and the off-wire extras resolve by id too
  assert.equal((await body(await call('/api/lot/goldin-anchor'))).lot.id, 'goldin-anchor');
  assert.equal((await body(await call('/api/lot/off-wire-1'))).lot.priceUsd, 33000);
  assert.equal((await call('/api/lot/nope-404')).status, 404);
  assert.equal((await call('/api/lot/%3Cscript%3E')).status, 400);
  const many = await body(await call(`/api/lots?ids=${main[0].id},${main[1].id},missing-1`));
  assert.deepEqual(Object.keys(many.lots).sort(), [main[0].id, main[1].id].sort());
  assert.equal((await call(`/api/lots?ids=${Array.from({ length: 13 }, (_, i) => `x${i}`).join(',')}`)).status, 400);
});

test('comps: an uncalled lot gets NO fallback read (wave 3) and no appraisal (wave 4) — context rows only', async () => {
  const book = main.filter(l => l.artist === 'pablo-picasso');
  // the client read WOULD call this lot — the API must not ship it
  assert.ok(signalWithPool(anchor, book), 'fixture must be readable client-side');
  const r = await call(`/api/comps?lot=${anchor.id}`);
  // stored gzip is decompressed in the Function (Pages ignores encodeBody:'manual'); the edge compresses
  assert.equal(r.headers.get('Content-Encoding'), null, 'answers are served as plain JSON');
  const j = await body(r);
  assert.equal(j.pack.c ?? null, null, 'no comp call without an engine call');
  assert.equal(j.pack.sig ?? null, null, 'no directional signal without an engine call');
  // (wave 4) a lot the engine declined carries no client appraisal either
  assert.ok(appraiseLot(anchor, book), 'fixture must be appraisable client-side');
  assert.equal(j.pack.ap ?? null, null, 'no appraisal without an engine value');
  assert.equal(j.pack.a ?? null, null);
  assert.ok(j.ctx.length > 0, 'the context list renders instead');
});

test('comps: engine call resolves its pool ids, including off-wire rows', async () => {
  const j = await body(await call(`/api/comps?lot=${called.id}`));
  assert.equal(j.pack.c.n, 3);
  assert.equal(j.pack.c.resolved, 3);
  assert.ok(j.pack.c.rows.some((x: AuctionLot) => x.id === 'off-wire-1'));
  assert.equal(j.pack.c.med, 18000);
});

test('comps: watch reference, sports band over main+archive, culture band, provenance, context, window', async () => {
  // an uncalled watch: no fallback read (wave 3)
  const jw = await body(await call(`/api/comps?lot=${watch.id}`));
  assert.equal(jw.pack.c ?? null, null);

  const band = soldCompBand(jersey, [...main, ...archive].filter(l => l.artist === 'game-used'))!;
  assert.ok(band);
  const jj = await body(await call('/api/comps?lot=goldin-anchor'));
  assert.equal(jj.pack.b.n, band.n);
  assert.equal(jj.pack.b.median, band.median);

  const cb = cultureReferenceBand(prop, main.filter(l => l.artist === 'entertainment-memorabilia'))!;
  assert.ok(cb);
  const jc = await body(await call(`/api/comps?lot=${prop.id}`));
  assert.equal(jc.pack.r.med, cb.med);
  assert.equal(jc.pack.r.n, cb.n);

  const jg = await body(await call(`/api/comps?lot=${g2.id}`));
  assert.deepEqual(jg.pack.p.map((x: AuctionLot) => x.id), [g1.id, g2.id]);

  // a sold art lot with no call and no band → the modal's context rows
  const plain = main.find(l => l.title === 'Femme assise, oil on canvas')!;
  const jp = await body(await call(`/api/comps?lot=${plain.id}`));
  const ctxWant = main.filter(l => l.artist === plain.artist && l.status === 'sold' && l.priceUsd && l.id !== plain.id && areComparable(plain, l)).length;
  assert.equal(jp.ctx.length, Math.min(15, ctxWant));

  // sold before the window: an honest "not precomputed", never "no comps"
  const jo = await body(await call(`/api/comps?lot=${old.id}`));
  assert.equal(jo.np, true);
  assert.equal((await call('/api/comps?lot=nope-404')).status, 404);
});

test('maker table: PastResults order, filters, pages, facets, cap', async () => {
  const sold = main.filter(l => l.artist === 'pablo-picasso' && l.status === 'sold');
  for (const sort of ['date', 'price'] as const) {
    const want = orderRows(sold as never[], sort).map(l => l.id);
    const p0 = await body(await call(`/api/maker/pablo-picasso?sort=${sort}&page=0`));
    const p1 = await body(await call(`/api/maker/pablo-picasso?sort=${sort}&page=1`));
    assert.equal(p0.total, sold.length);
    assert.deepEqual([...p0.rows, ...p1.rows].map((r: AuctionLot) => r.id), want.slice(0, 40));
  }
  const orig = await body(await call('/api/maker/pablo-picasso?cat=original'));
  assert.equal(orig.total, sold.filter(l => l.category === 'original').length);
  assert.deepEqual(orig.facets.cats, ['original', 'print']);
  const none = await body(await call('/api/maker/pablo-picasso?cat=sculpture'));
  assert.equal(none.total, 0);
  assert.deepEqual(none.facets.cats, ['original', 'print'], 'an empty filter keeps the chips');
  // deep table: pages stop at the materialized depth and say so
  const deep = await body(await call(`/api/maker/kaws?page=${TABLE_MAX_PAGES - 1}`));
  assert.equal(deep.rows.length, TABLE_PAGE);
  assert.equal(deep.capped, true);
  const past = await body(await call(`/api/maker/kaws?page=${TABLE_MAX_PAGES}`));
  assert.equal(past.rows.length, 0);
  assert.equal(past.capped, true);
  assert.equal((await call('/api/maker/not-a-maker')).status, 404);
  assert.equal((await call('/api/maker/pablo-picasso?size=999')).status, 400);
  assert.equal((await call('/api/maker/pablo-picasso?sort=random')).status, 400);
  assert.equal((await call('/api/maker/pablo-picasso?status=upcoming')).status, 400);
});

test('archive table: sports carries the archive tier and sport chips', async () => {
  const want = [...main, ...archive].filter(l => l.artist === 'game-used' && l.status === 'sold' && (l.priceUsd || 0) > 0);
  const j = await body(await call('/api/archive?market=sports'));
  assert.equal(j.total, want.length);
  assert.ok(j.facets.sports && j.facets.sports.length === 2);
  const bb = await body(await call('/api/archive?market=sports&sport=Basketball'));
  assert.equal(bb.total, want.filter(l => l.sport === 'Basketball').length);
  assert.equal((await call('/api/archive?market=mars')).status, 400);
  const all = await body(await call('/api/archive?market=all'));
  assert.equal(all.total, main.filter(l => l.status === 'sold' && (l.priceUsd || 0) > 0).length);
});

test('summaries: maker book minus the eager lots, decoded; market summary', async () => {
  const r = await call('/api/maker/pablo-picasso?view=summary');
  assert.equal(r.headers.get('Content-Encoding'), null);
  const rows = decodeSummary(await body(r) as SummaryJson);
  const want = main.filter(l => l.artist === 'pablo-picasso' && !eager.some(e => e.id === l.id));
  assert.equal(rows.length, want.length);
  assert.equal(rows.filter(l => l.status === 'sold').length, want.filter(l => l.status === 'sold').length);
  assert.equal(rows.reduce((m, l) => Math.max(m, l.priceUsd || 0), 0), 2_500_000);
  assert.ok(rows.find(l => l.priceUsd === 2_500_000)!.title.includes('Femme'), 'top rows come back whole');
  const mj = await body(await call('/api/market/sports?view=summary')) as SummaryJson;
  assert.equal(mj.n, [...main, ...archive].filter(l => l.artist === 'game-used').length);
});

test('settled flags carry their flag; ref ledgers page', async () => {
  const j = await body(await call('/api/settled-flags'));
  assert.deepEqual(j.rows.map((r: AuctionLot) => r.id), [flagged.id]);
  assert.equal(j.rows[0].signal.label, 'Below Market');
  const ref = await body(await call('/api/ref/rolex/116500'));
  assert.equal(ref.total, 9);
  assert.equal(ref.rows.length, 9);
});

test('caching: ETag 304, edge cache hit (gzip pass-through too), headers; refusals', async () => {
  const cache = new FakeCache();
  const a = await call(`/api/lot/${main[0].id}`, {}, cache);
  const etag = a.headers.get('ETag')!;
  assert.match(etag, /^"/);
  assert.equal(a.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(a.headers.get('Cache-Control')!, /max-age=300/);
  assert.equal(a.headers.get('Access-Control-Allow-Origin'), null);
  await a.arrayBuffer();
  const b = await call(`/api/lot/${main[0].id}`, {}, cache);
  assert.equal(b.headers.get('X-Api-Cache'), 'hit');
  assert.equal((await body(b)).lot.id, main[0].id);
  await (await call(`/api/comps?lot=${anchor.id}`, {}, cache)).arrayBuffer();
  const c2 = await call(`/api/comps?lot=${anchor.id}`, {}, cache);
  assert.equal(c2.headers.get('X-Api-Cache'), 'hit');
  assert.equal((await body(c2)).id, anchor.id, 'a cached gzip pass-through stays readable');
  assert.equal((await call(`/api/lot/${main[0].id}`, { headers: { 'If-None-Match': etag } })).status, 304);
  assert.equal((await call('/api/version', { method: 'POST' })).status, 405);
  assert.equal((await call('/api/version', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call('/api/nope')).status, 404);
});

test('a warm comps request is two small reads', async () => {
  // pointer, manifest and dir.bin are per-isolate memos; then one id bucket
  // and the answer itself (passed through, never parsed)
  await (await call(`/api/comps?lot=${anchor.id}`)).arrayBuffer();
  bucket.gets = [];
  await (await call(`/api/comps?lot=${called.id}`)).arrayBuffer();
  assert.ok(bucket.gets.length <= 2, `reads: ${bucket.gets.join(', ')}`);
});

test('no corpus → 503, never a hang or an empty 200', async () => {
  resetStoreMemo();
  const empty = new DirBucket(fs.mkdtempSync(path.join(os.tmpdir(), 'r2api-empty-')));
  const res = await handleApi(new Request('https://lectr.test/api/lot/t-1'), { CORPUS: empty }, {}, null);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  // the rollout probe answers plainly
  const v = await handleApi(new Request('https://lectr.test/api/version'), {}, {}, null);
  assert.equal(v.status, 200);
  assert.deepEqual(await v.json(), { version: null, available: false });
  resetStoreMemo();
});

test('cold start: a table request is pointer → loc shards → page (no dir.bin, no manifest)', async () => {
  resetStoreMemo();
  bucket.gets = [];
  const res = await call('/api/archive?market=all&page=0');
  assert.equal(res.status, 200);
  await res.arrayBuffer();
  assert.equal(bucket.gets[0], 'api/current.json');
  assert.ok(!bucket.gets.some(k => /dir\.bin|manifest\.json/.test(k)), `reads: ${bucket.gets.join(', ')}`);
  assert.ok(bucket.gets.length <= 4, `reads: ${bucket.gets.join(', ')}`);
});

test('cold start: a pointer without locDir (written before it existed) still reads via dir.bin', async () => {
  resetStoreMemo();
  const legacy: R2BucketLike = {
    get: async (key, opts) => {
      const o = await bucket.get(key, opts);
      if (!o || key !== 'api/current.json') return o;
      const { version, prefix } = JSON.parse(await o.text());
      const t = JSON.stringify({ version, prefix });
      return { arrayBuffer: async () => new TextEncoder().encode(t).buffer as ArrayBuffer, text: async () => t };
    },
  };
  const a = await body(await handleApi(new Request('https://lectr.test/api/maker/kaws?page=1'), { CORPUS: legacy }, {}, null));
  resetStoreMemo();
  const b = await body(await call('/api/maker/kaws?page=1'));
  assert.deepEqual(a, b);
  assert.equal(a.rows.length, TABLE_PAGE);
  resetStoreMemo();
});

test('cold isolates share the colo cache: pointer + index reads come from it, R2 serves only the answer', async () => {
  const cache = new FakeCache();
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  const go = async (p: string) => {
    const r = await handleApi(new Request(`https://lectr.test${p}`), { CORPUS: bucket }, ctx, cache);
    await r.arrayBuffer();
    await Promise.all(pending);
    return r;
  };
  resetStoreMemo();
  await go(`/api/lot/${main[3].id}`);
  await go('/api/maker/kaws?page=2');
  // a second, fresh isolate in the same colo
  resetStoreMemo();
  bucket.gets = [];
  const r1 = await go('/api/maker/kaws?page=3');
  assert.equal(r1.headers.get('X-Api-Cache'), 'miss');
  assert.equal(bucket.gets.length, 1, `reads: ${bucket.gets.join(', ')}`);
  bucket.gets = [];
  const r2 = await go(`/api/lot/${main[4].id}`);
  assert.equal(r2.status, 200);
  assert.ok(!bucket.gets.some(k => /dir\.bin|current\.json/.test(k)), `reads: ${bucket.gets.join(', ')}`);
  resetStoreMemo();
});

test('summaries stream the plain copy (no gunzip in the Function); the gzip copy stays for older readers', async () => {
  resetStoreMemo();
  const res = await call('/api/market/all?view=summary');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Encoding'), null);
  const plain = await res.text();
  const store = await Store.open({ CORPUS: bucket });
  const gz = await store.json<SummaryJson>((await store.loc('s:k:all')) as Loc);
  assert.deepEqual(JSON.parse(plain), gz);
  resetStoreMemo();
});
