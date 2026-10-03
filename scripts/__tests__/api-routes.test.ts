/**
 * The read-only lot API (functions/_lib/api.ts) end to end over a FAKE R2:
 * scripts/emit-r2-index.ts writes a small synthetic book to a temp dir, a
 * fake bucket serves it (ranged GETs included), and every route is checked
 * against the answer the old client-side corpus path computed over the WHOLE
 * pool — the partitions must never change a number.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AuctionLot } from '../../app/types';
import { emitR2Index } from '../emit-r2-index';
import { handleApi } from '../../functions/_lib/api';
import { resetStoreMemo, type R2BucketLike } from '../../functions/_lib/store';
import { decodeSummary } from '../../app/lib/api';
import { signalWithPool, soldCompBand, cultureReferenceBand, appraiseLot, areComparable } from '../../app/lib/comps';
import type { SummaryJson } from '../../functions/_lib/format';

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
  store = new Map<string, Response>();
  hits = 0;
  async match(req: Request) { const r = this.store.get(req.url); if (r) { this.hits++; return r.clone(); } return undefined; }
  async put(req: Request, res: Response) { this.store.set(req.url, res); }
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
main.push(lot({ title: 'Femme assise, oil on canvas', category: 'original', medium: 'oil on canvas', formKey: 'painting', priceUsd: 2_500_000, estimateLow: 2e6, estimateHigh: 3e6, saleDate: '2024-05-14' }));
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
const g2 = lot({ title: 'La Colombe, lithograph', repeatSaleGroupId: 'grp-1', priceUsd: 18000, saleDate: '2020-01-01', formKey: 'print' });
main.push(g1, g2);
// a settled flag
const flagged = lot({ title: 'Flagged then sold', priceUsd: 21000, estimateLow: 10000, estimateHigh: 14000, saleDate: '2026-09-20', signal: { label: 'Below Market', pct: 40 } as unknown as AuctionLot['signal'] });
main.push(flagged);

const eager = [anchor, called, watch];

let dir = '';
let bucket: DirBucket;
const call = async (p: string, init: RequestInit = {}, cache: FakeCache | null = null) => {
  const res = await handleApi(new Request(`https://lectr.test${p}`, init), { CORPUS: bucket }, {}, cache);
  return res;
};
const body = async (res: Response) => JSON.parse(await res.text());

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2api-'));
  emitR2Index({ main, archive, eager, extras: [extra], lastCrawl: '2026-10-02T16:02:52.000Z' }, dir);
  bucket = new DirBucket(dir);
  resetStoreMemo();
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('version + one lot + many lots', async () => {
  const v = await body(await call('/api/version'));
  assert.equal(v.lastCrawl, '2026-10-02T16:02:52.000Z');
  const r = await call(`/api/lot/${main[3].id}`);
  assert.equal(r.status, 200);
  const j = await body(r);
  assert.equal(j.lot.id, main[3].id);
  assert.equal(j.lot.title, main[3].title);
  // the archive tier and the off-wire extras resolve by id too
  assert.equal((await body(await call('/api/lot/goldin-anchor'))).lot.id, 'goldin-anchor');
  assert.equal((await body(await call('/api/lot/off-wire-1'))).lot.priceUsd, 33000);
  assert.equal((await call('/api/lot/nope-404')).status, 404);
  assert.equal((await call('/api/lot/%3Cscript%3E')).status, 400);
  const many = await body(await call(`/api/lots?ids=${main[0].id},${main[1].id},missing-1`));
  assert.deepEqual(Object.keys(many.lots).sort(), [main[0].id, main[1].id].sort());
  assert.equal((await call(`/api/lots?ids=${Array.from({ length: 61 }, (_, i) => `x${i}`).join(',')}`)).status, 400);
});

test('comps: the client read over the partition equals the read over the whole book', async () => {
  const book = main.filter(l => l.artist === 'pablo-picasso');
  const want = signalWithPool(anchor, book)!;
  assert.ok(want, 'fixture must produce a read');
  const j = await body(await call(`/api/comps?lot=${anchor.id}`));
  assert.equal(j.pack.c.n, want.pool.length);
  assert.equal(j.pack.c.med, want.signal.med);
  assert.deepEqual(j.pack.c.rows.map((r: AuctionLot) => r.id).sort(), want.pool.map(l => l.id).sort());
  assert.equal(j.pack.ap.value, appraiseLot(anchor, book)!.value);
  assert.equal(j.pack.sig.label, want.signal.label);
});

test('comps: engine call resolves its pool ids, including off-wire rows', async () => {
  const j = await body(await call(`/api/comps?lot=${called.id}`));
  assert.equal(j.pack.c.n, 3);
  assert.equal(j.pack.c.resolved, 3);
  assert.ok(j.pack.c.rows.some((r: AuctionLot) => r.id === 'off-wire-1'));
  assert.equal(j.pack.c.med, 18000);
});

test('comps: watch reference, sports band over main+archive, culture band, provenance, modal context', async () => {
  const rolexBook = main.filter(l => l.artist === 'rolex');
  const w = signalWithPool(watch, rolexBook);
  const jw = await body(await call(`/api/comps?lot=${watch.id}`));
  assert.equal(jw.pack.c?.n ?? null, w ? w.pool.length : null);

  const sportsBook = [...main, ...archive].filter(l => l.artist === 'game-used');
  const band = soldCompBand(jersey, sportsBook)!;
  assert.ok(band);
  const jj = await body(await call(`/api/comps?lot=goldin-anchor`));
  assert.equal(jj.pack.b.n, band.n);
  assert.equal(jj.pack.b.median, band.median);

  const cultureMain = main.filter(l => l.artist === 'entertainment-memorabilia');
  const cb = cultureReferenceBand(prop, cultureMain)!;
  assert.ok(cb);
  const jc = await body(await call(`/api/comps?lot=${prop.id}`));
  assert.equal(jc.pack.r.med, cb.med);
  assert.equal(jc.pack.r.n, cb.n);

  const jg = await body(await call(`/api/comps?lot=${g2.id}`));
  assert.deepEqual(jg.pack.p.map((r: AuctionLot) => r.id), [g1.id, g2.id]);

  // a sold art lot with no estimate: no call, no band → the modal's context rows
  const plain = main.find(l => l.title === 'Femme assise, oil on canvas')!;
  const jp = await body(await call(`/api/comps?lot=${plain.id}`));
  const ctxWant = main.filter(l => l.artist === plain.artist && l.status === 'sold' && l.priceUsd && l.id !== plain.id && areComparable(plain, l)).length;
  assert.equal(jp.ctx.length, Math.min(15, ctxWant));
});

/** PastResults' own order (the reference implementation the API mirrors). */
function pastResultsOrder(lots: AuctionLot[], sort: 'date' | 'price', cat?: string): AuctionLot[] {
  const filtered = cat ? lots.filter(l => l.category === cat) : lots;
  const copy = [...filtered];
  if (sort === 'price') return copy.sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0));
  copy.sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime());
  const groups = new Map<string, AuctionLot[]>();
  for (const l of copy) { const g = groups.get(l.auctionHouse) || []; g.push(l); groups.set(l.auctionHouse, g); }
  if (groups.size < 2) return copy;
  const qs = Array.from(groups.values());
  const woven: AuctionLot[] = [];
  for (let i = 0; woven.length < copy.length; i++) for (const q of qs) if (i < q.length) woven.push(q[i]);
  return woven;
}

