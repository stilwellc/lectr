// CLOSE-DAY BOARD — the intraday leg of the timeliness fix (Aug 14 audit:
// vsBid was ~18-20h stale at the soft-close decision moment; the fitted curve
// says lots 8+ days out close at 5.7× the nightly bid).
//
// Every ~4h (cron in close-board.yml): refetch CURRENT bids for lots closing
// within 24h — Goldin via its lots API (grouped per auction, cheap), REA via
// its plain lot pages — and write public/data/ray/close-board.json. (Oct 11
// 2026) No projection rides the overlay any more: every surface projects the
// fresh bid itself (priority.projectedCloseOf — bid × the room's close
// multiple), so the old growth-curve figure + deep-value rows are gone. The CI job
// commits the file; the on-push deploy ships it; the client merges the
// overlay over the eager payload. The corpus is untouched — this is a small
// overlay, not a build.
//   RAY_SKIP_MAIN=1 npx tsx scripts/close-board.ts [--source https://lectr.bid]
import * as fs from 'fs';
import * as path from 'path';

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
};

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

async function main() {
  const src = argStr('source', 'https://lectr.bid');
  const up = await fetchJson(`${src}/data/ray/upcoming.json?cb=${Date.now()}`);

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

  // ── the overlay: fresh bid + bid count per closing lot ───────────────────
  const overlay: Record<string, { b: number; n: number }> = {};
  for (const l of closing) {
    const fresh = freshBid.get(l.id);
    if (fresh) overlay[l.id] = { b: fresh.b, n: fresh.n };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    closingCount: closing.length,
    refreshed: Object.keys(overlay).length,
    bids: overlay,
  };
  const dest = path.join(process.cwd(), 'public', 'data', 'ray', 'close-board.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log(`[close-board] wrote ${Object.keys(overlay).length} refreshed lots → close-board.json`);
}
main().catch(e => { console.error('[close-board] fatal', e); process.exit(1); });
