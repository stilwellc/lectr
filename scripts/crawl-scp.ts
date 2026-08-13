// SCP Auctions crawler — ISOLATED ('scp' segment; not in nightly/assemble).
// Catalog on Bidsquare white-label at catalogs.scpauctions.com — server-
// rendered, plain curl 200 (real Chrome UA; avoid ClaudeBot UA which SCP's
// robots names). Each lot page carries a JSON-LD Product (name/productID/image/
// description/availabilityEnds) + a #tcb_ "Sold for" price div. SCP encodes
// cert + photo-match in the lot title itself. Enumerate: /auctions/past →
// per-auction /catalog?page=N (50/pg) → lot pages. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/crawl-scp.ts --auctions 1 --cap 40 [--write]
import type { AuctionLot, LotCategory } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { getHtml, decodeHtml, classifySports, pseudoArtist, readAuth, stampRealizedUsd, stampUpcomingUsd, writeMergedSegment, writeMergedSegmentWithLive, settledOnly, liveOnly, installCrashGuard } from './lib/sports-crawl';

const HOST = 'https://catalogs.scpauctions.com';
const TODAY = new Date().toISOString().slice(0, 10);

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

function ldProduct(html: string): Record<string, unknown> | null {
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks) {
    const json = b.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    try { const d = JSON.parse(json); if (d && d['@type'] === 'Product') return d; } catch { /* skip */ }
  }
  return null;
}

