/**
 * On-device signals (app/lib/recs-signals) + their optional input to the
 * recommender (app/lib/recs extra / negative): the store is capped, decayed,
 * versioned, survives corrupted storage and clears; implicit views weigh
 * below a save; "More like this" lifts; "Not for me" bans the lot and quiets
 * its entity / card; reasons say what the reader did.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSignals, recordSignal, recordDwell, markLot, unmarkLot, clearSignals, signalsToTaste, quietKeysOf, startPage,
  SIGNALS_KEY, MAX_EVENTS, MAX_MARKS, SIGNAL_WEIGHT, type KV,
} from '../recs-signals';
import { buildTaste, recommend, SEED_WEIGHT, type RecLot } from '../recs';

const NOW = Date.parse('2026-10-09T20:00:00Z');
const DAY = 864e5;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

function mem(init?: Record<string, string>): KV & { m: Map<string, string> } {
  const m = new Map<string, string>(Object.entries(init ?? {}));
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
}

let seq = 0;
function card(title: string, sport: string, bid: number, o: Partial<RecLot> = {}): RecLot {
  const id = `s-${++seq}`;
  return {
    id, artist: 'sports-cards', title, subCat: 'cards', drill: sport, auctionHouse: 'Goldin', saleName: 'Weekly',
    saleDate: at(3).slice(0, 10), saleDateTime: at(3), currentBid: bid, bidCount: 6, currency: 'USD', status: 'upcoming', ...o,
  };
}

/* ── the store ─────────────────────────────────────────────────────────── */

test('records a visit with its snapshot; a repeat inside 30 min is one visit, later ones count', () => {
  const kv = mem();
  const l = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  recordSignal('lot', l.id, { lot: l }, kv, NOW);
  recordSignal('lot', l.id, { lot: l }, kv, NOW + 60_000);
  let st = readSignals(kv, NOW);
  assert.equal(st.ev.length, 1);
  assert.equal(st.ev[0].n, 1);
  assert.equal(st.ev[0].lot?.title, l.title);
  recordSignal('lot', l.id, { lot: l }, kv, NOW + 3_600_000);
  st = readSignals(kv, NOW + 3_600_000);
  assert.equal(st.ev[0].n, 2);
  recordDwell('lot', l.id, 25_000, kv, NOW + 3_600_000);
  assert.equal(readSignals(kv, NOW).ev[0].dwell, 25_000);
});

test('search keeps the term only, normalized; too-short terms are ignored', () => {
  const kv = mem();
  recordSignal('search', '  KAWS   Companion ', {}, kv, NOW);
  recordSignal('search', 'ab', {}, kv, NOW);
  const st = readSignals(kv, NOW);
  assert.deepEqual(st.ev.map(e => [e.k, e.id]), [['search', 'kaws companion']]);
});

test('capped: never more than MAX_EVENTS events or MAX_MARKS marks, oldest go first', () => {
  const kv = mem();
  for (let i = 0; i < MAX_EVENTS + 25; i++) recordSignal('entity', `sj:x|k:${i}`, { label: `E${i}` }, kv, NOW + i);
  const st = readSignals(kv, NOW + 1000);
  assert.equal(st.ev.length, MAX_EVENTS);
  assert.equal(st.ev[0].id, 'sj:x|k:25');
  for (let i = 0; i < MAX_MARKS + 5; i++) markLot('more', card(`1990 Fleer #${i} Card - PSA 9`, 'basketball', 50), kv, NOW + i);
  assert.equal(readSignals(kv, NOW + 1000).marks.length, MAX_MARKS);
});

