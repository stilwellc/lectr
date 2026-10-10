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
 *           (Wright, LAMA, Lelands): fine for readers, fragile for previews.
 *   LAST  — christies.com (Akamai: refuses headless UAs outright and is the
 *           host PlateImg's ORB note was written about), Julien's (301 to an
 *           HTML page) and Propstore (404): a face here is a letter tile for
 *           some readers, so it is chosen only when nothing else exists.
 *
 * Faces are picked by host tier first, then by value (scripts/emit-entities
 * faceValueOf + betterFace) — the build and the client's live-lot fallback
 * share this one table.
 */

export type HostTier = 0 | 1 | 2;

const SAFE = /(^|\.)(brightspotcdn\.com|phillips\.com|bonhams\.com|cloudfront\.net|rrauction\.com|digitaloceanspaces\.com|cloudinary\.com|bidsquare\.com|amazonaws\.com|loveofthegameauctions\.com|memorylaneinc\.com|bruun-rasmussen\.dk)$/i;
const LAST = /(^|\.)(christies\.com|julienslive\.com|propstoreauction\.com)$/i;

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
  const a = imageHostTier(cand.url), b = imageHostTier(cur.url);
  if (a !== b) return a < b;
  return cand.val > cur.val;
}

/** the first image among `lots` on the best host tier (order = the caller's
 *  relevance order). A christies photo is used only when no other lot has one. */
export function bestLotImage<T extends { imageUrl?: string | null }>(lots: readonly T[]): string | null {
  let best: string | null = null;
  let tier = 3;
  for (const l of lots) {
    const u = l.imageUrl;
    if (!u) continue;
    const t = imageHostTier(u);
    if (t < tier) { best = u; tier = t; if (t === 0) break; }
  }
  return best;
}
