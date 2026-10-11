/**
 * "Tonight" on the reader's calendar (Oct 11 2026 — R1 #4 / R4 P2-6 / R5):
 * at 00:40 on Sun Oct 11 the Today band said "none close tonight — the next
 * closes Sun, Oct 11" while a pick closed at 10 PM that day. Tonight now ends
 * at the 4am after the reader's evening (the date on their clock decides
 * which evening), and the next close is worded today / tonight / tomorrow /
 * a date relative to the same clock. Pinned to New York so DST nights are
 * real (Nov 1 2026 falls back, Mar 8 2026 springs forward).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tonightEndMs, closeWhenText, calendarDaysBetween } from '../close-time';
import { pickStrips, tonightEndMs as fromRecs } from '../recs';

// Node re-reads TZ when it is assigned; nothing above touches a Date at import
process.env.TZ = 'America/New_York';

/** local wall time in New York → epoch ms */
const ny = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const wall = (ms: number) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('the clock under test is New York', () => {
  assert.equal(new Date(ny(2026, 10, 11, 0, 40)).toISOString(), '2026-10-11T04:40:00.000Z');
});

test('tonight ends at the 4am after the evening on the reader\'s date — before and after midnight', () => {
  assert.equal(wall(tonightEndMs(ny(2026, 10, 10, 20, 0))), '10/11 4:00', 'Sat 8 PM → Sun 4am');
  assert.equal(wall(tonightEndMs(ny(2026, 10, 10, 23, 59))), '10/11 4:00', 'Sat 11:59 PM → Sun 4am');
  assert.equal(wall(tonightEndMs(ny(2026, 10, 11, 0, 40))), '10/12 4:00', 'Sun 00:40 → tonight is Sunday night (THE bug)');
  assert.equal(wall(tonightEndMs(ny(2026, 10, 11, 3, 59))), '10/12 4:00', 'Sun 3:59 AM → Sunday night');
  assert.equal(wall(tonightEndMs(ny(2026, 10, 11, 4, 0))), '10/12 4:00', 'Sun 4 AM → Sunday night');
  assert.equal(wall(tonightEndMs(ny(2026, 10, 11, 12, 0))), '10/12 4:00');
  assert.equal(fromRecs, tonightEndMs, 'recs re-exports the one definition');
});

test('at 00:40 a 10 PM close the same day IS tonight (the pick strip agrees with the card)', () => {
  const now = ny(2026, 10, 11, 0, 40);
  const close = ny(2026, 10, 11, 22, 0);
  assert.ok(close <= tonightEndMs(now));
  const lot = { id: 'g1', artist: 'sports-cards', title: '1986 Fleer #57 Michael Jordan - PSA 8', status: 'upcoming', saleDateTime: new Date(close).toISOString(), saleDate: '2026-10-11' };
  const s = pickStrips([{ lot, score: 1, reason: 'x', why: [] } as never], { isNew: () => false, nowMs: now });
  assert.deepEqual(s.closing.map(r => (r.lot as { id: string }).id), ['g1']);
  assert.equal(closeWhenText(close, now), 'tonight at 10:00 PM');
});

test('DST: the fall-back and spring-forward nights still end at 4am wall time', () => {
  // Nov 1 2026 01:00–02:00 happens twice; Sat Oct 31 evening's night ends Sun 4am EST
  const fb = tonightEndMs(ny(2026, 10, 31, 21, 0));
  assert.equal(wall(fb), '11/1 4:00');
  assert.equal(fb - ny(2026, 10, 31, 21, 0), 8 * 3_600_000, '7 wall hours + the repeated hour');
  // Sun Nov 1 00:30 (still EDT) → Sunday night, ending Mon 4am EST
  assert.equal(wall(tonightEndMs(ny(2026, 11, 1, 0, 30))), '11/2 4:00');
  // Mar 8 2026: 2am → 3am. Sat Mar 7 9 PM → Sun 4am EDT, one hour shorter
  const sf = tonightEndMs(ny(2026, 3, 7, 21, 0));
  assert.equal(wall(sf), '3/8 4:00');
  assert.equal(sf - ny(2026, 3, 7, 21, 0), 6 * 3_600_000);
  assert.equal(calendarDaysBetween(ny(2026, 3, 7, 23, 0), ny(2026, 3, 8, 23, 0)), 1, 'a 23-hour day is still one day');
  assert.equal(calendarDaysBetween(ny(2026, 10, 31, 23, 0), ny(2026, 11, 1, 23, 0)), 1, 'a 25-hour day is still one day');
});

test('the next close in the reader\'s words: today / tonight / tomorrow / a date', () => {
  const sun0040 = ny(2026, 10, 11, 0, 40);
  assert.equal(closeWhenText(ny(2026, 10, 11, 14, 0), sun0040), 'today at 2:00 PM');
  assert.equal(closeWhenText(ny(2026, 10, 11, 1, 30), sun0040), 'tonight at 1:30 AM', 'the small hours are still tonight');
  assert.equal(closeWhenText(ny(2026, 10, 12, 21, 0), sun0040), 'tomorrow at 9:00 PM');
  assert.equal(closeWhenText(ny(2026, 10, 12, 23, 59), sun0040, false), 'tomorrow', 'a date-only sale has no clock time');
  assert.equal(closeWhenText(ny(2026, 10, 13, 18, 0), sun0040), 'Tue, Oct 13');
  const sat2300 = ny(2026, 10, 10, 23, 0);
  assert.equal(closeWhenText(ny(2026, 10, 11, 1, 30), sat2300), 'tonight at 1:30 AM', 'after midnight, before tonight ends');
  assert.equal(closeWhenText(ny(2026, 10, 11, 21, 0), sat2300), 'tomorrow at 9:00 PM');
  assert.equal(closeWhenText(ny(2026, 10, 11, 23, 59), ny(2026, 10, 11, 0, 40), false), 'today', 'never a bare date that is today');
});
