/**
 * The columnar corpus (data/corpus/corpus.parquet) is a LOSSLESS twin of the
 * gz NDJSON: written through persistCorpusAndServed's sink, read back with
 * readCorpusParquet, it must return exactly readCorpus() — same rows, same
 * order (main tier, then archive), same key order — and its typed columns
 * must carry the row's values for query engines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-pq-'));
process.chdir(tmp);

const rows = (): Record<string, unknown>[] => [
  { id: 'a1', artist: 'rolex', title: 'Daytona "Paul Newman"', auctionHouse: "Christie's", status: 'sold', priceUsd: 120000.5, estLowUsd: 80000, estHighUsd: 120000, saleDate: '2024-05-12', _vn: 1.5, titleTokens: ['daytona'] },
  { id: 'g1', artist: 'sports-cards', title: 'Mantle', auctionHouse: 'Goldin', status: 'sold', priceUsd: 900000, realizedUsd: 900000, _card: { year: 1952 } },
  { id: 'u1', artist: 'movie-tv', title: 'Sword', auctionHouse: 'Goldin', status: 'upcoming', currentBid: 500, estimateLow: null, value: null },
  { id: 'r1', artist: 'space-exploration', title: 'Flag', auctionHouse: 'RR Auction', status: 'sold', archived: true, priceUsd: 1500 },
];
const isArch = (l: Record<string, unknown>) => (l.auctionHouse === 'Goldin' && l.status === 'sold') || l.archived === true;

test('corpus.parquet roundtrips to exactly readCorpus(); typed columns carry the values', async () => {
  const io = await import('../corpus-io');
  const pq = await import('../lib/corpus-parquet');
  const file = path.join(io.CORPUS_DIR, pq.PARQUET_FILE);
  fs.mkdirSync(io.CORPUS_DIR, { recursive: true });
  const sink = await pq.openParquetSink(file);
  assert.ok(sink, 'duckdb available');
  const r = await io.persistCorpusAndServed(rows(), isArch, () => false, { sink });
  const want = io.readCorpus();
  assert.deepEqual(r.view, want);
  const back: Record<string, unknown>[] = [];
  const n = await pq.readCorpusParquet(file, x => back.push(x));
  assert.equal(n, 4);
  assert.deepEqual(back, want);
  assert.deepEqual(back.map(x => Object.keys(x)), want.map(x => Object.keys(x)), 'key order kept');

  const { DuckDBInstance } = await import('@duckdb/node-api');
  const inst = await DuckDBInstance.create(':memory:');
  const con = await inst.connect();
  const res = await con.runAndReadAll(`SELECT tier, ord, id, auction_house, price_usd, est_high_usd, current_bid, sale_date FROM read_parquet('${file}') ORDER BY tier DESC, ord`);
  assert.deepEqual(res.getRowObjectsJson(), [
    { tier: 'main', ord: 0, id: 'a1', auction_house: "Christie's", price_usd: 120000.5, est_high_usd: 120000, current_bid: null, sale_date: '2024-05-12' },
    { tier: 'main', ord: 1, id: 'u1', auction_house: 'Goldin', price_usd: null, est_high_usd: null, current_bid: 500, sale_date: null },
    { tier: 'archive', ord: 0, id: 'g1', auction_house: 'Goldin', price_usd: 900000, est_high_usd: null, current_bid: null, sale_date: null },
    { tier: 'archive', ord: 1, id: 'r1', auction_house: 'RR Auction', price_usd: 1500, est_high_usd: null, current_bid: null, sale_date: null },
  ]);
  con.closeSync(); inst.closeSync();
});

test('a failing sink never fails the corpus write', async () => {
  const io = await import('../corpus-io');
  let finished = false;
  const r = await io.persistCorpusAndServed(rows(), isArch, () => false, {
    sink: { add() { throw new Error('boom'); }, async finish() { finished = true; } },
  });
  assert.equal(r.view.length, 4);
  assert.equal(finished, false, 'a dropped sink is not finished');
  assert.deepEqual(r.view, io.readCorpus());
});
