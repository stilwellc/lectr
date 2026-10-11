/**
 * The pick track record (app/lib/pick-log, N4): the on-device log is
 * validated, capped and aged; a pass logs only open lots and keeps first-shown
 * + best rank; outcomes resolve from the book row, else the sold ledger,
 * through id aliases; provisional / bought-in / unresolved never enter a
 * median; the summary is windowed and n-gated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../types';
import {
  readPicks, logPicks, notePickAction, clearPicks, resolvePick, resolvePicks, needsLedger, summarizeOutcomes,
  reasonKindOf, PICKS_KEY, PICKS_VERSION, MAX_PICKS, PICK_MAX_AGE_DAYS, OUTCOME_MIN_N,
  type PickKV, type PickEntry,
} from '../pick-log';

const NOW = Date.parse('2026-10-11T16:00:00Z');
const DAY = 864e5;
const iso = (days: number) => new Date(NOW + days * DAY).toISOString();

function mem(init?: Record<string, string>): PickKV & { m: Map<string, string> } {
  const m = new Map<string, string>(Object.entries(init ?? {}));
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
}

let seq = 0;
function lot(o: Partial<AuctionLot> = {}): AuctionLot {
  return {
    id: `g-${++seq}`, artist: 'sports-cards', title: '1986 Fleer #57 Michael Jordan PSA 8', auctionHouse: 'Goldin',
    saleName: 'Weekly', saleDate: iso(2).slice(0, 10), saleDateTime: iso(2), currency: 'USD', status: 'upcoming',
    estimateLow: null, estimateHigh: null, currentBid: 400,
    ...o,
  } as unknown as AuctionLot;
}
/** an engine value the way the build stamps it (verdict reads these) */
const valued = (exp: number, allIn: number, lo: number, hi: number) => ({
  value: { expectedHammerUsd: exp, compValueUsd: allIn, bandLowUsd: lo, bandHighUsd: hi, confidence: 'high', n: 8, basis: 'card-comp' },
}) as unknown as Partial<AuctionLot>;

function entry(o: Partial<PickEntry> = {}): PickEntry {
  return {
    id: `p-${++seq}`, t0: NOW - 5 * DAY, t: NOW - 4 * DAY, d: 1, r: 1, s: 'p', k: 'follow',
    lot: { title: 'Lot', artist: 'x', auctionHouse: 'Goldin', saleDate: iso(-2).slice(0, 10), saleDateTime: iso(-2) },
    v: { h: 800, a: 1000, lo: 600, hi: 1100, c: 'high' }, est: [800, 1200],
    ...o,
  };
}

test('read: malformed entries are dropped field by field, never the log', () => {
  const kv = mem({
    [PICKS_KEY]: JSON.stringify({
      v: PICKS_VERSION, picks: [
        entry({ id: 'ok' }),
        { id: 'no-lot', t: NOW },
        { ...entry({ id: 'bad-value' }), v: { h: 'x' } },
        { ...entry({ id: 'bad-est' }), est: [900, 100] },
        { ...entry({ id: 'too-old' }), t: NOW - (PICK_MAX_AGE_DAYS + 1) * DAY },
        { ...entry({ id: 'future' }), t: NOW + 10 * DAY },
        entry({ id: 'ok' }), // duplicate id
        null, 7, 'x',
      ],
    }),
  });
  const st = readPicks(kv, NOW);
  assert.deepEqual(st.picks.map(p => p.id), ['ok', 'bad-value', 'bad-est']);
  assert.equal(st.picks[1].v, null, 'a bad value reads as "no value", not a wrong one');
  assert.equal(st.picks[2].est, undefined);
});

test('read: corrupted JSON, a foreign version, no storage → an empty log', () => {
  assert.deepEqual(readPicks(mem({ [PICKS_KEY]: '{oops' }), NOW).picks, []);
  assert.deepEqual(readPicks(mem({ [PICKS_KEY]: JSON.stringify({ v: 99, picks: [entry()] }) }), NOW).picks, []);
  assert.deepEqual(readPicks(null, NOW).picks, []);
  const throwing: PickKV = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('x'); }, removeItem: () => {} };
  assert.deepEqual(readPicks(throwing, NOW).picks, []);
  assert.equal(logPicks([{ lot: lot() }], 'p', throwing, NOW), 1, 'a refused write never throws');
});

