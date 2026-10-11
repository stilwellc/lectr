/**
 * "Add to calendar" (THE DESK v3) — the .ics the week writes on the device.
 *
 *  1. Stamps: UTC instants (…Z), no VTIMEZONE; a date-only sale is an
 *     all-day DATE event ending the next day (RFC 5545 exclusive end).
 *  2. Text: escaping of \ ; , and newlines; lines fold at 75 octets with
 *     CRLF + space and unfold back to the same text.
 *  3. The event of a row: summary, the decision line + links in the
 *     description, a 30-minute event with a 30-minute alarm for a timed
 *     close; an all-day event and no alarm for a day-only sale.
 *  4. The calendar wrapper and the file name.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { pinClock } from '../../../lib/__tests__/helpers/pin-clock';
import type { AuctionLot } from '../../../types';
import { utcStamp, dateStamp, escapeText, foldLine, icsEvent, icsCalendar, eventOfRow, icsFileName, lotPageUrl, EVENT_MS, ALARM_MIN } from '../ics';
import type { WeekRow } from '../week';

const NOW_ISO = '2026-10-11T20:00:00Z';
pinClock(NOW_ISO);
const NOW = Date.parse(NOW_ISO);

function lot(p: Partial<AuctionLot>): AuctionLot {
  return {
    id: 'rr-1', artist: 'entertainment-memorabilia', title: 'Hirohito Document Signed, Appointing the Secretary', year: null, medium: null, dimensions: null, category: 'object',
    imageUrl: null, auctionHouse: 'RR Auction', saleName: 'RR 751', saleDate: '2026-10-14', saleDateTime: '2026-10-14T19:00:00-04:00', lotNumber: 1,
    estimateLow: 2000, estimateHigh: null, currency: 'USD', hammerPrice: null, premiumPrice: null, priceUsd: null, status: 'upcoming',
    url: 'https://www.rrauction.com/auctions/lot-detail/1', bidCount: 15, ...p,
  } as AuctionLot;
}
const row = (p: Partial<WeekRow> & { lot: AuctionLot }): WeekRow =>
  ({ kind: 'watch', name: null, owned: false, closeMs: Date.parse(p.lot.saleDateTime || `${p.lot.saleDate}T23:59:59Z`), timed: true, day: p.lot.saleDate, estMid: null, conflictWith: [], ...p });

const unfold = (s: string) => s.replace(/\r\n[ \t]/g, '');
const lines = (s: string) => unfold(s).split('\r\n');

test('stamps are UTC instants, no VTIMEZONE; a date is YYYYMMDD', () => {
  assert.equal(utcStamp(Date.UTC(2026, 9, 14, 23, 0, 0)), '20261014T230000Z');
  assert.equal(utcStamp(Date.parse('2026-10-14T19:00:00-04:00')), '20261014T230000Z', '7 PM ET is 23:00Z');
  assert.equal(dateStamp('2026-10-15'), '20261015');
});

test('text escapes \\ ; , and newlines; long lines fold at 75 octets and unfold back', () => {
  assert.equal(escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  const long = 'DESCRIPTION:' + 'x'.repeat(200);
  const folded = foldLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    assert.ok(Buffer.byteLength(p, 'utf8') <= 75, `line ${i} is ${Buffer.byteLength(p, 'utf8')} octets`);
    if (i > 0) assert.ok(p.startsWith(' '), 'a continuation line opens with a space');
  }
  assert.equal(unfold(folded), long);
  // multibyte text folds on octets, never mid-character
  const cjk = 'SUMMARY:' + '東京の時計'.repeat(20);
  const f2 = foldLine(cjk);
  for (const p of f2.split('\r\n')) assert.ok(Buffer.byteLength(p, 'utf8') <= 75);
  assert.equal(unfold(f2), cjk);
  assert.equal(foldLine('short'), 'short');
});

test('a timed event: UTC DTSTART, DTEND 30 minutes on, an alarm 30 minutes before', () => {
  const start = Date.parse('2026-10-14T19:00:00-04:00');
  const ev = icsEvent({ uid: 'u@lectr.bid', summary: 'Closes · X', startMs: start, url: 'https://lectr.bid/lot?id=x' }, NOW);
  const L = lines(ev);
  assert.equal(L[0], 'BEGIN:VEVENT');
  assert.ok(L.includes('UID:u@lectr.bid'));
  assert.ok(L.includes(`DTSTAMP:${utcStamp(NOW)}`));
  assert.ok(L.includes('DTSTART:20261014T230000Z'));
  assert.ok(L.includes(`DTEND:${utcStamp(start + EVENT_MS)}`));
  assert.ok(L.includes('BEGIN:VALARM') && L.includes(`TRIGGER:-PT${ALARM_MIN}M`));
  assert.ok(!ev.includes('TZID') && !ev.includes('VTIMEZONE'));
  assert.equal(L[L.length - 1], 'END:VEVENT');
});

test('a date-only sale: an all-day DATE event ending the next day, no alarm', () => {
  const ev = icsEvent({ uid: 'd@lectr.bid', summary: 'Sells · Y', day: '2026-10-15' }, NOW);
  const L = lines(ev);
  assert.ok(L.includes('DTSTART;VALUE=DATE:20261015'));
  assert.ok(L.includes('DTEND;VALUE=DATE:20261016'), 'the exclusive end is the day after');
  assert.ok(!ev.includes('VALARM'));
  assert.throws(() => icsEvent({ uid: 'x', summary: 'x' }, NOW));
});

test('the event of a row carries the decision words, the house and the links; day-only rows say so', () => {
  const timed = eventOfRow(row({ lot: lot({}) }), NOW);
  assert.equal(timed.startMs, Date.parse('2026-10-14T19:00:00-04:00'));
  assert.equal(timed.day, undefined);
  assert.match(timed.summary, /^Closes · Hirohito Document Signed/);
  assert.match(timed.summary, /· RR Auction$/);
  assert.equal(timed.location, 'RR Auction');
  assert.equal(timed.url, 'https://lectr.bid/lot?id=rr-1');
  assert.ok(timed.description!.includes('Your watch'));
  assert.ok(timed.description!.includes('lectr: https://lectr.bid/lot?id=rr-1'));
  assert.ok(timed.description!.includes('RR Auction: https://www.rrauction.com/auctions/lot-detail/1'));
  assert.ok(!timed.description!.includes('not a close time'));

  const dayOnly = eventOfRow(row({ lot: lot({ id: 'ch-1', auctionHouse: "Christie's", saleDateTime: undefined, saleDate: '2026-10-16', url: 'https://www.christies.com/lot/1' }), timed: false, day: '2026-10-16', kind: 'name', name: 'Pablo Picasso' }), NOW);
  assert.equal(dayOnly.day, '2026-10-16');
  assert.equal(dayOnly.startMs, undefined);
  assert.match(dayOnly.summary, /^Sells · /);
  assert.ok(dayOnly.description!.includes('By Pablo Picasso (followed)'));
  assert.ok(dayOnly.description!.includes('The house published the sale day, not a close time.'));

  const pick = eventOfRow(row({ lot: lot({ id: 'p1', url: 'javascript:alert(1)' }), kind: 'pick' }), NOW, 'http://localhost:3000');
  assert.ok(pick.description!.includes('A lectr pick for you'));
  assert.ok(pick.description!.includes('lectr: http://localhost:3000/lot?id=p1'));
  assert.ok(!pick.description!.includes('javascript:'), 'a non-http house URL is dropped (safe-href)');
  assert.equal(lotPageUrl(lot({ id: 'a b' })), 'https://lectr.bid/lot?id=a%20b');
});

test('the calendar wraps its events with CRLF line ends; the file name is safe', () => {
  const cal = icsCalendar([{ uid: 'a', summary: 'A', day: '2026-10-15' }, { uid: 'b', summary: 'B; with, marks', startMs: NOW + 3_600_000 }], NOW, 'lectr · week 2026-10-11');
  const L = lines(cal);
  assert.equal(L[0], 'BEGIN:VCALENDAR');
  assert.equal(L[1], 'VERSION:2.0');
  assert.ok(L.includes('METHOD:PUBLISH'));
  assert.ok(L.includes('X-WR-CALNAME:lectr · week 2026-10-11'));
  assert.equal(L.filter(x => x === 'BEGIN:VEVENT').length, 2);
  assert.ok(L.includes('SUMMARY:B\\; with\\, marks'));
  assert.ok(cal.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/\n(?!$)/.test(cal.replace(/\r\n/g, '')), 'no bare LF');
  assert.equal(icsFileName('week 2026-10-11'), 'lectr-week-2026-10-11.ics');
  assert.equal(icsFileName('2026-10-14 Hirohito Document Signed, Appointing'), 'lectr-2026-10-14-hirohito-document-signed-appointing.ics');
});
