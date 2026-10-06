/**
 * Oct 5 2026 scale pass — the headroom changes must not move a single output.
 *
 *  · value.compCandidates (the comp candidate index build-market now hands
 *    resolveComps): on a synthetic roster with a Zipf vocabulary, shared
 *    maker words, watch references and print editions, resolveComps over the
 *    index's candidates returns EXACTLY the comps of the full-roster scan, in
 *    the same order, for every lot — including at a lowered cosine floor.
 *  · stats.maxOf / minOf: Math.max/min semantics without the argument spread
 *    that overflowed the call stack past ~120k values.
 *  · emit-value-book: the prebuilt-book marker is honoured only for the corpus
 *    files it was built from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AuctionLot } from '../../app/types';
import { resolveComps, buildCompCandidateIndex, compCandidates, FALLBACK_GATE } from '../../app/lib/value';
import { buildIdf, buildVectors } from '../../app/lib/similarity';
import { titleTokens } from '../../app/lib/normalize';
import { maxOf, minOf } from '../../app/lib/stats';

// deterministic PRNG (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

type V = AuctionLot & { _v?: Record<string, number>; _vn?: number };
function syntheticRoster(seed: number, n: number): { lots: V[]; roster: V[]; tbl: ReturnType<typeof buildIdf> } {
  const r = rng(seed);
  const vocab = Array.from({ length: 400 }, (_, i) => `w${i}x`);
  // Zipf-ish draw: low indices are common words, high ones rare identity words
  const word = () => vocab[Math.min(vocab.length - 1, Math.floor(Math.pow(r(), 2.2) * vocab.length))];
  const lots: V[] = [];
  for (let i = 0; i < n; i++) {
    const watch = r() < 0.4;
    const k = 2 + Math.floor(r() * 7);
    const words = Array.from({ length: k }, word);
    const ref = watch && r() < 0.6 ? `${16600 + Math.floor(r() * 12)}` : null;
    const edition = !watch && r() < 0.3;
    const title = watch
      ? `Rolex ${words.join(' ')}${ref ? ` ref ${ref}` : ''} ${r() < 0.5 ? 'stainless steel' : 'yellow gold'}`
      : `${words.join(' ')} screenprint in colors${edition ? ' edition 12/50' : ''}`;
    const sold = r() < 0.8;
    lots.push({
      id: `L${i}`, title, artist: watch ? 'rolex' : 'andy-warhol', category: watch ? 'object' : 'print',
      formKey: watch ? null : 'print', medium: edition ? 'screenprint' : null, reference: ref,
      auctionHouse: "Christie's", status: sold ? 'sold' : 'upcoming',
      saleDate: `20${String(15 + Math.floor(r() * 11)).padStart(2, '0')}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`,
      realizedUsd: sold ? Math.round(1000 + r() * 90000) : null, titleTokens: titleTokens(title),
    } as unknown as V);
  }
  const sold = lots.filter(l => l.status === 'sold');
  const tbl = buildIdf(sold);
  buildVectors(lots, tbl);
  const roster = sold.slice().sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1));
  return { lots, roster, tbl };
}

test('compCandidates: resolveComps over the index candidates === the full roster scan (same comps, same order)', () => {
  const { lots, roster, tbl } = syntheticRoster(7, 1200);
  const byArtist = new Map<string, V[]>();
  for (const s of roster) (byArtist.get(s.artist) || byArtist.set(s.artist, []).get(s.artist)!).push(s);
  const ix = new Map(Array.from(byArtist.entries()).map(([a, p]) => [a, buildCompCandidateIndex(p)]));
  let checked = 0, admitted = 0, pruned = 0;
  for (const lot of lots) {
    const pool = byArtist.get(lot.artist)!;
    const pos = compCandidates(ix.get(lot.artist)!, lot);
    assert.ok(pos, 'a vectorized lot always gets a candidate list');
    for (let i = 1; i < pos.length; i++) assert.ok(pos[i] > pos[i - 1], 'positions ascending, unique');
    const full = resolveComps(lot, pool, tbl, '2026-10-01');
    const fast = resolveComps(lot, pos.map(i => pool[i]), tbl, '2026-10-01');
    assert.deepEqual(fast, full, `lot ${lot.id}`);
    checked++; admitted += full.length; pruned += pool.length - pos.length;
  }
  assert.equal(checked, lots.length);
  assert.ok(admitted > 500, `the fixture admits real comps (${admitted})`);
  assert.ok(pruned > 0, 'the index prunes inadmissible candidates');
});

test('compCandidates: stays exact when the cosine floor is lowered (harness sweeps mutate FALLBACK_GATE)', () => {
  const { lots, roster, tbl } = syntheticRoster(11, 500);
  const saved = FALLBACK_GATE.cosFloor;
  try {
    FALLBACK_GATE.cosFloor = 0.41;
    const pools = new Map<string, V[]>();
    for (const s of roster) (pools.get(s.artist) || pools.set(s.artist, []).get(s.artist)!).push(s);
    const ix = new Map(Array.from(pools.entries()).map(([a, p]) => [a, buildCompCandidateIndex(p)]));
    for (const lot of lots) {
      const pool = pools.get(lot.artist)!;
      const pos = compCandidates(ix.get(lot.artist)!, lot)!;
      assert.deepEqual(resolveComps(lot, pos.map(i => pool[i]), tbl), resolveComps(lot, pool, tbl), `lot ${lot.id}`);
    }
  } finally { FALLBACK_GATE.cosFloor = saved; }
});

test('compCandidates: a lot without a precomputed vector is not pruned (null → caller scans)', () => {
  const { roster } = syntheticRoster(3, 50);
  const ix = buildCompCandidateIndex(roster);
  assert.equal(compCandidates(ix, { id: 'x', title: 'a', artist: 'rolex' } as unknown as V), null);
});

test('maxOf/minOf: Math.max/min semantics, no call-stack overflow on large arrays', () => {
  assert.equal(maxOf([]), -Infinity);
  assert.equal(minOf([]), Infinity);
  assert.ok(Number.isNaN(maxOf([1, NaN, 3])));
  assert.ok(Number.isNaN(minOf([1, NaN, 3])));
  assert.ok(Object.is(maxOf([-0, 0]), Math.max(-0, 0)));
  assert.ok(Object.is(maxOf([0, -0]), Math.max(0, -0)));
  assert.ok(Object.is(minOf([0, -0]), Math.min(0, -0)));
  assert.ok(Object.is(minOf([-0, 0]), Math.min(-0, 0)));
  const big = Array.from({ length: 600_000 }, (_, i) => (i * 7919) % 600_001);
  assert.throws(() => Math.max(...big), RangeError, 'the spread this replaces does overflow');
  assert.equal(maxOf(big), big.reduce((m, x) => (x > m ? x : m), -Infinity));
  assert.equal(minOf(big), big.reduce((m, x) => (x < m ? x : m), Infinity));
});

test('emit-value-book: a prebuilt book is pushed only for the corpus files it was built from', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-'));
  const prev = process.env.RAY_VALUE_BOOK_FILE;
  process.env.RAY_VALUE_BOOK_FILE = path.join(dir, 'value-book.json.gz');
  try {
    const corpus = path.join(dir, 'corpus');
    fs.mkdirSync(corpus);
    fs.writeFileSync(path.join(corpus, 'lots.json.gz'), 'a');
    fs.writeFileSync(path.join(corpus, 'sold-archive.json.gz'), 'bb');
    const vb = await import('../emit-value-book');
    const sig = vb.corpusSignature(corpus);
    assert.match(sig, /^lots\.json\.gz:1:\d+\|sold-archive\.json\.gz:2:\d+$/);
    const book = { schema: 1 as const, builtAt: '2026-10-05T00:00:00.000Z', engineVersion: 'test', bookVersion: 'test', rows: [], context: [], gradeLadder: null, indexes: {}, audit: { skipped: {}, abstained: {}, watchSplit: 0 } };
    vb.writeValueBook(book, sig);
    assert.ok(fs.existsSync(process.env.RAY_VALUE_BOOK_FILE));
    assert.deepEqual(JSON.parse(fs.readFileSync(process.env.RAY_VALUE_BOOK_FILE + '.built.json', 'utf8')), { builtAt: book.builtAt, corpus: sig });
    // a changed corpus file changes the signature (the marker no longer applies)
    fs.writeFileSync(path.join(corpus, 'lots.json.gz'), 'aaa');
    assert.notEqual(vb.corpusSignature(corpus), sig);
    // a write without a signature clears a stale marker
    vb.writeValueBook(book);
    assert.ok(!fs.existsSync(process.env.RAY_VALUE_BOOK_FILE + '.built.json'));
  } finally {
    if (prev === undefined) delete process.env.RAY_VALUE_BOOK_FILE; else process.env.RAY_VALUE_BOOK_FILE = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
