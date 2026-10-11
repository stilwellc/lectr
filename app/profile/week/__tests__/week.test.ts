/**
 * YOUR WEEK (THE DESK v3) — the timeline's reads on fixtures, one clock.
 *
 *  1. The window: 14 local days from the reader's today; a close behind
 *     `now`, a sold row, or one off the block never prints; a later close
 *     is counted "beyond" and the first of them is named.
 *  2. The day a lot lands on: a timed close on the reader's calendar, a
 *     date-only sale on its house day (never an invented hour).
 *  3. Whose: watch > pick > name, once each; names are maker / player /
 *     subject follows and owned pieces' names — never a category or a house.
 *  4. Conflicts: two WATCHED timed closes inside 30 minutes from different
 *     sales, both sides marked; one sale's lots never collide; a pick does
 *     not make a conflict.
 *  5. Totals: Σ estimate midpoints over two-bounded rows; one-sided = unpriced.
 *  6. Closing now: watched closes inside 24h, the next one named.
 *  7. Words: countdown (minutes, never seconds), velocity, bids, day words.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { pinClock } from '../../../lib/__tests__/helpers/pin-clock';
import type { AuctionLot } from '../../../types';
import type { Follow } from '../../../lib/follows';
import {
  planWeek, closingNowOf, watchRows, markConflicts, localDayOf, addDays, dayKeysOf, dayOffsetOf, dayWords, offsetWord,
  countdownText, velocityText, bidsText, estMidOf, weekNamesOf, byClose,
  WEEK_DAYS, CONFLICT_MS, CLOSING_NOW_MS, type WeekRow,
} from '../week';

/** Sun Oct 11 2026, 4 PM ET */
const NOW_ISO = '2026-10-11T20:00:00Z';
pinClock(NOW_ISO);
const NOW = Date.parse(NOW_ISO);
const H = 3_600_000;

let seq = 0;
function lot(p: Partial<AuctionLot> & { closeMs?: number }): AuctionLot {
  const { closeMs, ...rest } = p;
  const id = rest.id ?? `lot-${++seq}`;
  const saleDateTime = closeMs != null ? new Date(closeMs).toISOString() : rest.saleDateTime;
  const saleDate = rest.saleDate ?? (saleDateTime ? saleDateTime.slice(0, 10) : '2026-10-14');
  return {
    id, artist: 'andy-warhol', title: `Work ${id}`, year: null, medium: null, dimensions: null, category: 'print',
    imageUrl: null, auctionHouse: "Christie's", saleName: 'New York Sale 1', lotNumber: 1,
    estimateLow: 10_000, estimateHigh: 20_000, currency: 'USD', hammerPrice: null, premiumPrice: null, priceUsd: null,
    status: 'upcoming', url: `https://www.christies.com/lot/${id}`,
    ...rest, saleDate, saleDateTime,
  } as AuctionLot;
}
const ids = (rows: readonly WeekRow[]) => rows.map(r => r.lot.id);
const plan = (o: Partial<Parameters<typeof planWeek>[0]>) => planWeek({
  now: NOW, saved: [], savedIds: new Set(o.saved?.map(l => l.id) ?? []), recs: [], book: [], follows: [], collection: [], ...o,
});

/* ── 1. the window ── */
test('the window is 14 local days from today; behind-now, sold, and later closes never print there', () => {
  const soon = lot({ id: 'soon', closeMs: NOW + 3 * 24 * H });
  const gone = lot({ id: 'gone', closeMs: NOW - 2 * H, saleDate: '2026-10-11' });
  const sold = lot({ id: 'sold', closeMs: NOW + 3 * 24 * H, status: 'sold' });
  const later = lot({ id: 'later', closeMs: NOW + 20 * 24 * H });
  const latest = lot({ id: 'latest', closeMs: NOW + 25 * 24 * H });
  const p = plan({ saved: [latest, later, sold, gone, soon] });
  assert.deepEqual(ids(p.rows), ['soon']);
  assert.equal(p.days.length, WEEK_DAYS);
  assert.deepEqual(p.dayKeys, dayKeysOf(NOW));
  assert.equal(p.dayKeys[0], localDayOf(NOW));
  assert.equal(p.beyond, 2, 'both later watches are counted beyond the window');
  assert.equal(p.nextBeyond?.lot.id, 'later', 'the first of them is named');
  assert.equal(p.first?.lot.id, 'soon');
  assert.equal(p.watches, 1); assert.equal(p.picks, 0); assert.equal(p.yours, 1);
  // every day is on the plan, empty ones included (gaps are gaps)
  const filled = p.days.filter(d => d.rows.length);
  assert.equal(filled.length, 1);
  assert.equal(filled[0].day, localDayOf(NOW + 3 * 24 * H));
  assert.equal(filled[0].offset, 3);
});