test('decay: anything older than 90 days is dropped; weight halves every 21 days', () => {
  const kv = mem();
  const old = card('1986 Fleer #57 Michael Jordan - PSA 8', 'basketball', 5000);
  const fresh = card('1986 Fleer #57 Michael Jordan - PSA 9', 'basketball', 9000);
  recordSignal('lot', old.id, { lot: old }, kv, NOW - 100 * DAY);
  recordSignal('lot', fresh.id, { lot: fresh }, kv, NOW - 21 * DAY);
  const st = readSignals(kv, NOW);
  assert.deepEqual(st.ev.map(e => e.id), [fresh.id]);
  const { extra } = signalsToTaste(st, NOW);
  assert.equal(extra.length, 1);
  assert.ok(Math.abs(extra[0].weight - SIGNAL_WEIGHT.lot / 2) < 1e-6);
});

test('corrupted or foreign storage reads as an empty memory, never a throw', () => {
  for (const raw of ['{not json', '"x"', 'null', JSON.stringify({ v: 99, ev: [], marks: [] }), JSON.stringify({ v: 1, ev: 'nope', marks: [{ k: 'zzz' }] })]) {
    const st = readSignals(mem({ [SIGNALS_KEY]: raw }), NOW);
    assert.deepEqual(st, { v: 1, ev: [], marks: [] });
  }
  // half-good rows: the good ones survive
  const kv = mem({ [SIGNALS_KEY]: JSON.stringify({ v: 1, ev: [{ k: 'search', id: 'warhol', t: NOW, t0: NOW, n: 1 }, { k: 'lot' }, 7], marks: [] }) });
  assert.equal(readSignals(kv, NOW).ev.length, 1);
  // a throwing storage (private mode / quota): reads empty, writes quietly fail
  const bad: KV = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
  assert.deepEqual(readSignals(bad, NOW).ev, []);
  assert.doesNotThrow(() => recordSignal('search', 'warhol', {}, bad, NOW));
  assert.doesNotThrow(() => clearSignals(bad));
  assert.deepEqual(readSignals(null, NOW).ev, []);
});

test('clear empties everything', () => {
  const kv = mem();
  recordSignal('search', 'charizard', {}, kv, NOW);
  markLot('less', card('2020 Prizm #1 Joe Burrow - PSA 10', 'football', 300), kv, NOW);
  clearSignals(kv);
  assert.equal(kv.m.has(SIGNALS_KEY), false);
  assert.deepEqual(readSignals(kv, NOW), { v: 1, ev: [], marks: [] });
});

test('marks: one per lot, the newer replaces; undo restores the one it replaced', () => {
  const kv = mem();
  const l = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  assert.equal(markLot('more', l, kv, NOW), null);
  const prev = markLot('less', l, kv, NOW + 1);
  assert.equal(prev?.k, 'more');
  let st = readSignals(kv, NOW);
  assert.deepEqual(st.marks.map(m => m.k), ['less']);
  assert.ok(st.marks[0].keys?.some(k => k.startsWith('card:')), 'a "less" carries the card identity it quiets');
  unmarkLot(l.id, prev, kv, NOW + 2);
  st = readSignals(kv, NOW);
  assert.deepEqual(st.marks.map(m => m.k), ['more']);
  unmarkLot(l.id, null, kv, NOW + 3);
  assert.equal(readSignals(kv, NOW).marks.length, 0);
});

