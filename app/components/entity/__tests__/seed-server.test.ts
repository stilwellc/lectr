/**
 * W30 — an entity page's build-time header (components/entity/seed-server)
 * is exactly what the page reads once its data lands: the market file's
 * summary (then its tail), and the record recordOf completes from the
 * entity's detail bucket.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { entitySeed } from '../seed-server';
import { bucketOf } from '../../../lib/page-data';
import { readEntitiesFile } from '../../../hooks/useEntities';
import { parseEntityId } from '../../../lib/entity/key';

const summary = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: 'player', market: 'sports', label: id.slice(3), discipline: 'Baseball', face: null, page: null,
  sold: 120, sold12m: 30, med12m: 900, med12mN: 30, medScope: 'cards', record: { p: 1_830_000, d: '2026-08-01' },
  spark: null, sparkN: null, yoy: null, verified: null, thin: false, caps: { compare: true, follow: null, dossier: true }, ...extra,
});

test('the seed reads the market file, then its tail, and completes the record from the detail bucket', () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w30-seed-'));
  const pages = path.join(dir, 'public', 'data', 'ray', 'pages');
  fs.mkdirSync(pages, { recursive: true });
  fs.writeFileSync(path.join(pages, 'entities-sports.json'), JSON.stringify({ generatedAt: '', lastCrawl: '', entities: [summary('pl:a-main')] }));
  fs.writeFileSync(path.join(pages, 'entities-sports-tail.json'), JSON.stringify({ generatedAt: '', lastCrawl: '', entities: [summary('pl:b-tail', { record: null })] }));
  const top = [{ id: 'goldin-1', img: 'https://x/y.jpg', p: 1_830_000, d: '2026-08-01', t: '1952 Topps #311', h: 'Goldin', cat: 'sports-cards' }];
  fs.writeFileSync(path.join(pages, `entity-${bucketOf('pl:a-main')}.json`), JSON.stringify({ 'pl:a-main': { yearly: [], houses: [{ h: 'Goldin', n: 80 }, { h: 'Heritage', n: 40 }], cats: [], top, recent: [] } }));
  try {
    process.chdir(dir);
    const a = entitySeed('pl:a-main')!;
    assert.deepEqual(a.s, summary('pl:a-main'));
    assert.deepEqual(a.rec, { p: 1_830_000, d: '2026-08-01', t: '1952 Topps #311', h: 'Goldin', id: 'goldin-1', img: 'https://x/y.jpg' });
    assert.deepEqual(a.houses.map(h => h.h), ['Goldin', 'Heritage']);
    const b = entitySeed('pl:b-tail')!;
    assert.equal(b.s.id, 'pl:b-tail');
    assert.equal(b.rec, null);
    assert.deepEqual(b.houses, []);
    assert.equal(entitySeed('pl:nobody'), null);
    assert.equal(entitySeed('nonsense'), null);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('on the served data (when present): every seed summary is the one the browser decodes', () => {
  const pages = path.join(process.cwd(), 'public', 'data', 'ray', 'pages');
  if (!fs.existsSync(path.join(pages, 'entities-sports.json'))) return;
  const ids: string[] = [];
  for (const m of ['sports', 'tcg', 'culture', 'art']) {
    const f = readEntitiesFile(JSON.parse(fs.readFileSync(path.join(pages, `entities-${m}.json`), 'utf8')));
    for (const e of (f?.entities ?? []).slice(0, 25)) ids.push(e.id);
  }
  for (const id of ids) {
    const m = parseEntityId(id)?.market;
    const f = readEntitiesFile(JSON.parse(fs.readFileSync(path.join(pages, `entities-${m}.json`), 'utf8')));
    const want = f?.entities.find(e => e.id === id);
    assert.deepEqual(entitySeed(id)?.s, want, id);
  }
});
