/**
 * `data-store.sh push` (parallel uploads since Oct 11 2026): the version
 * payloads + the dated snapshot upload side by side, but the CONTRACT is the
 * serial one's — every object lands byte-exact, the pointer moves only after
 * BOTH version payloads are verified, and any failed PUT fails the push.
 *
 * The real script runs against a fake R2 (a directory): `curl` is shadowed on
 * PATH by a python fake that serves listing / GET / PUT (etag = md5) and fails
 * the PUT of any key matching $FAKE_FAIL_PUT; `sleep` is a no-op.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..', '..');

const FAKE_CURL = `#!/usr/bin/env python3
import sys, os, re, json, hashlib, urllib.parse
bucket = os.environ['FAKE_R2']
args = sys.argv[1:]
out = None; url = None; method = 'GET'; body = None
i = 0
while i < len(args):
    a = args[i]
    if a == '-H': i += 2; continue
    if a == '--data-binary': body = args[i + 1][1:]; i += 2; continue
    if a == '-X': method = args[i + 1]; i += 2; continue
    if a == '-o': out = args[i + 1]; i += 2; continue
    if a.startswith('-'): i += 1; continue
    url = a; i += 1
base = url.split('/objects', 1)[1]
def md5b(b): return hashlib.md5(b).hexdigest()
if method == 'GET' and base.startswith('?'):
    prefix = urllib.parse.parse_qs(base[1:]).get('prefix', [''])[0]
    res = []
    for dp, _, fs in os.walk(bucket):
        for f in fs:
            full = os.path.join(dp, f); key = os.path.relpath(full, bucket)
            if key.startswith(prefix): res.append({'key': key, 'etag': '"%s"' % md5b(open(full, 'rb').read()), 'size': os.path.getsize(full)})
    print(json.dumps({'success': True, 'result': res, 'result_info': {}})); sys.exit(0)
key = urllib.parse.unquote(base[1:])
p = os.path.join(bucket, key)
if method == 'PUT':
    fail = os.environ.get('FAKE_FAIL_PUT')
    if fail and re.search(fail, key): sys.exit(22)
    data = open(body, 'rb').read()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'wb').write(data)
    print(json.dumps({'success': True, 'result': {'key': key, 'etag': md5b(data)}})); sys.exit(0)
if not os.path.isfile(p): sys.exit(22)
data = open(p, 'rb').read()
if out: open(out, 'wb').write(data)
else: sys.stdout.buffer.write(data)
`;

function harness(failPut?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dspush-'));
  const repo = path.join(dir, 'repo'), bin = path.join(dir, 'bin'), r2 = path.join(dir, 'r2');
  for (const d of [path.join(repo, 'scripts'), path.join(repo, 'data', 'corpus'), path.join(repo, 'public', 'data', 'ray'), bin, r2]) fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'data-store.sh'), path.join(repo, 'scripts', 'data-store.sh'));
  fs.writeFileSync(path.join(bin, 'curl'), FAKE_CURL, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  // a corpus (already-gz members) + a served dir with a nested file
  fs.writeFileSync(path.join(repo, 'data', 'corpus', 'lots.json.gz'), Buffer.from('corpus-main-bytes'));
  fs.writeFileSync(path.join(repo, 'data', 'corpus', 'sold-archive.json.gz'), Buffer.from('corpus-archive-bytes'));
  fs.writeFileSync(path.join(repo, 'public', 'data', 'ray', 'meta.json'), JSON.stringify({ lastCrawl: '2026-10-11T04:40:00.000Z', totalLots: 5 }));
  fs.mkdirSync(path.join(repo, 'public', 'data', 'ray', 'pages'));
  fs.writeFileSync(path.join(repo, 'public', 'data', 'ray', 'pages', 'p.json'), '{"x":1}');
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_R2: r2, CLOUDFLARE_API_TOKEN: 'fake', GITHUB_RUN_ID: '424242', GITHUB_OUTPUT: path.join(dir, 'gh-output') };
  if (failPut) env.FAKE_FAIL_PUT = failPut;
  const r = spawnSync('bash', [path.join(repo, 'scripts', 'data-store.sh'), 'push'], { cwd: repo, env, encoding: 'utf8', timeout: 60_000 });
  const keys: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else keys.push(path.relative(r2, f)); } };
  walk(r2);
  return { r, r2, repo, dir, keys: keys.sort() };
}

test('push: every object lands byte-exact, pointer names the version, snapshot = version corpus', () => {
  const h = harness();
  assert.equal(h.r.status, 0, h.r.stdout + h.r.stderr);
  const ver = fs.readFileSync(path.join(h.r2, 'latest', 'pointer.txt'), 'utf8');
  assert.match(ver, /^versions\/\d{8}T\d{6}Z-/);
  assert.ok(h.keys.includes(`${ver}/corpus.tar`) && h.keys.includes(`${ver}/served.tar.gz`), h.keys.join(','));
  assert.ok(h.keys.includes('snapshots/20261011/corpus.tar'));
  assert.ok(h.keys.includes('latest/meta.json'));
  const corpus = fs.readFileSync(path.join(h.r2, ver, 'corpus.tar'));
  assert.deepEqual(fs.readFileSync(path.join(h.r2, 'snapshots', '20261011', 'corpus.tar')), corpus);
  // the tarballs carry exactly the inputs
  const x = path.join(h.dir, 'x');
  fs.mkdirSync(path.join(x, 'c'), { recursive: true }); fs.mkdirSync(path.join(x, 's'));
  assert.equal(spawnSync('tar', ['-xf', path.join(h.r2, ver, 'corpus.tar'), '-C', path.join(x, 'c')]).status, 0);
  assert.equal(spawnSync('tar', ['-xzf', path.join(h.r2, ver, 'served.tar.gz'), '-C', path.join(x, 's')]).status, 0);
  assert.equal(fs.readFileSync(path.join(x, 'c', 'lots.json.gz'), 'utf8'), 'corpus-main-bytes');
  assert.equal(fs.readFileSync(path.join(x, 'c', 'sold-archive.json.gz'), 'utf8'), 'corpus-archive-bytes');
  assert.equal(fs.readFileSync(path.join(x, 's', 'pages', 'p.json'), 'utf8'), '{"x":1}');
  assert.match(fs.readFileSync(path.join(h.dir, 'gh-output'), 'utf8'), new RegExp(`^version=${ver}$`, 'm'));
});

test('push: a failed version payload PUT fails the push and never moves the pointer', () => {
  for (const fail of ['served\\.tar\\.gz$', '^versions/.*/corpus\\.tar$']) {
    const h = harness(fail);
    assert.notEqual(h.r.status, 0, `${fail}: ${h.r.stdout}`);
    assert.ok(!h.keys.includes('latest/pointer.txt'), `${fail}: pointer moved: ${h.keys.join(',')}`);
    assert.match(h.r.stdout, /pointer NOT moved/);
  }
});

test('push: a failed snapshot PUT still fails the push (after the pointer, as before)', () => {
  const h = harness('^snapshots/');
  assert.notEqual(h.r.status, 0, h.r.stdout);
  assert.ok(h.keys.includes('latest/pointer.txt'));
  assert.match(h.r.stdout, /snapshot snapshots\/20261011\/corpus\.tar PUT failed/);
});
