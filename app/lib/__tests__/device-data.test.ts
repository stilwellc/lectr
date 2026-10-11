/**
 * Device data is untrusted (Oct 11 2026, /profile review R4 P1-1/P1-2): a
 * hand-edited, half-written or older-format value in lectr-follows,
 * lectr-signals or lectr-interests must read as "less data", never as a
 * crash — the profile and home both render straight from these stores, and
 * a crash here survived every reload. Fuzzed: each reader takes garbage
 * and returns only well-typed entries, and everything downstream of the
 * read (the recommender, the printed titles and labels) runs on it.
 * Plus: storage that throws on the property itself (Safari private /
 * blocked site data) and the device reset's scope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFollows, isFollow, migrationPlan } from '../follows';
import { readSignals, signalsToTaste, markLot, unmarkLot, recordSignal, cleanSnap, SIGNALS_KEY, type KV } from '../recs-signals';
import { parseInterests, readInterests } from '../interests';
import { buildTaste, recommend, type RecLot } from '../recs';
import { storageGet, storageSet, storageRemove, isLectrKey, resetLectrStorage, STORAGE_FAILED_EVENT } from '../safe-storage';
import { craftTitle } from '../../utils';

const NOW = Date.parse('2026-10-09T20:00:00Z');

/* ── a small deterministic garbage generator ───────────────────────────── */
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
function junk(depth = 0): unknown {
  const leaves: unknown[] = [null, undefined, 0, -1, 5, NaN, Infinity, 1e308, true, false, '', 'x', 'charizard', '2026-10-09', { }, [], '<script>', '\u0000'];
  if (depth > 2) return pick(leaves);
  const r = rnd();
  if (r < 0.45) return pick(leaves);
  if (r < 0.7) return Array.from({ length: Math.floor(rnd() * 4) }, () => junk(depth + 1));
  const o: Record<string, unknown> = {};
  for (const k of ['kind', 'key', 'label', 'k', 'id', 't', 't0', 'n', 'dwell', 'keys', 'lot', 'title', 'artist', 'auctionHouse', 'markets', 'minUsd', 'maxUsd', 'at', 'v', 'ev', 'marks']) {
    if (rnd() < 0.35) o[k] = junk(depth + 1);
  }
  return o;
}
/** a plausible-shaped value with one field broken */
function nearMiss<T extends Record<string, unknown>>(good: T): T {
  const keys = Object.keys(good);
  const k = pick(keys);
  return { ...good, [k]: junk(3) } as T;
}

const mem = (init?: Record<string, string>): KV & { m: Map<string, string> } => {
  const m = new Map<string, string>(Object.entries(init ?? {}));
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
};

const POOL: RecLot[] = [
  { id: 'a1', artist: 'pokemon', title: '1999 Pokemon Base Set Holo Charizard #4 - PSA 9', subCat: 'cards', drill: 'tcg', auctionHouse: 'Goldin', saleDate: '2026-10-12', saleDateTime: '2026-10-12T22:00:00Z', currentBid: 4000, currency: 'USD', status: 'upcoming', ek: 'sj:tcg|k:charizard' },
  { id: 'a2', artist: 'andy-warhol', title: 'Marilyn (F. & S. II.31)', subCat: 'prints', auctionHouse: "Christie's", saleDate: '2026-10-13', estimateLow: 80000, estimateHigh: 120000, currency: 'USD', status: 'upcoming' },
];

/* ── follows ───────────────────────────────────────────────────────────── */

test('follows: the R4 repros read as the valid entries only', () => {
  const good = { kind: 'entity', key: 'sj:tcg|k:charizard', label: 'Charizard' };
  assert.deepEqual(parseFollows(JSON.stringify([null, good])), [good]);
  assert.deepEqual(parseFollows(JSON.stringify([{ ...good, label: { a: 1 } }, good])), [good], 'a non-text label is dropped');
  assert.deepEqual(parseFollows(JSON.stringify([{ kind: 'planet', key: 'x', label: 'x' }])), []);
  assert.deepEqual(parseFollows(JSON.stringify({ kind: 'maker' })), [], 'an object, not a list');
  assert.deepEqual(parseFollows('not json'), []);
  assert.deepEqual(parseFollows(JSON.stringify([good, good])), [good], 'a follow stored twice is one');
});

