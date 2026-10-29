/**
 * TODAY'S EDITION on the desk (app/profile/desk/edition-model.ts) renders the
 * SAME paper the morning send does: the desk's data maps onto the runner's
 * inputs, and the same model through either path is byte-identical HTML
 * (the on-desk frame adds only <base target="_top">).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../app/types';
import type { Rec } from '../../app/lib/recs';
import { planDesk, type DeskEmail } from '../lib/daily-desk';
import { renderDesk } from '../lib/daily-desk-html';
import { watchRowsOf, soldRowsOf, picksOf, entityIdsOf, editionInputOf, renderEdition, dayBefore, dateLabelOf, type EditionSource } from '../../app/profile/desk/edition-model';

const NOW = Date.parse('2026-10-21T12:20:00Z');
const H = 3600_000;
const lot = (id: string, closeIn: number, extra: Partial<AuctionLot> = {}): AuctionLot => ({
  id, title: `Lot ${id}`, artist: 'andy-warhol', auctionHouse: "Christie's", status: 'upcoming', currency: 'USD', ek: 'mk:andy-warhol',
  saleDate: new Date(NOW + closeIn).toISOString().slice(0, 10), saleDateTime: new Date(NOW + closeIn).toISOString(),
  estimateLow: 1000, estimateHigh: 2000, imageUrl: `https://img.example/${id}.jpg`, firstSeen: '2026-10-21', ...extra,
} as unknown as AuctionLot);
const rec = (l: AuctionLot, seed: Rec<AuctionLot>['seed'], extra: Partial<Rec<AuctionLot>> = {}): Rec<AuctionLot> =>
  ({ lot: l, score: 1, taste: 1, reason: 'Like your prints', short: 'Like your prints', why: [], seed, ...extra } as Rec<AuctionLot>);

const book = [lot('a', 5 * H, { currentBid: 1200, bidCount: 9 }), lot('b', 60 * H, { currentBid: 300, bidCount: 4 }), lot('p1', 72 * H), lot('p2', 80 * H), lot('n1', 90 * H)];
const soldLot = { ...lot('s1', -48 * H), status: 'sold', priceUsd: 12_000, saleDate: '2026-10-20', title: 'Card', auctionHouse: 'REA', artist: 'graded-cards' } as unknown as AuctionLot;
const src: EditionSource = {
  now: NOW,
  savedIds: ['a', 'b', 's1', 'o1', 'own-1'],
  savedMeta: {
    a: { savedAt: '2026-10-01', estMid: 1500, signalPct: null, bidCount: 5, maxUsd: 2000, title: 'Lot a', artist: 'andy-warhol' },
    b: { savedAt: '2026-10-01', estMid: 1500, signalPct: null, bidCount: 4, maxUsd: 250 },
    s1: { savedAt: '2026-10-01', estMid: 8000, signalPct: null, bidCount: null, maxUsd: 10_000 },
    o1: { savedAt: '2026-10-01', estMid: null, signalPct: null, bidCount: null, title: 'Orphan print', artist: 'andy-warhol' },
    'own-1': { savedAt: '2026-09-01', estMid: null, signalPct: null, bidCount: null, owned: true, title: 'Cow, 1976', artist: 'andy-warhol', paidUsd: 12_000 },
  },
  book, sold: [soldLot],
  soldOrphans: [{ id: 'o1', priceUsd: 900, saleDate: '2026-10-20', provisional: false }, { id: 'o2', priceUsd: 1, saleDate: '2026-10-20', provisional: true }],
  recs: [rec(book[2], { kind: 'follow', w: 1, label: 'Andy Warhol', follow: { kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' } }), rec(book[3], { kind: 'saved', w: 1, label: 'Lot a', lotId: 'a' })],
  closingPicks: [rec(book[2], { kind: 'follow', w: 1, label: 'Andy Warhol', follow: { kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' } })],
  follows: [{ kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' }, { kind: 'house', key: 'Goldin', label: 'Goldin' }],
  pendingResults: 2, lastSentOn: null,
};
const got = {
  nameSold: new Map([['mk:andy-warhol', { id: 'sold-9', p: 243_200, d: '2026-10-20', h: "Christie's", t: 'African Elephant' }]]),
  nameRecent: new Map([['mk:andy-warhol', [{ id: 'sold-9', p: 243_200, d: '2026-10-20', h: "Christie's", t: 'African Elephant' }]]]),
  receipts: { rows: Array.from({ length: 6 }, (_, k) => ({ id: `r${k}`, k: 'card', d: '2026-10-10', sd: '2026-10-20', p: 1000, r: 900, m: 'art' })) },
  backtest: { flagged: { n: 2903, medianPerfPct: 44 }, unflagged: { n: 14906, medianPerfPct: 20 } },
};

test('edition: the desk’s saves, settled rows and recs map onto the runner’s inputs', () => {
  const w = watchRowsOf(src);
  assert.deepEqual(w.find(x => x.lot_id === 'a'), { lot_id: 'a', saved_title: 'Lot a', saved_artist: 'andy-warhol', max_usd: 2000, owned: false, est_mid: 1500, bid_count: 5, paid_usd: null });
  assert.equal(w.find(x => x.lot_id === 'own-1')?.owned, true);
  const s = soldRowsOf(src);
  assert.deepEqual(s.map(r => r.id), ['s1', 'o1']);   // a provisional orphan is not a result
  assert.equal(s[0].price_usd, 12_000);
  assert.equal(s[1].title, 'Orphan print');
  const p = picksOf(src);
  assert.deepEqual(p.map(x => x.lot.id), ['p1', 'p2']);   // closing picks first, a lot once
  assert.equal(p[0].lane?.label, 'Because you follow Andy Warhol');
  assert.equal(p[1].lane?.label, 'Because you saved Andy Warhol · Lot a');   // the saved seed's maker read off the live lot
  assert.deepEqual(entityIdsOf(src), ['mk:andy-warhol']);   // the followed name and the owned piece's maker, once; the house is no name
  assert.equal(dayBefore(NOW, 1), '2026-10-20');
  assert.equal(dateLabelOf(NOW), 'Wednesday, Oct 21');
});

test('edition: the same model renders the same HTML on the desk as in the morning send (plus <base target="_top">)', () => {
  const input = editionInputOf(src, got);
  assert.equal(input.lastSentOn, '2026-10-20');   // no edition yet: yesterday, so the welcome never shows on the desk
  const model = planDesk(input)!;
  assert.equal(model.welcome, false);
  assert.ok(model.overMax.length === 1 && model.results.length === 2 && model.collection.length === 1 && model.picks.length === 2 && model.names.length === 1 && model.market.length >= 2);
  const origin = 'https://lectr.bid', dateLabel = dateLabelOf(NOW);
  const runner = renderDesk(model, { origin, unsubUrl: `${origin}/profile#account`, dateLabel }).html;
  const desk = renderEdition(model, origin, dateLabel);
  assert.equal(desk.replace('<base target="_top">', ''), runner);
  assert.ok(desk.includes('<base target="_top">'));
  // the prefs' last edition day drives the window when they carry it
  const later = planDesk(editionInputOf({ ...src, lastSentOn: '2026-10-19' }, got))!;
  assert.equal(later.welcome, false);
  assert.match(later.fresh?.since ?? '', /since your last Desk \(Mon, Oct 19\)/);
  // and the runner's own path over the same model stays byte-identical for a second render
  assert.equal(renderDesk(model as DeskEmail, { origin, unsubUrl: `${origin}/profile#account`, dateLabel }).html, runner);
});
