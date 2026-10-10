import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildEntities, emitEntities, checkEntityFiles, faceValueOf, MIN_SOLD } from '../emit-entities';
import { bucketOf } from '../../app/lib/page-data';
import { normalizeArtCategory } from '../lib/corpus-normalize';
import type { AuctionLot } from '../../app/types';

const TODAY = '2026-10-09';
let n = 0;
const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `t${n++}`, artist, title, status: 'sold', saleDate: '2026-06-01', priceUsd: 1000, auctionHouse: "Christie's", category: 'print', subCat: 'prints', ...extra }) as unknown as AuctionLot;

function book() {
  const sold: AuctionLot[] = [];
  for (let i = 0; i < 12; i++) sold.push(lot('andy-warhol', `Marilyn ${i}`, { priceUsd: 20_000 + i, imageUrl: `https://img/${i}.jpg` }));
  sold.push(lot('andy-warhol', 'Shot Sage Blue Marilyn', { priceUsd: 195_000_000, saleDate: '2022-05-08', category: 'original', subCat: 'originals', medium: 'acrylic and silkscreen ink on linen', imageUrl: 'https://img/ssbm.jpg' }));
  // not by Warhol — never in his entity
  sold.push(lot('andy-warhol', 'Richard Pettibone (B. 1938) Marilyn', { priceUsd: 900_000 }));
  // the same id twice (main + archive tier): counted once
  sold.push({ ...sold[0] });
  // a player with too few sales and no live lot gets no row
  for (let i = 0; i < 3; i++) sold.push(lot('game-used', 'Ty Cobb Game-Used Bat', { category: 'object', subCat: undefined }));
  const live = [
    lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8', { status: 'upcoming', saleDate: '2026-10-20', priceUsd: undefined, category: 'object', subCat: 'cards' }),
    // a stamped ek wins over a recomputation
    lot('pokemon', 'Anything', { status: 'upcoming', saleDate: '2026-10-20', priceUsd: undefined, ek: 'sj:tcg|k:charizard' }),
  ];
  return { sold, live };
}

const run = (b = book()) => buildEntities({ eachSold: v => b.sold.forEach(v), live: b.live, lastCrawl: '2026-10-09T12:00:00.000Z', market: null, today: TODAY });

test('emit-entities: inclusion = ≥1 live OR ≥ MIN_SOLD sold; one id per lot, deduped', () => {
  const { summaries, details, unkeyed } = run();
  const ids = summaries.map(s => s.id).sort();
  assert.deepEqual(ids, ['mk:andy-warhol', 'pl:mickey-mantle', 'sj:tcg|k:charizard']);
  assert.equal(unkeyed, 1, 'the Pettibone row is filed under no entity');
  const w = summaries.find(s => s.id === 'mk:andy-warhol')!;
  assert.equal(w.sold, 13);
  assert.ok(13 >= MIN_SOLD);
  assert.equal(w.record?.p, 195_000_000);
  assert.equal(w.record?.img, 'https://img/ssbm.jpg');
  assert.equal(w.medScope, 'Prints & Multiples');
  assert.equal(w.med12mN, 12);
  assert.equal(w.discipline, 'Pop art');
  assert.equal(w.page, '/makers/andy-warhol');
  assert.deepEqual(w.caps, { compare: false, follow: 'andy-warhol', dossier: true });
  assert.equal(w.thin, false);
  // live-only entities have a summary but no detail
  assert.ok(details.has('mk:andy-warhol'));
  assert.ok(!details.has('pl:mickey-mantle'));
  const m = summaries.find(s => s.id === 'pl:mickey-mantle')!;
  assert.equal(m.label, 'Mickey Mantle');
  assert.equal(m.sold, 0);
  assert.equal(m.med12m, null);
  assert.equal(m.thin, true);
  const det = details.get('mk:andy-warhol')!;
  assert.deepEqual(det.cats.map(c => c.label), ['Prints & Multiples', 'Paintings & Works on Paper']);
  assert.equal(det.lensSplit?.length, 2);
});

test('emit-entities: the face is the highest-value photographed lot the maker\'s market allows', () => {
  const { summaries } = run();
  assert.equal(summaries.find(s => s.id === 'mk:andy-warhol')!.face, 'https://img/ssbm.jpg');
  assert.equal(faceValueOf(lot('andy-warhol', 'x', { imageUrl: null })), null);
});

test('emit-entities: writes 8 market files + 256 stamped buckets, and the nightly check passes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entities-'));
  const crawl = '2026-10-09T12:00:00.000Z';
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ lastCrawl: crawl }));
  const b = book();
  // every maker market has a row on a real night (the check insists)
  b.live.push(lot('rolex', 'Rolex Submariner', { status: 'upcoming', saleDate: '2026-10-20', category: 'object', subCat: undefined }));
  b.live.push(lot('jean-prouve', 'Jean Prouvé Standard Chair', { status: 'upcoming', saleDate: '2026-10-20', category: 'design', subCat: 'seating' }));
  const rep = emitEntities({ eachSold: v => b.sold.forEach(v), live: b.live, lastCrawl: crawl, market: null, today: TODAY, outDir: path.join(dir, 'pages') });
  assert.equal(rep.perMarket.all, 5);
  assert.equal(rep.perMarket.art, 1);
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'pages', 'entities-all.json'), 'utf8'));
  assert.equal(all.lastCrawl, crawl);
  assert.equal(all.sparkQ.length, 12);
  const bucket = JSON.parse(fs.readFileSync(path.join(dir, 'pages', `entity-${bucketOf('mk:andy-warhol')}.json`), 'utf8'));
  assert.equal(bucket._.lastCrawl, crawl);
  assert.equal(bucket['mk:andy-warhol'].top[0].p, 195_000_000);
  assert.deepEqual(checkEntityFiles(dir), []);
  // another night's meta: every file is flagged
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ lastCrawl: '2026-10-10T12:00:00.000Z' }));
  assert.equal(checkEntityFiles(dir).length, 16 + 256);
  fs.rmSync(path.join(dir, 'pages', 'entities-art.json'));
  assert.ok(checkEntityFiles(dir).some(s => s.startsWith('entities-art.json missing')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalize: a painted canvas is unique even when its medium names the screen', () => {
  const rows = [
    { artist: 'andy-warhol', title: 'White Disaster [White Car Crash 19 Times]', medium: 'silkscreen ink and graphite on primed canvas', category: 'print' },
    { artist: 'andy-warhol', title: 'Monkey', medium: 'acrylic screenprint on canvas', category: 'print' },
    { artist: 'andy-warhol', title: 'Marilyn', medium: 'screenprint in colors on paper', category: 'print' },
    { artist: 'andy-warhol', title: 'Flowers', medium: 'screenprint on canvas, edition of 250', category: 'print' },
  ];
  normalizeArtCategory(rows as never);
  assert.deepEqual(rows.map(r => r.category), ['original', 'original', 'print', 'print']);
});
