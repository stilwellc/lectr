/**
 * The lot API resolves collapsed lot ids (W16 id aliases) the same way the
 * /lot route does: through the ONE served map, /data/ray/id-aliases.json,
 * which the build writes from normalize's `idAliases` (aliasMapOf). Here the
 * map is built exactly as build-market builds it, served through a fake Pages
 * ASSETS binding, and the three lot routes are asked for the alias id.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuctionLot } from '../../app/types';
import { emitR2Index } from '../emit-r2-index';
import { handleApi } from '../../functions/_lib/api';
import { resetStoreMemo, type R2BucketLike } from '../../functions/_lib/store';
import { resetAliasMemo, ID_ALIASES_PATH } from '../../functions/_lib/aliases';
import { aliasMapOf, dedupeChristiesIdSchemes } from '../lib/id-aliases';

class DirBucket implements R2BucketLike {
  constructor(private root: string) {}
  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    const f = path.join(this.root, key);
    if (!fs.existsSync(f)) return null;
    let buf = fs.readFileSync(f);
    if (options?.range) buf = buf.subarray(options.range.offset, options.range.offset + options.range.length);
    const u8 = new Uint8Array(buf);
    return { arrayBuffer: async () => u8.slice().buffer as ArrayBuffer, text: async () => Buffer.from(u8).toString('utf8') };
  }
}
/** a fake Pages ASSETS binding serving one file (and an HTML fallback, as the
 *  real asset server does for a path it lacks) */
class Assets {
  reads: string[] = [];
  constructor(public file: string | null) {}
  async fetch(req: Request) {
    this.reads.push(new URL(req.url).pathname);
    if (new URL(req.url).pathname === ID_ALIASES_PATH && this.file != null) return new Response(this.file, { headers: { 'Content-Type': 'application/json' } });
    return new Response('<!DOCTYPE html><html></html>', { headers: { 'Content-Type': 'text/html' } });
  }
}

const row = (o: Record<string, unknown>) => ({
  artist: 'pablo-picasso', category: 'print', auctionHouse: "Christie's", currency: 'USD', url: 'https://www.christies.com/en/lot/lot-1',
  ...o,
});
// one Christie's object under both crawlers' ids → one row, canonical christies-<n>
const lots: Record<string, unknown>[] = [
  row({ id: 'christies-6400001', title: 'Grand Vase aux danseurs (A.R. 114)', status: 'upcoming', saleDate: '2026-11-01', estimateLow: 8000, estimateHigh: 12000, lotNumber: '12' }),
  row({ id: 'christies-auc-6400001', title: 'Pablo Picasso (1881-1973) Grand Vase aux danseurs (A.R. 114)', status: 'upcoming', saleDate: '2026-11-01', estimateLow: 8000, estimateHigh: 12000 }),
  // a sale-crawler id with no twin keeps its own id (never rewritten)
  row({ id: 'christies-auc-6400002', title: 'Tête de faune', status: 'upcoming', saleDate: '2026-11-01', estimateLow: 3000, estimateHigh: 5000 }),
  row({ id: 'christies-6400003', title: 'Le Repas frugal', status: 'sold', priceUsd: 90000, saleDate: '2025-05-01' }),
];

let dir = '';
let bucket: DirBucket;
let aliases: Record<string, string> = {};
const call = (p: string, assets: Assets | undefined) =>
  handleApi(new Request(`https://lectr.test${p}`), { CORPUS: bucket, ASSETS: assets }, {}, null);

before(() => {
  const { pairs } = dedupeChristiesIdSchemes(lots as never);
  assert.equal(pairs, 1, 'fixture: one twin pair');
  aliases = aliasMapOf(lots as never); // build-market's map
  assert.deepEqual(aliases, { 'christies-auc-6400001': 'christies-6400001' });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2alias-'));
  const all = lots as unknown as AuctionLot[];
  emitR2Index({ main: all, archive: [], eager: all.filter(l => l.status === 'upcoming'), extras: [], lastCrawl: '2026-10-02T16:02:52.000Z', now: new Date('2026-10-03T00:00:00Z'), compsDays: 730 }, dir);
  bucket = new DirBucket(dir);
  resetStoreMemo();
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const served = () => new Assets(JSON.stringify({ generatedAt: '2026-10-11', aliases }));

test('an alias id answers with its canonical lot on /api/lot, /api/lots and /api/comps', async () => {
  resetAliasMemo();
  const assets = served();
  const r = await call('/api/lot/christies-auc-6400001', assets);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.lot.id, 'christies-6400001');
  assert.equal(j.canonicalId, 'christies-6400001');
  assert.deepEqual(j.lot.idAliases, ['christies-auc-6400001']);
  // the canonical id itself answers plainly, without a map read
  assets.reads = [];
  const c = await (await call('/api/lot/christies-6400001', assets)).json();
  assert.equal(c.lot.id, 'christies-6400001');
  assert.equal(c.canonicalId, undefined);
  assert.deepEqual(assets.reads, []);
  // many lots: the alias is keyed by the id asked (callers look rows up by it)
  const many = await (await call('/api/lots?ids=christies-auc-6400001,christies-6400003,missing-1', assets)).json();
  assert.deepEqual(Object.keys(many.lots).sort(), ['christies-6400003', 'christies-auc-6400001']);
  assert.equal(many.lots['christies-auc-6400001'].id, 'christies-6400001');
  // comps under the alias = comps under the canonical id
  const ca = await (await call('/api/comps?lot=christies-auc-6400001', assets)).json();
  const cc = await (await call('/api/comps?lot=christies-6400001', assets)).json();
  assert.deepEqual(ca, cc);
});

test('an un-twinned sale-crawler id keeps its own row; a non-alias miss never reads the map', async () => {
  resetAliasMemo();
  const assets = served();
  assert.equal((await (await call('/api/lot/christies-auc-6400002', assets)).json()).lot.id, 'christies-auc-6400002');
  assert.equal((await call('/api/lot/christies-auc-6400009', assets)).status, 404, 'an alias-shaped id not in the map is a 404');
  assets.reads = [];
  assert.equal((await call('/api/lot/christies-6499999', assets)).status, 404);
  assert.equal((await call('/api/lot/nope-1', assets)).status, 404);
  assert.deepEqual(assets.reads, [], 'only alias-shaped misses read the map');
});

test('the map is read once per isolate; a missing map (HTML fallback) or no binding is an honest 404', async () => {
  resetAliasMemo();
  const assets = served();
  await call('/api/lot/christies-auc-6400001', assets);
  await call('/api/lot/christies-auc-6400001', assets);
  await call('/api/comps?lot=christies-auc-6400001', assets);
  assert.equal(assets.reads.length, 1);
  resetAliasMemo();
  assert.equal((await call('/api/lot/christies-auc-6400001', new Assets(null))).status, 404);
  resetAliasMemo();
  assert.equal((await call('/api/lot/christies-auc-6400001', undefined)).status, 404);
  resetAliasMemo();
});