test('follows: 2,000 fuzzed stores never throw and return only well-typed follows', () => {
  for (let i = 0; i < 2000; i++) {
    const raw = rnd() < 0.5
      ? JSON.stringify(Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => (rnd() < 0.5 ? nearMiss({ kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' }) : junk())))
      : JSON.stringify(junk());
    const fs = parseFollows(raw);
    for (const f of fs) {
      assert.ok(isFollow(f));
      assert.equal(typeof f.label, 'string');
      assert.equal(typeof f.key, 'string');
    }
    assert.doesNotThrow(() => migrationPlan(fs, []));
  }
});

/* ── on-device signals ─────────────────────────────────────────────────── */

const goodEv = () => ({ k: 'lot', id: 'a1', t: NOW - 1000, t0: NOW - 5000, n: 2, label: 'x', lot: { id: 'a1', title: 'Charizard', artist: 'pokemon', auctionHouse: 'Goldin' } });
const goodMark = () => ({ k: 'less', id: 'a2', t: NOW - 1000, keys: ['sj:tcg|k:charizard'], lot: { id: 'a2', title: 'Marilyn', artist: 'andy-warhol' } });

test('signals: the R4 repros (non-array keys, non-text snapshot title) read safely', () => {
  const kv = mem({ [SIGNALS_KEY]: JSON.stringify({ v: 1, ev: [{ ...goodEv(), lot: { id: 'a1', title: 5 } }], marks: [{ ...goodMark(), keys: 5 }, { ...goodMark(), id: 'a3', keys: 'sj:x' }] }) });
  const st = readSignals(kv, NOW);
  assert.equal(st.ev.length, 1);
  assert.equal(st.ev[0].lot, undefined, 'a snapshot without a text title is dropped, the visit kept');
  assert.equal(st.marks.length, 2);
  assert.ok(st.marks.every(m => m.keys === undefined), 'keys that are not a list are dropped');
  assert.doesNotThrow(() => signalsToTaste(st, NOW));
});

test('signals: 2,000 fuzzed stores never throw — read, taste, recommend, print', () => {
  for (let i = 0; i < 2000; i++) {
    const ev = Array.from({ length: Math.floor(rnd() * 4) }, () => (rnd() < 0.6 ? nearMiss(goodEv()) : junk()));
    const marks = Array.from({ length: Math.floor(rnd() * 4) }, () => (rnd() < 0.6 ? nearMiss(goodMark()) : junk()));
    const raw = rnd() < 0.85 ? JSON.stringify({ v: 1, ev, marks }) : JSON.stringify(junk());
    const kv = mem({ [SIGNALS_KEY]: raw });
    const st = readSignals(kv, NOW);
    for (const e of st.ev) {
      assert.equal(typeof e.id, 'string');
      if (e.label !== undefined) assert.equal(typeof e.label, 'string');
      if (e.lot) { assert.equal(typeof e.lot.title, 'string'); assert.doesNotThrow(() => craftTitle(e.lot!.title, e.lot!.auctionHouse ?? undefined)); }
    }
    for (const m of st.marks) {
      if (m.keys !== undefined) assert.ok(Array.isArray(m.keys) && m.keys.every(k => typeof k === 'string'));
      if (m.lot) assert.doesNotThrow(() => craftTitle(m.lot!.title, m.lot!.auctionHouse ?? undefined));
    }
    const { extra, negative } = signalsToTaste(st, NOW, id => POOL.find(l => l.id === id));
    const taste = buildTaste({ saved: [], follows: [], extra, negative, nowMs: NOW });
    assert.doesNotThrow(() => recommend(POOL, taste, { nowMs: NOW }));
    // and the writers still work on top of whatever was there
    assert.doesNotThrow(() => { markLot('more', POOL[0], kv, NOW); unmarkLot(POOL[0].id, null, kv, NOW); recordSignal('search', 'warhol marilyn', {}, kv, NOW); });
  }
});

test('signals: a snapshot keeps only fields of their own type', () => {
  const s = cleanSnap({ id: 'z', title: 'T', artist: 7, auctionHouse: ['x'], currentBid: '900', estimateLow: 100, ek: { x: 1 } })!;
  assert.equal(s.artist, '');
  assert.equal(s.auctionHouse, undefined);
  assert.equal(s.currentBid, undefined);
  assert.equal(s.estimateLow, 100);
  assert.equal(s.ek, undefined);
  assert.equal(cleanSnap({ id: 'z' }), undefined);
  assert.equal(cleanSnap('z'), undefined);
});

/* ── interests ─────────────────────────────────────────────────────────── */

test('interests: unknown markets, bad prices and bad times read as none', () => {
  const i = parseInterests(JSON.stringify({ v: 1, markets: ['tcg', 'all', 'planets', 4, null, 'tcg'], minUsd: '5000', maxUsd: -1, at: 'yesterday' }));
  assert.deepEqual(i.markets, ['tcg']);
  assert.equal(i.minUsd, null);
  assert.equal(i.maxUsd, null);
  assert.equal(i.at, null);
  assert.deepEqual(parseInterests(JSON.stringify([1, 2])).markets, []);
  for (let n = 0; n < 1000; n++) {
    const v = parseInterests(JSON.stringify(rnd() < 0.5 ? junk() : nearMiss({ v: 1, markets: ['art'], minUsd: 1000, maxUsd: 5000, at: '2026-10-09T00:00:00Z' })));
    assert.ok(Array.isArray(v.markets) && v.markets.every(m => typeof m === 'string'));
    assert.ok(v.minUsd === null || (typeof v.minUsd === 'number' && v.minUsd > 0));
  }
});

/* ── blocked storage (Safari private / "Block all site data") ──────────── */

test('storage that throws on the property itself: reads are empty, writes say false, nothing throws', () => {
  const g = globalThis as unknown as { window?: unknown };
  const had = 'window' in g;
  const prev = g.window;
  const events: string[] = [];
  const win = {
    dispatchEvent: (e: Event) => { events.push(e.type); return true; },
    get localStorage(): Storage { throw new Error('SecurityError: The user has denied storage'); },
    get sessionStorage(): Storage { throw new Error('SecurityError'); },
  };
  g.window = win;
  try {
    assert.equal(storageGet('lectr-follows'), null);
    assert.equal(storageSet('lectr-x', '1'), false);
    assert.deepEqual(events, [], 'a background write fails quietly');
    assert.equal(storageSet('lectr-x', '1', { announce: true }), false);
    assert.deepEqual(events, [STORAGE_FAILED_EVENT], 'a write the reader asked for is announced');
    assert.doesNotThrow(() => storageRemove('lectr-x'));
    assert.equal(resetLectrStorage(), 0);
    assert.deepEqual(readSignals(undefined, NOW).ev, []);
    assert.deepEqual(readInterests().markets, []);
  } finally {
    if (had) g.window = prev; else delete g.window;
  }
});

test('the device reset clears lectr keys only — never the sign-in session or saved lots', () => {
  for (const k of ['lectr-follows', 'lectr-signals', 'lectr-interests', 'lectr-last-visit', 'ray-feedview', 'costil-theme']) assert.ok(isLectrKey(k), k);
  for (const k of ['sb-abc-auth-token', 'ray-saved-lots', 'other-site']) assert.ok(!isLectrKey(k), k);
});
