/**
 * eager-book.ts — the ONE preparation every eager lot row goes through before
 * a surface reads it: the close-stamp normalization and the close-board
 * intraday bid overlay. useRayData's phase 1 (the whole upcoming.json) and
 * the first-screen payloads (app/lib/first-screen — a slice of the same rows)
 * both call it, so a lot prints the same bid, the same floored value and the
 * same "refreshed" stamp whichever payload painted it first.
 *
 * Moved verbatim out of useRayData (perf wave W13, Oct 11 2026).
 */
import type { AuctionLot } from '../types';
import { normalizeCloseStamp } from './house-tz';
import { fillHouseImages } from './house-images';
import { floorAtBid } from './value';

export interface CloseBoardJson {
  generatedAt?: string;
  bids?: Record<string, { b: number; n: number; t?: string }>;
}

/**
 * Normalize every row's close stamp, then lay the close-board's intraday bids
 * over the rows (in place). Returns the overlay's generatedAt when one was
 * read (the board's freshness stamp), else undefined.
 */
export function prepareEagerLots(lots: AuctionLot[] | undefined, cb: CloseBoardJson | null, upGen: string | undefined): string | undefined {
  // CLOSE STAMPS (Oct 9, app/lib/house-tz) — the same normalization the
  // build applies, so a payload built before it ships reads honestly too: a
  // Christie's local-midnight DAY stamp is dropped (no "12:00 AM" countdown),
  // an RR lot carries its published 7:00 PM ET close. Idempotent.
  if (lots) for (const l of lots) normalizeCloseStamp(l);
  // HOUSE PHOTOS (Oct 28, app/lib/house-images) — an RR lot the crawl shipped
  // without a photo reads its CDN preview; a payload built before the nightly
  // backfill shows photos too. Idempotent.
  fillHouseImages(lots);

  // ── CLOSE-BOARD OVERLAY — intraday bid refresh for lots closing <24h.
  // Overrides currentBid/bidCount so every surface reads close-fresh — the
  // projected close is read off the bid at view time (priority.projectedCloseOf),
  // so a fresh bid is a fresh projection (Oct 11 2026: no served projection).
  // ACCEPT RULE (Sep 2 2026). The overlay used to be applied only when its
  // generatedAt beat upcoming.json's — but close-board reads PROD's
  // upcoming.json while the nightly rebuilds a newer base, so for up to ~4h
  // after every push the whole overlay was discarded even though its bids
  // were captured hours after the base's crawl. Now a lot takes the overlay
  // when (a) the overlay as a whole is newer, OR (b) the entry carries its
  // own timestamp `t` newer than the base, OR (c) the entry's bid is
  // STRICTLY NEWER INFORMATION — a higher current bid or a higher bid
  // count (both are monotone on a live lot, so "higher" ⇒ "later"). A bid
  // that is strictly newer is never discarded; an older overlay can never
  // LOWER a bid the base already knows.
  const overlayNewer = !!cb?.bids && (!upGen || !cb.generatedAt || cb.generatedAt > upGen);
  if (cb?.bids && lots) {
    for (const l of lots) {
      const o = cb.bids[String((l as { id?: string }).id)];
      if (!o) continue;
      const lw = l as AuctionLot;
      const baseBid = lw.currentBid ?? 0;
      const baseN = lw.bidCount ?? 0;
      const entryNewer = overlayNewer
        || (!!o.t && (!upGen || o.t > upGen))
        || o.b > baseBid
        || o.n > baseN;
      if (!entryNewer) continue;
      if (o.b > 0 && o.b >= baseBid) {
        lw.currentBid = o.b;
        // (Oct 6 2026, wave 4) the engine's value is floored at the bid on
        // the lot (value.floorAtBid, applied at build) — an intraday bid
        // above last night's re-floors it, or the page prints an expected
        // hammer under the bid it shows
        if (o.b > baseBid && lw.value && lw.value.compValueUsd > 0) lw.value = floorAtBid(lw.value as unknown as Parameters<typeof floorAtBid>[0], lw, Date.now()) as unknown as typeof lw.value;
      }
      if (o.n > 0 && o.n >= baseN) lw.bidCount = o.n;
      // the lot's bid state is now INTRADAY-fresh — stamp the overlay's
      // generatedAt so surfaces can say "LIVE · refreshed Nh ago" instead
      // of letting close-day bids read as last night's numbers
      const stamp = o.t || cb.generatedAt;
      if (stamp) lw.overlayAt = stamp;
    }
  }
  return cb?.generatedAt || undefined;
}
