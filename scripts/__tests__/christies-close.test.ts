/**
 * Christie's onlineonly close times (scripts/lib/houses/christies-close).
 * Fixture: a trimmed live onlineonly lot page (24498 lot 339, fetched Oct 10
 * 2026) — the lot's own object, its sale block (whose end_date is the sale's
 * first close, NOT this lot's), and three neighbours with their own closes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import type { AuctionLot } from '../../app/types';
import {
  christiesOnlineKey, christiesOnlineTargets, enrichChristiesCloseTimes,
  isChristiesOnlineUrl, parseChristiesOnlineClose, stampChristiesOnlineClose,
} from '../lib/houses/christies-close';
import { closeIsTimed, liveUntilMs, ONLINE_SLACK_MS } from '../../app/lib/house-tz';

const FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'christies-onlineonly-24498-339.html'), 'utf8');
const SSO = 'https://onlineonly.christies.com/sso?ObjectID=24498.339&LotNumber=339';
const FINAL = 'https://onlineonly.christies.com/s/photographs/andy-warhol-1928-1987-339/326588';
const NOW = Date.parse('2026-10-10T12:00:00Z');

type L = AuctionLot & { saleDateTime?: string | null; closeKind?: 'online' | 'session' | null; resultsPending?: boolean };
const lot = (over: Partial<L> = {}): L => ({
  id: 'christies-24498.339', artist: 'andy-warhol', title: 'Nude Model (Male), 1977', year: null, medium: null,
  dimensions: null, category: 'photograph', imageUrl: null, auctionHouse: "Christie's", saleName: 'New York Sale 24498',
  saleDate: '2026-10-23', lotNumber: 339, currency: 'USD', estimateLow: 6000, estimateHigh: 8000,
  status: 'upcoming', url: SSO, ...over,
} as L);

const resp = (body: string, init: { status?: number; url?: string } = {}) => {
  const r = new Response(body, { status: init.status ?? 200 });
  Object.defineProperty(r, 'url', { value: init.url ?? FINAL });
  return r;
};

test('keys: SSO ObjectID/LotNumber and the post-302 /s/ object id', () => {
  assert.deepEqual(christiesOnlineKey(SSO, FINAL), { analyticsId: '24498.339', lotNumber: '339', objectId: '326588' });
  assert.deepEqual(christiesOnlineKey(FINAL), { objectId: '326588' });
  assert.deepEqual(christiesOnlineKey('not a url'), {});
  assert.equal(isChristiesOnlineUrl(SSO), true);
  assert.equal(isChristiesOnlineUrl('https://www.christies.com/en/lot/lot-6610264'), false);
  assert.equal(isChristiesOnlineUrl(null), false);
});

test('parse: THIS lot\'s end_date — not the sale block\'s, not a neighbour\'s', () => {
  const k = christiesOnlineKey(SSO, FINAL);
  assert.equal(parseChristiesOnlineClose(FIX, k), '2026-10-23T17:17:00.000Z');
  // keyed by object id alone (an /s/ url with no SSO query)
  assert.equal(parseChristiesOnlineClose(FIX, { objectId: '326588' }), '2026-10-23T17:17:00.000Z');
  // a neighbour on the same page reads its own staggered close
  assert.equal(parseChristiesOnlineClose(FIX, { analyticsId: '24498.341' }), '2026-10-23T17:19:00.000Z');
  // the sale block's end_date (11:00Z) is never returned
  assert.ok(FIX.includes('"end_date":"2026-10-23T11:00:00.000Z"'));
  // a lot not on the page → nothing (fail closed), never the first end_date
  assert.equal(parseChristiesOnlineClose(FIX, { analyticsId: '24498.999' }), null);
  assert.equal(parseChristiesOnlineClose(FIX, {}), null);
});

test('parse: lot-number fallback only when unique; junk pages and stamps fail closed', () => {
  assert.equal(parseChristiesOnlineClose(FIX, { lotNumber: '339' }), '2026-10-23T17:17:00.000Z');
  // the www sale-day stamp shape and garbage are not close times
  const page = (end: string) => `<script>window.chrComponents = {"lots":{"data":{"lots":[{"analytics_id":"1.1","object_id":"9","lot_id_txt":"1","end_date":${JSON.stringify(end)}}]}}};</script>`;
  assert.equal(parseChristiesOnlineClose(page('2026-10-23'), { analyticsId: '1.1' }), null);
  assert.equal(parseChristiesOnlineClose(page('soon'), { analyticsId: '1.1' }), null);
  assert.equal(parseChristiesOnlineClose(page('2026-10-23T17:17Z'), { analyticsId: '1.1' }), '2026-10-23T17:17:00.000Z');
  // the same lot twice with two different closes is ambiguous
  const twice = `<script>window.chrComponents = {"a":{"analytics_id":"1.1","end_date":"2026-10-23T17:17:00Z"},"b":{"analytics_id":"1.1","end_date":"2026-10-24T17:17:00Z"}};</script>`;
  assert.equal(parseChristiesOnlineClose(twice, { analyticsId: '1.1' }), null);
  // no chrComponents / unbalanced / not JSON
  assert.equal(parseChristiesOnlineClose('<html>blocked</html>', { analyticsId: '24498.339' }), null);
  assert.equal(parseChristiesOnlineClose('<script>window.chrComponents = {"lots": [</script>', { analyticsId: '24498.339' }), null);
});

test('stamp: full ISO + closeKind online + sale-local day; house-tz reads a 3h online stagger', () => {
  const l = lot({ saleDate: '2026-10-10', resultsPending: true });
  assert.equal(stampChristiesOnlineClose(l, '2026-10-23T17:17:00.000Z', NOW), false);
  assert.equal(l.saleDateTime, '2026-10-23T17:17:00.000Z');
  assert.equal(l.closeKind, 'online');
  assert.equal(l.saleDate, '2026-10-23');
  assert.equal(l.status, 'upcoming');
  assert.equal(l.resultsPending, false);
  assert.equal(closeIsTimed(l), true);
  assert.equal(liveUntilMs(l), Date.parse('2026-10-23T17:17:00.000Z') + ONLINE_SLACK_MS);
  // a London close just after midnight UTC on a BST night is still the London day
  const ldn = lot({ saleName: 'London Sale 24595', currency: 'GBP' });
  stampChristiesOnlineClose(ldn, '2026-10-20T23:30:00.000Z', NOW);
  assert.equal(ldn.saleDate, '2026-10-21');
});

test('stamp: a future close revives a stale-www bought_in; a past close keeps status for the sanitize net', () => {
  const dead = lot({ status: 'bought_in' });
  assert.equal(stampChristiesOnlineClose(dead, '2026-10-23T17:17:00.000Z', NOW), true);
  assert.equal(dead.status, 'upcoming');
  // closed 2 days ago, unresulted → pending (inside the results window)
  const recent = lot({ resultsPending: false });
  stampChristiesOnlineClose(recent, '2026-10-08T17:00:00.000Z', NOW);
  assert.equal(recent.status, 'upcoming');
  assert.equal(recent.resultsPending, true);
  // closed a month ago: the real date replaces the now-anchor guess; the flag
  // drops so the net settles it instead of holding it forever
  const old = lot({ resultsPending: true });
  stampChristiesOnlineClose(old, '2026-09-10T17:00:00.000Z', NOW);
  assert.equal(old.resultsPending, false);
  // a past close never revives a closed lot
  const closed = lot({ status: 'bought_in' });
  assert.equal(stampChristiesOnlineClose(closed, '2026-10-01T17:00:00.000Z', NOW), false);
  assert.equal(closed.status, 'bought_in');
});

test('targets: non-sold onlineonly Christie\'s lots only, live first', () => {
  const ts = christiesOnlineTargets([
    lot({ id: 'a', status: 'bought_in' }),
    lot({ id: 'b' }),
    lot({ id: 'c', status: 'sold' }),
    lot({ id: 'd', url: 'https://www.christies.com/en/lot/lot-6610264' }),
    lot({ id: 'e', auctionHouse: "Sotheby's" }),
  ]);
  assert.deepEqual(ts.map(l => l.id), ['b', 'a']);
});

test('enrich: dates reachable lots; unreachable / non-200 / undated lots keep date + status', async () => {
  const ok = lot({ id: 'ok', saleDate: '2026-10-10', resultsPending: true });
  const down = lot({ id: 'down', url: 'https://onlineonly.christies.com/sso?ObjectID=1.1&LotNumber=1', saleDate: '2026-10-11' });
  const blocked = lot({ id: 'blocked', url: 'https://onlineonly.christies.com/sso?ObjectID=1.2&LotNumber=2', saleDate: '2026-10-12' });
  const empty = lot({ id: 'empty', url: 'https://onlineonly.christies.com/sso?ObjectID=1.3&LotNumber=3', saleDate: '2026-10-13' });
  const www = lot({ id: 'www', url: 'https://www.christies.com/en/lot/lot-6610264', saleDate: '2026-10-23' });
  const seen: { url: string; ua: string; timeoutMs?: number }[] = [];
  const stats = await enrichChristiesCloseTimes([ok, down, blocked, empty, www], {
    nowMs: NOW, pauseMs: 0,
    fetchImpl: async (url, init) => {
      seen.push({ url, ua: String((init.headers as Record<string, string>)['User-Agent']), timeoutMs: init.timeoutMs });
      if (url.includes('1.1')) throw new Error('ETIMEDOUT');
      if (url.includes('1.2')) return resp('Access Denied', { status: 403 });
      if (url.includes('1.3')) return resp('<html>no data</html>', { url: 'https://onlineonly.christies.com/s/x/y/1' });
      return resp(FIX);
    },
  });
  assert.deepEqual({ ...stats }, { targets: 4, attempted: 4, dated: 1, revived: 0, unreachable: 2, undated: 1, budgetHit: false });
  assert.equal(seen.some(s => s.url.includes('www.christies.com')), false);
  assert.ok(seen.every(s => /Chrome\/\d+/.test(s.ua) && s.timeoutMs === 20_000));
  assert.equal(ok.saleDateTime, '2026-10-23T17:17:00.000Z');
  assert.equal(ok.closeKind, 'online');
  for (const [l, day] of [[down, '2026-10-11'], [blocked, '2026-10-12'], [empty, '2026-10-13']] as const) {
    assert.equal(l.saleDate, day);
    assert.equal(l.status, 'upcoming');
    assert.equal(l.saleDateTime, undefined);
    assert.equal(l.closeKind, undefined);
  }
});

test('enrich: cap and budget stop early without touching unreached lots', async () => {
  const many = Array.from({ length: 10 }, (_, i) => lot({ id: `l${i}`, saleDate: '2026-10-10' }));
  const capped = await enrichChristiesCloseTimes(many, { nowMs: NOW, pauseMs: 0, cap: 4, concurrency: 2, fetchImpl: async () => resp(FIX) });
  assert.equal(capped.attempted, 4);
  assert.equal(many.filter(l => l.closeKind === 'online').length, 4);
  const fresh = Array.from({ length: 6 }, (_, i) => lot({ id: `m${i}`, saleDate: '2026-10-10' }));
  const budget = await enrichChristiesCloseTimes(fresh, {
    nowMs: NOW, pauseMs: 0, concurrency: 2, budgetMs: 5,
    fetchImpl: async () => { await new Promise(r => setTimeout(r, 20)); return resp(FIX); },
  });
  assert.equal(budget.budgetHit, true);
  assert.equal(budget.attempted, 2);
  assert.equal(fresh.slice(2).every(l => l.saleDate === '2026-10-10' && l.saleDateTime === undefined), true);
});
