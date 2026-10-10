import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeQuarters, headlineRead, quarterOrdinal, HEAD_MIN_N } from '../maker-hero';
import { playerRowTag, latestContiguousRun } from '../player-rows';

const OCT9 = Date.parse('2026-10-09T20:00:00Z');

test('maker hero: the quarter in progress is never read or drawn', () => {
  const s = [
    { date: '2026 Q2', value: 697, n: 12348 },
    { date: '2026 Q3', value: 750, n: 13822 },
    { date: '2026 Q4', value: 397, n: 629 },
  ];
  const c = completeQuarters(s, OCT9);
  assert.deepEqual(c.map(p => p.date), ['2026 Q2', '2026 Q3']);
  assert.equal(headlineRead(c, 'price')!.head.value, 750);
  assert.equal(quarterOrdinal('2026-Q4'), quarterOrdinal('2026 Q4'));
});

test('maker hero: "a year ago" is the same calendar quarter, never an array offset', () => {
  // Fossils: the 5th-from-last point was 7 quarters back
  const s = [
    { date: '2024 Q4', value: 5_470_000, n: 40 },
    { date: '2025 Q4', value: 30_000, n: 40 },
    { date: '2026 Q1', value: 31_000, n: 40 },
    { date: '2026 Q2', value: 32_000, n: 40 },
    { date: '2026 Q3', value: 38_000, n: 40 },
  ];
  const r = headlineRead(s, 'price')!;
  assert.equal(r.yearAgo, null);
  assert.equal(r.dir, null);
});

test('maker hero: direction words need depth on both sides and a real move', () => {
  const thin = [{ date: '2025 Q3', value: 1000, n: 12 }, { date: '2026 Q3', value: 210, n: 15 }];
  assert.equal(headlineRead(thin, 'price')!.dir, null); // Game Worn "cooling" on n=15
  const onePoint = [{ date: '2025 Q3', value: -20, n: 300 }, { date: '2026 Q3', value: -21, n: 300 }];
  assert.equal(headlineRead(onePoint, 'demand')!.dir, null); // Bacon "−21% cooling, was −20%"
  const real = [{ date: '2025 Q3', value: -10, n: 300 }, { date: '2026 Q3', value: -3, n: 300 }];
  assert.equal(headlineRead(real, 'demand')!.dir, 'up');
  assert.equal(headlineRead([{ date: '2026 Q3', value: 5, n: HEAD_MIN_N - 1 }], 'demand'), null);
});

test('player rows: tags come from the title in the live chips\' words', () => {
  assert.deepEqual(playerRowTag('Mickey Mantle Single-Signed OAL Brown Baseball - PSA/DNA LOA', 'sports-cards'), { label: 'Autographs', card: false });
  assert.equal(playerRowTag('1952 Topps #311 Mickey Mantle (Freshly Graded) - CSG NM-MT 8', 'graded-cards').card, true);
  assert.equal(playerRowTag('2018 Upper Deck Goodwin Champions Exquisite Rookie Autograph #09T-SO Shohei Ohta', 'autographs').card, true);
  assert.equal(playerRowTag('2013 BBM Nippon-Ham Fighters The Two-Sword Player #F98 Shohei Ohtani - PSA EX 5', 'sports-cards').card, true);
  assert.equal(playerRowTag('60 Mickey Mantle Game-Used, Photo-Matched, Signed New York Yankees Home', 'game-used').label, 'Game-Used & Worn');
  assert.equal(playerRowTag('2024 Shohei Ohtani Signed MLB Debut, Postseason Debut Full Tickets Pair', 'tickets-passes').label, 'Tickets & Passes');
});

test('player line: drawn over the latest consecutive years only', () => {
  const { run, dropped } = latestContiguousRun([{ y: 2019 }, { y: 2023 }, { y: 2024 }, { y: 2025 }, { y: 2026 }]);
  assert.deepEqual(run.map(p => p.y), [2023, 2024, 2025, 2026]);
  assert.deepEqual(dropped.map(p => p.y), [2019]);
  assert.deepEqual(latestContiguousRun([]).run, []);
});
