/**
 * img-host.ts — which auction image hosts a reader's browser actually renders
 * when lectr.bid hotlinks them (Oct 10, measured in real Chrome from a
 * lectr.bid page, 4 sampled lots per host across the served book):
 *
 *   SAFE  — CDNs that serve any referer, any UA: Sotheby's brightspot,
 *           Phillips, Bonhams, Goldin (cloudfront), RR, REA + Heritage-era
 *           archives (DigitalOcean spaces), Huggins & Scott (cloudinary),
 *           Bidsquare, iSynApp (vafloc02), the BidAmerica houses, Bruun.
 *   OK    — renders for a real browser but refuses headless / bot UAs
 *           (christies.com, Wright, LAMA, Lelands): fine for readers —
 *           measured: all 14 Christie's art faces render in real Chrome on
 *           prod; only headless captures show letter tiles (the "headless UA
 *           false alarm"), so they keep their flagship faces.
 *   LAST  — Julien's (301 to an HTML page) and Propstore (404): dead even in
 *           a real browser, chosen only when nothing else exists.
 *
 * Faces: a dead host never beats a live one; among live hosts (SAFE and OK
 * both render for readers) the most valuable picture wins (scripts/emit-
 * entities faceValueOf + betterFace) — the build and the client's live-lot
 * fallback share this one table.
 */

export type HostTier = 0 | 1 | 2;

const SAFE = /(^|\.)(brightspotcdn\.com|phillips\.com|bonhams\.com|cloudfront\.net|rrauction\.com|digitaloceanspaces\.com|cloudinary\.com|bidsquare\.com|amazonaws\.com|loveofthegameauctions\.com|memorylaneinc\.com|bruun-rasmussen\.dk)$/i;
const LAST = /(^|\.)(julienslive\.com|propstoreauction\.com)$/i;

/** 0 = renders everywhere, 1 = unknown / UA-sensitive, 2 = often a dead tile */
export function imageHostTier(url: string | null | undefined): HostTier {
  if (!url) return 2;
  let host: string;
  try { host = new URL(url).hostname; } catch { return 2; }
  if (SAFE.test(host)) return 0;
  if (LAST.test(host)) return 2;
  return 1;
}

/** is `cand` (url + value) a better face than `cur`? host tier first, then value */
export function betterFace(cur: { url: string; val: number } | null | undefined, cand: { url: string; val: number }): boolean {
  if (!cur) return true;
  const a = imageHostTier(cand.url) === 2, b = imageHostTier(cur.url) === 2;
  if (a !== b) return !a;
  return cand.val > cur.val;
}

/** the first live-host image among `lots` (order = the caller's relevance
 *  order); a dead-host photo (Julien's, Propstore) only when no other exists. */
export function bestLotImage<T extends { imageUrl?: string | null }>(lots: readonly T[]): string | null {
  let dead: string | null = null;
  for (const l of lots) {
    const u = l.imageUrl;
    if (!u) continue;
    if (imageHostTier(u) !== 2) return u;
    dead ??= u;
  }
  return dead;
}
