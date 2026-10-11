/**
 * First-screen payloads (perf wave W13, Oct 11 2026) — a page that paints
 * from a slice of the book must print exactly what the whole book prints.
 *
 * The emitter (scripts/emit-first-screen.ts) picks each slice with the
 * selectors in app/lib/first-screen-select.ts over a 48h clock sweep; these
 * tests re-run every selector over the SLICE and over the WHOLE BOOK, on a
 * finer clock than the sweep (between its steps) and on every reader's day,
 * and require equality — on a synthetic book built to exercise the caps,
 * folds, cross-house twins and flags, and on the served book when present.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AuctionLot } from '../../types';
import { buildFirstScreens, withClock, readerDays, trimMarket } from '../../../scripts/emit-first-screen';
import { homeFeedIds, valueRead, makersRead, entityLiveIds, closeOverRefs } from '../first-screen-select';
import { prepareEagerLots, type CloseBoardJson } from '../eager-book';
import { entityFsKey } from '../first-screen';
import { setEntityAliasesForTest } from '../entity/aliases';
import { houseBaselines, houseBaselineStats, baselinesFromStats } from '../feed-filters';
import { foldKeyOf } from '../fold';
import { ARTISTS, type Market } from '../../constants';
import { pinClock } from './helpers/pin-clock';

const T0 = Date.parse('2026-10-09T20:00:00Z');
pinClock('2026-10-09T20:00:00Z');

type Lot = AuctionLot & { ek?: string | null };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ── a synthetic eager book ──────────────────────────────────────────────────
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const HOUSES = ["Christie's", 'Phillips', "Sotheby's", 'Bonhams', 'Wright', 'Goldin', 'Heritage', 'REA'];
const MAKERS = ['andy-warhol', 'kaws', 'keith-haring', 'george-condo', 'rolex', 'patek-philippe', 'charles-eames', 'george-nakashima']
  .filter(s => ARTISTS.some(a => a.slug === s));
function syntheticBook(n = 420, seed = 7): Lot[] {
  const r = rng(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const out: Lot[] = [];
  for (let i = 0; i < n; i++) {
    const card = r() < 0.45;
    const house = card ? pick(['Goldin', 'Heritage', 'REA']) : pick(HOUSES.slice(0, 5));
    // closes from 1 day ago to 9 days out, on half-hours; 70% carry a clock
    const close = T0 + Math.round((r() * 10 - 1) * 48) * 1_800_000;
    const iso = new Date(close).toISOString();
    const timed = r() < 0.7;
    const k = Math.floor(r() * 40);
    const grade = pick([6, 7, 8, 9, 10]);
    const l: Record<string, unknown> = {
      id: `${house.toLowerCase().replace(/[^a-z]/g, '')}-${i}`,
      status: 'upcoming', auctionHouse: house, currency: 'USD', saleName: '',
      saleDate: iso.slice(0, 10),
      firstSeen: new Date(T0 - Math.floor(r() * 20) * 864e5).toISOString().slice(0, 10),
      imageUrl: r() < 0.9 ? `https://img.example/${i}.jpg` : undefined,
      signal: null,
    };
    if (timed) l.saleDateTime = iso;
    if (card) {
      // the same card at several grades and houses: fold groups + twins
      l.artist = 'sports-cards';
      l.title = `${1950 + (k % 20)} Topps #${k} Player ${k} Rookie Card - PSA ${grade}`;
      l.playerSlug = `player-${k}`; l.playerName = `Player ${k}`;
      l.ek = `pl:player-${k}`;
      l.currentBid = Math.round(100 + r() * 60000);
      l.bidCount = r() < 0.15 ? 0 : Math.floor(r() * 40);
    } else {
      const maker = pick(MAKERS);
      l.artist = maker; l.ek = `mk:${maker}`;
      l.title = `${pick(['Flowers', 'Untitled', 'Companion', 'Daytona Ref. 6263', 'Lounge Chair', 'Skull'])} ${k}`;
      const lo = Math.round(2000 + r() * 400000);
      l.estimateLow = lo; l.estimateHigh = Math.round(lo * 1.5);
      if (r() < 0.5) { l.bidCount = r() < 0.3 ? 0 : Math.floor(r() * 12); l.currentBid = l.bidCount ? Math.round(lo * (0.3 + r())) : 0; }
    }
    if (r() < 0.35) {
      const v = Math.round(1000 + r() * 300000);
      l.value = {
        compValueUsd: v, expectedHammerUsd: Math.round(v * 0.8), low: Math.round(v * 0.6), high: Math.round(v * 1.6),
        confidence: pick(['low', 'medium', 'high']), poolIds: [], n: 20,
        signal: { beatRatePct: 30 + r() * 40, label: r() < 0.5 ? 'below comparable market' : 'in line' },
      };
    }
    if (r() < 0.18) l.signal = { label: 'Below Market', pct: Math.round(30 + r() * 200), confidence: pick(['medium', 'high', 'very-high']), basis: 'comps', med: 5000 };
    if (r() < 0.08) l.resultsPending = true;
    out.push(l as unknown as Lot);
  }
  // cross-house twins: the same card live at two houses
  const cards = out.filter(l => l.artist === 'sports-cards');
  for (let i = 0; i + 1 < cards.length; i += 9) {
    const a = cards[i], b = cards[i + 1];
    if (a.auctionHouse === b.auctionHouse) continue;
    a.crossLive = [{ id: b.id, house: b.auctionHouse, bid: b.currentBid || 0 }];
    b.crossLive = [{ id: a.id, house: a.auctionHouse, bid: a.currentBid || 0 }];
  }
  return out;
}

const META = { lastCrawl: '2026-10-09T11:45:00.000Z', sources: HOUSES, totalLots: 1_234_567, totalSold: 1_100_000 };
const CB: CloseBoardJson = { generatedAt: '2026-10-09T18:00:00.000Z', bids: {} };

/** the rows as a page holds them (phase 1 and the slice both run this) */
function prepared(rows: readonly AuctionLot[], at: number): Lot[] {
  const c = clone(rows) as Lot[];
  withClock(at, () => prepareEagerLots(c, CB, '2026-10-09T12:00:00.000Z'));
  return c;
}