test('a lot on day 14 is in; the same clock time on day 15 is out (the window ends at the local midnight)', () => {
  const in14 = lot({ id: 'in14', closeMs: Date.parse(`${addDays(localDayOf(NOW), 13)}T12:00:00`) });
  const out15 = lot({ id: 'out15', closeMs: Date.parse(`${addDays(localDayOf(NOW), 14)}T00:30:00`) });
  const p = plan({ saved: [in14, out15] });
  assert.deepEqual(ids(p.rows), ['in14']);
  assert.equal(p.rows[0].day, p.dayKeys[13]);
  assert.equal(p.beyond, 1);
});

/* ── 2. the day a lot lands on ── */
test('a timed close lands on the reader’s local day of the instant; a date-only sale on its house day', () => {
  const timed = lot({ id: 't', closeMs: NOW + 50 * H });
  // Christie's Hong Kong, date-only: the sale DAY is the row's day whatever the reader's zone
  const hk = lot({ id: 'hk', saleDate: '2026-10-18', saleDateTime: undefined, saleName: 'Hong Kong Sale 2', currency: 'HKD', nativeCurrency: 'HKD' });
  const p = plan({ saved: [timed, hk] });
  const t = p.rows.find(r => r.lot.id === 't')!;
  const h = p.rows.find(r => r.lot.id === 'hk')!;
  assert.equal(t.timed, true);
  assert.equal(t.day, localDayOf(t.closeMs));
  assert.equal(h.timed, false, 'no close hour was published');
  assert.equal(h.day, '2026-10-18', 'the published sale day, not the reader-local day of its end');
  assert.ok(h.closeMs > NOW);
});

test('timed rows sort by close ahead of the day-only tail; a tie keeps watch before pick before name', () => {
  const mk = (id: string, kind: WeekRow['kind'], closeMs: number, timed: boolean): WeekRow =>
    ({ lot: lot({ id }), kind, name: null, owned: false, closeMs, timed, day: 'x', estMid: null, conflictWith: [] });
  const rows = [mk('d', 'watch', NOW + 30 * H, false), mk('b', 'name', NOW + 2 * H, true), mk('a', 'watch', NOW + 2 * H, true), mk('c', 'pick', NOW + 5 * H, true)];
  rows.sort(byClose);
  assert.deepEqual(ids(rows), ['a', 'b', 'c', 'd']);
});