test('open a pick, "Not for me", Undo: the page reads the same signals and the room comes back identical', () => {
  const kv = mem();
  const seed = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  const room = [
    card('1956 Topps #135 Mickey Mantle - PSA EX 5', 'baseball', 9000),
    card('1957 Topps #95 Mickey Mantle - PSA EX 5', 'baseball', 8000),
    card('1954 Topps #128 Hank Aaron - PSA VG 3', 'baseball', 7000),
    card('1955 Topps #47 Hank Aaron - PSA EX 5', 'baseball', 6000),
    card('1951 Bowman #253 Mickey Mantle - PSA PR 1', 'baseball', 9500),
    card('1986 Fleer #57 Michael Jordan - PSA 8', 'basketball', 5000),
    card('1997 Topps Chrome #123 Kobe Bryant - PSA 9', 'basketball', 4000),
  ];
  const byId = new Map(room.map(l => [l.id, l]));
  // what this device already knew when the page opened: a long read, a
  // "More like this", a "Not for me"
  recordSignal('lot', room[3].id, { lot: room[3] }, kv, NOW - 2 * DAY);
  recordDwell('lot', room[3].id, 30_000, kv, NOW - 2 * DAY);
  markLot('more', room[5], kv, NOW - DAY);
  markLot('less', room[6], kv, NOW - DAY);
  startPage(kv);
  const ids = () => {
    const st = readSignals(kv, NOW, { view: true });
    const { extra, negative } = signalsToTaste(st, NOW, id => byId.get(id));
    const t = buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-1) }], follows: [], extra, negative, nowMs: NOW });
    return { st, ids: recommend(room, t, { nowMs: NOW }).map(r => r.lot.id) };
  };
  const before = ids();
  // the reader opens a lower pick (comps modal) and reads it 25s — quiet
  recordSignal('comps', room[4].id, { lot: room[4] }, kv, NOW + 1000);
  recordDwell('comps', room[4].id, 25_000, kv, NOW + 26_000);
  // …then passes on another pick, and takes it back
  const prev = markLot('less', room[1], kv, NOW + 30_000);
  assert.ok(!ids().ids.includes(room[1].id), 'the passed pick leaves the room');
  unmarkLot(room[1].id, prev, kv, NOW + 32_000);
  const after = ids();
  assert.deepEqual(after.ids, before.ids, 'same picks, same order');
  { // without the page's view the open would re-rank the room (the bug)
    const { extra, negative } = signalsToTaste(readSignals(kv, NOW), NOW, id => byId.get(id));
    const t = buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-1) }], follows: [], extra, negative, nowMs: NOW });
    assert.notDeepEqual(recommend(room, t, { nowMs: NOW }).map(r => r.lot.id), before.ids);
  }
  assert.deepEqual(after.st, before.st, 'same opens, dwell and marks');
  // the same with a mark replaced (More like this → Not for me → Undo)
  const p2 = markLot('less', room[5], kv, NOW + 40_000);
  assert.equal(p2?.k, 'more');
  unmarkLot(room[5].id, p2, kv, NOW + 41_000);
  assert.deepEqual(ids().st, before.st, 'the replaced mark is back in its seat');
  // the open is stored, and the next page reads it
  const raw = readSignals(kv, NOW + 50_000);
  const open = raw.ev.find(e => e.k === 'comps' && e.id === room[4].id);
  assert.equal(open?.dwell, 25_000);
  startPage(kv);
  assert.ok(readSignals(kv, NOW + 50_000, { view: true }).ev.some(e => e.k === 'comps' && e.id === room[4].id));
});

test('a repeat visit on this page reads as it stood before (n and dwell), the next page as it is now', () => {
  const kv = mem();
  const l = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  recordSignal('lot', l.id, { lot: l }, kv, NOW - DAY);
  startPage(kv);
  recordSignal('lot', l.id, { lot: l }, kv, NOW);
  recordDwell('lot', l.id, 40_000, kv, NOW);
  const v = readSignals(kv, NOW, { view: true }).ev[0];
  assert.equal(v.n, 1);
  assert.equal(v.dwell, undefined);
  assert.equal(v.t, NOW - DAY);
  const r = readSignals(kv, NOW).ev[0];
  assert.equal(r.n, 2);
  assert.equal(r.dwell, 40_000);
  clearSignals(kv);
  assert.equal(readSignals(kv, NOW, { view: true }).ev.length, 0);
});

test('quietKeysOf: a card lot quiets its player and its card in any grade', () => {
  const keys = quietKeysOf(card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000));
  assert.ok(keys.some(k => k.startsWith('pl:') || k.startsWith('sj:')), JSON.stringify(keys));
  assert.ok(keys.some(k => k.startsWith('card:')));
});

/* ── the recommender input ─────────────────────────────────────────────── */