const BOOK = syntheticBook();
// a few close-board bids, so the overlay path is part of the proof
for (const l of BOOK.filter(x => x.bidCount != null).slice(0, 12)) CB.bids![l.id] = { b: (l.currentBid || 0) + 500, n: (l.bidCount || 0) + 2 };
const BUILT = buildFirstScreens({
  up: { generatedAt: '2026-10-09T12:00:00.000Z', lots: clone(BOOK), demand: {}, realized: {}, bidComp: {} },
  meta: META, market: null, backtest: null, closeBoard: CB, closeK: null, fromMs: T0, hours: 48, stepMin: 20,
});
const FULL = prepared(BOOK, T0);
const sliceOf = (key: string) => prepared(BUILT.get(key)!.lots, T0);

/** the reader clocks the proof runs on: every 37 minutes across the sweep
 *  (never on its 20-minute grid), each on every day a reader can be on */
function clocks(stepMin = 37, hours = 48): [number, string][] {
  const out: [number, string][] = [];
  for (let t = T0 - 30 * 60_000; t <= T0 + hours * 3_600_000; t += stepMin * 60_000) for (const d of readerDays(t)) out.push([t, d]);
  return out;
}

test('synthetic book exercises the shortlist (the proof is not vacuous)', () => {
  const ids = homeFeedIds(FULL, T0, '2026-10-09', '2026-10-09');
  assert.ok(ids.length >= 10, `What matters seats ${ids.length}`);
  assert.ok(valueRead(FULL, 'all', T0, '2026-10-09').deals.length >= 5);
  assert.ok(Object.keys(makersRead(FULL, T0, '2026-10-09')).length >= 4);
  // the slice is a slice: smaller than the book, larger than the seats
  const home = BUILT.get('home')!.lots;
  assert.ok(home.length < BOOK.length && home.length >= ids.length);
});

test('home: What matters over the slice = over the book, between the sweep steps, on every reader day', () => {
  const slice = sliceOf('home');
  let n = 0;
  for (const [t, d] of clocks()) {
    const a = withClock(t, () => homeFeedIds(slice, t, d, '2026-10-09'));
    const b = withClock(t, () => homeFeedIds(FULL, t, d, '2026-10-09'));
    assert.deepEqual(a, b, `differs at ${new Date(t).toISOString()} (${d})`);
    n++;
  }
  assert.ok(n > 150);
});

