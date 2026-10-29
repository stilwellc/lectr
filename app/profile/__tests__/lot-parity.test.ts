/**
 * ONE LOT, ONE SET OF FIGURES (pass 16, Oct 29 2026). When the owner taps a
 * desk row he lands on /lot?id= — the row, the dossier, the cockpit's
 * Next-hammer cell, the Daily Desk row and the lot page must print the SAME
 * strings for the same lot: the estimate words, the live bid in USD and its
 * count, the signal magnitude, the close's day and clock, my max and whether
 * the bid passed it. Each surface's own function is called here — the lot
 * page's through what it imports (estimate-text, lot-face, Terminal.daysWord,
 * comps.signalMagnitude); where the lot page keeps a local copy, a source
 * guard pins it to the shared rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { AuctionLot } from '../../types';
import { pinClock } from '../../lib/__tests__/helpers/pin-clock';

process.env.TZ = 'America/New_York';
pinClock('2026-10-29T16:00:00-04:00');
const NOW = Date.now();

(Module as unknown as { _extensions: Record<string, (m: unknown, f: string) => void> })._extensions['.css'] = () => {};
declare const require: NodeRequire;
const Row = require('../desk/row') as typeof import('../desk/row');
const D = require('../desk/derive') as typeof import('../desk/derive');
const P = require('../desk/priced') as typeof import('../desk/priced');
const MyMax = require('../desk/mymax') as typeof import('../desk/mymax');
const { formatEstimate } = require('../../lib/estimate-text') as typeof import('../../lib/estimate-text');
const { lotFace, fmtFace, liveBidUsd, liveSignalOf } = require('../../lib/lot-face') as typeof import('../../lib/lot-face');
const { signalMagnitude } = require('../../lib/comps') as typeof import('../../lib/comps');
const { daysWord } = require('../../components/Terminal') as typeof import('../../components/Terminal');
const { planDesk, whenText } = require('../../../scripts/lib/daily-desk') as typeof import('../../../scripts/lib/daily-desk');
const { closeMsOf } = require('../../lib/priority') as typeof import('../../lib/priority');
const { closeDayOf } = require('../../utils') as typeof import('../../utils');

const lot = (over: Record<string, unknown>): AuctionLot =>
  ({ id: 'l', title: 'Work', artist: 'andy-warhol', auctionHouse: "Christie's", status: 'upcoming', currency: 'USD', saleDate: '2026-11-05', saleDateTime: '2026-11-05T23:00:00Z',
    estimateLow: null, estimateHigh: null, priceUsd: null, ...over } as unknown as AuctionLot);

/* ── the fixture lots ── */
const usdBid = lot({ id: 'goldin', auctionHouse: 'Goldin', artist: 'michael-jordan', currentBid: 1272, bidCount: 9, saleDate: '2026-10-30', saleDateTime: '2026-10-30T02:00:00Z', closeKind: 'online',
  signal: { label: 'Below Market', pct: 38, confidence: 'medium' } });                        // 10 PM ET tonight (Oct 29)
const eur = lot({ id: 'eur', currency: 'EUR', fxRate: 1.08, estLowNative: 8000, estHighNative: 12000, estLowUsd: 8640, estHighUsd: 12960, estimateLow: 8640, estimateHigh: 12960,
  currentBid: 10000, bidCount: 3, saleDate: '2026-10-30', saleDateTime: '2026-10-30T18:00:00Z', signal: { label: 'Above Market', pct: 12, confidence: 'medium' } }); // 2 PM ET tomorrow
const oneSided = lot({ id: 'rr', auctionHouse: 'RR Auction', estimateLow: 2000, currentBid: 1391, bidCount: 15, saleDate: '2026-11-03', saleDateTime: null });
const noEst = lot({ id: 'noest', auctionHouse: 'Goldin', bidCount: 0, saleDate: '2026-11-02', saleDateTime: '2026-11-02T23:00:00Z', closeKind: 'online' });
const dateOnly = lot({ id: 'day', estimateLow: 2300, estimateHigh: 3450, saleDate: '2026-11-05', saleDateTime: null });
const pending = lot({ id: 'pend', estimateLow: 1000, estimateHigh: 2000, saleDate: '2026-10-20', saleDateTime: '2026-10-20T23:00:00Z', resultsPending: true });
const ALL = [usdBid, eur, oneSided, noEst, dateOnly, pending];

