// Per-lot re-verification of price-bleed suspects — the CreateAuction trio.
// The gallery heal can't reach withdrawn lots (settled-auction galleries don't
// render them), so their old rows keep NEIGHBOR prices stolen by the pre-fix
// extractor. The bleed's signature is same price + same auction: stolen values
// came from cards on the SAME gallery page, so suspects are rows sharing a
// price whose itemids sit within one auction's id window. Each suspect's own
// bidplace.aspx page is the authority: sold → restamp the true price; a
// definitive not-sold page → delete the row; any nav/CF failure → keep as-is
// (never delete on doubt).
//   RAY_SKIP_MAIN=1 npx tsx scripts/_qa/resolve-suspects.ts --house lotg [--cap 400] [--write]
import { chromium, type Browser } from 'playwright-core';
import type { AuctionLot } from '../../app/types';
import { readSegment, writeSegment } from '../corpus-io';
import { HOUSES, extract, buildLot } from '../crawl-createauction';

const argStr = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const argNum = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : d; };
const ID_WINDOW = 2500; // one auction's itemid spread

async function main() {
  const houseKey = argStr('house', 'lotg');
  const cfg = HOUSES[houseKey];
  if (!cfg) { console.error('unknown --house'); process.exit(1); }
  const cap = argNum('cap', 5000);
  const write = process.argv.includes('--write');

  const rows = readSegment(cfg.seg) as unknown as (AuctionLot & { priceUsd?: number })[];
  const sold = rows.filter(r => r.status === 'sold' && typeof r.priceUsd === 'number' && r.id.startsWith(`${cfg.prefix}-`));
  const byPrice = new Map<number, typeof sold>();
  for (const r of sold) { const a = byPrice.get(r.priceUsd!) || []; a.push(r); byPrice.set(r.priceUsd!, a); }

  const idNum = (r: AuctionLot) => parseInt(r.id.slice(cfg.prefix.length + 1), 10) || 0;
  const suspects: typeof sold = [];
  byPrice.forEach((arr, p) => {
    if (arr.length < 2 || p < 1000) return;
    // same-auction pairs only: sort by itemid, flag runs within the window
    const sorted = [...arr].sort((a, b) => idNum(a) - idNum(b));
    for (let i = 0; i < sorted.length; i++) {
      const near = sorted.filter((o, j) => j !== i && Math.abs(idNum(o) - idNum(sorted[i])) <= ID_WINDOW);
      if (near.length >= 1 && (p >= 50000 || near.length >= 2)) suspects.push(sorted[i]);
    }
  });
  const uniq = Array.from(new Map(suspects.map(r => [r.id, r])).values())
    .sort((a, b) => (b.priceUsd! - a.priceUsd!))
    .slice(0, cap);
  console.log(`[resolve:${houseKey}] ${uniq.length} same-auction suspects (of ${sold.length} sold)`);

  const browser: Browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const byId = new Map(rows.map(r => [r.id, r] as const));
  let fixed = 0, deleted = 0, kept = 0, failed = 0;
  try {
    for (let i = 0; i < uniq.length; i++) {
      const row = uniq[i];
      const raw = await (async () => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
          try {
            const page = await ctx.newPage();
            await page.goto(`${cfg.host}/bids/bidplace.aspx?itemid=${idNum(row)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
            const t0 = Date.now();
            while (Date.now() - t0 < 25000) {
              const ready = await page.evaluate(() => !/just a moment/i.test(document.title) && (!!document.querySelector('#lot-desc') || !!document.querySelector('#MainContent_currentBidBox'))).catch(() => false);
              if (ready) return await extract(page);
              await page.waitForTimeout(1000);
            }
            return null;
          } catch { /* retry fresh context */ } finally { await ctx.close(); }
        }
        return null;
      })();
      if (!raw) { failed++; continue; }
      const truth = buildLot(raw, idNum(row), cfg);
      if (truth && typeof (truth as { priceUsd?: number }).priceUsd === 'number') {
        const newPrice = (truth as { priceUsd?: number }).priceUsd!;
        if (Math.abs(newPrice - row.priceUsd!) > 0.5) { byId.set(row.id, { ...row, ...truth }); fixed++; }
        else kept++;
      } else if (/\bwithdrawn\b/i.test(`${raw.price} ${raw.title} ${raw.desc}`) || !/sold\s*for/i.test(raw.price)) {
        byId.delete(row.id); deleted++; // the page itself says: not a sale
      } else kept++;
      if (i % 25 === 0 && i > 0) console.log(`  …${i}/${uniq.length} (fixed ${fixed}, deleted ${deleted}, kept ${kept}, failed ${failed})`);
    }
  } finally { await browser.close(); }
  console.log(`[resolve:${houseKey}] fixed ${fixed} · deleted ${deleted} · kept ${kept} · nav-failed ${failed}`);
  if (write) {
    writeSegment(cfg.seg, Array.from(byId.values()) as unknown as Record<string, unknown>[]);
    console.log(`[resolve:${houseKey}] segment written: ${byId.size} rows`);
  } else console.log('[resolve] dry run — pass --write');
}
main().catch(e => { console.error('[resolve] fatal', e); process.exit(1); });
