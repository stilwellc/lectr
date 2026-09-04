// Throwaway QA probe: parse a known Bidsquare page set and print why each lot
// did or did not become a row. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/_qa/bidsquare-probe.ts <catalogUrl> [n]
import { SCP } from '../crawl-scp';
import { HAKES } from '../crawl-hakes';
import { lotUrls, parseBidsquareSold, parseBidsquareLive, subjectPrice, ldProduct, eventStatus } from '../lib/bidsquare';
import { getHtml } from '../lib/sports-crawl';

const url = process.argv[2];
const n = parseInt(process.argv[3] || '24', 10);
const cfg = url.includes('hakes') ? HAKES : SCP;
(async () => {
  const urls = (await lotUrls(cfg, url, 1, 300)).slice(0, n);
  console.log(`${urls.length} urls`);
  for (const u of urls) {
    const html = await getHtml(u);
    if (!html) { console.log('MISS', u); continue; }
    const p = ldProduct(html);
    const id = String((p?.productID ?? p?.sku ?? '') as string);
    const sp = subjectPrice(html, id, cfg.label);
    const sold = parseBidsquareSold(cfg, html, u);
    const live = parseBidsquareLive(cfg, html, u);
    console.log(`${id} ev=${eventStatus(html)} label=${JSON.stringify(sp?.label ?? null)} amt=${sp?.amount ?? null} bp=${sp?.includesBp ?? null} -> ${sold ? 'SOLD $' + (sold as unknown as { priceUsd: number }).priceUsd : live ? 'LIVE' : 'null'}`);
    await new Promise(r => setTimeout(r, 300));
  }
})();