test('home: every seated row carries its whole fold group and its cross-house twins', () => {
  const ids = new Set(BUILT.get('home')!.lots.map(l => l.id));
  const byKey = new Map<string, string[]>();
  for (const l of FULL) { const k = foldKeyOf(l)?.key; if (k) byKey.set(k, [...(byKey.get(k) || []), l.id]); }
  for (const [t, d] of clocks(180)) {
    for (const id of homeFeedIds(FULL, t, d, '2026-10-09')) {
      const l = FULL.find(x => x.id === id)!;
      const k = foldKeyOf(l)?.key;
      for (const m of (k && byKey.get(k)) || []) assert.ok(ids.has(m), `${id}: fold member ${m} missing`);
      for (const x of l.crossLive || []) assert.ok(ids.has(x.id), `${id}: twin ${x.id} missing`);
    }
  }
  // closure is transitive (a twin's fold group comes too)
  const seed = homeFeedIds(FULL, T0, '2026-10-09', '2026-10-09');
  const closed = closeOverRefs(FULL, seed);
  closed.forEach(id => assert.ok(ids.has(id)));
});

test('/value: the flags, the call and the sleepers over the slice = over the book, every market', () => {
  const slice = sliceOf('value');
  const markets: Market[] = ['all', 'art', 'design', 'watches', 'sports'];
  for (const [t, d] of clocks(91)) for (const m of markets) {
    assert.deepEqual(valueRead(slice, m, t, d), valueRead(FULL, m, t, d), `${m} at ${new Date(t).toISOString()} (${d})`);
  }
});

test('/makers: every maker row\'s live + flagged counts over the slice = over the book', () => {
  const slice = sliceOf('makers');
  for (const [t, d] of clocks(91)) assert.deepEqual(makersRead(slice, t, d), makersRead(FULL, t, d));
});

test('entity pages: every entity\'s live book over its bucket = over the book', () => {
  const eks = Array.from(new Set(BOOK.map(l => l.ek).filter(Boolean) as string[]));
  assert.ok(eks.length > 20);
  for (const ek of eks) {
    const slice = sliceOf(entityFsKey(ek));
    for (const [t, d] of clocks(240)) assert.deepEqual(entityLiveIds(slice, ek, t, d), entityLiveIds(FULL, ek, t, d), ek);
  }
  // all 256 buckets ship (an empty bucket is an exact "None live")
  assert.equal(Array.from(BUILT.keys()).filter(k => k.startsWith('ent-')).length, 256);
});

