/**
 * THE PUSH IS THE DESK'S THIRD SURFACE (pass 18). Over the same fixture lots
 * as lot-parity.test.ts, a push's figures equal the desk row's and the paper's:
 * the live bid in USD, the My max words, the close's day and clock, the
 * realized price and the vs-your-max read. A push never fires for a result the
 * reader owns or dismissed, nor twice for one event; every anchor it may open
 * resolves to a tab and is owned by the fold that lands it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { AuctionLot } from '../../types';
import { pinClock } from '../../lib/__tests__/helpers/pin-clock';

process.env.TZ = 'America/New_York';
pinClock('2026-10-29T16:00:00-04:00');
const NOW = Date.now();

(Module as unknown as { _extensions: Record<string, (m: unknown, f: string) => void> })._extensions['.css'] = () => {};
declare const require: NodeRequire;
const Push = require('../../../scripts/lib/push-plan') as typeof import('../../../scripts/lib/push-plan');
const Row = require('../desk/row') as typeof import('../desk/row');
const D = require('../desk/derive') as typeof import('../desk/derive');
const W = require('../desk/words') as typeof import('../desk/words');
const { owns } = require('../desk/fold') as typeof import('../desk/fold');
const { SECTIONS, SUB_ANCHORS, tabOf, EVERY_TAB } = require('../desk/sections') as typeof import('../desk/sections');
const { fmtFace, liveBidUsd } = require('../../lib/lot-face') as typeof import('../../lib/lot-face');
const { planDesk, whenText } = require('../../../scripts/lib/daily-desk') as typeof import('../../../scripts/lib/daily-desk');

const lot = (over: Record<string, unknown>): AuctionLot =>
  ({ id: 'l', title: 'Work', artist: 'andy-warhol', auctionHouse: "Christie's", status: 'upcoming', currency: 'USD', saleDate: '2026-11-05', saleDateTime: '2026-11-05T23:00:00Z',
    estimateLow: null, estimateHigh: null, priceUsd: null, ...over } as unknown as AuctionLot);
const usdBid = lot({ id: 'goldin', auctionHouse: 'Goldin', currentBid: 1272, bidCount: 9, saleDate: '2026-10-30', saleDateTime: '2026-10-30T02:00:00Z', value: { compValueUsd: 1800 } }); // 10 PM ET tonight
const eur = lot({ id: 'eur', currency: 'EUR', fxRate: 1.08, estimateLow: 8640, estimateHigh: 12960, currentBid: 10000, bidCount: 3, saleDate: '2026-10-30', saleDateTime: '2026-10-30T18:00:00Z' }); // 2 PM ET tomorrow
const dateOnly = lot({ id: 'day', estimateLow: 2300, estimateHigh: 3450, saleDate: '2026-10-30', saleDateTime: null });   // tomorrow, no hour
const live = new Map([usdBid, eur, dateOnly].map(l => [l.id, l as unknown as import('../../../scripts/lib/push-plan').LiveLot]));
const users = new Set(['u1']);
const plan = (watches: import('../../../scripts/lib/push-plan').Watch[], over: Partial<Parameters<typeof Push.planSends>[0]> = {}) =>
  Push.planSends({ usersWithSubs: users, watches, live, settled: new Map(), sent: new Set(), forecasts: new Map(), now: NOW, ...over });

test('a close push prints the desk row\'s bid (USD), its count and its clock: the same strings as the row figure and the paper', () => {
  const [p] = plan([{ user_id: 'u1', lot_id: 'goldin' }]);
  assert.equal(p.kind, 'close24');
  assert.equal(p.payload.title, 'Closes within 24 hours: Work');
  // the desk row: figure fmtFace(liveBidUsd) · bidsSubOf; the clock: closeFigureOf's clockText
  const ms = Date.parse(usdBid.saleDateTime!);
  assert.equal(p.payload.body, `On the block at Goldin · closes today ${Row.clockText(ms)} · bid ${fmtFace(liveBidUsd(usdBid)!)} · ${Row.bidsSubOf(usdBid)} · lectr forecast $1.8K all-in.`);
  assert.equal(Row.closeFigureOf(usdBid, NOW).main, Row.clockText(ms));
  assert.equal(whenText(ms, NOW, 'America/New_York', true), `today ${Row.clockText(ms)}`);
  // the EUR bid: $10,800, never €10,000 under a $ sign
  const [e] = plan([{ user_id: 'u1', lot_id: 'eur' }]);
  assert.match(e.payload.body, new RegExp(`closes tomorrow ${Row.clockText(Date.parse(eur.saleDateTime!))} · bid \\$11K · 3 bids`));
  assert.equal(Row.priceFigureOf(lot({ ...eur, estimateLow: null, estimateHigh: null } as unknown as Record<string, unknown>)).fig, '$11K');
});

test('My max in a push is the desk row\'s words (words.myMaxText): passed, room, or none', () => {
  const [over] = plan([{ user_id: 'u1', lot_id: 'goldin', max_usd: 1000 }]);
  assert.ok(over.payload.body.includes(' · My max $1K · bid passed it · '), over.payload.body);
  assert.equal(W.myMaxText(usdBid, 1000), 'My max $1K · bid passed it');
  const [room] = plan([{ user_id: 'u1', lot_id: 'eur', max_usd: 11_000 }]);
  assert.ok(room.payload.body.includes(' · My max $11K · $200 of room'), room.payload.body);
  assert.equal(W.myMaxText(eur, 11_000), 'My max $11K · $200 of room');
  const [none] = plan([{ user_id: 'u1', lot_id: 'goldin' }]);
  assert.ok(!none.payload.body.includes('My max'));
  // the paper's over flag agrees with the push's words
  const paper = planDesk({ now: NOW, tz: 'America/New_York', watches: [{ lot_id: 'goldin', max_usd: 1000 }], live: new Map([['goldin', usdBid]]), sold: [], picks: [] })!;
  assert.equal(paper.overMax[0]?.id, 'goldin');
});

test('a date-only sale: "Sells tomorrow" on the READER\'s day (the desk\'s and the paper\'s), never UTC\'s', () => {
  // 4 PM ET Oct 29 = 20:00Z; a sale dated Oct 30 is tomorrow on both clocks here —
  // but at 10 PM ET Oct 29 (02:00Z Oct 30) UTC would have said "today"
  const late = Date.parse('2026-10-29T22:00:00-04:00');
  const [p] = Push.planSends({ usersWithSubs: users, watches: [{ user_id: 'u1', lot_id: 'day' }], live, settled: new Map(), sent: new Set(), forecasts: new Map(), now: late });
  assert.equal(p.payload.title, 'Sells tomorrow: Work');
  assert.equal(Push.closeKindFor(live.get('day')!, late), 'close24');
  assert.equal(D.hammerWord(D.closeDays(dateOnly)), 'tomorrow', 'the desk says tomorrow too');
  assert.equal(whenText(Date.parse('2026-10-31T03:59:00Z'), late, 'America/New_York', false, '2026-10-30'), 'tomorrow (time TBC)');
});

test('a hammer push: the realized price in fmtFace, the result vs your max in the paper\'s words; never for an owned or dismissed save; never twice', () => {
  const settled = new Map([['s1', { id: 's1', title: 'Mantle 1952 Topps', house: 'Heritage', status: 'sold', price_usd: 12_500, sale_date: '2026-10-28' }]]);
  const base = (w: import('../../../scripts/lib/push-plan').Watch[], sent = new Set<string>()) =>
    Push.planSends({ usersWithSubs: users, watches: w, live: new Map(), settled, sent, forecasts: new Map(), now: NOW });
  const [p] = base([{ user_id: 'u1', lot_id: 's1', max_usd: 10_000 }]);
  assert.equal(p.payload.body, `Sold for ${fmtFace(12_500)} at Heritage · +25% vs your max $10K.`);   // fmtFace: whole K from $10K → "$13K", the paper's own figure
  assert.equal(W.vsMaxText(12_500, 10_000), '+25% vs your max $10K');
  // the paper's results row prints the same vs-max
  const paper = planDesk({ now: NOW, tz: 'America/New_York', watches: [{ lot_id: 's1', max_usd: 10_000 }], live: new Map(), sold: [{ id: 's1', title: 'Mantle', house: 'Heritage', price_usd: 12_500, sale_date: '2026-10-28' }], picks: [], lastSentOn: '2026-10-27' })!;
  assert.equal(paper.results[0].vsMax, '+25% vs your max $10K');
  assert.equal(paper.results[0].hammer, fmtFace(12_500), 'the paper prints the same money');
  // owned / dismissed: not news
  assert.deepEqual(base([{ user_id: 'u1', lot_id: 's1', owned: true }]), []);
  assert.deepEqual(base([{ user_id: 'u1', lot_id: 's1', result_dismissed: true }]), []);
  // once per user × lot × kind: the ledger, and duplicate saves (x and x~) in one run
  assert.deepEqual(base([{ user_id: 'u1', lot_id: 's1' }], new Set([Push.dedupeKey('u1', 's1~', 'hammer')])), []);
  assert.equal(base([{ user_id: 'u1', lot_id: 's1' }, { user_id: 'u1', lot_id: 's1~' }]).length, 1);
});

test('every anchor a push may open resolves to a tab and is owned by the fold that lands it (page.tsx idsOf: the group\'s rooms + their sub-anchors)', () => {
  for (const url of Push.PUSH_ANCHORS) {
    const id = url.replace(/^\/profile#/, '');
    const tab = tabOf(id);
    assert.ok(tab, `${url} resolves to a tab`);
    const room = SUB_ANCHORS[id] ?? id;
    const sec = SECTIONS.find(s => s.id === room);
    assert.ok(sec && sec.Component, `${url} names a mounted room`);
    // the fold's ids as page.tsx builds them: the group's rooms plus the sub-anchors inside them
    const rooms = SECTIONS.filter(s => s.tab === sec!.tab && !EVERY_TAB.has(s.id)).map(s => s.id);
    const ids = rooms.concat(Object.entries(SUB_ANCHORS).filter(([, r]) => rooms.includes(r)).map(([a]) => a));
    assert.ok(owns(ids, id), `${url}: the ${sec!.tab} fold owns #${id}`);
  }
  assert.ok(!owns(['watching'], 'results'), 'an anchor never opens a fold that does not hold it');
  assert.ok(owns(['week'], 'week-2026-10-30'), 'a week day opens the week');
});
