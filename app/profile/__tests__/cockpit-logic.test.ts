import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinClock } from '../../lib/__tests__/helpers/pin-clock';
import { addDays, dowLetter, estMidOf, hammerStrip, streakOf, stripCaption } from '../desk/cockpit-logic';

pinClock('2026-10-09T16:00:00-04:00');

test('addDays: local calendar arithmetic, month and year ends included', () => {
  assert.equal(addDays('2026-10-09', 0), '2026-10-09');
  assert.equal(addDays('2026-10-09', 1), '2026-10-10');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-07', 2), '2026-03-09'); // across a US DST change
});

test('dowLetter: Oct 9 2026 is a Friday', () => {
  assert.equal(dowLetter('2026-10-09'), 'F');
  assert.equal(dowLetter('2026-10-11'), 'S');
  assert.equal(dowLetter('2026-10-12'), 'M');
});

test('estMidOf: two-sided midpoint; a one-sided estimate counts at its side; none is 0', () => {
  assert.equal(estMidOf({ estimateLow: 1000, estimateHigh: 3000 }), 2000);
  assert.equal(estMidOf({ estimateLow: 1000, estimateHigh: null }), 1000);
  assert.equal(estMidOf({ estimateLow: null, estimateHigh: 500 }), 500);
  assert.equal(estMidOf({}), 0);
});

test('hammerStrip: 14 days from today, counts and estimate totals per reader-day, today marked', () => {
  const lots = [
    { day: '2026-10-09', est: 100 },  // today
    { day: '2026-10-11', est: 0 },    // bid-only lot: counted, adds nothing
    { day: '2026-10-11', est: 250 },
    { day: '2026-10-22', est: 10 },   // day 13: the last column
    { day: '2026-10-23', est: 10 },   // past the window: not counted
    { day: '2026-10-08', est: 10 },   // yesterday: not counted
    { day: '', est: 10 },             // no day: not counted
  ];
  const s = hammerStrip(lots, '2026-10-09');
  assert.equal(s.length, 14);
  assert.equal(s[0].day, '2026-10-09'); assert.equal(s[0].today, true); assert.equal(s[0].n, 1); assert.equal(s[0].est, 100);
  assert.equal(s[1].today, false);
  assert.equal(s[2].day, '2026-10-11'); assert.equal(s[2].n, 2); assert.equal(s[2].est, 250);
  assert.equal(s[13].day, '2026-10-22'); assert.equal(s[13].n, 1);
  assert.equal(s.reduce((a, d) => a + d.n, 0), 4);
  assert.deepEqual(s.map(d => d.dow).slice(0, 7), ['F', 'S', 'S', 'M', 'T', 'W', 'T']);
});

test('streakOf: trailing same-sign run of 2+; a flat call ends it; a lone call is no streak', () => {
  assert.deepEqual(streakOf([{ pct: -5 }, { pct: 12 }, { pct: 3 }, { pct: 30 }]), { n: 3, dir: 'beat' });
  assert.deepEqual(streakOf([{ pct: 12 }, { pct: -3 }, { pct: -30 }]), { n: 2, dir: 'missed' });
  assert.equal(streakOf([{ pct: 12 }, { pct: 12 }, { pct: 0.2 }]), null); // rounds to 0: ends the run at once
  assert.equal(streakOf([{ pct: -4 }, { pct: 12 }]), null);
  assert.equal(streakOf([]), null);
});

test('stripCaption: honest counts, next day word, the busiest day only when it differs', () => {
  const none = hammerStrip([], '2026-10-09');
  assert.equal(stripCaption(none), 'nothing of yours closes in the next 14 days');
  const one = hammerStrip([{ day: '2026-10-10', est: 0 }], '2026-10-09');
  assert.equal(stripCaption(one), '1 lot closes in 14 days · next tomorrow');
  const today = hammerStrip([{ day: '2026-10-09', est: 0 }, { day: '2026-10-09', est: 0 }], '2026-10-09');
  assert.equal(stripCaption(today), '2 lots close in 14 days · next today');
  const busy = hammerStrip([{ day: '2026-10-11', est: 0 }, { day: '2026-10-14', est: 0 }, { day: '2026-10-14', est: 0 }, { day: '2026-10-14', est: 0 }], '2026-10-09');
  assert.equal(stripCaption(busy), '4 lots close in 14 days · next Sun, Oct 11 · busiest Wed, Oct 14 (3)');
});
