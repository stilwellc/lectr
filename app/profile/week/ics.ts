/**
 * ics.ts — "Add to calendar" for the week, generated on the device (no
 * server, no upload): RFC 5545 text a calendar app imports.
 *
 *   timed close     DTSTART / DTEND as UTC instants ("…Z") — no VTIMEZONE
 *                   block to get wrong; the calendar app shows the reader's
 *                   own zone. The event runs 30 minutes from the close (RR's
 *                   30-minute rule, Goldin's extended bidding) with an alarm
 *                   30 minutes before it.
 *   date-only sale  an all-day event on the sale day (VALUE=DATE, DTEND the
 *                   next day, exclusive per the RFC) — the house published a
 *                   day, so the calendar gets a day, never an invented hour.
 *
 * DESCRIPTION carries the decision line (lot-face.decisionOf, the same
 * words the row prints), the house, and the lot's links. Text is escaped
 * (\ ; , newline) and lines fold at 75 octets with CRLF + space.
 */
import type { AuctionLot } from '../../types';
import { decisionOf, decisionParts } from '../../lib/lot-face';
import { craftTitle } from '../../utils';
import { safeHref } from '../../lib/safe-href';
import type { WeekRow } from './week';

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  location?: string;
  /** a timed close: the instant (ms) */
  startMs?: number;
  /** a date-only sale: the day (YYYY-MM-DD) */
  day?: string;
  /** timed only; default 30 minutes */
  durationMs?: number;
  /** timed only; default 30 minutes before */
  alarmMinutes?: number | null;
}

export const EVENT_MS = 30 * 60_000;
export const ALARM_MIN = 30;
export const PRODID = '-//lectr//the desk · your week//EN';

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYYMMDDTHHMMSSZ */
export function utcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** YYYY-MM-DD → YYYYMMDD */
export const dateStamp = (day: string): string => day.replace(/-/g, '');

/** YYYY-MM-DD + n days */
function plusDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** TEXT escaping (RFC 5545 §3.3.11) */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const enc = new TextEncoder();
/** fold a content line at 75 octets: CRLF + one space opens each continuation */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  // a continuation line's leading space is one of its 75 octets
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function prop(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

export function icsEvent(e: IcsEvent, nowMs: number): string {
  const lines: string[] = ['BEGIN:VEVENT', prop('UID', e.uid), prop('DTSTAMP', utcStamp(nowMs))];
  if (e.day) {
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(e.day)}`, `DTEND;VALUE=DATE:${dateStamp(plusDays(e.day, 1))}`);
  } else if (e.startMs != null) {
    lines.push(prop('DTSTART', utcStamp(e.startMs)), prop('DTEND', utcStamp(e.startMs + (e.durationMs ?? EVENT_MS))));
  } else {
    throw new Error('icsEvent: a start instant or a day is required');
  }
  lines.push(prop('SUMMARY', escapeText(e.summary)));
  if (e.description) lines.push(prop('DESCRIPTION', escapeText(e.description)));
  if (e.location) lines.push(prop('LOCATION', escapeText(e.location)));
  if (e.url) lines.push(prop('URL', e.url));
  const alarm = e.alarmMinutes === undefined ? ALARM_MIN : e.alarmMinutes;
  if (!e.day && alarm != null && alarm > 0) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', prop('DESCRIPTION', escapeText(e.summary)), `TRIGGER:-PT${alarm}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

export function icsCalendar(events: readonly IcsEvent[], nowMs: number, name = 'lectr · your week'): string {
  const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', prop('PRODID', PRODID), 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', prop('X-WR-CALNAME', escapeText(name))];
  return [...head, ...events.map(e => icsEvent(e, nowMs)), 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

/** the lot's page on lectr */
export function lotPageUrl(lot: AuctionLot, origin = 'https://lectr.bid'): string {
  return `${origin}/lot?id=${encodeURIComponent(lot.id)}`;
}

/** a week row as a calendar event — the decision line in the description */
export function eventOfRow(row: WeekRow, nowMs: number, origin = 'https://lectr.bid'): IcsEvent {
  const { lot } = row;
  const title = craftTitle(lot.title, lot.auctionHouse);
  const d = decisionOf(lot, nowMs);
  const decision = decisionParts(d, { when: false, close: true }).join(' · ');
  const house = safeHref(lot.url);
  const desc = [
    row.kind === 'watch' ? 'Your watch' : row.kind === 'pick' ? 'A lectr pick for you' : row.name ? `By ${row.name}${row.owned ? ' (you own a piece)' : ' (followed)'}` : null,
    decision || null,
    row.timed ? null : 'The house published the sale day, not a close time.',
    `lectr: ${lotPageUrl(lot, origin)}`,
    house ? `${lot.auctionHouse}: ${house}` : null,
  ].filter(Boolean).join('\n');
  return {
    uid: `${lot.id}@lectr.bid`,
    summary: `${row.timed ? 'Closes' : 'Sells'} · ${title} · ${lot.auctionHouse}`,
    description: desc,
    url: lotPageUrl(lot, origin),
    location: lot.auctionHouse,
    ...(row.timed ? { startMs: row.closeMs } : { day: row.day }),
  };
}

/** a safe file name: "lectr-week-2026-10-11.ics" / "lectr-2026-10-14.ics" */
export function icsFileName(label: string): string {
  return `lectr-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.ics`;
}