test('payload rows are the book\'s rows verbatim (never recomputed, never rounded)', () => {
  const byId = new Map(clone(BOOK).map(l => [l.id, l]));
  for (const [k, p] of Array.from(BUILT)) {
    for (const l of p.lots) assert.deepEqual(l, byId.get(l.id), `${k}: ${l.id} changed`);
    // in the book's order
    const order = p.lots.map((l: AuctionLot) => BOOK.findIndex(x => x.id === l.id));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${k}: out of book order`);
  }
});

test('house baselines: the shipped stats give exactly the whole book\'s baselines', () => {
  const book = clone(BOOK);
  // a flood: one house's first crawl, 60 lots on one day
  for (let i = 0; i < 60; i++) book.push({ ...book[0], id: `flood-${i}`, auctionHouse: 'NewHouse', firstSeen: '2026-10-08' } as unknown as Lot);
  for (const day of ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-12']) {
    assert.deepEqual(Array.from(baselinesFromStats(houseBaselineStats(book), day)), Array.from(houseBaselines(book, day)), day);
  }
  assert.equal(houseBaselines(book, '2026-10-09').get('NewHouse'), '2026-10-08');
});

test('a slice that would recompute a signal over itself is never written', () => {
  const book = clone(BOOK);
  delete (book.find(l => l.ek === 'mk:andy-warhol') as { signal?: unknown }).signal;
  const built = buildFirstScreens({ up: { lots: book }, meta: META, market: null, backtest: null, closeBoard: null, closeK: null, fromMs: T0, hours: 2, stepMin: 60 });
  assert.equal(built.has('makers'), false);
});

test('market.json trims to the reads the tape and the pulse print', () => {
  const m = {
    generatedAt: 'g', lastCrawl: 'c', makers: { a: 1 }, drills: { b: 2 },
    markets: { art: { method: 'hedonic', label: 'Art', index: [[1, 2]], n: 12, volume: [1], analytics: { x: 1 } } },
    repeatSale: { art: { scope: 'prints', horizons: {} } },
    hedonic: { art: { series: [1, 2, 3], horizons: { '1Y': { changePct: 3 } }, lastCompleteQuarter: '2026 Q3', note: 'n', diag: {}, composite: { horizons: {} } } },
  };
  const t = trimMarket(m)!;
  assert.deepEqual(Object.keys(t).sort(), ['generatedAt', 'hedonic', 'lastCrawl', 'markets', 'repeatSale']);
  assert.deepEqual(t.markets!.art, { method: 'hedonic', label: 'Art', index: [[1, 2]], n: 12 });
  assert.deepEqual(t.hedonic!.art, { horizons: { '1Y': { changePct: 3 } }, lastCompleteQuarter: '2026 Q3', note: 'n', composite: { horizons: {} } });
});

test('routes → payloads; a payload from another deploy is discarded', async () => {
  process.env.NEXT_PUBLIC_FS_VERSION = 'abc123';
  // fresh module instance with the version baked
  const mod = await import(`../first-screen?fsv=${Date.now()}`) as typeof import('../first-screen');
  assert.equal(mod.fsKeyOf('/'), 'home');
  assert.equal(mod.fsKeyOf('/value'), 'value');
  assert.equal(mod.fsKeyOf('/value/art'), 'value');
  assert.equal(mod.fsKeyOf('/makers'), 'makers');
  assert.equal(mod.fsKeyOf('/makers/m/art'), 'makers');
  assert.equal(mod.fsKeyOf('/makers/m/sports'), null); // collection rows are names over the whole book
  assert.equal(mod.fsKeyOf('/makers/andy-warhol'), mod.entityFsKey('mk:andy-warhol'));
  assert.equal(mod.fsKeyOf('/player', '?id=mickey-mantle'), mod.entityFsKey('pl:mickey-mantle'));
  // the static aliases (W12) are the same entity page
  assert.equal(mod.fsKeyOf('/p/mickey-mantle'), mod.entityFsKey('pl:mickey-mantle'));
  setEntityAliasesForTest([{ id: 'sj:tcg|k:charizard', slug: 'charizard' }]);
  assert.equal(mod.fsKeyOf('/e/charizard'), mod.entityFsKey('sj:tcg|k:charizard'));
  assert.equal(mod.fsKeyOf('/e/nobody-here'), null);
  setEntityAliasesForTest(null);
  assert.equal(mod.fsKeyOf('/art'), null);
  assert.equal(mod.fsKeyOf('/profile'), null);
  assert.equal(mod.fsKeyOf('/about'), null);
  const realFetch = globalThis.fetch;
  try {
    const body = (ver: string) => new Response(JSON.stringify({ v: 1, ver, key: 'home', lots: [] }), { headers: { 'content-type': 'application/json' } });
    globalThis.fetch = (async () => body('stale9')) as typeof fetch;
    assert.equal(await mod.fetchFirstScreen('home'), null);
    globalThis.fetch = (async () => body('abc123')) as typeof fetch;
    assert.notEqual(await mod.fetchFirstScreen('value'), null);
    globalThis.fetch = (async () => new Response('<html>', { status: 404, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    assert.equal(await mod.fetchFirstScreen('makers'), null);
  } finally { globalThis.fetch = realFetch; }
});

// ── the served book, when this checkout has one ─────────────────────────────
const SERVED = path.join(process.cwd(), 'public', 'data', 'ray');
test('served book: every slice = the book (a 24h sweep, off its grid)', { skip: !existsSync(path.join(SERVED, 'upcoming.json')) }, () => {
  const read = (f: string) => { try { return JSON.parse(readFileSync(path.join(SERVED, f), 'utf8')); } catch { return null; } };
  const up = read('upcoming.json');
  const cb = read('close-board.json');
  const meta = read('meta.json') || {};
  const from = Date.parse(up.generatedAt || meta.lastCrawl || '') || T0;
  const built = buildFirstScreens({ up, meta, market: null, backtest: null, closeBoard: cb, closeK: read('close-k.json'), fromMs: from, hours: 24, stepMin: 60 });
  const prep = (rows: readonly AuctionLot[]) => { const c = clone(rows) as Lot[]; withClock(from, () => prepareEagerLots(c, cb, up.generatedAt)); return c; };
  const full = prep(up.lots);
  const home = prep(built.get('home')!.lots), value = prep(built.get('value')!.lots), makers = prep(built.get('makers')!.lots);
  const crawlDay = (meta.lastCrawl || '').slice(0, 10);
  for (let t = from + 17 * 60_000; t <= from + 24 * 3_600_000; t += 173 * 60_000) {
    for (const d of readerDays(t)) {
      assert.deepEqual(withClock(t, () => homeFeedIds(home, t, d, crawlDay)), withClock(t, () => homeFeedIds(full, t, d, crawlDay)), `home ${new Date(t).toISOString()} ${d}`);
      assert.deepEqual(valueRead(value, 'all', t, d), valueRead(full, 'all', t, d), `value ${d}`);
      assert.deepEqual(makersRead(makers, t, d), makersRead(full, t, d), `makers ${d}`);
    }
  }
});