test('log: capped at MAX_PICKS, the oldest-shown fall off first', () => {
  const kv = mem();
  const lots = Array.from({ length: MAX_PICKS + 40 }, () => lot());
  for (let i = 0; i < lots.length; i += 20) logPicks(lots.slice(i, i + 20).map(l => ({ lot: l })), 'h', kv, NOW - (lots.length - i) * 60_000);
  const st = readPicks(kv, NOW);
  assert.equal(st.picks.length, MAX_PICKS);
  assert.ok(!st.picks.some(p => p.id === lots[0].id), 'the first-shown dropped');
  assert.ok(st.picks.some(p => p.id === lots[lots.length - 1].id));
});

test('log: a re-shown pick keeps its first-shown time and best rank, counts days, refreshes what lectr said', () => {
  const kv = mem();
  const a = lot(valued(500, 620, 400, 700));
  const b = lot();
  logPicks([{ lot: b }, { lot: a }], 'p', kv, NOW - 2 * DAY);
  logPicks([{ lot: a }], 'p', kv, NOW - 2 * DAY + 3600_000); // same day
  const a2 = { ...a, value: { ...(a.value as object), compValueUsd: 700 } } as AuctionLot;
  logPicks([{ lot: b }, { lot: a2 }], 'h', kv, NOW - DAY);
  const p = readPicks(kv, NOW).picks.find(x => x.id === a.id)!;
  assert.equal(p.t0, NOW - 2 * DAY);
  assert.equal(p.t, NOW - DAY);
  assert.equal(p.r, 1, 'best rank kept');
  assert.equal(p.d, 2, 'two distinct days');
  assert.equal(p.s, 'p', 'first surface kept');
  assert.equal(p.v?.a, 700, 'the last read before close');
  assert.equal(p.v?.h, 500);
  assert.equal(p.bid, 400);
});

test('log: only open, upcoming lots; non-USD figures are never logged as dollars', () => {
  const kv = mem();
  const closed = lot({ saleDate: iso(-1).slice(0, 10), saleDateTime: iso(-1) });
  const sold = lot({ status: 'sold' } as Partial<AuctionLot>);
  const gbp = lot({ currency: 'GBP', currentBid: 900, estimateLow: 1000, estimateHigh: 2000 } as Partial<AuctionLot>);
  assert.equal(logPicks([{ lot: closed }, { lot: sold }, { lot: gbp }], 'p', kv, NOW), 1);
  const p = readPicks(kv, NOW).picks[0];
  assert.equal(p.id, gbp.id);
  assert.equal(p.bid, undefined);
  assert.equal(p.est, undefined);
  assert.equal(p.v, null, 'no engine value → null, never a stand-in');
});

test('actions: opened / More like this / Not for me stamp a logged pick; an unlogged lot is ignored', () => {
  const kv = mem();
  const a = lot();
  logPicks([{ lot: a }], 'p', kv, NOW);
  notePickAction(a.id, 'o', true, kv, NOW);
  notePickAction(a.id, 'x', true, kv, NOW);
  notePickAction('never-shown', 'o', true, kv, NOW);
  let p = readPicks(kv, NOW).picks;
  assert.equal(p.length, 1);
  assert.equal(p[0].o, 1);
  assert.equal(p[0].x, 1);
  notePickAction(a.id, 'x', false, kv, NOW);
  p = readPicks(kv, NOW).picks;
  assert.equal(p[0].x, undefined);
  clearPicks(kv);
  assert.equal(readPicks(kv, NOW).picks.length, 0);
});

test('reason kind: the seed kind, a fallback rung reads kin', () => {
  assert.equal(reasonKindOf({ seed: { kind: 'saved', w: 1, label: 'x' }, tier: 1 }), 'saved');
  assert.equal(reasonKindOf({ seed: { kind: 'follow', w: 1, label: 'x' }, tier: 3 }), 'kin');
  assert.equal(reasonKindOf({ seed: { kind: 'signal', w: 1, label: 'x' } }), 'signal');
});

test('outcome: the ledger price vs the lectr value (all-in vs all-in) and vs the estimate midpoint', () => {
  const p = entry();
  const o = resolvePick(p, { hit: [1250, iso(-2).slice(0, 10)] }, NOW);
  assert.equal(o.state, 'sold');
  assert.equal(o.price, 1250);
  assert.equal(Math.round(o.vsValue!), 25);
  assert.equal(Math.round(o.vsEst!), 25);
  // Goldin's premium is stripped before the hammer-basis range: 1250 all-in
  // is ~1000-1050 hammer, inside 600–1100
  assert.equal(o.inRange, true);
  const hi = resolvePick(p, { hit: [3000, iso(-2).slice(0, 10)] }, NOW);
  assert.equal(hi.inRange, false);
  const nov = resolvePick(entry({ v: null, est: undefined }), { hit: [500, '2026-10-09'] }, NOW);
  assert.equal(nov.vsValue, null);
  assert.equal(nov.vsEst, null);
  assert.equal(nov.inRange, null);
});

