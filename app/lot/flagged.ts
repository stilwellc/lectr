import fs from 'node:fs';
import path from 'node:path';
import type { AuctionLot } from '../types';

/**
 * The build-time flagged set — the lots whose crawl-time signal says
 * 'Below Market' in public/data/ray/upcoming.json. These are THE static
 * permalinks (/lot/<id>): a bounded, high-signal set (~100 today), never the
 * whole book — Cloudflare Pages caps a deploy at 20,000 files, so the
 * universal /lot?id= route carries everything else client-side.
 *
 * SERVER-ONLY (node:fs): imported by generateStaticParams/generateMetadata
 * and sitemap.ts at build. Never import from a client component — the
 * browser webpack config stubs fs to false.
 */
let cache: AuctionLot[] | null = null;

export function flaggedLots(): AuctionLot[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'public', 'data', 'ray', 'upcoming.json'),
      'utf8',
    );
    const lots: AuctionLot[] = (JSON.parse(raw)?.lots as AuctionLot[]) || [];
    const seen = new Set<string>();
    let flagged = lots.filter(l => {
      if (!l || typeof l.id !== 'string' || !l.id) return false;
      if (l.signal?.label !== 'Below Market') return false;
      if (seen.has(l.id)) return false; // dupe ids would collide as params
      seen.add(l.id);
      return true;
    });
    // deploy-cap guard: if the flag set ever balloons, keep the 500 soonest
    // hammers — the ones a reader can still act on.
    if (flagged.length > 500) {
      flagged = [...flagged]
        .sort((a, b) => (a.saleDate || '9999').localeCompare(b.saleDate || '9999'))
        .slice(0, 500);
    }
    cache = flagged;
  } catch {
    cache = []; // no upcoming.json (fresh checkout) — build ships zero static lots
  }
  return cache;
}