test('a looked-at lot seeds picks with "Because you looked at …", weighed below a save', () => {
  const seen = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  const mantle = card('1956 Topps #135 Mickey Mantle - PSA EX 5', 'baseball', 9000);
  const kv = mem();
  recordSignal('comps', seen.id, { lot: seen }, kv, NOW);
  const { extra, negative } = signalsToTaste(readSignals(kv, NOW), NOW);
  const t = buildTaste({ saved: [], follows: [], extra, negative, nowMs: NOW });
  assert.equal(t.counts.signals, 1);
  assert.ok(t.seeds[0].w < SEED_WEIGHT.saved, 'an implicit view weighs below a save');
  const rs = recommend([seen, mantle], t, { nowMs: NOW });
  assert.equal(rs[0].lot.id, mantle.id);
  assert.match(rs[0].reason, /^Because you looked at 1952 Topps #311 Mickey Mantle/);
  assert.ok(!rs.some(r => r.reason.includes('your')), 'a view never speaks as "your" desk');
  // the viewed lot never explains itself
  assert.ok(!rs.some(r => r.lot.id === seen.id && /looked at 1952/.test(r.reason)));
});

test('a save already on the desk is not doubled by its view', () => {
  const seen = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  const t = buildTaste({ saved: [{ id: seen.id, lot: seen, savedAt: at(-1) }], follows: [], extra: [{ lot: seen, weight: 0.25, reason: 'looked at' }], nowMs: NOW });
  assert.equal(t.seeds.length, 1);
  assert.equal(t.seeds[0].kind, 'saved');
});

test('"More like this" outweighs a view and says so', () => {
  const a = card('1986 Fleer #57 Michael Jordan - PSA 8', 'basketball', 5000);
  const b = card('1980 Topps Larry Bird Magic Johnson - PSA 8', 'basketball', 5000);
  const jordan = card('1986 Fleer Sticker #8 Michael Jordan - PSA 8', 'basketball', 4000);
  const bird = card('1981 Topps #4 Larry Bird - PSA 8', 'basketball', 4000);
  const kv = mem();
  recordSignal('lot', b.id, { lot: b }, kv, NOW);
  markLot('more', a, kv, NOW);
  const { extra } = signalsToTaste(readSignals(kv, NOW), NOW);
  const t = buildTaste({ saved: [], follows: [], extra, nowMs: NOW });
  const rs = recommend([jordan, bird], t, { nowMs: NOW });
  assert.equal(rs[0].lot.id, jordan.id);
  assert.match(rs[0].reason, /^Because you asked for more like 1986 Fleer #57 Michael Jordan/);
});

test('"Not for me" bans the lot and quiets its player; its views stop seeding', () => {
  const seed = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  const m1 = card('1956 Topps #135 Mickey Mantle - PSA EX 5', 'baseball', 9000);
  const m2 = card('1957 Topps #95 Mickey Mantle - PSA EX 5', 'baseball', 9000);
  const kv = mem();
  recordSignal('lot', m1.id, { lot: m1 }, kv, NOW);
  const t0 = buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-1) }], follows: [], nowMs: NOW });
  const before = recommend([m1, m2], t0, { nowMs: NOW });
  assert.equal(before.length, 2);
  markLot('less', m1, kv, NOW);
  const { extra, negative } = signalsToTaste(readSignals(kv, NOW), NOW);
  assert.equal(extra.length, 0, 'a lot marked not for me no longer seeds from its view');
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-1) }], follows: [], extra, negative, nowMs: NOW });
  const rs = recommend([m1, m2], t, { nowMs: NOW });
  assert.deepEqual(rs.map(r => r.lot.id), [m2.id]);
  const ratio = rs[0].score / before.find(r => r.lot.id === m2.id)!.score;
  assert.ok(ratio < 0.65 && ratio > 0.5, `its player is quieted softly (×${ratio.toFixed(2)})`);
});

