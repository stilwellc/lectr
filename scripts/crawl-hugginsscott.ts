// Huggins & Scott crawler — ISOLATED ('hugginsscott' segment; not in nightly/
// assemble). REA-owned, runs the SAME Laravel stack + <dt>/<dd> block, so it
// reuses parseReaLot. Difference is the URL scheme: the sold ARCHIVE lives on
// the main domain hugginsandscott.com/auction/{YR}/{Month}/{lot#}/{slug}
// (server-rendered, robots allow-all, plain curl 200), enumerated via /search →
// month indexes → paginated lots. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/crawl-hugginsscott.ts --months 2 [--write]
import * as cheerio from 'cheerio';
import type { AuctionLot } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { writeSegment } from './corpus-io';
import { getHtml } from './lib/sports-crawl';
import { parseReaLot } from './crawl-rea';

const BASE = 'https://hugginsandscott.com';

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

/** month-index URLs like /auction/2005/September/ from the /search seed */
async function monthIndexes(): Promise<string[]> {
  const html = await getHtml(`${BASE}/search`);
  if (!html) return [];
  const $ = cheerio.load(html);
  const set = new Set<string>();
  $('a[href*="/auction/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/auction\/\d{4}\/[A-Za-z]+\/?$/);
    if (m) set.add(href.startsWith('http') ? href : BASE + href);
  });
  return Array.from(set);
}

/** lot detail URLs from one month index, paginating ?page=N until empty */
async function lotUrlsForMonth(monthUrl: string, maxPages = 40): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await getHtml(`${monthUrl.replace(/\/$/, '')}/?page=${page}`);
    if (!html) break;
    const $ = cheerio.load(html);
    const found: string[] = [];
    $('a[href*="/auction/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      // detail = /auction/{yr}/{mo}/{lot#}/{slug}
      if (/\/auction\/\d{4}\/[A-Za-z]+\/\d+\/[a-z0-9-]+/i.test(href)) {
        out.push(href.startsWith('http') ? href : BASE + href);
        found.push(href);
      }
    });
    if (!found.length) break;
    await new Promise(r => setTimeout(r, 150));
  }
  return Array.from(new Set(out));
}

function idFromUrl(url: string): string {
  const m = url.match(/\/auction\/(\d{4})\/([A-Za-z]+)\/(\d+)\//);
  return m ? `${m[1]}-${m[2].toLowerCase()}-${m[3]}` : url.replace(/[^0-9a-z]+/gi, '-').slice(-40);
}

async function main() {
  const monthsWanted = arg('months', 2);
  const delayMs = arg('delay', 200);
  const idx = await monthIndexes();
  // --oldest crawls the settled tail (the newest month is the CURRENT, unsold
  // auction — 0 realized prices). Sort by the year in the URL, not lexically.
  const yr = (u: string) => parseInt((u.match(/\/auction\/(\d{4})\//) || [])[1] || '0', 10);
  const sorted = idx.sort((a, b) => yr(a) - yr(b)); // oldest → newest
  const oldest = process.argv.includes('--oldest');
  const months = oldest ? sorted.slice(0, monthsWanted) : sorted.reverse().slice(0, monthsWanted);
  console.log(`[H&S] ${idx.length} month indexes; crawling ${oldest ? 'oldest' : 'newest'} ${monthsWanted}: ${months.map(m => m.split('/auction/')[1]).join(', ')}`);

  const lots: AuctionLot[] = [];
  let miss = 0;
  for (const mu of months) {
    const urls = await lotUrlsForMonth(mu);
    console.log(`  [H&S] ${mu}: ${urls.length} lot urls`);
    for (const u of urls) {
      const html = await getHtml(u);
      if (!html) { miss++; continue; }
      try {
        const lot = parseReaLot(html, idFromUrl(u), 'Huggins & Scott', u);
        if (lot) lots.push(lot); else miss++;
      } catch { miss++; }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.log(`[H&S] parsed ${lots.length} sold lots (${miss} skipped)`);

  const report = assertInvariants(lots);
  console.log(`[H&S] invariant FATALs: ${report.fatal.length} | warns: ${report.warn.length}`);
  report.fatal.slice(0, 8).forEach(f => console.error('  FATAL', f));
  const byCat: Record<string, number> = {};
  for (const l of lots) { const c = (l as { subCat?: string }).subCat || '?'; byCat[c] = (byCat[c] || 0) + 1; }
  console.log('[H&S] by category:', byCat);

  if (process.argv.includes('--write')) {
    if (report.fatal.length) { console.error('[H&S] refusing to write: FATALs'); process.exit(1); }
    writeSegment('hugginsscott', lots as unknown as Record<string, unknown>[]);
    console.log(`[H&S] wrote isolated segment 'hugginsscott' (${lots.length}) — NOT in nightly/assemble.`);
  } else {
    const s = lots[0];
    if (s) console.log('[H&S] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 50), saleDate: s.saleDate, priceUsd: (s as { priceUsd?: number }).priceUsd }, null, 0));
    console.log('[H&S] dry run (pass --write to persist)');
  }
}
main().catch(e => { console.error('[H&S] fatal', e); process.exit(1); });
