/**
 * The slim entities wire (app/lib/entity/wire) + the tiers + THE SIZE
 * BUDGET: a synthetic file at prod scale (Oct 10 2026 prod: sports 6,088
 * entities — 5,089 players, 813 sets, 176 subjects; ~2,540 with a live lot;
 * all 8,503 / ~3,550 live) must encode under the budgets, or this fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntities, entityFileBodies, brotliBytes } from '../emit-entities';
import {
  encodeEntities, decodeEntities, tierEntities, isEntitiesWire, derivedLabelOf,
  MAIN_SOLD_ONLY, BUDGET_MARKET_BR, BUDGET_ALL_BR, type EntitiesWire,
} from '../../app/lib/entity/wire';
import { recordOf, type EntitySummary } from '../../app/lib/entity/model';
import { readEntitiesFile } from '../../app/hooks/useEntities';
import { entityPageOf, parseEntityId } from '../../app/lib/entity/key';
import type { AuctionLot } from '../../app/types';

const TODAY = '2026-10-09';
const SPARK_Q = ['2023-Q4', '2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'];
const META = { generatedAt: '2026-10-10T11:19:41.122Z', lastCrawl: '2026-10-10T11:09:16.169Z', sparkQ: SPARK_Q };

/* ── a real build, small ── */
let n = 0;
const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `w${n++}`, artist, title, status: 'sold', saleDate: '2026-06-01', priceUsd: 1000, auctionHouse: "Christie's", category: 'print', subCat: 'prints', ...extra }) as unknown as AuctionLot;
function built() {
  const sold: AuctionLot[] = [];
  for (let i = 0; i < 12; i++) sold.push(lot('andy-warhol', `Marilyn ${i}`, { priceUsd: 20_000 + i, imageUrl: `https://img/${i}.jpg`, saleDate: `2025-0${1 + (i % 9)}-15` }));
  sold.push(lot('andy-warhol', 'Shot Sage Blue Marilyn', { priceUsd: 195_000_000, saleDate: '2022-05-08', category: 'original', subCat: 'originals', medium: 'acrylic and silkscreen ink on linen', imageUrl: 'https://img/ssbm.jpg' }));
  for (let i = 0; i < 11; i++) sold.push(lot('graded-cards', `1952 Topps #311 Mickey Mantle PSA ${i % 9 + 1}`, { category: 'object', subCat: 'cards', priceUsd: 50_000 + i * 1000, imageUrl: `https://img/m${i}.jpg`, saleDate: `2024-0${1 + (i % 9)}-10` }));
  const live = [
    lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8', { status: 'upcoming', saleDate: '2026-10-20', priceUsd: undefined, category: 'object', subCat: 'cards', imageUrl: 'https://img/live.jpg' }),
    lot('pokemon', 'Anything', { status: 'upcoming', saleDate: '2026-10-20', priceUsd: undefined, ek: 'sj:tcg|k:charizard', imageUrl: null }),
  ];
  return buildEntities({ eachSold: v => sold.forEach(v), live, lastCrawl: META.lastCrawl, market: null, today: TODAY });
}

test('wire: decode(encode(summaries)) gives back every field the client reads; record → [price, day]', () => {
  const b = built();
  const body = entityFileBodies(b.summaries, b.live, META);
  const main = JSON.parse(body.main);
  assert.ok(isEntitiesWire(main));
  const dec = decodeEntities(main).entities;
  assert.equal(dec.length, b.summaries.length);
  for (const s of b.summaries) {
    const d = dec.find(x => x.id === s.id)!;
    const { record, face, ...rest } = s;
    const { record: dRec, face: dFace, ...dRest } = d;
    assert.deepEqual(dRest, rest, s.id);
    assert.deepEqual(dRec, record ? { p: record.p, d: record.d } : null);
    void face; void dFace;
  }
  // derived, never shipped
  const w = main as EntitiesWire;
  assert.equal(w.c.l[w.c.id.indexOf('mk:andy-warhol')], 0, 'a maker\'s label is derived');
  assert.equal(derivedLabelOf('mk:andy-warhol'), 'Andy Warhol');
  assert.ok(!body.main.includes('Shot Sage Blue Marilyn'), 'the record title lives in the detail bucket');
});

test('wire: the face ships for a maker and a live entity with no live photo — never where the live photo leads', () => {
  const b = built();
  const dec = decodeEntities(JSON.parse(entityFileBodies(b.summaries, b.live, META).main)).entities;
  const by = (id: string) => dec.find(x => x.id === id)!;
  assert.equal(by('mk:andy-warhol').face, 'https://img/ssbm.jpg');
  assert.equal(by('pl:mickey-mantle').face, null, 'its live lot\'s photo is the row\'s hero');
  assert.equal(b.summaries.find(s => s.id === 'pl:mickey-mantle')!.face !== null, true);
});

