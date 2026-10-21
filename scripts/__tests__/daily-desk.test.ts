import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../app/types';
import { planDesk, whenText, PICKS_N } from '../lib/daily-desk';
import { renderDesk } from '../lib/daily-desk-html';

const NOW = Date.parse('2026-10-21T12:20:00Z');
const H = 3600_000;
const lot = (id: string, closeIn: number | null, extra: Partial<AuctionLot> = {}): AuctionLot => ({
  id, title: `Lot ${id}`, artist: 'kaws', auctionHouse: 'Goldin', status: 'upcoming', currency: 'USD',
  saleDate: closeIn == null ? '' : new Date(NOW + closeIn).toISOString().slice(0, 10),
  saleDateTime: closeIn == null ? null : new Date(NOW + closeIn).toISOString(),
  estimateLow: 1000, estimateHigh: 2000, hammerPrice: null, premiumPrice: null, priceUsd: null,
  ...extra,
} as unknown as AuctionLot);
const liveMap = (ls: AuctionLot[]) => new Map(ls.map(l => [l.id, l]));

test('nothing to say → no email', () => {
  assert.equal(planDesk({ now: NOW, watches: [], live: new Map(), sold: [], picks: [] }), null);
  // a watch closing in 10 days, no results, no picks
  const l = lot('a', 240 * H);
  assert.equal(planDesk({ now: NOW, watches: [{ lot_id: 'a' }], live: liveMap([l]), sold: [], picks: [] }), null);
});

test('closing within 36h, soonest first; a bid past your max leads its own section', () => {
  const a = lot('a', 20 * H), b = lot('b', 5 * H), c = lot('c', 8 * H, { currentBid: 5000 });
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'a' }, { lot_id: 'b' }, { lot_id: 'c', max_usd: 4000 }], live: liveMap([a, b, c]), sold: [], picks: [] })!;
  assert.deepEqual(d.overMax.map(i => i.id), ['c']);
  assert.deepEqual(d.closing.map(i => i.id), ['b', 'a']);   // c is not repeated
  assert.match(d.subject, /passed your max/);
});

test('results since the last email grade the hammer against your max', () => {
  const d = planDesk({
    now: NOW, watches: [{ lot_id: 'x', max_usd: 10_000, est_mid: 8_000 }], live: new Map(),
    sold: [{ id: 'x', title: 'Card', house: 'REA', price_usd: 12_000, sale_date: '2026-10-20' }], picks: [], lastSentOn: '2026-10-20',
  })!;
  assert.equal(d.results.length, 1);
  assert.equal(d.results[0].inReach, false);
  assert.match(d.results[0].vsMax!, /\+20% vs your max/);
  // a result older than the last email is not repeated
  assert.equal(planDesk({ now: NOW, watches: [{ lot_id: 'x' }], live: new Map(), sold: [{ id: 'x', price_usd: 1, sale_date: '2026-10-19' }], picks: [], lastSentOn: '2026-10-20' }), null);
});

test('picks skip lots you already watch and cap at three', () => {
  const ps = ['a', 'p1', 'p2', 'p3', 'p4'].map(id => ({ lot: lot(id, 72 * H), note: 'Like your prints' }));
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'a' }], live: liveMap([]), sold: [], picks: ps })!;
  assert.equal(d.picks.length, PICKS_N);
  assert.ok(!d.picks.some(p => p.id === 'a'));
});

test('whenText reads the reader clock', () => {
  assert.match(whenText(NOW + 2 * H, NOW, 'America/New_York')!, /^today /);
  assert.match(whenText(NOW + 26 * H, NOW, 'America/New_York')!, /^tomorrow /);
  assert.equal(whenText(null, NOW, 'America/New_York'), null);
});

test('the email carries an unsubscribe link and escapes titles', () => {
  const l = lot('a', 5 * H, { title: 'A <b>bold</b> lot' } as Partial<AuctionLot>);
  const d = planDesk({ now: NOW, watches: [{ lot_id: 'a' }], live: liveMap([l]), sold: [], picks: [] })!;
  const { html, text } = renderDesk(d, { origin: 'https://lectr.bid', unsubUrl: 'https://lectr.bid/api/email/unsubscribe?t=x', dateLabel: 'Wednesday, Oct 21' });
  assert.ok(html.includes('https://lectr.bid/api/email/unsubscribe?t=x'));
  assert.ok(!html.includes('<b>bold</b>'));
  assert.ok(text.includes('Unsubscribe: https://lectr.bid/api/email/unsubscribe?t=x'));
});
