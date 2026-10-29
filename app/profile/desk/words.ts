/**
 * words.ts — the desk's shared WORDS, pure and Node-safe (no React, no DOM),
 * so the desk row, the lot page, the Daily Desk and the push notifications
 * print the same strings for the same lot (pass 16–18 parity law, docs/DESK.md §3).
 */
import type { AuctionLot } from '../../types';
import { fmtFace, liveBidUsd } from '../../lib/lot-face';

/** the reader's clock the paper and the push assume when no device says otherwise */
export const READER_TZ = 'America/New_York';

/** "My max $18K · bid passed it" (the USD live bid past it), "My max $18K ·
 *  $2K of room" (a bid under it), "My max $18K" (no readable bid); null with
 *  no max — ONE read for the desk row's pill, the lot page and the push */
export function myMaxText(lot: Pick<AuctionLot, 'currentBid' | 'currency' | 'fxRate' | 'priceUsd'>, max: number | null | undefined): string | null {
  if (max == null || !(max > 0)) return null;
  const usd = lot.priceUsd == null ? liveBidUsd(lot) : null;
  if (usd != null && usd > max) return `My max ${fmtFace(max)} · bid passed it`;
  if (usd != null) return `My max ${fmtFace(max)} · ${fmtFace(max - usd)} of room`;
  return `My max ${fmtFace(max)}`;
}

/** "+20%" / "−8%" / "0%" — a signed whole percent (the paper's and the push's) */
export const signedPct = (x: number): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x))}%`;

/** a result against the reader's max: "+20% vs your max $10K" — the paper's
 *  results row and the hammer push; null without a max */
export function vsMaxText(price: number, max: number | null | undefined): string | null {
  if (max == null || !(max > 0) || !(price > 0)) return null;
  return `${signedPct((price / max - 1) * 100)} vs your max ${fmtFace(max)}`;
}