test('"Not for me" quiets the same card in another grade hard, and two passes on one name compound', () => {
  const seed = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  const passed = card('1956 Topps #135 Mickey Mantle - PSA EX 5', 'baseball', 9000);
  const twin = card('1956 Topps #135 Mickey Mantle - PSA VG 4', 'baseball', 7000, { auctionHouse: 'Heritage' });
  const other = card('1957 Topps #95 Mickey Mantle - PSA EX 5', 'baseball', 9000);
  const saved = [{ id: seed.id, lot: seed, savedAt: at(-1) }];
  const base = new Map(recommend([twin, other], buildTaste({ saved, follows: [], nowMs: NOW }), { nowMs: NOW }).map(r => [r.lot.id, r.score]));
  const kv = mem();
  markLot('less', passed, kv, NOW);
  const one = signalsToTaste(readSignals(kv, NOW), NOW);
  const rs1 = new Map(recommend([twin, other], buildTaste({ saved, follows: [], ...one, nowMs: NOW }), { nowMs: NOW }).map(r => [r.lot.id, r.score]));
  assert.ok(rs1.get(twin.id)! / base.get(twin.id)! < 0.25, 'the same card, any grade: card ×0.3 and player ×0.6');
  assert.ok(rs1.get(other.id)! / base.get(other.id)! > 0.5);
  markLot('less', card('1958 Topps #150 Mickey Mantle - PSA 4', 'baseball', 5000), kv, NOW);
  const two = signalsToTaste(readSignals(kv, NOW), NOW);
  const rs2 = new Map(recommend([twin, other], buildTaste({ saved, follows: [], ...two, nowMs: NOW }), { nowMs: NOW }).map(r => [r.lot.id, r.score]));
  assert.ok(rs2.get(other.id)! < rs1.get(other.id)! * 0.7, 'a second pass on the same player quiets it again');
});

test('an entity page visit and a search term each seed with their own words', () => {
  const kv = mem();
  recordSignal('entity', 'pl:mickey-mantle', { label: 'Mickey Mantle' }, kv, NOW);
  recordSignal('search', 'honus wagner', {}, kv, NOW);
  const { extra } = signalsToTaste(readSignals(kv, NOW), NOW);
  const fo = extra.find(x => x.follow);
  assert.deepEqual(fo?.follow, { kind: 'maker', key: 'mickey-mantle', label: 'Mickey Mantle' });
  assert.equal(fo?.weight, SIGNAL_WEIGHT.entity);
  const mantle = card('1956 Topps #135 Mickey Mantle - PSA EX 5', 'baseball', 9000, { playerSlug: 'mickey-mantle' });
  const wagner = card('1909 T206 Honus Wagner Reprint - PSA 5', 'baseball', 900);
  const t = buildTaste({ saved: [], follows: [], extra, nowMs: NOW });
  const rs = recommend([mantle, wagner], t, { nowMs: NOW });
  const by = new Map(rs.map(r => [r.lot.id, r.reason]));
  assert.equal(by.get(mantle.id), 'Because you looked at Mickey Mantle');
  assert.equal(by.get(wagner.id), 'Because you searched “honus wagner”');
  // a page you already follow is not counted twice
  const t2 = buildTaste({ saved: [], follows: [{ kind: 'maker', key: 'mickey-mantle', label: 'Mickey Mantle' }], extra, nowMs: NOW });
  assert.equal(t2.seeds.filter(s => s.follow?.key === 'mickey-mantle').length, 1);
});

test('no extra / negative → the recommender is unchanged', () => {
  const seed = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  const m1 = card('1956 Topps #135 Mickey Mantle - PSA EX 5', 'baseball', 9000);
  const a = recommend([m1], buildTaste({ saved: [{ id: seed.id, lot: seed }], follows: [], nowMs: NOW }), { nowMs: NOW });
  const b = recommend([m1], buildTaste({ saved: [{ id: seed.id, lot: seed }], follows: [], extra: [], negative: {}, nowMs: NOW }), { nowMs: NOW });
  assert.deepEqual(a.map(r => [r.lot.id, r.score, r.reason]), b.map(r => [r.lot.id, r.score, r.reason]));
});
