/**
 * house-images — a lot photo derived from the house's own id scheme when the
 * crawl carried none (Oct 28 2026).
 *
 * RR AUCTION: the listing crawl lazy-loads photos, so most live RR lots ship
 * without an imageUrl (236 of 871 carried one on Oct 28) and the Daily Desk
 * printed grey tiles for every Schulz and Edison pick. The id encodes the
 * photo: `rrauction-<sale>-<lotId>`, where the 15-digit lotId is
 * <item 7><sale 4><lot 4>, and the CDN serves
 * `https://cdn.rrauction.com/auction/<sale>/preview/<item>_1.jpg` for every
 * lot (verified Oct 28 on sales 746 (archive), 752 and 753, and through
 * Gmail's image proxy). Fill ONLY a missing url — a house-set url always wins.
 */
import type { AuctionLot } from '../types';

const RR = /^rrauction-(\d+)-(\d{15})~?$/;

/** the RR preview photo for an RR-shaped id; null for any other id */
export function rrPreviewImage(id: string | null | undefined): string | null {
  const m = RR.exec(String(id || ''));
  if (!m) return null;
  return `https://cdn.rrauction.com/auction/${Number(m[1])}/preview/${m[2].slice(0, 7)}_1.jpg`;
}

/** a lot's photo, or the house-derived one when the crawl carried none */
export function imageOf(l: Pick<AuctionLot, 'id' | 'imageUrl'>): string | null {
  return l.imageUrl || rrPreviewImage(l.id);
}

/** fill the missing photos in place (idempotent); returns how many were filled */
export function fillHouseImages(lots: readonly Pick<AuctionLot, 'id' | 'imageUrl'>[] | undefined): number {
  let n = 0;
  if (!lots) return 0;
  for (const l of lots) {
    if (l.imageUrl) continue;
    const u = rrPreviewImage(l.id);
    if (u) { (l as { imageUrl?: string | null }).imageUrl = u; n++; }
  }
  return n;
}