test('outcome: the book row wins; provisional = settling; bought in = unsold; closed with nothing = pending', () => {
  const p = entry();
  const row = resolvePick(p, { row: { id: p.id, status: 'sold', priceUsd: 900, saleDate: '2026-10-09' }, hit: [5000, '2026-10-09'] }, NOW);
  assert.equal(row.price, 900);
  assert.equal(resolvePick(p, { hit: [900, '2026-10-09', 1] }, NOW).state, 'settling');
  assert.equal(resolvePick(p, { row: { id: p.id, status: 'sold', priceUsd: 900, priceBasis: 'last-tracked-bid' } }, NOW).state, 'settling');
  const bi = resolvePick(p, { row: { id: p.id, status: 'bought_in' } }, NOW);
  assert.equal(bi.state, 'unsold');
  assert.equal(bi.why, 'bought_in');
  assert.equal(resolvePick(p, {}, NOW).state, 'pending');
  const future = entry({ lot: { title: 'x', artist: '', saleDate: iso(3).slice(0, 10), saleDateTime: iso(3) } });
  assert.equal(resolvePick(future, {}, NOW).state, 'open');
});

test('outcomes walk id aliases (the ledger keys canonical ids) and read saved / won', () => {
  const p = entry({ id: 'wright-123~' });
  const [o] = resolvePicks([p], {
    hitOf: id => (id === 'rago-123' ? [1000, '2026-10-09'] : null),
    isSaved: id => id === 'wright-123',
    isOwned: () => false,
  }, NOW);
  assert.equal(o.state, 'sold');
  assert.equal(o.saved, true);
  assert.equal(o.won, false);
  const [w] = resolvePicks([entry()], { hitOf: () => [1, '2026-10-09'], isOwned: () => true }, NOW);
  assert.equal(w.won, true);
  assert.equal(w.saved, true, 'a won pick counts as saved');
});

test('needsLedger: only when a closed pick has no resolved row', () => {
  const closed = entry();
  const open = entry({ lot: { title: 'x', artist: '', saleDate: iso(3).slice(0, 10), saleDateTime: iso(3) } });
  assert.equal(needsLedger([open], () => null, NOW), false);
  assert.equal(needsLedger([open, closed], () => null, NOW), true);
  assert.equal(needsLedger([closed], id => ({ id, status: 'sold', priceUsd: 5 }), NOW), false);
  assert.equal(needsLedger([closed], id => ({ id, status: 'upcoming' }), NOW), true);
});

test('summary: windowed, medians n-gated, only final sold prices count', () => {
  const sold = (vs: number, o: Partial<PickEntry> = {}, date = '2026-10-08') =>
    resolvePick(entry(o), { hit: [1000 * (1 + vs / 100), date] }, NOW);
  const four = [sold(-20), sold(10), sold(30), sold(0, { v: null })];
  let s = summarizeOutcomes(four, NOW);
  assert.equal(s.n, 4);
  assert.equal(s.nValue, 3);
  assert.equal(s.medVsValue, null, `under ${OUTCOME_MIN_N} with a value, no median`);
  assert.equal(s.inRange, null);
  const outs = [
    ...four, sold(-40), sold(50),
    resolvePick(entry(), { hit: [9999, '2026-10-09', 1] }, NOW), // settling
    resolvePick(entry(), { row: { id: 'x', status: 'bought_in' } }, NOW),
    resolvePick(entry(), {}, NOW), // pending
    sold(500, {}, '2026-08-01'), // outside the 30-day window
  ];
  s = summarizeOutcomes(outs, NOW);
  assert.equal(s.n, 6);
  assert.equal(s.nValue, 5);
  assert.equal(Math.round(s.medVsValue!), 10, 'median of −40, −20, 10, 30, 50');
  assert.equal(s.nEst, 6);
  assert.equal(s.pending, 2, 'settling + no result');
  assert.equal(s.unsold, 1);
  assert.ok(s.inRange != null && s.inRange <= s.nValue);
  const withSaves = summarizeOutcomes([
    resolvePick(entry(), { hit: [1000, '2026-10-08'], saved: true }, NOW),
    resolvePick(entry(), { hit: [1000, '2026-10-08'], won: true }, NOW),
    resolvePick(entry(), { hit: [1000, '2026-10-08'] }, NOW),
  ], NOW);
  assert.equal(withSaves.saved, 2);
  assert.equal(withSaves.won, 1);
});
