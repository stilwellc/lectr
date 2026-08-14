// CLOSE-DAY BOARD — the intraday leg of the timeliness fix (Aug 14 audit:
// vsBid was ~18-20h stale at the soft-close decision moment; the fitted curve
// says lots 8+ days out close at 5.7× the nightly bid).
//
// Every ~4h (cron in close-board.yml): refetch CURRENT bids for lots closing
// within 24h — Goldin via its lots API (grouped per auction, cheap), REA via
// its plain lot pages — recompute the projection + deep-value read with the
// served close curve, and write public/data/ray/close-board.json. The CI job
// commits the file; the on-push deploy ships it; the client merges the
// overlay over the eager payload. The corpus is untouched — this is a small
// overlay, not a build.
//   RAY_SKIP_MAIN=1 npx tsx scripts/close-board.ts [--source https://lectr.bid]
import * as fs from 'fs';
import * as path from 'path';
import { lotAllInFactor } from '../app/lib/premiums';
import { marketOf } from '../app/constants';
import { hasConditionFlag } from './lib/condition';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const GOLDIN_API = 'https://d1wu47wucybvr3.cloudfront.net/api/lots_v2';
const argStr = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const argNum = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : d; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Lot = {
  id: string; artist?: string; auctionHouse?: string; title?: string;
  saleDate?: string; saleDateTime?: string | null;
  currentBid?: number; bidCount?: number; auctionId?: string;
  buyerPremiumPct?: number | null; url?: string;
  value?: { low?: number; confidence?: string };
  cardComps?: { med?: number | null; n?: number };
  bidProj?: { g: number; allIn: number; floor?: number; below?: boolean };
};

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

async function main() {
  const src = argStr('source', 'https://lectr.bid');
  const up = await fetchJson(`${src}/data/ray/upcoming.json?cb=${Date.now()}`);
  const mj = await fetchJson(`${src}/data/ray/market.json?cb=${Date.now()}`);
  const curve = mj?.markets?.all?.analytics?.closeCurve as { buckets: (number | null)[]; edges: number[] } | undefined;
  if (!curve?.buckets?.length) { console.log('[close-board] no close curve served — nothing to do'); return; }

  const now = Date.now();
  const lots: Lot[] = (up?.lots || []) as Lot[];
  const hours = argNum('hours', 24);
  const closing = lots.filter(l => {
    const t = new Date(String(l.saleDateTime || l.saleDate || '')).getTime();
    return !isNaN(t) && t > now && t - now < hours * 3600e3;
  });
  console.log(`[close-board] ${closing.length} lots close within ${hours}h (of ${lots.length} live)`);

  // ── refresh bids ──────────────────────────────────────────────────────────
  const freshBid = new Map<string, { b: number; n: number }>();

  // Goldin: the served payload strips auctionId, so refresh via the two
  // category passes that cover the bid book (Sport + Pokémon) and map by
  // lot_id — ~45 pages total, far cheaper than per-lot fetches.
  const goldinClosing = closing.some(l => l.auctionHouse === 'Goldin');
  if (goldinClosing) {
    for (const scope of [
      { category: ['Sport'] },
      { category: ['Non-Sport'], sub_category: ['Pokemon'] },
    ]) {
      let from = 0, total = Infinity;
      while (from < Math.min(total, 9000)) {
        try {
          const r = await fetch(GOLDIN_API, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
            body: JSON.stringify({ search: { queryType: 'Featured', hasAnalyticsConsent: false, ...scope, size: 100, from } }),
            signal: AbortSignal.timeout(25000),
          });
          if (!r.ok) throw new Error(`goldin ${r.status}`);
          const j = await r.json();
          const rows = j?.searchalgolia?.lots || [];
          total = j?.searchalgolia?.total || 0;
          if (!rows.length) break;
          for (const g of rows) if (g.lot_id) freshBid.set(`goldin-${g.lot_id}`, { b: g.current_price || 0, n: g.number_of_bids || 0 });
          from += 100;
          await sleep(300);
        } catch (e) { console.log('[close-board] goldin pass truncated:', (e as Error).message); break; }
      }
    }
  }

  // REA: plain lot pages, bounded — only lots we track as closing
  const reaClosing = closing.filter(l => l.auctionHouse === 'REA');
  let reaOk = 0;
  for (const l of reaClosing) {
    try {
      const url = l.url || `https://bid.collectrea.com/lots/${l.id.replace('rea-', '')}`;
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
      if (!r.ok) continue;
      const html = await r.text();
      const bidM = html.replace(/&quot;/g, '"').match(/"currentBid":\s*([0-9]+(?:\.[0-9]+)?)/);
      const nM = html.match(/totalBids:\s*(\d+)/);
      if (bidM) { freshBid.set(l.id, { b: Math.round(parseFloat(bidM[1])), n: nM ? parseInt(nM[1], 10) : (l.bidCount || 0) }); reaOk++; }
      await sleep(150);
    } catch { /* keep stale for this lot */ }
  }
  console.log(`[close-board] refreshed bids: goldin ${freshBid.size - reaOk}, rea ${reaOk}`);

  // ── recompute projections + deep value on the refreshed bids ─────────────
  const bucketOf = (daysOut: number) => { let b = 0; for (const e of curve.edges) { if (daysOut < e) break; b++; } return b; };
  const overlay: Record<string, { b: number; n: number; proj?: number; floor?: number; below?: boolean }> = {};
  const deep: Array<{ id: string; depth: number; allIn: number; floor: number; closes: string; m?: string }> = [];
  for (const l of closing) {
    const fresh = freshBid.get(l.id);
    const b = fresh?.b ?? l.currentBid ?? 0;
    const n = fresh?.n ?? l.bidCount ?? 0;
    const entry: (typeof overlay)[string] = { b, n };
    const closeMs = new Date(String(l.saleDateTime || l.saleDate)).getTime();
    const daysOut = Math.max(0, (closeMs - now) / 86400000);
    const g = curve.buckets[bucketOf(daysOut)];
    if (b > 0 && g && g >= 1) {
      const projAllIn = Math.round(b * g * lotAllInFactor(l, b * g));
      const floor = (l.value?.low && l.value.low > 0 && l.value.confidence !== 'low' ? l.value.low : null)
        ?? (l.cardComps?.med && (l.cardComps.n || 0) >= 3 ? Math.round(l.cardComps.med * 0.85) : null);
      entry.proj = projAllIn;
      if (floor) {
        entry.floor = floor;
        entry.below = projAllIn < floor;
        const depth = 1 - projAllIn / floor;
        if (entry.below && depth >= 0.25 && depth <= 0.9 && !hasConditionFlag(l.title)) {
          deep.push({ id: l.id, depth: Math.round(depth * 100) / 100, allIn: projAllIn, floor, closes: String(l.saleDate || ''), m: marketOf(String(l.artist || '')) });
        }
      }
    }
    if (fresh || entry.proj) overlay[l.id] = entry;
  }
  deep.sort((a, b) => b.depth - a.depth);

  const out = {
    generatedAt: new Date().toISOString(),
    closingCount: closing.length,
    refreshed: Object.keys(overlay).length,
    bids: overlay,
    deepValue: deep.slice(0, 60),
  };
  const dest = path.join(process.cwd(), 'public', 'data', 'ray', 'close-board.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log(`[close-board] wrote ${Object.keys(overlay).length} refreshed lots, ${deep.length} deep-value rows → close-board.json`);
}
main().catch(e => { console.error('[close-board] fatal', e); process.exit(1); });