test('maker table: PastResults order, filters, paging, facets', async () => {
  const sold = main.filter(l => l.artist === 'pablo-picasso' && l.status === 'sold');
  for (const sort of ['date', 'price'] as const) {
    const want = pastResultsOrder(sold, sort).map(l => l.id);
    const p0 = await body(await call(`/api/maker/pablo-picasso?sort=${sort}&page=0&size=10`));
    const p1 = await body(await call(`/api/maker/pablo-picasso?sort=${sort}&page=1&size=10`));
    assert.equal(p0.total, sold.length);
    if (sort === 'date') assert.deepEqual([...p0.rows, ...p1.rows].map((r: AuctionLot) => r.id), want.slice(0, 20));
    else assert.deepEqual([...p0.rows, ...p1.rows].map((r: AuctionLot) => r.priceUsd), want.slice(0, 20).map(id => sold.find(l => l.id === id)!.priceUsd));
  }
  const orig = await body(await call('/api/maker/pablo-picasso?cat=original&size=50'));
  assert.equal(orig.total, sold.filter(l => l.category === 'original').length);
  assert.deepEqual(orig.facets.cats, ['original', 'print']);
  assert.equal((await call('/api/maker/not-a-maker')).status, 404);
  assert.equal((await call('/api/maker/pablo-picasso?size=999')).status, 400);
  assert.equal((await call('/api/maker/pablo-picasso?sort=random')).status, 400);
  assert.equal((await call('/api/maker/pablo-picasso?status=upcoming')).status, 400);
});

