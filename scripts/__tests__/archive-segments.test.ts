/**
 * ARCHIVE-ONLY SEGMENTS (juliens, propstore): `data-store.sh assemble-segments
 * <crawl…> --archive <archive…>` must assemble an archive segment when it is in
 * R2, skip it (rc 0, logged) when R2 confirms it ABSENT, and still FAIL when it
 * is listed but unreadable — while crawl houses keep their rc semantics.
 *
 * The real script runs against a fake R2: a copy of data-store.sh in a temp
 * repo, with `curl` (the R2 REST API) and `sleep` (retry backoff) shadowed on
 * PATH. The fake curl serves a directory as the bucket: listing = the files
 * under it (etag = md5), GET = the file; a `<key>.broken` marker lists the key
 * but fails every GET (an R2 outage on that object).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { spawnSync } from 'child_process';
import { ARCHIVE_SOURCES, buildStatus, updateLedger, staleHouseKeys, mergeLegRecords, type Ledger } from '../lib/house-status';
import { segmentOf } from '../corpus-io';

const ROOT = path.resolve(__dirname, '..', '..');

const FAKE_CURL = `#!/usr/bin/env python3
import sys, os, json, hashlib, urllib.parse
bucket = os.environ['FAKE_R2']
args = sys.argv[1:]
out = None; url = None; method = 'GET'
i = 0
while i < len(args):
    a = args[i]
    if a in ('-H', '--data-binary'): i += 2; continue
    if a == '-X': method = args[i + 1]; i += 2; continue
    if a == '-o': out = args[i + 1]; i += 2; continue
    if a.startswith('-'): i += 1; continue
    url = a; i += 1
if method != 'GET': sys.exit(22)  # read-only fake: no PUT/DELETE ever
base = url.split('/objects', 1)[1]
def md5(p): return hashlib.md5(open(p, 'rb').read()).hexdigest()
if base.startswith('?'):
    q = urllib.parse.parse_qs(base[1:])
    prefix = q.get('prefix', [''])[0]
    res = []
    for dp, _, fs in os.walk(bucket):
        for f in fs:
            full = os.path.join(dp, f)
            key = os.path.relpath(full, bucket)
            broken = key.endswith('.broken')
            if broken: key = key[:-len('.broken')]
            if key.startswith(prefix):
                res.append({'key': key, 'etag': '"%s"' % ('0' * 32 if broken else md5(full)), 'size': os.path.getsize(full), 'last_modified': '2026-10-05T00:00:00Z'})
    print(json.dumps({'success': True, 'result': res, 'result_info': {}}))
    sys.exit(0)
key = urllib.parse.unquote(base[1:])
p = os.path.join(bucket, key)
if not os.path.isfile(p): sys.exit(22)
data = open(p, 'rb').read()
if out: open(out, 'wb').write(data)
else: sys.stdout.buffer.write(data)
`;

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archseg-'));
  const repo = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  const r2 = path.join(dir, 'r2');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(r2, 'latest', 'segments'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'data-store.sh'), path.join(repo, 'scripts', 'data-store.sh'));
  fs.writeFileSync(path.join(bin, 'curl'), FAKE_CURL, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const seg = (name: string, rows: object[]) =>
    fs.writeFileSync(path.join(r2, 'latest', 'segments', `${name}.ndjson.gz`), zlib.gzipSync(rows.map(r => JSON.stringify(r)).join('\n') + '\n'));
  const broken = (name: string) => fs.writeFileSync(path.join(r2, 'latest', 'segments', `${name}.ndjson.gz.broken`), '');
  const run = (...args: string[]) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_R2: r2, CLOUDFLARE_API_TOKEN: 'fake', DATA_FRESH_TRIES: '1' };
    delete env.GITHUB_RUN_ID; // local mode: no handoff lookups
    const r = spawnSync('bash', [path.join(repo, 'scripts', 'data-store.sh'), 'assemble-segments', ...args], { env, encoding: 'utf8', timeout: 60_000 });
    const segDir = path.join(repo, 'data', 'corpus', 'segments');
    const source = (h: string) => { try { return fs.readFileSync(path.join(segDir, `.${h}.source`), 'utf8').trim(); } catch { return null; } };
    const has = (h: string) => fs.existsSync(path.join(segDir, `${h}.ndjson.gz`));
    return { rc: r.status, out: (r.stdout || '') + (r.stderr || ''), source, has };
  };
  return { seg, broken, run, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const sold = (house: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${house}-${i}`, auctionHouse: house, status: 'sold', priceUsd: 1000 + i, saleDate: '2019-05-01' }));

test('archive segments PRESENT are assembled as last-good alongside crawl houses', () => {
  const h = harness();
  try {
    h.seg('goldin', sold('Goldin', 3));
    h.seg('juliens', sold("Julien's", 5));
    h.seg('propstore', sold('Propstore', 2));
    const r = h.run('goldin', '--archive', 'juliens', 'propstore');
    assert.equal(r.rc, 0, r.out);
    for (const s of ['goldin', 'juliens', 'propstore']) { assert.ok(r.has(s), s); assert.equal(r.source(s), 'last-good'); }
  } finally { h.cleanup(); }
});

test('archive segments ABSENT in R2 are skipped (logged, rc 0) — the publish is not failed', () => {
  const h = harness();
  try {
    h.seg('goldin', sold('Goldin', 3));
    const r = h.run('goldin', '--archive', 'juliens', 'propstore');
    assert.equal(r.rc, 0, r.out);
    assert.ok(r.has('goldin'));
    assert.equal(r.has('juliens'), false);
    assert.equal(r.source('juliens'), 'absent');
    assert.equal(r.source('propstore'), 'absent');
    assert.match(r.out, /archive segment juliens absent in R2 — skipped/);
    assert.doesNotMatch(r.out, /::warning title=segment juliens/);
  } finally { h.cleanup(); }
});

test('an archive segment LISTED but unreadable still fails assemble (never a silent drop)', () => {
  const h = harness();
  try {
    h.seg('goldin', sold('Goldin', 3));
    h.broken('juliens');
    const r = h.run('goldin', '--archive', 'juliens');
    assert.notEqual(r.rc, 0, r.out);
    assert.equal(r.source('juliens'), 'unavailable');
    assert.equal(r.has('juliens'), false);
  } finally { h.cleanup(); }
});

test('crawl houses keep their absence handling: unreadable fails, confirmed-absent passes with a ::warning', () => {
  const h = harness();
  try {
    h.broken('goldin');
    const bad = h.run('goldin');
    assert.notEqual(bad.rc, 0, bad.out);
    assert.equal(bad.source('goldin'), 'unavailable');
  } finally { h.cleanup(); }
  const h2 = harness();
  try {
    const r = h2.run('hakes');
    assert.equal(r.rc, 0, r.out);
    assert.equal(r.source('hakes'), 'absent');
    assert.match(r.out, /::warning title=segment hakes absent::/);
  } finally { h2.cleanup(); }
});

test('nightly.yml --archive list ⊇ ARCHIVE_SOURCES, and each maps to its own segment', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'nightly.yml'), 'utf8');
  const m = yml.match(/assemble-segments "\$\{houses\[@\]\}" --archive ([a-z\- ]+)/);
  assert.ok(m, 'assemble step passes an --archive list');
  const listed = m![1].trim().split(/\s+/);
  for (const a of Object.keys(ARCHIVE_SOURCES)) assert.ok(listed.includes(a), `${a} in nightly --archive list`);
  for (const [k, label] of Object.entries(ARCHIVE_SOURCES)) assert.equal(segmentOf(label), k);
  // never a crawl-matrix house
  const plan = yml.match(/houses=(\[[^\]]+\])/);
  assert.ok(plan);
  const crawl = JSON.parse(plan![1]) as string[];
  for (const a of Object.keys(ARCHIVE_SOURCES)) assert.equal(crawl.includes(a), false, `${a} must not be in the crawl matrix`);
});

test('status.json: archives listed with rows + newest saleDate, never in houses/housesDown; ledger + stale rule ignore them', () => {
  const now = new Date('2026-10-05T06:00:00Z');
  // a ledger that (wrongly) carried juliens — the stale rule must still skip it
  const prev: Ledger = { version: 1, updatedAt: '2026-09-01T00:00:00Z', houses: {
    juliens: { lastOkAt: null, lastAttemptAt: null, trackedSince: '2026-01-01T00:00:00Z', ok: false, reason: 'x', source: 'unknown', failStreak: 9, lastRunId: null },
  } };
  assert.equal(staleHouseKeys(prev, now).has('juliens'), false);
  const ledger = updateLedger(prev, { houses: ['goldin', 'juliens'], legs: mergeLegRecords([{ house: 'goldin', ok: true }]), sources: { goldin: 'fresh' }, crawled: true, now });
  assert.deepEqual(Object.keys(ledger.houses), ['goldin']);
  const st = buildStatus({
    now, houses: ['goldin', 'propstore'], ledger,
    stats: {
      goldin: { rows: 10, sold: 8, live: 2, hiddenLive: 0, lastSaleDate: '2026-10-04' },
      juliens: { rows: 10_412, sold: 10_412, live: 0, hiddenLive: 0, lastSaleDate: '2024-06-30' },
    },
    engineVersion: null, engineSignal: null, runId: null,
  });
  assert.deepEqual(st.houses.map(h => h.house), ['goldin']);
  assert.deepEqual(st.publish.housesDown, []);
  assert.equal(st.publish.signal, 'ok');
  const j = st.archives.find(a => a.house === 'juliens')!;
  assert.deepEqual(j, { house: 'juliens', label: "Julien's", kind: 'archive', present: true, rows: 10_412, sold: 10_412, lastSaleDate: '2024-06-30' });
  const p = st.archives.find(a => a.house === 'propstore')!;
  assert.equal(p.present, false);
  assert.equal(p.rows, 0);
  assert.equal(JSON.stringify(st).includes('unhealthy'), false);
});