/* ── 3. whose ── */
test('watch > pick > name, once each; names come from maker / subject follows and owned pieces, never a category or a house', () => {
  const watched = lot({ id: 'w', closeMs: NOW + 24 * H });
  const picked = lot({ id: 'p', closeMs: NOW + 26 * H, artist: 'pablo-picasso' });
  const warhol = lot({ id: 'n1', closeMs: NOW + 48 * H, artist: 'andy-warhol', ek: 'mk:andy-warhol' } as Partial<AuctionLot>);
  const kaws = lot({ id: 'n2', closeMs: NOW + 49 * H, artist: 'kaws', ek: 'mk:kaws' } as Partial<AuctionLot>);
  const phillips = lot({ id: 'h', closeMs: NOW + 50 * H, artist: 'someone-else', auctionHouse: 'Phillips', ek: 'mk:someone-else' } as Partial<AuctionLot>);
  const owned = lot({ id: 'own', status: 'sold', artist: 'kaws', ek: 'mk:kaws', priceUsd: 5000 } as Partial<AuctionLot>);
  const follows: Follow[] = [
    { kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' },
    { kind: 'house', key: 'Phillips', label: 'Phillips' },
    { kind: 'cat', key: 'watches', label: 'Watches' },
  ];
  const p = plan({ saved: [watched], recs: [{ lot: watched }, { lot: picked }], book: [watched, picked, warhol, kaws, phillips], follows, collection: [owned] });
  const kinds = Object.fromEntries(p.rows.map(r => [r.lot.id, r.kind]));
  assert.deepEqual(kinds, { w: 'watch', p: 'pick', n1: 'name', n2: 'name' });
  assert.equal(p.rows.filter(r => r.lot.id === 'w').length, 1, 'a watched pick prints once, as a watch');
  const n1 = p.rows.find(r => r.lot.id === 'n1')!;
  const n2 = p.rows.find(r => r.lot.id === 'n2')!;
  assert.equal(n1.name, 'Andy Warhol'); assert.equal(n1.owned, false);
  assert.equal(n2.name, 'KAWS'); assert.equal(n2.owned, true, 'an owned piece’s maker is a name you own');
  assert.ok(!kinds.h, 'a house follow pours no house onto the week');
  assert.equal(p.nameRows, 2); assert.equal(p.yours, 2);
  assert.deepEqual(p.names.sort(), ['Andy Warhol', 'KAWS']);
  // the roster itself
  const names = weekNamesOf(follows, [owned]);
  assert.deepEqual(names.map(n => n.label).sort(), ['Andy Warhol', 'KAWS']);
});

/* ── 4. conflicts ── */
test('two watched timed closes inside 30 minutes from different sales are marked on both sides; one sale never collides; a pick makes none', () => {
  const a = lot({ id: 'a', closeMs: NOW + 24 * H, auctionHouse: 'RR Auction', saleName: 'RR 751' });
  const b = lot({ id: 'b', closeMs: NOW + 24 * H + 20 * 60_000, auctionHouse: 'Goldin', saleName: 'Goldin Oct' });
  const c = lot({ id: 'c', closeMs: NOW + 24 * H + 25 * 60_000, auctionHouse: 'RR Auction', saleName: 'RR 751' });
  const far = lot({ id: 'far', closeMs: NOW + 24 * H + CONFLICT_MS + 31 * 60_000, auctionHouse: "Sotheby's" });
  const pick = lot({ id: 'pk', closeMs: NOW + 24 * H + 10 * 60_000, auctionHouse: 'Bonhams' });
  const p = plan({ saved: [a, b, c, far], recs: [{ lot: pick }] });
  const by = Object.fromEntries(p.rows.map(r => [r.lot.id, r.conflictWith.slice().sort()]));
  assert.deepEqual(by.a, ['b']);
  assert.deepEqual(by.b, ['a', 'c'], 'Goldin at :20 collides with both RR closes');
  assert.deepEqual(by.c, ['b'], 'the two RR lots are one sale — not each other’s conflict');
  assert.deepEqual(by.far, [], 'past 30 minutes from every other watch is no conflict');
  assert.deepEqual(by.pk, [], 'a pick is not yet yours to collide');
  assert.equal(p.conflicts, 2, 'two pairs');
  const day = p.days.find(d => d.rows.length)!;
  assert.equal(day.conflicts, 2, 'the day counts its pairs');
  // date-only watches have no hour to collide on
  const d1 = lot({ id: 'd1', saleDate: '2026-10-15', saleDateTime: undefined });
  const d2 = lot({ id: 'd2', saleDate: '2026-10-15', saleDateTime: undefined, auctionHouse: 'Wright' });
  const rows = watchRows([d1, d2], NOW);
  assert.equal(markConflicts(rows), 0);
});

/* ── 5. totals ── */
test('a day sums estimate midpoints over two-bounded rows; a one-sided estimate is unpriced', () => {
  // 6–8 PM ET on Oct 12 — one local day in every US zone
  const both = lot({ id: 'both', closeMs: NOW + 26 * H, estimateLow: 10_000, estimateHigh: 20_000 });
  const oneSided = lot({ id: 'one', closeMs: NOW + 27 * H, estimateLow: 2_000, estimateHigh: null, auctionHouse: 'RR Auction' });
  const usd = lot({ id: 'usd', closeMs: NOW + 27.5 * H, estimateLow: 1, estimateHigh: 1, estLowUsd: 40_000, estHighUsd: 60_000 } as Partial<AuctionLot>);
  const p = plan({ saved: [both, oneSided, usd] });
  const day = p.days.find(d => d.rows.length)!;
  assert.equal(day.rows.length, 3);
  assert.equal(day.priced, 2);
  assert.equal(day.estTotal, 15_000 + 50_000, 'USD bounds win over the native aliases');
  assert.equal(p.estTotal, 65_000); assert.equal(p.priced, 2);
  assert.equal(estMidOf(oneSided), null);
  // a name's sale is never counted as your money
  const warhol = lot({ id: 'n', closeMs: NOW + 26 * H, estimateLow: 1_000_000, estimateHigh: 2_000_000, ek: 'mk:andy-warhol' } as Partial<AuctionLot>);
  const q = plan({ saved: [both], book: [warhol], follows: [{ kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' }] });
  assert.equal(q.rows.length, 2);
  assert.equal(q.estTotal, 15_000); assert.equal(q.priced, 1);
  assert.equal(q.days.find(d => d.rows.length)!.estTotal, 15_000);
  // a bare midnight-UTC stamp is a DAY marker (house-tz isDayStamp), so that
  // lot is date-only and sits on its sale day, not on a 7 PM/8 PM evening
  const midnightZ = lot({ id: 'mz', saleDateTime: '2026-10-13T00:00:00.000Z', saleDate: '2026-10-13' });
  const z = plan({ saved: [midnightZ] });
  assert.equal(z.rows[0].timed, false);
  assert.equal(z.rows[0].day, '2026-10-13');
});

/* ── 6. closing now ── */
test('closing now: watched closes inside 24 hours, soonest first; the next one after is named', () => {
  const in2 = lot({ id: 'in2', closeMs: NOW + 2 * H });
  const in23 = lot({ id: 'in23', closeMs: NOW + 23 * H });
  const in30 = lot({ id: 'in30', closeMs: NOW + 30 * H });
  const in40 = lot({ id: 'in40', closeMs: NOW + 40 * H });
  const r = closingNowOf([in40, in30, in23, in2], NOW);
  assert.deepEqual(ids(r.rows), ['in2', 'in23']);
  assert.equal(r.next?.lot.id, 'in30');
  assert.equal(r.live, 4);
  assert.ok(r.rows.every(x => x.closeMs - NOW <= CLOSING_NOW_MS));
  // a date-only sale whose house day ends inside 24h is a closer too, as "day only"
  const todayNY = lot({ id: 'day', saleDate: localDayOf(NOW), saleDateTime: undefined, saleName: 'New York Sale 9' });
  const r2 = closingNowOf([todayNY], NOW);
  assert.equal(r2.rows.length, 1);
  assert.equal(r2.rows[0].timed, false);
  const none = closingNowOf([], NOW);
  assert.equal(none.live, 0); assert.equal(none.rows.length, 0); assert.equal(none.next, null);
});

/* ── 7. words ── */
test('countdown prints minutes never seconds; velocity and bids only where measured; day words', () => {
  assert.equal(countdownText(NOW + 3 * H + 10 * 60_000 + 59_000, NOW), 'in 3h 10m');
  assert.equal(countdownText(NOW + 12 * 60_000, NOW), 'in 12m');
  assert.equal(countdownText(NOW - 1, NOW), 'closing now');
  assert.equal(countdownText(NOW + 3 * 24 * H, NOW), 'in 3 days');
  assert.equal(velocityText(lot({ bidVelocity: { delta: 3, hours: 24, pctile: 62 } } as Partial<AuctionLot>)), '+3 bids · 24h');
  assert.equal(velocityText(lot({ bidVelocity: { delta: 1, hours: 71.6, pctile: null } } as Partial<AuctionLot>)), '+1 bid · 72h');
  assert.equal(velocityText(lot({ bidVelocity: { delta: 0, hours: 24, pctile: 1 } } as Partial<AuctionLot>)), null, 'no bids added is no velocity line');
  assert.equal(velocityText(lot({})), null);
  assert.equal(bidsText(lot({ bidCount: 15 })), '15 bids');
  assert.equal(bidsText(lot({ bidCount: 1 })), '1 bid');
  assert.equal(bidsText(lot({ bidCount: 0 })), null);
  assert.deepEqual(dayWords('2026-10-11'), { wd: 'Sun', md: 'Oct 11', dayNum: 11 });
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(offsetWord(0), 'today'); assert.equal(offsetWord(1), 'tomorrow'); assert.equal(offsetWord(2), null);
  assert.equal(dayOffsetOf(addDays(localDayOf(NOW), 5), NOW), 5);
});