/** the Daily Desk's row for a lot (scripts/lib/daily-desk itemOf, through planDesk) */
function paperRow(l: AuctionLot, max: number | null = null) {
  const d = planDesk({ now: NOW, tz: 'America/New_York', watches: [{ lot_id: l.id, max_usd: max }], live: new Map([[l.id, l]]), sold: [], picks: [] })!;
  return d.overMax[0] ?? d.closing[0] ?? d.desk[0] ?? null;
}

test('the estimate words: the desk row, the dossier, the cockpit line, the paper and the lot page read ONE formatter (estimate-text, fmtFace money)', () => {
  for (const l of ALL) {
    const shared = formatEstimate(l);                           // the lot page's import (LotCard re-export), the cockpit's LotLine, the paper's est
    const row = Row.priceFigureOf(l);                           // the desk row's figure + sub
    const dossier = P.fromText(l) ?? shared.replace(/ est\.$/, ''); // watching.tsx RowDossier "est <b>…</b>"
    const paper = paperRow(l);
    if (paper) assert.equal(paper.est, shared, `${l.id}: the paper's est`);
    if (P.fromText(l)) {
      assert.equal(row.fig, P.fromText(l), `${l.id}: a one-sided estimate is "from $X" on the row`);
      assert.equal(dossier, 'from $2K');
    } else if (/ est\.$/.test(shared)) {
      assert.equal(`${row.fig} est.`, shared, `${l.id}: the row's figure is the shared words without the suffix`);
      assert.equal(dossier, row.fig);
    } else if (row.kind === 'bid') {
      assert.equal(shared.split(' · ')[0], `${row.fig} bid`, `${l.id}: the row's bid figure is the shared bid`);
    } else {
      // the house's words with no number ("No reserve · opening bid"): a quiet
      // figure, never read as a live bid (pass 16 fixed the row's order)
      assert.equal(row.quiet, true, l.id);
      assert.equal(`${row.fig} · ${row.sub}`, shared, l.id);
    }
  }
  assert.deepEqual(Row.priceFigureOf(noEst), { fig: 'No reserve', sub: 'opening bid', quiet: true, kind: 'est' });
  assert.equal(formatEstimate(dateOnly), '$2.3K–$3.5K est.', 'fmtFace money, one decimal under $10K — never a whole-K "$2K–$3K"');
  assert.equal(formatEstimate(oneSided), '$1.4K bid · 15 bids', 'a one-sided estimate with a live bid prints the bid (the printed-bid gate)');
  assert.equal(P.fromText(oneSided), 'from $2K');
  assert.equal(formatEstimate(noEst), 'No reserve · opening bid');
});

test('the live bid is ONE number in USD on every surface: the desk row, the lot page words, My max, the paper, the over-max count (a EUR bid through its rate)', () => {
  assert.equal(liveBidUsd(usdBid), 1272);
  assert.equal(liveBidUsd(eur), 10800);
  assert.equal(P.liveBidUsd, liveBidUsd, 'priced.ts re-exports lot-face\'s read');
  assert.equal(D.liveBidUsd, liveBidUsd);
  // estimate-text (the lot page's byline import, the cockpit, the paper's est) prints the USD bid
  assert.equal(formatEstimate(eur), '$8.6K–$13K est.', 'a two-sided estimate leads');
  assert.equal(formatEstimate(lot({ id: 'eurbid', currency: 'EUR', fxRate: 1.08, currentBid: 10000, bidCount: 3 })), `${fmtFace(10800)} bid · 3 bids`);
  assert.equal(fmtFace(10800), '$11K', 'fmtFace: whole K from $10K (the lot page\'s own money format)');
  assert.equal(formatEstimate(lot({ id: 'gbpbid', currency: 'GBP', currentBid: 2000, bidCount: 1 })), '2,000 GBP bid · 1 bid', 'no rate: the bid keeps its own currency, never a $ sign');
  // the paper's row
  const p = paperRow(eur, 10_500)!;
  assert.equal(p.bid, fmtFace(10800));
  assert.equal(p.over, true, '$10.8K passed a $10.5K max');
  assert.equal(p.bids, '3 bids');
  // My max on the desk agrees
  assert.equal(MyMax.overMax(eur, 10_500), true);
  assert.equal(MyMax.overMax(eur, 11_000), false);
  assert.equal(MyMax.overMax(lot({ id: 'gbp', currency: 'GBP', currentBid: 20_000 }), 1000), false, 'an unconvertible bid never passes a USD max');
  assert.deepEqual(D.overMaxIdsOf([eur, usdBid], id => (id === 'eur' ? 10_500 : 1000)), ['eur', 'goldin']);
  assert.equal(Row.bidsSubOf(usdBid), '9 bids');
  assert.equal(Row.bidsSubOf(lot({ id: 'x', currentBid: 5 })), 'live bid');
});

