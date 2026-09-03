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
import { getHtml, decodeHtml, classifySports, pseudoArtist, readAuth, stampRealizedUsd, stampUpcomingUsd, seasonToDate, writeMergedSegment, writeMergedSegmentWithLive, settledOnly, liveOnly, mapPool } from './lib/sports-crawl';
import { readSegment } from './corpus-io';

const LOT_BASE = 'https://bid.collectrea.com/lots';
// The archive CDN host (rea-image-archive.nyc3.cdn.digitaloceanspaces.com). The
// match starts AT the host, so the capture is scheme-less — stamp https: on it
// (verified Sep 2026: the pages themselves link the https:// form).
const IMG_HINT = /rea-image-archive[^"'\s]+\.(?:jpg|jpeg|png|webp)/i;
function archiveImageUrl(html: string): string | null {
  const m = html.match(IMG_HINT);
  if (!m) return null;
  return `https://${m[0].replace(/^(?:https?:)?\/\//i, '')}`;
}
// live lots image off Cloudinary (folder = the running auction, e.g. 2026-Summer)
const LIVE_IMG = /res\.cloudinary\.com\/robertedwardauctions\/image\/upload[^"'\s]+\.(?:jpg|jpeg|png|webp)/i;
const TODAY = new Date().toISOString().slice(0, 10);

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

// REA renders the fields as <dt>/<dd>; H&S (same stack, different template)
// renders them as <li>Label: value</li>. Read BOTH so one parser serves both.
function dtMap($: cheerio.CheerioAPI): Record<string, string> {
  const m: Record<string, string> = {};
  $('dt').each((_, el) => {
    const k = $(el).text().replace(/[:\s]+$/, '').trim().toLowerCase();
    const dd = $(el).next('dd');
    if (k && dd.length) m[k] = dd.text().replace(/\s+/g, ' ').trim();
  });
  $('li').each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    const c = txt.indexOf(':');
    if (c > 0 && c < 30) {
      const k = txt.slice(0, c).trim().toLowerCase();
      const v = txt.slice(c + 1).trim();
      if (k && v && /^(sold for|year|auction|lot #|category|auction category)$/.test(k)) m[k] = m[k] || v;
    }
  });
  return m;
}

/** Parse one REA lot page into an AuctionLot (or null if unsold / unparseable).
 *  Exported so the H&S crawler reuses it on the same markup. */
export function parseReaLot(html: string, id: number | string, house: 'REA' | 'Huggins & Scott' = 'REA', urlOverride?: string): AuctionLot | null {
  const $ = cheerio.load(html);
  const map = dtMap($);

  // REA puts the lot name in <title>; H&S's <title> is generic ("… Auction
  // Archive"), so fall back to the lot-name heading (h3/h1), then the URL slug.
  let rawTitle = ($('title').first().text() || '').replace(/\s*\|\s*REA Archive.*$/i, '').replace(/\s*\|\s*Huggins.*$/i, '').trim();
  if (!rawTitle || /auction archive|^search$/i.test(rawTitle)) {
    const heads = $('h3, h1').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get()
      .filter(t => t && !/^(search|auction|menu|login)$/i.test(t));
    rawTitle = heads.sort((a, b) => b.length - a.length)[0] || '';
  }
  if (!rawTitle && typeof urlOverride === 'string') {
    const slug = urlOverride.split('/').pop() || '';
    rawTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  }
  const title = rawTitle;
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

  const imageUrl = archiveImageUrl(html);

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

/** Parse one LIVE lot page into a status:'upcoming' AuctionLot (or null when
 *  the page isn't a live lot — archive pages fall through to parseReaLot).
 *  Live markup (verified Aug 2026, both REA + the new bid.hugginsandscott.com —
 *  same Livewire stack): an Alpine miniCountdown({lotId, endTime, totalBids,
 *  status}) block plus an entity-encoded Livewire snapshot carrying
 *  {"currentBid":N,"nextBid":M,...}. */
export function parseReaLive(html: string, id: number | string, house: 'REA' | 'Huggins & Scott' = 'REA', urlOverride?: string): AuctionLot | null {
  const mc = html.match(/miniCountdown\(\{[\s\S]{0,400}?\}\)/);
  if (!mc) return null;
  const block = mc[0];
  const status = (block.match(/status:\s*'([a-z]+)'/) || [])[1] || '';
  if (!/^(live|open|ending)$/.test(status)) return null; // 'closed' → the sold parser's problem
  const endTime = (block.match(/endTime:\s*'([^']+)'/) || [])[1] || '';
  const saleDate = endTime.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return null;
  const bidCount = parseInt((block.match(/totalBids:\s*(\d+)/) || [])[1] || '0', 10);
  // currentBid lives in the Livewire snapshot, HTML-entity-encoded
  const bidM = html.replace(/&quot;/g, '"').match(/"currentBid":\s*([0-9]+(?:\.[0-9]+)?)/);
  const currentBid = bidM ? Math.round(parseFloat(bidM[1])) : 0;

  const $ = cheerio.load(html);
  const title = decodeHtml(($('title').first().text() || '')).replace(/\s*\|\s*(REA|Robert Edward|Huggins).*$/i, '').trim();
  if (!title || /auction archive|^search$|opening soon/i.test(title)) return null;

  const cat = classifySports('', title);
  const auth = readAuth(cat, title, ($('main').text() || $('body').text() || '').slice(0, 4000));
  const imgM = html.match(LIVE_IMG);
  const idPrefix = house === 'REA' ? 'rea' : 'hugginsscott';
  return {
    id: `${idPrefix}-${id}`,
    artist: pseudoArtist(cat),
    title,
    year: null, medium: null, dimensions: null, description: null, platform: null,
    category: 'object' as LotCategory,
    imageUrl: imgM ? `https://${imgM[0]}` : null,
    auctionHouse: house,
    saleName: null,
    saleDate,
    saleDateTime: endTime || null, // ISO with house-local offset; Date-parseable
    lotNumber: null,
    ...stampUpcomingUsd(saleDate),
    currentBid, bidCount,
    gradeLabel: auth.grade,
    authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    authConfidence: auth.confidence,
    subCat: cat,
    status: 'upcoming',
    firstSeen: TODAY,
    url: urlOverride || `${LOT_BASE}/${id}`,
  } as unknown as AuctionLot;
}

/** Enumerate + fetch the CURRENT auction's live lots off a bid.* Livewire site.
 *  The /lots grid is server-paginated and honors plain ?page=N GETs (24/page);
 *  ids are NOT contiguous (2026 Summer spans 185118..195743), so the listing —
 *  not an id window — is the enumerator. `resolve` then re-fetches last night's
 *  upcoming ids that vanished from the grid: a closed lot's page flips to the
 *  archive markup (bid.* 302s to collectrea.com/archives/… — getHtml follows
 *  it) and parseReaLot returns its settled sale — that same-id sold record is
 *  what retires the upcoming row (and is how new sold history now reaches the
 *  segment without a hand-tuned id window).
 *
 *  `ok` (the live-replace gate) is EARNED, not assumed (Sep 2 2026 audit — REA
 *  Summer 2026, ~10K lots, was lost when a 200 grid with zero parseable lots
 *  read as "the sale is empty" and evicted every upcoming row):
 *   - grid unreachable → ok=false, nothing else runs
 *   - grid answered with 0 ids ("Opening Soon" shell, or a markup change) →
 *     ok=false; the resolve pass STILL runs so closed rows settle to sold
 *   - lot pages fetched but NOTHING parsed (neither live nor closed) → ok=false
 *  A lot the grid still lists but whose page reads status:'closed' (or has
 *  already flipped to archive markup) is routed through parseReaLot right
 *  here — it is a settled sale, not a gap. */
export async function crawlReaLive(
  site: string,
  house: 'REA' | 'Huggins & Scott',
  prevUpcoming: AuctionLot[],
): Promise<{ live: AuctionLot[]; resolved: AuctionLot[]; ok: boolean }> {
  const ids = new Set<string>();
  let gridReached = false;
  for (let page = 1; page <= 200; page++) {
    const html = await getHtml(`${site}/lots?page=${page}`);
    if (!html) break;
    gridReached = true;
    const before = ids.size;
    for (const m of Array.from(html.matchAll(/\/lots\/(\d+)/g))) ids.add(m[1]);
    if (ids.size === before) break; // page past the end repeats/empties → done
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`[${house}] live grid: ${ids.size} lot ids${gridReached ? '' : ' (grid unreachable)'}`);
  if (!gridReached) return { live: [], resolved: [], ok: false };

  const idPrefix = house === 'REA' ? 'rea' : 'hugginsscott';
  let fetched = 0, parsedLive = 0, parsedClosed = 0, nulls = 0;
  const closedOnGrid: AuctionLot[] = [];
  const tried = new Set<string>();
  const live = (await mapPool(Array.from(ids), 3, async (id) => {
    tried.add(id);
    const url = `${site}/lots/${id}`;
    const html = await getHtml(url);
    if (!html) return null;
    fetched++;
    await new Promise(r => setTimeout(r, 120));
    try {
      const lv = parseReaLive(html, id, house, url);
      if (lv) { parsedLive++; return lv; }
      // still on the grid but not live: status:'closed' (or already the
      // archive page) → its settled sale, via the sold parser
      const sold = parseReaLot(html, id, house, url);
      if (sold) { parsedClosed++; closedOnGrid.push(sold); } else nulls++;
      return null;
    } catch { nulls++; return null; }
  }, `${house} live`)).filter((x): x is AuctionLot => !!x);
  console.log(`[${house}] live pages: fetched ${fetched}/${ids.size} · live ${parsedLive} · closed→sold ${parsedClosed} · unparsed ${nulls}`);

  // the gate: an empty grid or a grid whose pages parse to nothing is NOT an
  // empty sale — keep last night's snapshot (the resolve below still settles
  // whatever has actually closed)
  let ok = true;
  if (ids.size === 0) { ok = false; console.warn(`[${house}] live grid returned 0 lot ids — NOT ok; prior upcoming snapshot rides`); }
  else if (parsedLive + parsedClosed === 0) { ok = false; console.error(`[${house}] live grid listed ${ids.size} ids but ${fetched} fetched pages parsed to NOTHING — NOT ok (markup change or wall?); prior upcoming snapshot rides`); }

  // resolve: prior upcoming ids gone from tonight's grid (not re-fetching ids
  // this pass already read) → re-read as archive
  const liveIds = new Set(live.map(l => l.id));
  const gone = prevUpcoming.filter(l => l.id.startsWith(`${idPrefix}-`) && !liveIds.has(l.id) && !tried.has(l.id.slice(idPrefix.length + 1)));
  let resolveFetched = 0;
  const resolvedGone = (await mapPool(gone, 3, async (prev) => {
    const rawId = prev.id.slice(idPrefix.length + 1);
    const url = (prev as { url?: string }).url || `${site}/lots/${rawId}`;
    const html = await getHtml(url);
    if (!html) return null;
    resolveFetched++;
    await new Promise(r => setTimeout(r, 120));
    try { return parseReaLot(html, rawId, house, url); } catch { return null; }
  }, `${house} resolve`)).filter((x): x is AuctionLot => !!x);
  if (gone.length) console.log(`[${house}] resolve: ${gone.length} closed upcoming ids → ${resolveFetched} fetched → ${resolvedGone.length} settled sales`);
  const resolved = closedOnGrid.concat(resolvedGone);
  return { live, resolved, ok };
}

async function main() {
  const live = process.argv.includes('--live');
  const windowGiven = process.argv.includes('--start') || process.argv.includes('--end');
  const start = arg('start', 49990);
  const end = arg('end', 50010);
  const delayMs = arg('delay', 250);
  const lots: AuctionLot[] = [];
  let hit = 0, miss = 0;
  // --live without an explicit window skips the archive sweep: the deep archive
  // is fully harvested, and NEW sold history arrives via the live-leg resolve.
  if (!live || windowGiven) {
    console.log(`[REA] crawling lots ${start}..${end}`);
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
  }
  console.log(`[REA] parsed ${lots.length} sold lots (${miss} skipped)`);

  // ── live leg: snapshot the running auction's lots as status:'upcoming' ────
  let liveLots: AuctionLot[] = [];
  let liveOk = false;
  if (live) {
    const prevUpcoming = (readSegment('rea') as unknown as AuctionLot[]).filter(l => (l as { status?: string }).status === 'upcoming');
    const r = await crawlReaLive('https://bid.collectrea.com', 'REA', prevUpcoming);
    liveOk = r.ok;
    lots.push(...r.resolved); // closed lots re-read as settled archive sales
    const { good, dropped } = liveOnly(r.live);
    if (dropped) console.log(`[REA] dropped ${dropped} malformed live lots`);
    liveLots = good;
    console.log(`[REA] live: ${liveLots.length} upcoming lots (grid ${liveOk ? 'ok' : 'FAILED — keeping prior snapshot'})`);
  }

  const report = assertInvariants(lots.concat(liveLots));
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
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[REA] dropped ${dropped} unsettled/future-dated lots`);
    const rep = assertInvariants(good.concat(liveLots));
    if (rep.fatal.length) { console.error(`[REA] refusing to write: ${rep.fatal.length} FATALs remain after filtering`); rep.fatal.slice(0, 5).forEach(f => console.error('  ', f)); process.exit(1); }
    const r = live
      ? writeMergedSegmentWithLive('rea', good, liveLots, liveOk)
      : { ...writeMergedSegment('rea', good), upcoming: undefined as number | undefined };
    console.log(`[REA] merged into segment 'rea': +${r.added} new, ${r.total} total${r.upcoming !== undefined ? `, ${r.upcoming} upcoming` : ''}.`);
  } else {
    console.log('[REA] dry run (pass --write to persist the isolated segment)');
    const s = lots.find(l => l.status === 'sold');
    if (s) console.log('[REA] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 50), saleDate: s.saleDate, priceUsd: (s as { priceUsd?: number }).priceUsd, grade: (s as { gradeLabel?: string }).gradeLabel, cert: (s as { authCert?: string }).authCert }, null, 0));
    const u = liveLots[0];
    if (u) console.log('[REA] live sample:', JSON.stringify({ id: u.id, title: u.title.slice(0, 50), saleDate: u.saleDate, currentBid: (u as { currentBid?: number }).currentBid, bidCount: (u as { bidCount?: number }).bidCount }, null, 0));
  }
}

// run main() ONLY when executed directly — importing parseReaLot (crawl-
// hugginsscott, backfill-rea) must NOT spawn a competing crawl.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('[REA] fatal', e); process.exit(1); });
}
