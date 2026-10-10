/**
 * Close times, stale-live and cross-house twins (Oct 9 r3):
 *  - app/lib/house-tz: the house zone, day ends, Christie's day stamps, RR's
 *    published 7 PM ET close, liveUntil by close kind
 *  - utils.isLiveUpcoming: live until the sale is over where it is held
 *  - priority.reasonOf: date-only says the day, never an hour
 *  - fold / shortlist / spread: the same card live at two houses is one thing
 * Every assertion is reader-zone independent (run under any TZ).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  houseTzOf, dayEndMs, isDayStamp, closeIsTimed, closeMs, liveUntilMs, scheduledClose, normalizeCloseStamp,
} from '../house-tz';
import { isLiveUpcoming, trueSaleDay } from '../../utils';
import { reasonOf, shortlist, spread } from '../priority';
import { foldVariants, crossNote, crossSibs } from '../fold';

const H = 3_600_000;
// Oct 9 2026, 4 PM ET
const NOW = Date.parse('2026-10-09T20:00:00Z');

test('house zones: single rooms, Phillips sale codes, sale-name locations, currency fallback', () => {
  assert.equal(houseTzOf({ auctionHouse: 'RR Auction' }), 'America/New_York');
  assert.equal(houseTzOf({ auctionHouse: 'Wright' }), 'America/Chicago');
  assert.equal(houseTzOf({ auctionHouse: 'Phillips', id: 'phillips-NY080426-12' }), 'America/New_York');
  assert.equal(houseTzOf({ auctionHouse: 'Phillips', id: 'phillips-HK010726-3' }), 'Asia/Hong_Kong');
  assert.equal(houseTzOf({ auctionHouse: 'Phillips', id: 'phillips-UK011126-135' }), 'Europe/London');
  assert.equal(houseTzOf({ auctionHouse: "Christie's", saleName: 'Paris Sale 24609' }), 'Europe/Paris');
  assert.equal(houseTzOf({ auctionHouse: 'Bonhams', currency: 'DKK' }), 'Europe/Copenhagen');
  // a US room is NY or LA: the later day end never hides a lot early
  assert.equal(houseTzOf({ auctionHouse: 'Bonhams', currency: 'USD' }), 'America/Los_Angeles');
});

test('day ends are read in the house zone, across DST', () => {
  assert.equal(dayEndMs('2026-10-09', 'America/New_York'), Date.parse('2026-10-10T03:59:59.999Z'));
  assert.equal(dayEndMs('2026-12-09', 'America/New_York'), Date.parse('2026-12-10T04:59:59.999Z'));
  assert.equal(dayEndMs('2026-10-09', 'Asia/Hong_Kong'), Date.parse('2026-10-09T15:59:59.999Z'));
  assert.equal(dayEndMs('nope', 'UTC'), null);
});

test('Christie\'s local-midnight stamps are DAYS; genuine instants stay timed', () => {
  const ny = { auctionHouse: "Christie's", saleName: 'Prints And Multiples', saleDate: '2026-10-21', saleDateTime: '2026-10-21T04:00Z' };
  assert.equal(isDayStamp(ny), true);
  assert.equal(closeIsTimed(ny), false);
  assert.equal(trueSaleDay(ny), '2026-10-21'); // never the reader's Oct 20 evening
  const london = { auctionHouse: "Christie's", saleDate: '2026-10-15', saleDateTime: '2026-10-14T23:00Z' };
  assert.equal(trueSaleDay(london), '2026-10-15');
  const online = { auctionHouse: "Christie's", saleDateTime: '2026-10-23T17:17:00.000Z' };
  assert.equal(isDayStamp(online), false);
  assert.equal(closeIsTimed(online), true);
  // Sotheby's 7 PM EST evening sale arrives as 00:00Z — a real moment
  assert.equal(closeIsTimed({ auctionHouse: "Sotheby's", saleDateTime: '2026-11-19T00:00:00.000Z' }), true);
  // the client normalization drops the day stamp (no "12:00 AM" countdown)
  const n = normalizeCloseStamp({ ...ny });
  assert.equal(n.saleDateTime, undefined);
  assert.equal(n.saleDate, '2026-10-21');
});

test('RR Auction carries its published 7:00 PM ET close (EDT and EST)', () => {
  assert.equal(scheduledClose({ auctionHouse: 'RR Auction', saleDate: '2026-10-14' }), '2026-10-14T19:00:00-04:00');
  assert.equal(scheduledClose({ auctionHouse: 'RR Auction', saleDate: '2026-12-09' }), '2026-12-09T19:00:00-05:00');
  assert.equal(scheduledClose({ auctionHouse: 'Wright', saleDate: '2026-10-14' }), null);
  assert.equal(scheduledClose({ auctionHouse: 'RR Auction', saleDate: '2026-10-14', saleDateTime: '2026-10-14T20:30:00-04:00' }), null);
  const rr = normalizeCloseStamp({ auctionHouse: 'RR Auction', saleDate: '2026-10-14' as string, saleDateTime: null as string | null });
  assert.equal(closeMs(rr), Date.parse('2026-10-14T23:00:00Z'));
});

test('stale live: a date-only sale is live until its day ends where it is held', () => {
  const ph = { id: 'phillips-NY080426-12', auctionHouse: 'Phillips', status: 'upcoming', saleDate: '2026-10-09' };
  assert.equal(isLiveUpcoming(ph, '2026-10-09', 1, NOW), true);
  // a Hong Kong reader is already on Oct 10 — the New York sale day is not over
  assert.equal(isLiveUpcoming(ph, '2026-10-10', 1, NOW), true);
  // 00:30 ET Oct 10: over
  assert.equal(isLiveUpcoming(ph, '2026-10-10', 1, Date.parse('2026-10-10T04:30:00Z')), false);
  // a Hong Kong sale dated today ended at 16:00Z
  const hk = { ...ph, id: 'phillips-HK010726-3' };
  assert.equal(isLiveUpcoming(hk, '2026-10-09', 1, NOW), false);
});

test('stale live: timed closes by kind — online stagger, live session, extended bidding', () => {
  // Phillips online watches: lots began closing 10:00 ET
  const online = { id: 'phillips-NY080426-1', auctionHouse: 'Phillips', status: 'upcoming', saleDate: '2026-10-09', saleDateTime: '2026-10-09T10:00:00-04:00', closeKind: 'online' as const };
  assert.equal(isLiveUpcoming(online, '2026-10-09', 1, Date.parse('2026-10-09T15:30:00Z')), true);
  assert.equal(isLiveUpcoming(online, '2026-10-09', 1, NOW), false);
  assert.equal(liveUntilMs(online), Date.parse('2026-10-09T17:00:00Z'));
  // a live room that opened at 10:00 ET works through its lots all day
  const session = { ...online, closeKind: 'session' as const };
  assert.equal(isLiveUpcoming(session, '2026-10-09', 1, NOW), true);
  assert.equal(liveUntilMs(session), dayEndMs('2026-10-09', 'America/New_York'));
  // Goldin 10 PM ET close: extended bidding — live at 3 AM ET, gone by 7 AM ET
  const goldin = { auctionHouse: 'Goldin', status: 'upcoming', saleDate: '2026-10-08', saleDateTime: '2026-10-09T02:00:00Z' };
  assert.equal(isLiveUpcoming(goldin, '2026-10-09', 1, Date.parse('2026-10-09T07:00:00Z')), true);
  assert.equal(isLiveUpcoming(goldin, '2026-10-09', 1, Date.parse('2026-10-09T11:00:00Z')), false);
  // results pending keeps its grace window, untouched
  const rp = { auctionHouse: 'Bonhams', status: 'upcoming', saleDate: '2026-10-08', resultsPending: true };
  assert.equal(isLiveUpcoming(rp, '2026-10-09', 1, NOW), true);
  assert.equal(isLiveUpcoming(rp, '2026-10-10', 1, NOW), false);
});

test('reason line: a date-only sale names the day; RR names its scheduled close', () => {
  const t = new Date(NOW);
  const day = (d: number) => {
    const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const art = { artist: 'andy-warhol', auctionHouse: "Christie's", estimateLow: 200_000, estimateHigh: 300_000, saleDate: day(1), saleDateTime: `${day(1)}T04:00Z` };
  assert.match(reasonOf(art, NOW) || '', /^Sells tomorrow/);
  const rr = normalizeCloseStamp({ artist: 'autographs', auctionHouse: 'RR Auction', estimateLow: 5_000, estimateHigh: null as number | null, saleDate: '2026-10-09', saleDateTime: null as string | null });
  // 4 PM ET → the 7 PM ET close is 3h out
  assert.match(reasonOf(rr, NOW) || '', /^Closes in 3h/);
});

const card = (id: string, house: string, est: number, cross?: { id: string; house: string; bid: number }[], title = '1986 Fleer #57 Michael Jordan Rookie Card - PSA NM-MT 8') => ({
  id, title, artist: 'sports-cards', subCat: 'cards', drill: 'basketball', auctionHouse: house,
  estimateLow: est, estimateHigh: est, currentBid: 0, saleDateTime: new Date(NOW + 20 * H).toISOString(), status: 'upcoming', crossLive: cross,
});

test('crossLive: same-house entries are copies, never "also live at"', () => {
  const l = card('g1', 'Goldin', 4000, [{ id: 'g2', house: 'Goldin', bid: 900 }, { id: 'r1', house: 'REA', bid: 1200 }]);
  assert.deepEqual(crossSibs(l).map(s => s.id), ['r1']);
  assert.equal(crossNote(l), 'Also live at REA · $1.2K bid');
  assert.equal(crossNote(card('g3', 'Goldin', 4000, [{ id: 'g2', house: 'Goldin', bid: 900 }])), null);
  assert.equal(crossNote(l, [{ auctionHouse: 'REA', currentBid: 0 }]), 'Also live at REA · no bids yet');
});

test('crossLive: the pair folds to one card; the other venue rides the reason line', () => {
  const g = card('g1', 'Goldin', 4000, [{ id: 'r1', house: 'REA', bid: 1200 }]);
  const r = card('r1', 'REA', 3000, [{ id: 'g1', house: 'Goldin', bid: 0 }], '1986 Fleer Michael Jordan #57 RC PSA 8');
  const other = card('x1', 'Heritage', 3000, undefined, '1986 Fleer #57 Michael Jordan Rookie Card - PSA NM-MT 8');
  const f = foldVariants([g, r, other], NOW);
  assert.deepEqual(f.reps.map(l => l.id), ['g1', 'x1']); // Heritage copy, unmatched, stands alone
  assert.deepEqual(f.group.get('g1')!.members.map(l => l.id), ['g1', 'r1']);
  assert.equal(f.group.get('r1'), f.group.get('g1'));
});

test('crossLive: one seat on the shortlist, and the twin follows in spread', () => {
  // identities that do NOT match on parse (different titles) — the crossLive link alone pairs them
  const a = { ...card('a', 'Goldin', 400_000, [{ id: 'b', house: 'REA', bid: 0 }]), title: 'Babe Ruth Game-Used Bat', artist: 'game-used', subCat: 'game-used' };
  const b = { ...card('b', 'REA', 390_000, [{ id: 'a', house: 'Goldin', bid: 0 }]), title: 'Circa 1927 Babe Ruth Bat PSA/DNA', artist: 'equipment-artifacts', subCat: 'game-used' };
  const seated = shortlist([a, b], NOW, 20).map(l => l.id);
  assert.equal(seated.length, 1);
  // spread: 3-per-window player cap would push a 4th same-sale lot down; the twin rides along free
  const s = (id: string) => ({ ...card(id, 'Goldin', 5000), title: `Lot ${id} unrelated memorabilia piece`, artist: 'autographs' });
  const list = [s('1'), s('2'), s('3'), a, b, s('4')];
  const out = spread(list, 12, 3).map(l => l.id);
  assert.equal(Math.abs(out.indexOf('b') - out.indexOf('a')), 1);
  assert.equal(out.length, list.length);
});