test('the signal: the desk pill, the lot page\'s read cell and the paper print the one magnitude (comps.signalMagnitude via lot-face)', () => {
  for (const l of [usdBid, eur]) {
    const sig = liveSignalOf(l)!;
    const desk = D.sigText(sig as Parameters<typeof D.sigText>[0]);            // watching.tsx SigPill, Today's reads
    const page = lotFace(l).call?.text ?? signalMagnitude(sig.label, sig.pct);   // LotPage: face?.call?.text ?? signalMagnitude(...)
    assert.equal(desk, page, l.id);
    const paper = paperRow(l)!;
    assert.ok(paper.sig && paper.sig.text.startsWith(`${desk} vs comps · `), `${l.id}: the paper leads with the same magnitude: ${paper.sig?.text}`);
    assert.equal(paper.sig!.dir, sig.label === 'Below Market' ? 'up' : 'down');
  }
  assert.equal(D.sigText({ label: 'Below Market', pct: 38 } as Parameters<typeof D.sigText>[0]), '+38%');
  assert.equal(D.sigText({ label: 'Above Market', pct: 12 } as Parameters<typeof D.sigText>[0]), '−12%');
  assert.equal(paperRow(eur)!.sig!.text, '−12% vs comps · above market');
});

test('the close: every surface lands the lot on the same reader-day and prints the same clock — the row\'s figure, the cockpit\'s word, the paper\'s when, the lot page\'s daysWord', () => {
  const dayClass = (l: AuctionLot) => { const d = D.closeDays(l); return isNaN(d) ? 'scheduled' : d < 0 ? 'pending' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'later'; };
  const expect: Record<string, string> = { goldin: 'today', eur: 'tomorrow', rr: 'later', noest: 'later', day: 'later', pend: 'pending' };
  for (const l of ALL) {
    const cls = dayClass(l);
    assert.equal(cls, expect[l.id], `${l.id} day class`);
    // the cockpit's Next-hammer word (derive.hammerWord) and the lot page's daysWord agree on today / tomorrow / pending
    const cockpit = D.hammerWord(D.closeDays(l));
    const page = daysWord(closeDayOf(l));
    if (cls === 'today' || cls === 'tomorrow') { assert.equal(cockpit, cls); assert.equal(page, cls); }
    if (cls === 'later') { assert.match(cockpit, /^in \d+ days$/); assert.match(page, /^in \d+d$/); }
    if (cls === 'pending') { assert.equal(cockpit, 'result pending'); assert.match(page, /^hammered \d+d ago$/); }
    // the desk row's figure slot (row.tsx closeFigureOf)
    const fig = Row.closeFigureOf(l, NOW);
    const ms = closeMsOf(l);
    if (cls === 'today' && l.saleDateTime) {
      assert.equal(fig.main, Row.clockText(ms!), `${l.id}: today's figure is the clock`);
      // the paper's "today 10:00 PM" carries the same clock
      const when = whenText(ms, NOW, 'America/New_York', true)!;
      assert.equal(when, `today ${Row.clockText(ms!)}`);
    }
    if (cls === 'tomorrow') { assert.equal(fig.main, 'Tomorrow'); assert.equal(fig.sub, Row.clockText(ms!)); assert.match(whenText(ms, NOW, 'America/New_York', true)!, /^tomorrow /); }
    if (cls === 'pending') assert.equal(fig.main, 'result pending');
    if (l.id === 'day') {
      assert.equal(fig.main, 'Nov 5'); assert.equal(fig.sub, 'in 7 days');
      // the paper's row: the HOUSE day, as the desk prints it — the close instant alone read "Fri, Nov 6" (pass 16)
      assert.equal(paperRow(l)!.when, 'Thu, Nov 5', 'a date-only sale: the house day, never an invented hour or the next morning');
      assert.equal(whenText(ms, NOW, 'America/New_York', false, closeDayOf(l)), 'Thu, Nov 5');
    }
  }
  // a closed-pending lot is on the settled shelf, not the live one — the paper does not list it as live
  assert.equal(paperRow(pending), null);
  assert.deepEqual(D.partitionSaved([pending]).sold.map(l => l.id), ['pend']);
});

