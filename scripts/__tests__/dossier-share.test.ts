/**
 * /player?id= and /entity?id= previews (functions/_lib/dossier-share): a bot
 * gets that dossier's own head from the build's /og/q/ shards; people, unknown
 * ids and a missing shard get the static shell untouched. The shard hash is
 * pinned — build-og (Node) and the Functions must agree forever.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SHARE_SHARDS, shareShardOf, shareShardPath, type ShareShard } from '../../app/lib/share-shard';
import { resetDossierMemo } from '../../functions/_lib/dossier-share';
import { onRequestGet as playerGet } from '../../functions/player/index';
import { onRequestGet as entityGet } from '../../functions/entity/index';

const SHELL = `<!DOCTYPE html><html><head><title>Player — lectr</title><meta name="description" content="generic"/>`
  + `<meta property="og:title" content="lectr — auction intelligence"/><meta property="og:image" content="https://lectr.bid/opengraph-image?v=1"/>`
  + `<meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/>`
  + `<meta name="twitter:image" content="https://lectr.bid/opengraph-image?v=1"/></head><body>shell</body></html>`;
const BOT = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)';
const PERSON = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const shards = new Map<number, ShareShard>();
const put = (id: string, row: [string, string, string]) => {
  const n = shareShardOf(id);
  shards.set(n, { ...(shards.get(n) || {}), [id]: row });
};
put('pl:josh-allen', ['Josh Allen — player dossier · lectr', 'Josh Allen at auction — 1,326 sales tracked.', '/og/p/josh-allen.png']);
put('sj:culture|p:dwight-d-eisenhower', ['Dwight D. Eisenhower — dossier · lectr', 'Dwight D. Eisenhower at auction — 42 sales tracked.', '/og/m/culture.png']);

let assetReads: string[] = [];
const ASSETS = {
  fetch: async (req: Request) => {
    const u = new URL(req.url);
    assetReads.push(u.pathname);
    const m = u.pathname.match(/^\/og\/q\/(\d+)\.json$/);
    if (m) return shards.has(Number(m[1])) ? new Response(JSON.stringify(shards.get(Number(m[1])))) : new Response('nope', { status: 404 });
    return new Response(SHELL, { headers: { 'content-type': 'text/html', 'content-length': String(SHELL.length) } });
  },
};
const run = async (get: typeof playerGet, q: string, ua: string, route = '/player') => {
  const res = await get({ request: new Request(`https://lectr.bid${route}${q}`, { headers: { 'user-agent': ua } }), env: { ASSETS } });
  return { res, html: await res.text() };
};

beforeEach(() => { resetDossierMemo(); assetReads = []; });

test('the shard hash is pinned (build and Functions must agree)', () => {
  assert.equal(SHARE_SHARDS, 64);
  assert.equal(shareShardOf('pl:josh-allen'), shareShardOf('pl:josh-allen'));
  assert.deepEqual(['pl:michael-jordan', 'sj:culture|p:dwight-d-eisenhower', ''].map(shareShardOf), [
    shareShardOf('pl:michael-jordan'), shareShardOf('sj:culture|p:dwight-d-eisenhower'), 5]);
  assert.equal(shareShardPath(7), '/og/q/7.json');
  for (const k of ['a', 'pl:x', 'st:tcg|base-set']) { const n = shareShardOf(k); assert.ok(n >= 0 && n < 64 && Number.isInteger(n)); }
});

test('a bot sharing a player link gets the player', async () => {
  const { res, html } = await run(playerGet, '?id=josh-allen', BOT);
  assert.equal(res.status, 200);
  assert.match(html, /<title>Josh Allen — player dossier · lectr<\/title>/);
  assert.match(html, /og:image" content="https:\/\/lectr\.bid\/og\/p\/josh-allen\.png"/);
  assert.match(html, /og:image:width" content="1200"/);                 // our own card keeps its size
  assert.match(html, /og:url" content="https:\/\/lectr\.bid\/player\?id=josh-allen"/);
  assert.ok(html.endsWith('<body>shell</body></html>'));
});

test('a bot sharing an entity link gets the entity (ids with | and : survive the query)', async () => {
  const { html } = await run(entityGet, `?id=${encodeURIComponent('sj:culture|p:dwight-d-eisenhower')}`, BOT, '/entity');
  assert.match(html, /<title>Dwight D\. Eisenhower — dossier · lectr<\/title>/);
  assert.match(html, /og:image" content="https:\/\/lectr\.bid\/og\/m\/culture\.png"/);
});

test('people, missing / unknown ids and a missing shard get the shell, untouched', async () => {
  for (const [q, ua] of [['?id=josh-allen', PERSON], ['', BOT], ['?id=nobody-at-all', BOT], ['?id=no-shard-has-me-xyz', BOT]] as const) {
    const { html } = await run(playerGet, q, ua);
    assert.equal(html, SHELL, `${q} ${ua.slice(0, 12)}`);
  }
});

test('a shard is read once per isolate', async () => {
  await run(playerGet, '?id=josh-allen', BOT);
  await run(playerGet, '?id=josh-allen', BOT);
  assert.equal(assetReads.filter(p => p.startsWith('/og/q/')).length, 1);
});

test('the real build shards resolve real dossiers when present', { skip: !fs.existsSync(path.join(process.cwd(), 'public/og/q/0.json')) }, () => {
  const dir = path.join(process.cwd(), 'public/og/q');
  let rows = 0;
  for (let n = 0; n < SHARE_SHARDS; n++) {
    const sh = JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), 'utf8')) as ShareShard;
    for (const [id, [title, desc, img]] of Object.entries(sh)) {
      rows++;
      assert.equal(shareShardOf(id), n, `${id} filed in shard ${n}`);
      assert.ok(title && desc && /^\/(og\/|opengraph-image)/.test(img), id);
    }
  }
  assert.ok(rows > 100, `rows ${rows}`);
});