test('wire: recordOf fills the slim record\'s title + house from the detail\'s top results', () => {
  const b = built();
  const det = b.details.get('mk:andy-warhol')!;
  const rec = recordOf({ p: 195_000_000, d: '2022-05-08' }, det)!;
  assert.equal(rec.t, 'Shot Sage Blue Marilyn');
  assert.equal(rec.h, "Christie's");
  assert.deepEqual(recordOf({ p: 1, d: '2020-01-01' }, det), { p: 1, d: '2020-01-01' }, 'no match: price + day only');
  assert.equal(recordOf(null, det), null);
});

test('wire: the client reads v2 and a v1 file alike; junk is null', () => {
  const b = built();
  const v2 = readEntitiesFile(JSON.parse(entityFileBodies(b.summaries, b.live, META).main))!;
  assert.equal(v2.entities.length, b.summaries.length);
  assert.equal(v2.tier, 'main');
  const v1 = readEntitiesFile({ ...META, entities: b.summaries })!;
  assert.equal(v1.entities, b.summaries as unknown);
  assert.equal(readEntitiesFile('<html>'), null);
  assert.equal(readEntitiesFile({ v: 2 }), null);
});

test('tiers: every maker + every live entity in main, then the top sold-only by sold n; the rest in the tail', () => {
  const mk = (id: string, sold: number) => ({ id, sold, label: id });
  const list = [mk('mk:rolex', 5), mk('pl:a', 900), mk('pl:b', 800), mk('pl:c', 700), mk('pl:live', 12), mk('st:sports|s:x', 600)];
  const live = (id: string) => (id === 'pl:live' ? 3 : 0);
  const { main, tail } = tierEntities(list, live, 2);
  assert.deepEqual(main.map(e => e.id), ['mk:rolex', 'pl:a', 'pl:b', 'pl:live']);
  assert.deepEqual(tail.map(e => e.id), ['pl:c', 'st:sports|s:x']);
  assert.equal(MAIN_SOLD_ONLY, 400);
});

/* ── THE SIZE BUDGET at prod scale ── */

/** deterministic PRNG (mulberry32) */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SYL = ['ka', 'ro', 'mi', 'tan', 'del', 'vin', 'son', 'mar', 'lee', 'jo', 'bra', 'dy', 'can', 'tor', 'el', 'li', 'gar', 'ner', 'hu', 'wil', 'ster', 'ber', 'quin', 'zo', 'pa', 'rick', 'ham', 'ton', 'fe', 'lix', 'os', 'ga', 'ny', 'ce', 'tri', 'shaw'];
const LENSES = ['sports-cards:singles', 'sports-cards:graded', 'sports-cards:vintage', 'sports-cards:sealed', 'sports-memorabilia:autographs', 'sports-memorabilia:game-used', 'sports-memorabilia:tickets', 'sports-memorabilia:photos', 'sports-memorabilia:equipment', 'sports-memorabilia:other', 'sports-cards:other'];
const DISC = ['Baseball', 'Basketball', 'Football', 'Hockey', 'Soccer', 'Golf', 'Boxing', 'Tennis', 'Racing', 'Wrestling', 'Sports Cards · Singles', 'Sports Cards · Sealed', 'Sports Memorabilia · Autographs', 'Sports Memorabilia · Game-Used', 'Sports Memorabilia · Tickets', 'Sports Memorabilia · Photos', 'Sports Memorabilia · Other'];
const HOSTS = ['https://d2tt46f3mh26nl.cloudfront.net/public/Lots/', 'https://rea-image-archive.nyc3.cdn.digitaloceanspaces.com/', 'https://bid.memorylaneinc.com/ItemImages/', 'http://vafloc02.s3.amazonaws.com/isyn/images/'];

/** a v1-shaped summary population like prod's sports file (sold buckets
 *  <10: 18% · 10–49: 58% · 50–199: 18% · 200+: 6%), every field filled */