export function parseScpLot(html: string, url: string): AuctionLot | null {
  const p = ldProduct(html);
  if (!p) return null;
  const title = decodeHtml(String(p.name || '')).trim();
  const id = String(p.productID || p.sku || '').trim();
  if (!title || !id) return null;

  // realized price: the #tcb_ "Sold for" div (offers.price is the estimate/open)
  const tcb = html.match(/id="tcb_[0-9_]+"[^>]*>\s*\$?([0-9,]+)/);
  const soldNum = tcb ? parseInt(tcb[1].replace(/,/g, ''), 10) : 0;
  if (!soldNum || soldNum <= 0) return null; // unsold/withdrawn → skip

  const offers = (p.offers || {}) as Record<string, unknown>;
  const endsRaw = String(offers.availabilityEnds || offers.priceValidUntil || '');
  const saleDate = endsRaw.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? endsRaw.slice(0, 10) : null;
  if (!saleDate) return null;

  const description = decodeHtml(String(p.description || '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const cat = classifySports('', title);
  const auth = readAuth(cat, title, description.slice(0, 4000));
  const image = typeof p.image === 'string' ? p.image : Array.isArray(p.image) ? String(p.image[0]) : null;

  return {
    id: `scp-${id}`,
    artist: pseudoArtist(cat),
    title,
    year: null, medium: null, dimensions: null,
    description: description ? description.slice(0, 1200) : null,
    platform: null,
    category: 'object' as LotCategory,
    imageUrl: image,
    auctionHouse: 'SCP',
    saleName: null,
    saleDate,
    lotNumber: null,
    ...stampRealizedUsd(soldNum, saleDate),
    gradeLabel: auth.grade,
    authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    authConfidence: auth.confidence,
    subCat: cat,
    status: 'sold',
    url,
  } as unknown as AuctionLot;
}

/** Parse a LIVE (still-biddable) SCP lot into a status:'upcoming' AuctionLot.
 *  Same JSON-LD Product as the sold parser; the discriminator is
 *  offers.availability — "SoldOut" is settled (parseScpLot's turf), anything
 *  else with a future availabilityEnds is a live lot. The #tcb_ div holds the
 *  CURRENT high bid during a live sale (it only becomes "realized" at close);
 *  bid count is client-hydrated on Bidsquare and not in the server HTML. */
export function parseScpLive(html: string, url: string): AuctionLot | null {
  const p = ldProduct(html);
  if (!p) return null;
  const title = decodeHtml(String(p.name || '')).trim();
  const id = String(p.productID || p.sku || '').trim();
  if (!title || !id) return null;
  const offers = (p.offers || {}) as Record<string, unknown>;
  if (/SoldOut/i.test(String(offers.availability || ''))) return null;
  const endsRaw = String(offers.availabilityEnds || offers.priceValidUntil || '');
  const saleDate = endsRaw.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? endsRaw.slice(0, 10) : null;
  if (!saleDate || saleDate < TODAY) return null;

  const tcb = html.match(/id="tcb_[0-9_]+"[^>]*>\s*\$?([0-9,]+)/);
  const currentBid = tcb ? parseInt(tcb[1].replace(/,/g, ''), 10) : 0;
  const description = decodeHtml(String(p.description || '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const cat = classifySports('', title);
  const auth = readAuth(cat, title, description.slice(0, 4000));
  const image = typeof p.image === 'string' ? p.image : Array.isArray(p.image) ? String(p.image[0]) : null;
  return {
    id: `scp-${id}`,
    artist: pseudoArtist(cat),
    title,
    year: null, medium: null, dimensions: null,
    description: description ? description.slice(0, 1200) : null,
    platform: null,
    category: 'object' as LotCategory,
    imageUrl: image,
    auctionHouse: 'SCP',
    saleName: null,
    saleDate,
    saleDateTime: /^\d{4}-\d{2}-\d{2}T/.test(endsRaw) ? endsRaw.replace(/\s+[A-Z]{2,4}$/, '') : null,
    lotNumber: null,
    ...stampUpcomingUsd(saleDate),
    currentBid: currentBid > 0 ? currentBid : 0,
    gradeLabel: auth.grade,
    authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    authConfidence: auth.confidence,
    subCat: cat,
    status: 'upcoming',
    firstSeen: TODAY,
    url,
  } as unknown as AuctionLot;
}

async function catalogsFrom(url: string): Promise<string[]> {
  const html = await getHtml(url);
  if (!html) return [];
  const set = new Set<string>();
  for (const m of Array.from(html.matchAll(/href="([^"]*\/auctions\/scp-auctions-inc\/[^"]*?-\d+)(?:\/catalog)?"/g))) {
    const slug = m[1];
    if (/buy-now|test|marketplace/i.test(slug)) continue;
    const u = slug.startsWith('http') ? slug : HOST + slug;
    set.add(u.replace(/\/catalog$/, '') + '/catalog');
  }
  return Array.from(set);
}

// DOCTRINE inside catalogsFrom: skip buy-now / test / marketplace catalogs
async function catalogUrls(pastPage: number): Promise<string[]> {
  return catalogsFrom(`${HOST}/auctions/past?page=${pastPage}`);
}

async function lotUrls(catalogUrl: string, maxPages = 80): Promise<string[]> {
  const out = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const html = await getHtml(`${catalogUrl}?page=${page}`);
    if (!html) break;
    let found = 0;
    for (const m of Array.from(html.matchAll(/href="([^"]*\/online-auctions\/scp-auctions-inc\/[^"]*?-\d+)"/g))) {
      const u = m[1].startsWith('http') ? m[1] : HOST + m[1];
      if (!out.has(u)) { out.add(u); found++; }
    }
    if (!found) break;
    await new Promise(r => setTimeout(r, 200));
  }
  return Array.from(out);
}

async function main() {
  const write = process.argv.includes('--write');
  if (write) installCrashGuard('SCP');
  const auctionsWanted = arg('auctions', 1);
  const cap = arg('cap', 40);
  const delayMs = arg('delay', 200);
  const cats = await catalogUrls(1);
  console.log(`[SCP] ${cats.length} past-auction catalogs on page 1; crawling ${auctionsWanted}`);
  const lots: AuctionLot[] = [];
  let miss = 0;
  for (const cu of cats.slice(0, auctionsWanted)) {
    const urls = await lotUrls(cu);
    const auctionLots: AuctionLot[] = [];
    console.log(`  [SCP] ${cu.split('/').slice(-2)[0]}: ${urls.length} lots (capping ${cap})`);
    for (const u of urls.slice(0, cap)) {
      const html = await getHtml(u);
      if (!html) { miss++; continue; }
      try { const lot = parseScpLot(html, u); if (lot) { lots.push(lot); auctionLots.push(lot); } else miss++; } catch { miss++; }
      await new Promise(r => setTimeout(r, delayMs));
    }
    // INCREMENTAL: persist after each auction so a mid-run crash keeps progress
    if (write && auctionLots.length) {
      const { good } = settledOnly(auctionLots);
      if (good.length) { const r = writeMergedSegment('scp', good); console.log(`    [SCP] segment now ${r.total} lots`); }
    }
  }
  console.log(`[SCP] parsed ${lots.length} sold lots (${miss} skipped)`);

  // ── live leg: current/upcoming auctions off /auctions (not /auctions/past).
  // A "Coming Soon" catalog legitimately holds 0 lots until SCP loads it; the
  // liveOk gate is the /auctions page answering, not the lot count. The resolve
  // for a closed SCP sale is the normal past-auctions sweep above (the sale
  // moves to /auctions/past and parseScpLot reads its realized #tcb_ price
  // at the SAME scp-{itemId} id, retiring the upcoming row on merge).
  let liveLots: AuctionLot[] = [];
  let liveOk = false;
  if (process.argv.includes('--live')) {
    const currentCats = await catalogsFrom(`${HOST}/auctions`);
    liveOk = currentCats.length > 0; // SCP always lists at least the next sale
    console.log(`[SCP] live: ${currentCats.length} current/upcoming catalogs`);
    for (const cu of currentCats) {
      const urls = await lotUrls(cu);
      console.log(`  [SCP] ${cu.split('/').slice(-2)[0]}: ${urls.length} live lot urls`);
      for (const u of urls) {
        const html = await getHtml(u);
        if (!html) continue;
        try { const lot = parseScpLive(html, u); if (lot) liveLots.push(lot); } catch { /* skip */ }
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    const lg = liveOnly(liveLots);
    if (lg.dropped) console.log(`[SCP] dropped ${lg.dropped} malformed live lots`);
    liveLots = lg.good;
    console.log(`[SCP] live: ${liveLots.length} upcoming lots (${liveOk ? 'ok' : 'FAILED — keeping prior snapshot'})`);
  }

  const report = assertInvariants(lots.concat(liveLots));
  console.log(`[SCP] invariant FATALs: ${report.fatal.length} | warns: ${report.warn.length}`);
  report.fatal.slice(0, 8).forEach(f => console.error('  FATAL', f));
  const byCat: Record<string, number> = {}, byConf: Record<string, number> = {};
  for (const l of lots) {
    const c = (l as { subCat?: string }).subCat || '?'; byCat[c] = (byCat[c] || 0) + 1;
    const cf = (l as { authConfidence?: string }).authConfidence || '?'; byConf[cf] = (byConf[cf] || 0) + 1;
  }
  console.log('[SCP] by category:', byCat, '| confidence:', byConf);
  if (process.argv.includes('--write')) {
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[SCP] dropped ${dropped} unsettled/future-dated lots`);
    const rep = assertInvariants(good.concat(liveLots));
    if (rep.fatal.length) { console.error(`[SCP] refusing to write: ${rep.fatal.length} FATALs remain after filtering`); rep.fatal.slice(0, 5).forEach(f => console.error('  ', f)); process.exit(1); }
    const r = process.argv.includes('--live')
      ? writeMergedSegmentWithLive('scp', good, liveLots, liveOk)
      : { ...writeMergedSegment('scp', good), upcoming: undefined as number | undefined };
    console.log(`[SCP] merged into segment 'scp': +${r.added} new, ${r.total} total${r.upcoming !== undefined ? `, ${r.upcoming} upcoming` : ''}.`);
  } else {
    const s = lots.find(l => (l as { subCat?: string }).subCat === 'game-used') || lots[0];
    if (s) console.log('[SCP] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 55), saleDate: s.saleDate, priceUsd: (s as { priceUsd?: number }).priceUsd, cert: (s as { authCert?: string }).authCert, conf: (s as { authConfidence?: string }).authConfidence }, null, 0));
    console.log('[SCP] dry run (pass --write to persist)');
  }
}
main().catch(e => { console.error('[SCP] fatal', e); process.exit(1); });