test('the lot page keeps to the shared rules (source guard): the signal read is lot-face\'s / signalMagnitude\'s, the day word is daysWord over closeDayOf, the byline estimate is estimate-text\'s', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'LotPage.tsx'), 'utf8');
  assert.match(src, /face\?\.call\?\.text \?\? signalMagnitude\(sig\.label, sig\.pct\)/);
  assert.match(src, /daysWord\(closeDayOf\(lot\)\)/);
  assert.match(src, /return formatEstimate\(lot\);/);
});

test('My max: the lot page prints the desk row\'s words (desk/mymax myMaxText) — passed, room, or the max alone; the paper\'s over flag agrees', () => {
  const { myMaxText, overMax } = require('../desk/mymax') as typeof import('../desk/mymax');
  assert.equal(myMaxText(usdBid, 1000), 'My max $1K · bid passed it');          // $1,272 bid
  assert.equal(myMaxText(usdBid, 1500), 'My max $1.5K · $228 of room');
  assert.equal(myMaxText(eur, 11_000), 'My max $11K · $200 of room');          // €10,000 × 1.08 = $10,800
  assert.equal(myMaxText(eur, 10_500), `My max ${fmtFace(10_500)} · bid passed it`);   // fmtFace: whole K from $10K → "$11K"
  assert.equal(myMaxText(noEst, 500), 'My max $500', 'no bid: no claim either way');
  assert.equal(myMaxText(lot({ id: 'gbp', currency: 'GBP', currentBid: 20_000 }), 1000), 'My max $1K', 'an unconvertible bid is never read against a USD max');
  assert.equal(myMaxText(usdBid, null), null);
  assert.equal(myMaxText(lot({ id: 'sold', status: 'sold', priceUsd: 2000, currentBid: 2000 }), 1000), 'My max $1K', 'a sold lot has no live bid to pass a max');
  for (const [l, max] of [[usdBid, 1000], [eur, 11_000], [eur, 10_500]] as [AuctionLot, number][]) {
    const words = myMaxText(l, max)!;
    assert.equal(overMax(l, max), words.endsWith('bid passed it'), `${l.id} @ ${max}`);
    assert.equal(paperRow(l, max)!.over, overMax(l, max), `${l.id} @ ${max}: the paper's over flag`);
  }
});

test('the lot page keeps to the desk\'s My max and pending words (source guard)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'LotPage.tsx'), 'utf8');
  assert.match(src, /<MyMaxEditor lot=\{lot\} max=\{myMax\}/, 'the same editor as the desk row');
  assert.match(src, /setSavedFields\(savedId, \{ maxUsd: n \}\)/, 'the same persistence path, by the saved id');
  assert.match(src, /result pending\{savedId \? ' · the result lands on your desk under Record' : ''\}/);
  assert.doesNotMatch(src, /results pending</, 'one phrase: the desk\'s');
  assert.match(src, /window\.history\.back\(\)/, 'the way back is history.back() — the desk\'s restore lands the reader where they left');
});
