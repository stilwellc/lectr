import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  aliasOf, decodeAliases, encodeAliases, entityHrefOf, entityQueryOf, playerHrefOf,
  playerSlugOfHref, setEntityAliasesForTest,
} from '../entity/aliases';
import { entityPageOf } from '../entity/key';
import { pageHrefOf } from '../entity/kinds';
import { makerLineOf } from '../lot-labels';
import { lotSubjectOf } from '../maker-subjects';
import { liveBookHref } from '../lot-browser';

const SET = [
  { id: 'pl:michael-jordan', slug: 'michael-jordan' },
  { id: 'pl:ted-williams', slug: 'ted-williams' },
  { id: 'sj:tcg|k:charizard', slug: 'charizard' },
  { id: 'cs:sports-cards:singles', slug: 'sports-cards-singles' },
];
after(() => setEntityAliasesForTest(null));

test('aliases: compact wire round-trips; a slug rides only where it differs from the id tail', () => {
  const s = encodeAliases(SET);
  assert.equal(s, '["pl:michael-jordan","pl:ted-williams","sj:tcg|k:charizard","cs:sports-cards:singles>sports-cards-singles"]');
  const m = decodeAliases(s);
  assert.equal(m.get('pl:michael-jordan'), '/p/michael-jordan');
  assert.equal(m.get('sj:tcg|k:charizard'), '/e/charizard');
  assert.equal(m.get('cs:sports-cards:singles'), '/e/sports-cards-singles');
  // torn / absent input: no aliases, never a throw
  assert.equal(decodeAliases(undefined).size, 0);
  assert.equal(decodeAliases('{nope').size, 0);
  assert.equal(decodeAliases('["pl:x>Bad Slug"]').size, 0);
});

test('aliases: one helper — the static page when the deploy ships one, else the query route', () => {
  setEntityAliasesForTest(SET);
  assert.equal(entityPageOf('pl:michael-jordan'), '/p/michael-jordan');
  assert.equal(entityPageOf('pl:nobody-famous'), '/player?id=nobody-famous');
  assert.equal(entityPageOf('sj:tcg|k:charizard'), '/e/charizard');
  assert.equal(entityPageOf('sj:tcg|k:pikachu'), `/entity?id=${encodeURIComponent('sj:tcg|k:pikachu')}`);
  assert.equal(entityPageOf('mk:rolex'), '/makers/rolex');
  assert.equal(playerHrefOf('ted-williams'), '/p/ted-williams');
  assert.equal(pageHrefOf('pl:michael-jordan', { playerDossier: true }), '/p/michael-jordan');
  assert.equal(aliasOf('pl:nobody-famous'), null);
  // the query route is still every id's page
  assert.equal(entityQueryOf('pl:michael-jordan'), '/player?id=michael-jordan');
  setEntityAliasesForTest([]);
  assert.equal(entityHrefOf('pl:michael-jordan'), '/player?id=michael-jordan');
  assert.equal(entityPageOf('sj:tcg|k:charizard'), `/entity?id=${encodeURIComponent('sj:tcg|k:charizard')}`);
});

test('aliases: a card\'s maker line links the static page; its subject key does not move', () => {
  const card = () => ({ artist: 'graded-cards', title: '1954 Topps #1 Ted Williams PSA NM-MT+ 8.5' });
  setEntityAliasesForTest([]);
  const before = lotSubjectOf(card());
  setEntityAliasesForTest(SET);
  assert.equal(makerLineOf(card()).href, '/p/ted-williams');
  // the build stamps the key with no alias set; the browser reads it with one — same key
  assert.deepEqual(lotSubjectOf(card()), before);
  assert.equal(playerSlugOfHref('/p/ted-williams'), 'ted-williams');
  assert.equal(playerSlugOfHref('/player?id=ted-williams'), 'ted-williams');
  assert.equal(playerSlugOfHref('/makers/rolex'), null);
});

test('aliases: a static dossier opens on its live book like the query route', () => {
  const u = new URL(liveBookHref('/p/shohei-ohtani', '?win=48h'), 'https://x');
  assert.equal(u.pathname, '/p/shohei-ohtani');
  assert.equal(u.searchParams.get('tab'), 'all');
  assert.equal(u.hash, '#on-the-block');
});

/* ── no stragglers: a /player?id= or /entity?id= href is spelled only in
   app/lib/entity/aliases.ts. Comments and tests are free to name them. ── */
const ROOT = path.resolve(__dirname, '..', '..', '..');
// owned by another running agent this wave (do-not-edit list): its one
// dossier link still resolves — /player?id= forwards to /p/ client-side
// (AliasCanonical) — and moves to playerHrefOf when the file frees up
const KNOWN: Record<string, number> = { 'app/components/LotPage.tsx': 1 };

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|js)$/.test(e.name)) out.push(p);
  }
}
const stripComments = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

test('aliases: no hard-coded /player?id= or /entity?id= href outside the helper', () => {
  const files: string[] = [];
  walk(path.join(ROOT, 'app'), files);
  const bad: string[] = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    if (rel === 'app/lib/entity/aliases.ts') continue;
    const n = (stripComments(fs.readFileSync(f, 'utf8')).match(/\/(?:player|entity)\?id=/g) || []).length;
    if (n !== (KNOWN[rel] ?? 0)) bad.push(`${rel} (${n})`);
  }
  assert.deepEqual(bad, [], `entity links must go through app/lib/entity/aliases (entityHrefOf / playerHrefOf / key.ts entityPageOf): ${bad.join(', ')}`);
});
