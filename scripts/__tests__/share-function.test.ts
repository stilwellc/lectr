/**
 * functions/lot/index.ts end to end over a FAKE R2 (the api-routes fixture
 * pattern): a link-preview bot asking for /lot?id=<id> gets that lot's head;
 * people, unknown ids and a dead store all get the static shell untouched.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuctionLot } from '../../app/types';
import { emitR2Index } from '../emit-r2-index';
import { onRequestGet } from '../../functions/lot/index';
import { resetStoreMemo, type R2BucketLike } from '../../functions/_lib/store';

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

const SHELL = `<!DOCTYPE html><html><head><title>Lot — lectr</title><meta property="og:title" content="lectr — auction intelligence"/>`
  + `<meta property="og:image" content="https://lectr.bid/opengraph-image?v=1"/><meta property="og:image:width" content="1200"/>`
  + `<meta name="twitter:image" content="https://lectr.bid/opengraph-image?v=1"/></head><body>shell</body></html>`;
const BOT = 'Mozilla/5.0 (Macintosh) AppleWebKit/601.2.4 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0';
const PERSON = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

let n = 0;
const lot = (o: Record<string, unknown>): AuctionLot => ({
  id: `t-${++n}`, artist: 'rolex', title: 'Untitled', category: 'object', auctionHouse: 'Bonhams', saleDate: '2025-01-01',
  currency: 'USD', status: 'sold', url: 'https://example.com/x', priceUsd: 20000, formKey: 'wristwatch', ...o,
} as unknown as AuctionLot);
const main: AuctionLot[] = Array.from({ length: 8 }, (_, i) => lot({ title: `Rolex Daytona ref. 116500 ${i}`, reference: '116500', saleDate: `2024-0${1 + i}-01` }));
const watch = lot({
  id: 'bonhams-31994-572', title: 'Oyster Date Precision, Ref: 6066, Circa 1952', status: 'upcoming', currency: 'GBP',
  estimateLow: 931, estimateHigh: 1197, lotNumber: 572, saleDate: '2026-10-29', reference: '6066',
  imageUrl: 'https://images1.bonhams.com/image?src=Images/live/2026-10/07/60156941-2-1.jpg',
});
main.push(watch);

let dir = '';
let bucket: DirBucket;
const ASSETS = { fetch: async () => new Response(SHELL, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': String(SHELL.length) } }) };
const get = async (q: string, ua: string, env: Record<string, unknown> = { CORPUS: bucket, ASSETS }) => {
  const res = await onRequestGet({ request: new Request(`https://lectr.bid/lot${q}`, { headers: { 'user-agent': ua } }), env: env as never, waitUntil: () => {} });
  return { res, html: await res.text() };
};

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-fn-'));
  emitR2Index({ main, archive: [], eager: [watch], extras: [], lastCrawl: '2026-10-19T09:00:00.000Z', now: new Date('2026-10-19T12:00:00Z'), compsDays: 730 }, dir);
  bucket = new DirBucket(dir);
  resetStoreMemo();
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('a bot gets the lot\'s own preview', async () => {
  const { res, html } = await get('?id=bonhams-31994-572', BOT);
  assert.equal(res.status, 200);
  assert.match(html, /<title>Oyster Date Precision, Ref: 6066, Circa 1952 — Rolex — lectr<\/title>/);
  assert.match(html, /og:description" content="est\. £931–£1,197 · Bonhams · lot 572 · Oct 29, 2026\./);
  assert.match(html, /og:image" content="https:\/\/images1\.bonhams\.com\/image\?src=[^"]+&amp;width=1200"/);
  assert.doesNotMatch(html, /og:image:width/);
  assert.match(html, /<body>shell<\/body>/);
  assert.equal(res.headers.get('content-length'), null);
});

test('people, missing ids, unknown lots and a dead store get the static page', async () => {
  for (const [q, ua, env] of [
    ['?id=bonhams-31994-572', PERSON, undefined], ['', BOT, undefined], ['?id=nope-404', BOT, undefined],
    ['?id=bonhams-31994-572', BOT, { ASSETS }],                                   // no CORPUS binding
  ] as const) {
    const { res, html } = await get(q, ua, env ?? undefined);
    assert.equal(res.status, 200, `${q} ${ua.slice(0, 20)}`);
    assert.equal(html, SHELL, `${q} ${ua.slice(0, 20)}`);
  }
});
