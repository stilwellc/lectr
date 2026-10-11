/**
 * W26 ranking noise (Oct 11 2026 collector review), pinned to rows from the
 * served book that showed each problem:
 *  1. size gates the Below-Market / closing-soon boosts (a $2K flagged print
 *     sat above a $3M canvas closing beside it)
 *  2. spread() holds a lot back only for a near peer (NFL jerseys on Sports p1)
 *  3. the shortlist never seats a results-pending lot ("Sells today" on a
 *     Christie's lot whose sale had closed)
 *  4. the projection knee (26× a $68 TCG bid printed as a projected close)
 *  5. the reason line names what drives the rank
 *  6. a thin week reaches into the second (the $3.47M Trophy Pikachu)
 *  7. editions and raw+graded numbered cards fold; "+1 more BGS 9"
 *  8. a remembered / picked house the market has no lot from
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinClock } from './helpers/pin-clock';
import { ROWS } from './helpers/ranking-rows-oct11';
import { priorityOf, shortlist, spread, reasonOf, projectedCloseOf, projectionK, closeMsOf } from '../priority';
import { closeKOf, closeKRoomOf, setCloseK, resetCloseK, CLOSE_K_DEFAULT, CLOSE_K_ROOMS } from '../close-k';
import { foldVariants, foldNote, foldKeyOf } from '../fold';
import { restoreParams, houseOptions } from '../feed-filters';
import { taxonOf } from '../taxonomy';

const NOW_ISO = '2026-10-11T18:00:00Z';
pinClock(NOW_ISO);
const NOW = Date.parse(NOW_ISO);
type Row = (typeof ROWS)[keyof typeof ROWS];
const clone = <T extends Row>(r: T, patch: Record<string, unknown>) => ({ ...r, ...patch }) as T & Record<string, unknown>;

test('1 · a $2K flagged print scores under an unflagged $3M canvas closing the same day', () => {
  const kaws = ROWS.kawsTensionA; // Rago, $2K, Below Market (+97%), sells Oct 14
  assert.equal(kaws.signal?.label, 'Below Market');
  const canvas = clone(ROWS.baconFigure, { id: 'canvas-3m', estimateLow: 2_500_000, estimateHigh: 3_500_000, saleDate: kaws.saleDate, auctionHouse: 'Rago', saleName: kaws.saleName });
  const pk = priorityOf(kaws, NOW)!, pc = priorityOf(canvas, NOW)!;
  assert.ok(pk.edge > 0, 'the flag still reads as edge');
  assert.ok(pk.score < pc.score, `flagged $2K ${pk.score} < unflagged $3M ${pc.score}`);
  // the $5K Picasso Toros poster (flagged, What matters #5 before) no longer seats
  assert.equal(shortlist([ROWS.picassoToros], NOW, 20).length, 0);
  // a big enough flagged lot keeps its full lift: Hibou rouge ($12K) is partial, a $60K one full
  const big = clone(ROWS.hibou, { id: 'hibou-60k', estimateLow: 60_000, estimateHigh: 60_000 });
  const hb = priorityOf(ROWS.hibou, NOW)!, bb = priorityOf(big, NOW)!;
  assert.ok(bb.score - 40 * bb.size > hb.score - 40 * hb.size, 'the boost grows with size');
});

test('2 · spread: a capped lot yields its place only to a near peer', () => {
  const ohtani = ROWS.ohtaniGold; // Goldin Elite, ~$488K projected
  const sale = Array.from({ length: 4 }, (_, i) => clone(ohtani, { id: `ohtani-${i}`, title: `${ohtani.title} (${i})` }));
  const jersey = ROWS.broncosJersey; // NFL Auction, ~$2.8K projected
  const sJ = priorityOf(jersey, NOW)!.score, sO = priorityOf(ohtani, NOW)!.score;
  assert.ok(sJ < 0.75 * sO, `jersey ${sJ} is no peer of ${sO}`);
  const out = spread([...sale, jersey], 12, 3, 600, NOW);
  assert.deepEqual(out.map(l => l.id), ['ohtani-0', 'ohtani-1', 'ohtani-2', 'ohtani-3', jersey.id], 'the 4th Goldin lot keeps its place');
  // a peer from another sale still breaks the run (the 3-per-sale rule stands)
  const peer = clone(ohtani, { id: 'peer', auctionHouse: 'REA', saleName: 'REA Fall', title: '1952 Topps #311 Mickey Mantle PSA 8' });
  const out2 = spread([...sale, peer], 12, 3, 600, NOW);
  assert.deepEqual(out2.map(l => l.id), ['ohtani-0', 'ohtani-1', 'ohtani-2', 'peer', 'ohtani-3']);
});

test('3 · the shortlist never seats a results-pending lot', () => {
  const bat = ROWS.ruthBat; // Christie's, sale day Oct 11, crawler-marked results pending
  assert.equal(bat.resultsPending, true);
  assert.equal(shortlist([bat], NOW, 20).length, 0);
  assert.equal(shortlist([clone(bat, { resultsPending: false })], NOW, 20).length, 1, 'the flag alone keeps it out');
});

test('4 · the projection knee: k ≤ 3 stands, past it bid·√(3k); the refit path feeds it', () => {
  assert.equal(projectionK(1.3), 1.3);
  assert.equal(projectionK(3), 3);
  assert.ok(Math.abs(projectionK(26.4) - Math.sqrt(79.2)) < 1e-9);
  const j = ROWS.jolteon; // Goldin Weekly TCG, $68 bid, no engine value
  const days = (closeMsOf(j)! - NOW) / 864e5;
  const room = closeKRoomOf(j.auctionHouse, j.saleName, taxonOf(j).cat)!;
  assert.equal(room, 'goldin-weekly-tcg');
  resetCloseK();
  const k0 = closeKOf(room, days, j.currentBid!);
  assert.ok(k0 > 3, `compiled cell ${k0}`);
  assert.equal(projectedCloseOf(j, NOW)!.hammer, Math.round(j.currentBid! * Math.sqrt(3 * k0)));
  // the served nightly refit (close-k.json via setCloseK) is still what is read: the Oct 11 cell (26.4×)
  const rooms = Object.fromEntries(CLOSE_K_ROOMS.map(r => [r, { k: CLOSE_K_DEFAULT[r].map(row => row.slice()) }]));
  const g = rooms[room].k; for (const row of g) for (let b = 0; b < row.length; b++) row[b] = Math.max(row[b], 1);
  g[days < 1 ? 0 : days < 3 ? 1 : days < 7 ? 2 : days < 14 ? 3 : 4][0] = 26.4;
  assert.equal(setCloseK({ v: 1, rooms }), true);
  try {
    const pc = projectedCloseOf(j, NOW)!;
    assert.equal(pc.hammer, Math.round(j.currentBid! * Math.sqrt(3 * 26.4)), `~${pc.hammer}: 8.9×, not 26.4× ($1,795)`);
    assert.ok(pc.hammer / j.currentBid! < 9);
  } finally { resetCloseK(); }
});

test('5 · the reason line names what drives the rank', () => {
  // the certified flag: its magnitude, pool and confidence
  assert.equal(reasonOf(ROWS.hibou, NOW), 'Sells in 2 days · Below market +42% · 14 comps, high confidence');
  // an estimate lot names its standing on the board that seated it — in a real field only
  const bacon = clone(ROWS.baconFigure, {});
  const field = Array.from({ length: 12 }, (_, i) => clone(ROWS.baconFigure, { id: `fa-${i}`, title: `Work ${i}`, artist: `maker-${i}`, estimateLow: 200_000 + i * 10_000, estimateHigh: 300_000 + i * 10_000 }));
  assert.equal(reasonOf(bacon, NOW), 'Sells in 3 days', 'no board, no claim');
  const seated = shortlist([bacon, ...field], NOW, 20);
  assert.ok(seated.includes(bacon));
  assert.equal(reasonOf(bacon, NOW), 'Sells in 3 days · Top Fine Art estimate this week');
  const thin = clone(ROWS.baconFigure, { id: 'thin' });
  shortlist([thin, field[0], field[1]], NOW, 20);
  assert.equal(reasonOf(thin, NOW), 'Sells in 3 days', 'Top of 3 is not news');
});

test('6 · a thin week reaches into the second: the $3.47M Trophy Pikachu seats', () => {
  const trophy = ROWS.trophyPikachu; // Goldin Thematic, closes Oct 26 02:00Z (14.3 days)
  const h = (closeMsOf(trophy)! - NOW) / 3_600_000;
  assert.ok(h > 168 && h < 360, `${h}h out`);
  const week = [ROWS.charizardPsa10, ROWS.ohtaniGold];
  assert.ok(shortlist([trophy, ...week], NOW, 20).includes(trophy));
  assert.match(reasonOf(trophy, NOW)!, /^Closes in 14 days · ~\$/);
  // a week that fills every seat never reaches past it
  assert.ok(!shortlist([trophy, ...week], NOW, 1).includes(trophy));
});

test('7 · fold: editions by maker + title, numbered raw + graded cards, "+1 more BGS 9"', () => {
  // two $2K Rago KAWS prints, one edition
  const f1 = foldVariants([ROWS.kawsTensionA, ROWS.kawsTensionB], NOW);
  assert.equal(f1.reps.length, 1);
  assert.equal(foldNote(f1.reps[0], f1.siblings.get(f1.reps[0].id)!, f1.kind.get(f1.reps[0].id)!), '+1 more of this lot');
  // a unique work still never folds on a shared title
  const paint = (id: string) => ({ id, title: 'Untitled (Black and White Composition)', artist: 'christopher-wool', subCat: 'paintings', auctionHouse: "Christie's" });
  assert.equal(foldKeyOf(paint('p1')), null);
  // the raw #3 Charizard folds with its PSA 10 and BGS 9.5
  const f2 = foldVariants([ROWS.charizardPsa10, ROWS.charizardBgs95, ROWS.charizardRaw], NOW);
  assert.equal(f2.reps.length, 1);
  const rep = f2.reps[0];
  assert.equal(rep.id, ROWS.charizardPsa10.id);
  assert.equal(foldNote(rep, f2.siblings.get(rep.id)!, 'card'), '+2 more BGS 9.5, raw');
  // two BGS 9 Gold Star Pikachus
  const f3 = foldVariants([ROWS.pikachuBgs9a, ROWS.pikachuBgs9b], NOW);
  assert.equal(foldNote(f3.reps[0], f3.siblings.get(f3.reps[0].id)!, 'card'), '+1 more BGS 9');
  // a gradeless title with no card number is too loose to call one card
  const noNo = (id: string, t: string) => ({ ...ROWS.charizardRaw, id, title: t });
  assert.notEqual(foldKeyOf(noNo('x1', '2002 Pokemon Legendary Collection Reverse Holo Charizard'))?.key,
    foldKeyOf(noNo('x2', '2002 Pokemon Legendary Collection Reverse Holo Charizard - PSA GEM MT 10'))?.key);
  // and the shortlist seats the numbered card once
  const s = shortlist([ROWS.charizardPsa10, ROWS.charizardRaw, ROWS.charizardBgs95], NOW, 20);
  assert.equal(s.length, 1);
});

test('8 · houses: a remembered house with no lot here is dropped; a picked absent house shows its 0', () => {
  const mem = { m: 'sports', p: 'house=NFL+Auction&win=week' };
  assert.equal(restoreParams(mem, 'art', new Set(['Christie\'s', 'Rago']))!.toString(), 'win=week');
  assert.equal(restoreParams(mem, 'sports', new Set(['NFL Auction', 'Goldin']))!.get('house'), 'NFL Auction');
  assert.equal(restoreParams(mem, 'art')!.get('house'), 'NFL Auction', 'without the book the house travels');
  const lots = [ROWS.kawsTensionA, ROWS.kawsTensionB, ROWS.hibou];
  assert.deepEqual(houseOptions(lots, null), [['Rago', 2], ['Wright', 1]]);
  assert.deepEqual(houseOptions(lots, 'NFL Auction'), [['Rago', 2], ['Wright', 1], ['NFL Auction', 0]]);
});
