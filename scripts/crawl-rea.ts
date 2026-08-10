// REA (Robert Edward Auctions) crawler — ISOLATED. Writes only the 'rea'
// segment; NOT wired into the nightly matrix or assemble list. Run on-demand:
//   RAY_SKIP_MAIN=1 npx tsx scripts/crawl-rea.ts --start 49990 --end 50010
//   (full backfill: --start 1 --end 210000 ; nightly window: recent id range)
//
// Path (verified Aug 2026): bid.collectrea.com/lots/{id} — server-rendered
// (Laravel/Livewire), robots-allowed (/lots), plain curl 200, sequential
// numeric ids. Structured <dt>/<dd>: Sold For, Year, Auction, Lot #, Category.
// H&S (hugginsandscott.com) runs the same stack + block — crawl-hugginsscott
// reuses this parser with a different URL scheme.
import * as cheerio from 'cheerio';
import type { AuctionLot, LotCategory } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { writeSegment } from './corpus-io';
import { getHtml, classifySports, pseudoArtist, readAuth, stampRealizedUsd, seasonToDate } from './lib/sports-crawl';

const LOT_BASE = 'https://bid.collectrea.com/lots';
const IMG_HINT = /rea-image-archive[^"'\s]+\.(?:jpg|jpeg|png|webp)/i;

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

function dtMap($: cheerio.CheerioAPI): Record<string, string> {
  const m: Record<string, string> = {};
  $('dt').each((_, el) => {
    const k = $(el).text().replace(/[:\s]+$/, '').trim().toLowerCase();
    const dd = $(el).next('dd');
    if (k && dd.length) m[k] = dd.text().replace(/\s+/g, ' ').trim();
  });
  return m;
}

/** Parse one REA lot page into an AuctionLot (or null if unsold / unparseable).
 *  Exported so the H&S crawler reuses it on the same markup. */
export function parseReaLot(html: string, id: number, house: 'REA' | 'Huggins & Scott' = 'REA', urlOverride?: string): AuctionLot | null {
  const $ = cheerio.load(html);
  const map = dtMap($);

  const rawTitle = ($('title').first().text() || '').replace(/\s*\|\s*REA Archive.*$/i, '').replace(/\s*\|\s*Huggins.*$/i, '').trim();
  const title = rawTitle || $('h1').first().text().trim();
  if (!title) return null;

  // Sold For → realized (premium-inclusive). No price = unsold/withdrawn → skip.
  const soldRaw = map['sold for'] || '';
  const soldNum = parseInt(soldRaw.replace(/[^0-9]/g, ''), 10);
  if (!soldNum || soldNum <= 0) return null;

  const catLabel = map['category'] || map['auction category'] || '';
  const auctionLabel = map['auction'] || '';
  const saleDate = seasonToDate(auctionLabel) || seasonToDate(rawTitle) || null;
  if (!saleDate) return null; // can't date it → skip (invariant needs YYYY-MM-DD)

  const cat = classifySports(catLabel, title);
  const bodyText = $('main').text() || $('body').text() || '';
  const auth = readAuth(cat, title, bodyText.slice(0, 4000));

  const imgMatch = html.match(IMG_HINT);
  const imageUrl = imgMatch ? imgMatch[0] : null;

  const idPrefix = house === 'REA' ? 'rea' : 'hugginsscott';
  const url = urlOverride || `${LOT_BASE}/${id}`;

  return {
    id: `${idPrefix}-${id}`,
    artist: pseudoArtist(cat),
    title,
    year: map['year'] ? map['year'].replace(/[^0-9]/g, '') || null : null,
    medium: null,
    dimensions: null,
    description: null,
    platform: null,
    category: 'object' as LotCategory,
    imageUrl,
    auctionHouse: house,
    saleName: auctionLabel || null,
    saleDate,
    lotNumber: map['lot #'] ? parseInt(map['lot #'].replace(/[^0-9]/g, ''), 10) || null : null,
    ...stampRealizedUsd(soldNum, saleDate),
    // v2 auth fields (existing schema): the grade + who certified it
    gradeLabel: auth.grade,
    authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    // first-draft confidence flag for the doctrine gate (game-used→photo-match,
    // wax→BBCE, card→slab). Tomorrow's tune decides drop-vs-downweight.
    authConfidence: auth.confidence,
    subCat: cat,
    status: 'sold',
    url,
  } as unknown as AuctionLot;
}

async function main() {
  const start = arg('start', 49990);
  const end = arg('end', 50010);
  const delayMs = arg('delay', 250);
  console.log(`[REA] crawling lots ${start}..${end}`);
  const lots: AuctionLot[] = [];
  let hit = 0, miss = 0;
  for (let id = start; id <= end; id++) {
    const html = await getHtml(`${LOT_BASE}/${id}`);
    if (!html) { miss++; continue; }
    try {
      const lot = parseReaLot(html, id);
      if (lot) { lots.push(lot); hit++; } else miss++;
    } catch { miss++; }
    if ((id - start) % 25 === 0 && id > start) console.log(`  …${id} (${hit} sold, ${miss} skipped)`);
    await new Promise(r => setTimeout(r, delayMs));
  }
  console.log(`[REA] parsed ${lots.length} sold lots (${miss} skipped)`);

  const report = assertInvariants(lots);
  console.log(`[REA] invariant FATALs: ${report.fatal.length} | warns: ${report.warn.length}`);
  report.fatal.slice(0, 8).forEach(f => console.error('  FATAL', f));

  const byCat: Record<string, number> = {};
  const byConf: Record<string, number> = {};
  for (const l of lots) {
    const c = (l as { subCat?: string }).subCat || '?'; byCat[c] = (byCat[c] || 0) + 1;
    const cf = (l as { authConfidence?: string }).authConfidence || '?'; byConf[cf] = (byConf[cf] || 0) + 1;
  }
  console.log('[REA] by category:', byCat);
  console.log('[REA] by auth-confidence:', byConf);

  if (process.argv.includes('--write')) {
    if (report.fatal.length) { console.error('[REA] refusing to write: invariant FATALs present'); process.exit(1); }
    writeSegment('rea', lots as unknown as Record<string, unknown>[]);
    console.log(`[REA] wrote isolated segment 'rea' (${lots.length} lots) — NOT in nightly/assemble.`);
  } else {
    console.log('[REA] dry run (pass --write to persist the isolated segment)');
    const s = lots.find(l => l.status === 'sold');
    if (s) console.log('[REA] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 50), saleDate: s.saleDate, priceUsd: (s as { priceUsd?: number }).priceUsd, grade: (s as { gradeLabel?: string }).gradeLabel, cert: (s as { authCert?: string }).authCert }, null, 0));
  }
}

main().catch(e => { console.error('[REA] fatal', e); process.exit(1); });