function synth(count: number, liveN: number, seed: number, kinds: { prefix: (slug: string, r: () => number) => string; share: number }[]): { list: EntitySummary[]; live: Map<string, { n: number; photo: boolean }> } {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const hex = (k: number) => Array.from({ length: k }, () => Math.floor(r() * 16).toString(16)).join('');
  const word = () => { const w = Array.from({ length: 2 + Math.floor(r() * 2) }, () => pick(SYL)).join(''); return w[0].toUpperCase() + w.slice(1); };
  const list: EntitySummary[] = [];
  const live = new Map<string, { n: number; photo: boolean }>();
  const seen = new Set<string>();
  while (list.length < count) {
    const label = `${word()} ${word()}${r() < 0.1 ? ' Jr.' : ''}`;
    const slug = label.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '');
    const roll = r();
    let acc = 0, kind = kinds[0];
    for (const k of kinds) { acc += k.share; if (roll < acc) { kind = k; break; } }
    const id = kind.prefix(slug, r);
    if (seen.has(id)) continue;
    seen.add(id);
    const p = parseEntityId(id)!;
    const b = r();
    const sold = b < 0.18 ? Math.floor(r() * 10) : b < 0.76 ? 10 + Math.floor(r() * 40) : b < 0.94 ? 50 + Math.floor(r() * 150) : 200 + Math.floor(r() * 3000);
    const sold12m = Math.floor(sold * r() * 0.5);
    const hasSpark = sold >= 50 && r() < 0.7;
    const med = sold12m >= 5 ? 20 + Math.floor(r() * 5000) : null;
    const img = `${pick(HOSTS)}${hex(8)}-${hex(4)}-${hex(4)}-${hex(12)}/${hex(16)}@1x`;
    const lens = pick(LENSES);
    list.push({
      id, kind: p.kind, market: p.market, label, subKind: p.subKind, discipline: pick(DISC), face: img, page: entityPageOf(id),
      sold, sold12m, med12m: med, med12mN: sold12m, medScope: null, medLens: lens,
      record: sold ? { p: 100 + Math.floor(r() * 500_000), d: `20${10 + Math.floor(r() * 16)}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 10)}`, t: `${2000 + Math.floor(r() * 25)} ${word()} Chrome Refractor #${Math.floor(r() * 400)} ${label} Signed Rookie Card (#${Math.floor(r() * 99)}/99) - PSA GEM MT 10`, h: pick(['Goldin', 'Heritage', 'REA', 'Memory Lane', 'Lelands']), id: `goldin-${hex(24)}`, img } : null,
      spark: hasSpark ? Array.from({ length: 12 }, () => (r() < 0.2 ? null : 50 + Math.floor(r() * 3000))) : null,
      sparkN: hasSpark ? Array.from({ length: 12 }, () => Math.floor(r() * 60)) : null,
      yoy: hasSpark && r() < 0.4 ? { pct: Math.round((r() * 200 - 60) * 10) / 10, n: 10 + Math.floor(r() * 200), basis: 'median' } : null,
      verified: null, thin: sold12m < 5, caps: { compare: hasSpark, follow: p.kind === 'player' ? p.slug : null, dossier: sold >= 10 },
    });
  }
  // the live entities: the <10-sold ones (they exist only because something is live) + the busiest of the rest
  const order = list.slice().sort((a, b) => ((a.sold ?? 0) < 10 ? -1 : 0) - ((b.sold ?? 0) < 10 ? -1 : 0) || r() - 0.5);
  for (const e of order.slice(0, liveN)) live.set(e.id, { n: 1 + Math.floor(r() * 6), photo: r() < 0.995 });
  list.sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0));
  return { list, live };
}

const SPORTS_KINDS = [
  { prefix: (s: string) => `pl:${s}`, share: 5089 / 6088 },
  { prefix: (s: string) => `st:sports|s:${s}`, share: 813 / 6088 },
  { prefix: (s: string) => `sj:sports|t:${s}`, share: 176 / 6088 },
];

test(`BUDGET: a prod-scale entities-<market>.json main file is ≤ ${BUDGET_MARKET_BR / 1000}KB brotli`, () => {
  const { list, live } = synth(6088, 2540, 7, SPORTS_KINDS);
  const before = JSON.stringify({ ...META, entities: list });
  const b = entityFileBodies(list, live, META);
  const br = brotliBytes(b.main);
  console.log(`[budget] sports synthetic: v1 ${(brotliBytes(before) / 1024).toFixed(0)}KB br → main ${b.mainN} ${(br / 1024).toFixed(0)}KB br · tail ${b.tailN} ${(brotliBytes(b.tail) / 1024).toFixed(0)}KB br`);
  assert.ok(b.mainN >= 2540 && b.mainN <= 2540 + MAIN_SOLD_ONLY);
  assert.ok(br <= BUDGET_MARKET_BR, `entities-sports.json ${br} B brotli > budget ${BUDGET_MARKET_BR}`);
});

test(`BUDGET: a prod-scale entities-all.json main file is ≤ ${BUDGET_ALL_BR / 1000}KB brotli`, () => {
  const { list, live } = synth(8503, 3550, 11, [
    ...SPORTS_KINDS.map(k => ({ ...k, share: k.share * 0.72 })),
    { prefix: (s: string) => `sj:culture|p:${s}`, share: 0.2 },
    { prefix: (s: string) => `sj:tcg|k:${s}`, share: 0.056 },
    { prefix: (s: string) => `sj:science|m:${s}`, share: 0.024 },
  ]);
  const b = entityFileBodies(list, live, META);
  const br = brotliBytes(b.main);
  console.log(`[budget] all synthetic: main ${b.mainN} ${(br / 1024).toFixed(0)}KB br · tail ${b.tailN} ${(brotliBytes(b.tail) / 1024).toFixed(0)}KB br`);
  assert.ok(br <= BUDGET_ALL_BR, `entities-all.json ${br} B brotli > budget ${BUDGET_ALL_BR}`);
});
