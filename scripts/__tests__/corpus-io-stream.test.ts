/**
 * The single-load corpus codecs (Oct 2026 scale pass) must be INVISIBLE:
 *  - streamGzRows / readAllSegmentsLean read the same rows as the sync readers
 *    (legacy array lines, U+2028 inside strings, multi-member gzip, no final
 *    newline) — minus only the dead engine scratch fields;
 *  - persistCorpusAndServed writes the same corpus NDJSON and the same served
 *    shards as writeCorpusAndServed, and its returned view IS readCorpus();
 *  - roundtripCorpusView is the readCorpus() of what assemble used to write.
 * Runs in a temp cwd (CORPUS_DIR / SERVED_DIR resolve against process.cwd()).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-io-'));
process.chdir(tmp);
type CIO = typeof import('../corpus-io');
const load = async (): Promise<CIO> => import('../corpus-io');

const lots = (): Record<string, unknown>[] => [
  { id: 'a1', artist: 'rolex', title: 'Daytona ref 6263', auctionHouse: "Christie's", status: 'sold', priceUsd: 120000, hammerUsd: 100000, hammerPrice: 80000, _vn: 1.5, description: 'x'.repeat(40) },
  { id: 'g1', artist: 'sports-cards', title: '1952 Topps Mantle PSA 8', auctionHouse: 'Goldin', status: 'sold', priceUsd: 900000, realizedUsd: 900000, titleTokens: ['topps', 'mantle'] },
  { id: 'g2', artist: 'movie-tv', title: 'Prop sword', auctionHouse: 'Goldin', status: 'upcoming', estimateLow: null, bidHistory: [{ d: '2026-10-01', b: 5, n: 1 }], resultsPending: false },
  { id: 'r1', artist: 'space-exploration', title: 'Flown flag', auctionHouse: 'RR Auction', status: 'sold', archived: true, priceUsd: 1500, value: { n: 3 } },
  { id: 'p1', artist: 'pokemon', title: 'Charizard 1st Ed', auctionHouse: 'Goldin', status: 'sold', priceUsd: 50000, nan: NaN, und: undefined },
];
const isArch = (l: Record<string, unknown>) => (l.auctionHouse === 'Goldin' && l.status === 'sold' && l.artist !== 'movie-tv') || l.archived === true;
const corpusOnly = (l: Record<string, unknown>) => l.artist === 'pokemon';
const gunzipText = (f: string) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
const snapshotDir = (dir: string) => Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

test('streamGzRows === readGzRows (array line, U+2028, multi-member gzip, no trailing newline)', async () => {
  const io = await load();
  const f = path.join(tmp, 'mixed.ndjson.gz');
  const rows = lots().slice(0, 3);
  const part1 = zlib.gzipSync(Buffer.from(JSON.stringify(rows[0]) + '\n' + JSON.stringify([rows[1], rows[2]]) + '\n'));
  const part2 = zlib.gzipSync(Buffer.from(JSON.stringify({ id: 'z', title: 'tail ' })));
  fs.writeFileSync(f, Buffer.concat([part1, part2]));
  const got: Record<string, unknown>[] = [];
  await io.streamGzRows(f, r => got.push(r));
  assert.deepEqual(got, io.readGzRows(f));
  assert.equal(got.length, 4);
});

test('readAllSegmentsLean: same rows/order as readAllSegments minus _v/_saleMs; a corrupt segment drops whole', async () => {
  const io = await load();
  const rows = lots().map((l, i) => (i % 2 ? { ...l, _v: { tok: 0.5 }, _saleMs: 123 } : l));
  io.writeSegment('alpha', rows.slice(0, 3));
  io.writeSegment('beta', rows.slice(3));
  fs.writeFileSync(path.join(io.SEGMENTS_DIR, 'corrupt.ndjson.gz'), Buffer.concat([zlib.gzipSync('{"id":"ok"}\n'), Buffer.from('not gzip')]));
  const lean = await io.readAllSegmentsLean();
  const want = io.readAllSegments().map(r => { const o = { ...r }; delete o._v; delete o._saleMs; return o; });
  assert.deepEqual(lean, want);
  assert.deepEqual(lean.map(r => Object.keys(r)), want.map(r => Object.keys(r)), 'key order kept');
  assert.ok(!lean.some(r => r.id === 'ok'), 'no partial rows from a corrupt segment');
  fs.rmSync(io.SEGMENTS_DIR, { recursive: true });
});

test('persistCorpusAndServed: same corpus + served bytes as writeCorpusAndServed; view === readCorpus()', async () => {
  const io = await load();
  io.writeCorpusAndServed(lots(), isArch, corpusOnly);
  const wantServed = snapshotDir(io.SERVED_DIR);
  const wantMain = gunzipText(path.join(io.CORPUS_DIR, 'lots.json.gz'));
  const wantArch = gunzipText(path.join(io.CORPUS_DIR, 'sold-archive.json.gz'));
  const wantMainGz = fs.readFileSync(path.join(io.CORPUS_DIR, 'lots.json.gz'));
  fs.rmSync(io.SERVED_DIR, { recursive: true }); fs.rmSync(io.CORPUS_DIR, { recursive: true });

  const all = lots();
  const lines: string[] = [];
  const r = await io.persistCorpusAndServed(all, isArch, corpusOnly, { sink: { add: (_t, _o, line) => { lines.push(line); }, finish: async () => {} } });
  assert.equal(all.length, 0, 'input consumed');
  assert.deepEqual(snapshotDir(io.SERVED_DIR), wantServed);
  assert.equal(gunzipText(path.join(io.CORPUS_DIR, 'lots.json.gz')), wantMain);
  assert.equal(gunzipText(path.join(io.CORPUS_DIR, 'sold-archive.json.gz')), wantArch);
  assert.ok(fs.readFileSync(path.join(io.CORPUS_DIR, 'lots.json.gz')).equals(wantMainGz), 'gz bytes identical too');
  assert.deepEqual(r.view, io.readCorpus());
  assert.deepEqual(r.view.map(x => Object.keys(x)), io.readCorpus().map(x => Object.keys(x)));
  assert.equal(lines.join(''), wantMain + wantArch, 'sink sees every written line in order');
});

test('served shards split at the 18MiB boundary exactly like the array writer', async () => {
  const io = await load();
  const big = Array.from({ length: 45 }, (_, i) => ({ id: `b${i}`, artist: 'rolex', status: 'sold', title: 't', blob: 'y'.repeat(1 << 20) }));
  io.writeCorpusAndServed(big.map(x => ({ ...x })), () => false);
  const want = snapshotDir(io.SERVED_DIR);
  fs.rmSync(io.SERVED_DIR, { recursive: true });
  await io.persistCorpusAndServed(big.map(x => ({ ...x })), () => false);
  assert.deepEqual(snapshotDir(io.SERVED_DIR), want);
  assert.ok(Object.keys(want).filter(f => /^lots-\d+\.json$/.test(f)).length >= 3);
});

test('roundtripCorpusView === readCorpus() of what writeCorpusAndServed would write', async () => {
  const io = await load();
  io.writeCorpusAndServed(lots(), isArch);
  const want = io.readCorpus();
  const all = lots();
  const view = io.roundtripCorpusView(all, isArch);
  assert.equal(all.length, 0);
  assert.deepEqual(view, want);
  assert.deepEqual(view.map(x => Object.keys(x)), want.map(x => Object.keys(x)));
});

test('stripTopLevelKeysText === parse-then-delete, on every position and nesting', async () => {
  const io = await load();
  const cases: Record<string, unknown>[] = [
    { _v: { a: 1, 'b}"': 2 }, id: 'x', t: 'q' },
    { id: 'x', _v: { a: 1 } },
    { _v: {} },
    { id: 'x', nest: { _v: 5, _saleMs: 1 }, _saleMs: 1712000000000, t: 'has "_v": inside, and \\ "_saleMs":{', _v: { 'x,y': 0.25 }, z: [{ _v: 1 }] },
    { id: 'x', arr: ['"_v":1', { k: '}' }], _vn: 2.5, _v: { n: -1.5e-7 } },
    { id: 'plain' },
  ];
  for (const c of cases) {
    const line = JSON.stringify(c);
    const want = JSON.parse(line); delete want._v; delete want._saleMs;
    const got = io.stripTopLevelKeysText(line, io.DEAD_SEGMENT_FIELDS);
    assert.equal(got, JSON.stringify(want), line);
  }
});

test('stripKeys rebuilds without the keys, order kept; untouched rows are returned as-is', async () => {
  const io = await load();
  const r = { a: 1, _v: { x: 1 }, b: 2, _saleMs: 3, c: 3 };
  const o = io.stripKeys(r, ['_v', '_saleMs']);
  assert.deepEqual(Object.keys(o), ['a', 'b', 'c']);
  const same = { a: 1 };
  assert.equal(io.stripKeys(same, ['_v']), same);
});
