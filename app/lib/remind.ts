/**
 * remind.ts — "Remind me": hand a lot's close to the reader's calendar as an
 * .ics (utils.makeAuctionIcs — timed at the hammer when the house publishes a
 * close time, else an all-day block). One handler for every surface that
 * offers it (the lot card, the lot page). Nothing leaves the device: the file
 * is minted in the browser and handed to the OS calendar. Returns false when
 * the lot has no usable sale date (no file, never a throw in a click handler).
 */
import { makeAuctionIcs } from '../utils';
import { track } from './analytics';

export function addLotToCalendar(lot: Parameters<typeof makeAuctionIcs>[0]): boolean {
  const ics = makeAuctionIcs(lot);
  if (!ics) return false;
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  // window.open preserves the user-gesture context on iOS Safari so the
  // system intercepts the .ics MIME type and offers to add it to Calendar.
  const opened = window.open(url, '_blank');
  if (!opened) {
    // popup blocked (desktop) — fall back to a hidden download anchor
    const a = document.createElement('a');
    a.href = url;
    a.download = `auction-${lot.id}.ics`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  track('calendar_add');
  return true;
}