test('archive table: sports carries the archive tier and sport chips', async () => {
  const j = await body(await call('/api/archive?market=sports&size=50'));
  const want = [...main, ...archive].filter(l => l.artist === 'game-used' && l.status === 'sold' && (l.priceUsd || 0) > 0);
  assert.equal(j.total, want.length);
  assert.ok(j.facets.sports && j.facets.sports.length === 2);
  const bb = await body(await call('/api/archive?market=sports&sport=Basketball&size=50'));
  assert.equal(bb.total, want.filter(l => l.sport === 'Basketball').length);
  assert.equal((await call('/api/archive?market=mars')).status, 400);
  const all = await body(await call('/api/archive?market=all&size=1'));
  assert.equal(all.total, main.filter(l => l.status === 'sold' && (l.priceUsd || 0) > 0).length);
});

test('summaries: maker book minus the eager lots, decoded; market summary', async () => {
  const r = await call('/api/maker/pablo-picasso?view=summary');
  assert.equal(r.headers.get('Content-Encoding'), 'gzip');
  const j = JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8')) as SummaryJson;
  const rows = decodeSummary(j);
  const want = main.filter(l => l.artist === 'pablo-picasso' && !eager.some(e => e.id === l.id));
  assert.equal(rows.length, want.length);
  assert.equal(rows.filter(l => l.status === 'sold').length, want.filter(l => l.status === 'sold').length);
  const top = rows.reduce((m, l) => Math.max(m, l.priceUsd || 0), 0);
  assert.equal(top, 2_500_000);
  assert.ok(rows.find(l => l.priceUsd === 2_500_000)!.title.includes('Femme'), 'top rows come back whole');
  const mr = await call('/api/market/sports?view=summary');
  const mj = JSON.parse(zlib.gunzipSync(Buffer.from(await mr.arrayBuffer())).toString('utf8')) as SummaryJson;
  assert.equal(mj.n, [...main, ...archive].filter(l => l.artist === 'game-used').length);
});

test('settled flags + ref rows', async () => {
  const j = await body(await call('/api/settled-flags'));
  assert.deepEqual(j.rows.map((r: AuctionLot) => r.id), [flagged.id]);
  const ref = await body(await call('/api/ref/rolex/116500'));
  assert.equal(ref.total, 9);
});

test('caching: ETag 304, edge cache hit, headers; method + cross-site refusals', async () => {
  const cache = new FakeCache();
  const a = await call(`/api/lot/${main[0].id}`, {}, cache);
  const etag = a.headers.get('ETag')!;
  assert.match(etag, /^"/);
  assert.equal(a.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(a.headers.get('Cache-Control')!, /max-age=300/);
  assert.equal(a.headers.get('Access-Control-Allow-Origin'), null);
  const b = await call(`/api/lot/${main[0].id}`, {}, cache);
  assert.equal(b.status, 200);
  assert.equal(cache.hits, 1);
  assert.equal((await body(b)).lot.id, main[0].id);
  const c = await call(`/api/lot/${main[0].id}`, { headers: { 'If-None-Match': etag } });
  assert.equal(c.status, 304);
  assert.equal((await call('/api/version', { method: 'POST' })).status, 405);
  assert.equal((await call('/api/version', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call('/api/nope')).status, 404);
});

test('no corpus → 503, never a hang or an empty 200', async () => {
  resetStoreMemo();
  const empty = new DirBucket(fs.mkdtempSync(path.join(os.tmpdir(), 'r2api-empty-')));
  const res = await handleApi(new Request('https://lectr.test/api/version'), { CORPUS: empty }, {}, null);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const none = await handleApi(new Request('https://lectr.test/api/version'), {}, {}, null);
  assert.equal(none.status, 503);
  resetStoreMemo();
});
