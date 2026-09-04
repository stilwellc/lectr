// ─────────────────────────────────────────────────────────────────────────────
// BIDSQUARE — the shared white-label auction platform crawler.
//
// Two lectr houses ride the same Bidsquare stack and therefore the same code:
//   · SCP Auctions   catalogs.scpauctions.com   house slug `scp-auctions-inc`
//   · Hake's         www.hakes.com              house slug `hakes-auctions`
// (Hake's MIGRATED to Bidsquare in 2026 — the old ASP.NET `/{SLUG}-LOT{id}.aspx`
//  + Akamai plan in scripts/_qa/sports-expansion-recon.md is DEAD; those URLs
//  now 404. Verified Sep 3 2026.)
//
// Platform shape (verified Sep 3 2026 against both hosts with a real Chrome UA,
// plain curl 200 — no bot wall):
//   /auctions                       → current + upcoming catalogs (server-rendered)
//   /auctions/past?page=N           → past catalogs (server-rendered)
//   /auctions/<house>/<slug>-<eventId>/catalog?page=N  → ~50 lot links/page
//   /online-auctions/<house>/<slug>-<itemId>           → the lot page
//
// A lot page carries, all server-rendered:
//   · ONE JSON-LD Product — name / productID / sku / image / description /
//     offers.{price, availability, availabilityEnds, availabilityStarts}
//     `offers.price` is the STARTING bid, never the result.
//   · `event_status='past'|'upcoming'|'live'` + `data-event_name='<sale>'`
//   · the subject's own price pair:
//       <div id="lbl_<itemId>_<eventId>">Sold for</div>
//       … <div id="tcb_<itemId>_<eventId>">$900</div>
//       <span …>Sold Price includes BP</span>
//   · <div class="estimated_price">… Estimate: $A - $B
//
// ── PRICE ANCHORING (the law, learned from the NFL idwalk poison, Aug 30 2026,
// and the Memory Lane gallery price-bleed, Aug 13 2026) ──────────────────────
// The old crawl-scp.ts read `id="tcb_[0-9_]+"` — a PAGE-WIDE first match. That
// is the exact shape that minted 3,913 fake NFL sales off a sidebar widget: the
// moment Bidsquare renders a related-lot rail (or a "you may also like" card)
// carrying its own tcb div, the first match is a NEIGHBOUR's price. Every read
// here is instead anchored to the SUBJECT lot's own itemId AND its eventId —
// `lbl_<item>_<event>` and `tcb_<item>_<event>` must agree on both — so no
// other lot's markup can satisfy the pattern. A batch poison detector runs
// before every write as the second line of defence.
//
// ── MONEY BASIS ─────────────────────────────────────────────────────────────
// The tcb figure is labelled "Sold for" and the platform prints "Sold Price
// includes BP" next to it (verified on a settled SCP lot, 2025 Fall Premier,
// item 5997390: `Sold for / $900 / Sold Price includes BP`). So the figure is
// PREMIUM-INCLUSIVE = our `realized` basis. The parser reads that marker per
// lot rather than assuming it: a lot whose page does NOT print it falls back to
// the house's configured default basis and is COUNTED, so a platform change
// shows up as a log line instead of a silent basis flip.
// ─────────────────────────────────────────────────────────────────────────────
import type { AuctionLot, LotCategory } from '../../app/types';
import { assertInvariants } from '../../app/lib/validate';
import {
  getHtml, decodeHtml, classifySports, pseudoArtist, readAuth, stampRealizedUsd,
  stampUpcomingUsd, writeMergedSegment, writeMergedSegmentWithLive, settledOnly,
  liveOnly, installCrashGuard, mapPool, mapPoolErrors, FETCH_STATS,
  type SportsCategory,
} from './sports-crawl';

const TODAY = new Date().toISOString().slice(0, 10);

export interface BidsquareHouse {
  /** segment name + id prefix (must match app/lib/validate's HOUSE_PREFIXES) */
  segment: string;
  /** log label */
  label: string;
  /** origin, no trailing slash */
  host: string;
  /** the path segment Bidsquare files this seller under */
  houseSlug: string;
  /** lot id prefix — `<idPrefix>-<itemId>` */
  idPrefix: string;
  /** the AuctionHouse union member */
  auctionHouse: AuctionLot['auctionHouse'];
  /** published buyer's premium, percent — stamp ONLY when read off the house's
   *  own terms page; leave undefined rather than guessing (premiums.ts holds
   *  the fallback schedule). */
  bpPct?: number;
  /** catalogs to ignore (buy-now storefronts, platform tests) */
  skipCatalogRe?: RegExp;
  /** money basis when the page does not print the "includes BP" marker */
  defaultBasis?: 'realized' | 'hammer';
  /** house-specific category steer, applied over the shared classifier */
  categoryHint?: (title: string, desc: string, base: SportsCategory) => SportsCategory;
}

// ── page readers (all subject-anchored) ──────────────────────────────────────

export function ldProduct(html: string): Record<string, unknown> | null {
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks) {
    const json = b.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    try { const d = JSON.parse(json); if (d && d['@type'] === 'Product') return d; } catch { /* skip */ }
  }
  return null;
}

/** `event_status='past'` — the platform's own settled/live flag, and a stronger
 *  discriminator than offers.availability (which reads "InStock" on a lot whose
 *  sale has not opened yet). */
export function eventStatus(html: string): 'past' | 'upcoming' | 'live' | null {
  const m = html.match(/event_status='(past|upcoming|live)'/);
  return m ? (m[1] as 'past' | 'upcoming' | 'live') : null;
}

export function eventName(html: string): string | null {
  const m = html.match(/data-event_name='([^']{1,160})'/);
  return m ? decodeHtml(m[1]).trim() || null : null;
}

/** `Estimate: $A - $B` inside the subject's own `.estimated_price` block (one
 *  per lot page; related-lot rails do not render it). */
export function parseEstimate(html: string): { low: number | null; high: number | null } {
  const blk = html.match(/class="estimated_price"[\s\S]{0,900}?<\/div>\s*<\/div>/i);
  const m = (blk ? blk[0] : '').match(/Estimate:?\s*\$\s*([\d,]+)(?:\s*-\s*\$?\s*([\d,]+))?/i);
  if (!m) return { low: null, high: null };
  const n = (s: string | undefined) => { if (!s) return null; const v = parseInt(s.replace(/,/g, ''), 10); return isFinite(v) && v > 0 ? v : null; };
  return { low: n(m[1]), high: n(m[2]) };
}

export interface SubjectPrice {
  /** the label the platform printed above the figure ("Sold for", "Current Bid", "Starting Bid") */
  label: string;
  amount: number;
  eventId: string;
  /** the page printed "Sold Price includes BP" next to this figure */
  includesBp: boolean;
}

/** ANCHOR COUNTERS — a markup change that breaks the anchor must be loud, not
 *  silently zero-parsed. `anchorMiss` = the page printed a tcb figure we
 *  refused to read because it was not the subject's. */
export const ANCHOR_STATS = { anchorMiss: 0, bpMarkerMissing: 0 };
let anchorMissLogged = 0;

/** The subject lot's OWN price pair. `lbl_<item>_<event>` and
 *  `tcb_<item>_<event>` must carry the SAME itemId and the SAME eventId — a
 *  related-lot card renders neither with the subject's item id, so nothing
 *  outside the subject can satisfy this. */
export function subjectPrice(html: string, itemId: string, label = '?'): SubjectPrice | null {
  const id = itemId.replace(/[^0-9]/g, '');
  if (!id) return null;
  const re = new RegExp(
    `<div[^>]*\\bid="lbl_${id}_(\\d+)"[^>]*>([^<]{0,40})</div>` +   // label + eventId
    `[\\s\\S]{0,600}?` +
    `<div[^>]*\\bid="tcb_${id}_\\1"[^>]*>\\s*\\$?\\s*([\\d,]+(?:\\.\\d{1,2})?)`,
  );
  const m = html.match(re);
  if (!m) {
    // did the page print SOMEBODY's figure? then this is an anchor miss worth
    // shouting about (markup change), not just an unsold lot.
    if (/id="tcb_\d+_\d+"/.test(html) && !new RegExp(`id="tcb_${id}_`).test(html)) {
      ANCHOR_STATS.anchorMiss++;
      if (anchorMissLogged++ < 5) console.warn(`[${label}] item ${itemId}: page renders tcb blocks but NONE for the subject — anchor miss (markup change?); treated as unpriced`);
    }
    return null;
  }
  const amount = parseFloat(m[3].replace(/,/g, ''));
  if (!isFinite(amount) || amount <= 0) return null;
  // the BP marker sits immediately after the figure, inside the same block
  const tail = html.slice(html.indexOf(m[0]) + m[0].length, html.indexOf(m[0]) + m[0].length + 400);
  return {
    label: decodeHtml(m[2]).replace(/\s+/g, ' ').trim(),
    amount,
    eventId: m[1],
    includesBp: /includes\s+BP/i.test(tail),
  };
}

function commonFields(cfg: BidsquareHouse, p: Record<string, unknown>, html: string, url: string) {
  const title = decodeHtml(String(p.name || '')).trim();
  const id = String(p.productID || p.sku || '').trim();
  const description = decodeHtml(String(p.description || '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  let cat = classifySports('', title);
  if (cfg.categoryHint) cat = cfg.categoryHint(title, description, cat);
  const auth = readAuth(cat, title, description.slice(0, 4000));
  const image = typeof p.image === 'string' ? p.image : Array.isArray(p.image) ? String(p.image[0]) : null;
  return {
    title, id, description, cat, auth, image,
    base: {
      id: `${cfg.idPrefix}-${id}`,
      artist: pseudoArtist(cat),
      title,
      year: null, medium: null, dimensions: null,
      description: description ? description.slice(0, 1200) : null,
      platform: null,
      category: 'object' as LotCategory,
      imageUrl: image,
      auctionHouse: cfg.auctionHouse,
      saleName: eventName(html),
      lotNumber: null,
      gradeLabel: auth.grade,
      authCert: auth.marks.length ? auth.marks.join(' · ') : null,
      authConfidence: auth.confidence,
      subCat: cat,
      url,
    },
  };
}

/** A SETTLED lot: the subject's own figure labelled "Sold for". */
export function parseBidsquareSold(cfg: BidsquareHouse, html: string, url: string): AuctionLot | null {
  const p = ldProduct(html);
  if (!p) return null;
  const f = commonFields(cfg, p, html, url);
  if (!f.title || !f.id) return null;

  const price = subjectPrice(html, f.id, cfg.label);
  // the LABEL is the sold gate: "Current Bid"/"Starting Bid" is a live figure,
  // never a result. A withdrawn/passed lot prints no figure at all.
  if (!price || !/sold/i.test(price.label)) return null;

  const offers = (p.offers || {}) as Record<string, unknown>;
  const endsRaw = String(offers.availabilityEnds || offers.priceValidUntil || '');
  const saleDate = endsRaw.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? endsRaw.slice(0, 10) : null;
  if (!saleDate) return null;

  const basis = price.includesBp ? 'realized' : (cfg.defaultBasis ?? 'realized');
  if (!price.includesBp) ANCHOR_STATS.bpMarkerMissing++;
  const est = parseEstimate(html);

  return {
    ...f.base,
    saleDate,
    ...stampRealizedUsd(price.amount, saleDate, { basis }),
    // the house's PUBLISHED premium, only where we read it off their terms
    ...(cfg.bpPct != null && basis === 'realized' ? { buyerPremiumPct: cfg.bpPct } : {}),
    ...(est.low != null ? { estLowNative: est.low, estLowUsd: est.low, estimateLow: est.low } : {}),
    ...(est.high != null ? { estHighNative: est.high, estHighUsd: est.high, estimateHigh: est.high } : {}),
    status: 'sold',
  } as unknown as AuctionLot;
}

/** A LIVE (still-biddable) lot → status:'upcoming'. Discriminated on
 *  `event_status` first (the platform's own flag) and the close time second;
 *  the tcb figure here is the CURRENT high bid, not a result. */
export function parseBidsquareLive(cfg: BidsquareHouse, html: string, url: string): AuctionLot | null {
  const p = ldProduct(html);
  if (!p) return null;
  const f = commonFields(cfg, p, html, url);
  if (!f.title || !f.id) return null;

  const st = eventStatus(html);
  if (st === 'past') return null;                                   // settled — the sold parser's turf
  const offers = (p.offers || {}) as Record<string, unknown>;
  if (/SoldOut/i.test(String(offers.availability || ''))) return null;
  const endsRaw = String(offers.availabilityEnds || offers.priceValidUntil || '');
  const saleDate = endsRaw.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? endsRaw.slice(0, 10) : null;
  if (!saleDate || saleDate < TODAY) return null;

  const price = subjectPrice(html, f.id, cfg.label);
  // a "Sold for" label on a not-past event = the lot closed mid-crawl; leave it
  // to the sold parser rather than publishing a result as a live bid
  if (price && /sold/i.test(price.label)) return null;
  const currentBid = price ? price.amount : 0;
  const est = parseEstimate(html);

  return {
    ...f.base,
    saleDate,
    saleDateTime: /^\d{4}-\d{2}-\d{2}T/.test(endsRaw) ? endsRaw.replace(/\s+[A-Z]{2,4}$/, '') : null,
    ...stampUpcomingUsd(saleDate, { low: est.low, high: est.high }),
    currentBid: currentBid > 0 ? currentBid : 0,
    status: 'upcoming',
    firstSeen: TODAY,
  } as unknown as AuctionLot;
}

// ── enumeration ──────────────────────────────────────────────────────────────

export async function catalogsFrom(cfg: BidsquareHouse, url: string): Promise<string[]> {
  const html = await getHtml(url);
  if (!html) return [];
  const set = new Set<string>();
  const re = new RegExp(`href="([^"]*\\/auctions\\/${cfg.houseSlug}\\/[^"]*?-\\d+)(?:\\/catalog)?"`, 'g');
  for (const m of Array.from(html.matchAll(re))) {
    const slug = m[1];
    if (cfg.skipCatalogRe && cfg.skipCatalogRe.test(slug)) continue;
    const u = slug.startsWith('http') ? slug : cfg.host + slug;
    set.add(u.replace(/\/catalog$/, '') + '/catalog');
  }
  return Array.from(set);
}

/** BOUNDED pagination: stop on a page that yields no NEW lot url, on an empty
 *  fetch, or at maxPages — never an open-ended `while (true)`. */
export async function lotUrls(cfg: BidsquareHouse, catalogUrl: string, maxPages: number, delayMs: number): Promise<string[]> {
  const out = new Set<string>();
  const re = new RegExp(`href="([^"]*\\/online-auctions\\/${cfg.houseSlug}\\/[^"]*?-\\d+)"`, 'g');
  for (let page = 1; page <= maxPages; page++) {
    const html = await getHtml(`${catalogUrl}?page=${page}`);
    if (!html) break;
    let found = 0;
    for (const m of Array.from(html.matchAll(re))) {
      const u = m[1].startsWith('http') ? m[1] : cfg.host + m[1];
      if (!out.has(u)) { out.add(u); found++; }
    }
    if (!found) break;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return Array.from(out);
}

// ── poison detector ──────────────────────────────────────────────────────────
/** One exact price on >20% of a ≥50-row batch means the source is echoing a
 *  template/widget constant rather than per-lot results (the NFL idwalk
 *  signature). Honest repeats DO exist — a bid increment × premium tie inside
 *  one sale — so the detector additionally requires the repeat to span a single
 *  price at implausible density; the 50-row floor keeps small sales out. */
export function poisonedBatch(rows: AuctionLot[]): { price: number; n: number } | null {
  if (rows.length < 50) return null;
  const census = new Map<number, number>();
  for (const l of rows) {
    const pv = l as unknown as { priceUsd?: number; realizedUsd?: number };
    const pr = pv.realizedUsd ?? pv.priceUsd;
    if (typeof pr === 'number') census.set(pr, (census.get(pr) || 0) + 1);
  }
  const top = Array.from(census.entries()).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > rows.length * 0.2 ? { price: top[0], n: top[1] } : null;
}

// ── the runner ───────────────────────────────────────────────────────────────

export interface CrawlOpts {
  auctions: number;      // past catalogs to sweep
  cap: number;           // lot pages per catalog
  delayMs: number;
  conc: number;
  maxPages: number;      // catalog pagination bound
  pastPages: number;     // /auctions/past pages to read
  live: boolean;
  write: boolean;
  sampleOut?: string;    // write parsed rows to this path (QA)
}

export function argNum(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

export function optsFromArgv(d: Partial<CrawlOpts> = {}): CrawlOpts {
  const sIdx = process.argv.indexOf('--sample-out');
  return {
    auctions: argNum('auctions', d.auctions ?? 1),
    cap: argNum('cap', d.cap ?? 40),
    delayMs: argNum('delay', d.delayMs ?? 200),
    conc: argNum('conc', d.conc ?? 2),
    maxPages: argNum('max-pages', d.maxPages ?? 80),
    pastPages: argNum('past-pages', d.pastPages ?? 1),
    live: process.argv.includes('--live'),
    write: process.argv.includes('--write'),
    sampleOut: sIdx >= 0 ? process.argv[sIdx + 1] : undefined,
  };
}

/** Fetch a batch of lot pages with bounded concurrency + a polite per-request
 *  delay, and parse each with `parse`. Returns the lots AND the fetch/parse
 *  census the silent-zero gate reads. */
async function harvest(
  label: string,
  urls: string[],
  conc: number,
  delayMs: number,
  parse: (html: string, url: string) => AuctionLot | null,
): Promise<{ lots: AuctionLot[]; fetched: number; nulls: number; misses: number }> {
  const lots: AuctionLot[] = [];
  let fetched = 0, nulls = 0, misses = 0;
  await mapPool(urls, Math.max(1, conc), async (u) => {
    const html = await getHtml(u);
    await new Promise(r => setTimeout(r, delayMs));
    if (!html) { misses++; return; }
    fetched++;
    try { const lot = parse(html, u); if (lot) lots.push(lot); else nulls++; } catch { nulls++; }
  }, label);
  return { lots, fetched, nulls, misses };
}

export async function crawlBidsquare(cfg: BidsquareHouse, opts: CrawlOpts): Promise<void> {
  const L = cfg.label;
  if (opts.write) installCrashGuard(L);

  // ── SOLD: the past-auction archive ────────────────────────────────────────
  const cats: string[] = [];
  for (let p = 1; p <= opts.pastPages; p++) {
    const found = await catalogsFrom(cfg, `${cfg.host}/auctions/past?page=${p}`);
    if (!found.length) break;
    for (const c of found) if (!cats.includes(c)) cats.push(c);
  }
  console.log(`[${L}] ${cats.length} past-auction catalogs across ${opts.pastPages} page(s); crawling ${Math.min(opts.auctions, cats.length)}`);

  const lots: AuctionLot[] = [];
  let soldFetched = 0, soldNulls = 0, soldMisses = 0, soldUrlCount = 0;
  for (const cu of cats.slice(0, opts.auctions)) {
    const urls = (await lotUrls(cfg, cu, opts.maxPages, opts.delayMs)).slice(0, opts.cap);
    soldUrlCount += urls.length;
    console.log(`  [${L}] ${cu.split('/').slice(-2)[0]}: ${urls.length} lot urls (cap ${opts.cap})`);
    const h = await harvest(`${L}:sold`, urls, opts.conc, opts.delayMs, (html, u) => parseBidsquareSold(cfg, html, u));
    soldFetched += h.fetched; soldNulls += h.nulls; soldMisses += h.misses;
    console.log(`  [${L}] batch: fetched ${h.fetched} / parsed ${h.lots.length} / null ${h.nulls} / miss ${h.misses}`);
    // INCREMENTAL: persist per auction so a mid-run crash keeps progress — but
    // only past the poison detector (an incremental flush must never bypass it)
    if (opts.write && h.lots.length) {
      const { good } = settledOnly(h.lots);
      const p = poisonedBatch(good);
      if (p) { console.error(`[${L}] ABORT (incremental flush): $${p.price} repeats on ${p.n}/${good.length} rows — poisoned feed, nothing written.`); process.exit(1); }
      if (good.length) { const r = writeMergedSegment(cfg.segment, good); console.log(`    [${L}] segment now ${r.total} lots`); }
    }
    for (const l of h.lots) lots.push(l);
  }
  console.log(`[${L}] SOLD: ${soldUrlCount} urls → fetched ${soldFetched}, parsed ${lots.length}, null ${soldNulls}, miss ${soldMisses}`);

  // NO SILENT ZERO: pages came back but nothing parsed = the parser is broken or
  // the markup moved. Refuse the run; the prior segment rides untouched.
  if (soldFetched >= 20 && lots.length === 0) {
    console.error(`[${L}] FATAL: fetched ${soldFetched} sold lot pages and parsed 0 — refusing to write (markup change?). Prior segment kept.`);
    process.exit(1);
  }

  // ── LIVE: the running/upcoming catalogs ───────────────────────────────────
  let liveLots: AuctionLot[] = [];
  let liveOk = false;
  if (opts.live) {
    const currentCats = await catalogsFrom(cfg, `${cfg.host}/auctions`);
    // liveOk = the /auctions page ANSWERED with at least one catalog. A "coming
    // soon" catalog legitimately holds 0 lots; a network/WAF failure holds 0
    // catalogs — only the latter must keep last night's upcoming snapshot.
    liveOk = currentCats.length > 0;
    console.log(`[${L}] live: ${currentCats.length} current/upcoming catalogs`);
    let liveFetched = 0, liveNulls = 0;
    for (const cu of currentCats) {
      const urls = (await lotUrls(cfg, cu, opts.maxPages, opts.delayMs)).slice(0, opts.cap);
      console.log(`  [${L}] ${cu.split('/').slice(-2)[0]}: ${urls.length} live lot urls (cap ${opts.cap})`);
      const h = await harvest(`${L}:live`, urls, opts.conc, opts.delayMs, (html, u) => parseBidsquareLive(cfg, html, u));
      liveFetched += h.fetched; liveNulls += h.nulls;
      console.log(`  [${L}] batch: fetched ${h.fetched} / parsed ${h.lots.length} / null ${h.nulls} / miss ${h.misses}`);
      for (const l of h.lots) liveLots.push(l);
    }
    // a live leg that fetched real pages and parsed NOTHING is a parser failure,
    // not an empty sale — never let it evict last night's upcoming rows
    if (liveFetched >= 20 && liveLots.length === 0) {
      console.error(`[${L}] live leg fetched ${liveFetched} pages and parsed 0 — downgrading liveOk; keeping the prior upcoming snapshot`);
      liveOk = false;
    }
    const lg = liveOnly(liveLots);
    if (lg.dropped) console.log(`[${L}] dropped ${lg.dropped} malformed live lots`);
    liveLots = lg.good;
    console.log(`[${L}] LIVE: fetched ${liveFetched}, ${liveLots.length} upcoming lots, null ${liveNulls} (${liveOk ? 'ok' : 'NOT ok — keeping prior snapshot'})`);
  }

  // ── report ────────────────────────────────────────────────────────────────
  const report = assertInvariants(lots.concat(liveLots));
  console.log(`[${L}] invariant FATALs: ${report.fatal.length} | warns: ${report.warn.length}`);
  report.fatal.slice(0, 8).forEach(f => console.error('  FATAL', f));
  const byCat: Record<string, number> = {}, byConf: Record<string, number> = {};
  for (const l of lots.concat(liveLots)) {
    const c = (l as { subCat?: string }).subCat || '?'; byCat[c] = (byCat[c] || 0) + 1;
    const cf = (l as { authConfidence?: string }).authConfidence || '?'; byConf[cf] = (byConf[cf] || 0) + 1;
  }
  console.log(`[${L}] by category:`, byCat, '| confidence:', byConf);
  console.log(`[${L}] health: non2xx ${FETCH_STATS.non2xx}, rateLimited ${FETCH_STATS.rateLimited}, failed ${FETCH_STATS.failed}, poolErrors ${mapPoolErrors()}, anchorMiss ${ANCHOR_STATS.anchorMiss}, soldRowsWithoutBpMarker ${ANCHOR_STATS.bpMarkerMissing}`);

  if (opts.sampleOut) {
    const fs = await import('fs');
    const rows = lots.concat(liveLots);
    fs.writeFileSync(opts.sampleOut, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    console.log(`[${L}] wrote ${rows.length} parsed rows → ${opts.sampleOut}`);
  }

  if (!opts.write) {
    const s = lots[0] || liveLots[0];
    if (s) console.log(`[${L}] sample:`, JSON.stringify({
      id: s.id, artist: s.artist, title: s.title.slice(0, 60), saleName: s.saleName, saleDate: s.saleDate,
      status: (s as { status?: string }).status, priceUsd: (s as { priceUsd?: number }).priceUsd,
      bid: (s as { currentBid?: number }).currentBid, grade: (s as { gradeLabel?: string }).gradeLabel,
      conf: (s as { authConfidence?: string }).authConfidence,
    }));
    console.log(`[${L}] dry run (pass --write to persist)`);
    return;
  }

  const { good, dropped } = settledOnly(lots);
  if (dropped) console.log(`[${L}] dropped ${dropped} unsettled/future-dated lots`);
  const poison = poisonedBatch(good);
  if (poison) {
    console.error(`[${L}] ABORT: $${poison.price} repeats on ${poison.n}/${good.length} new sold rows — poisoned feed, nothing written.`);
    process.exit(1);
  }
  const rep = assertInvariants(good.concat(liveLots));
  if (rep.fatal.length) {
    console.error(`[${L}] refusing to write: ${rep.fatal.length} FATALs remain after filtering`);
    rep.fatal.slice(0, 5).forEach(f => console.error('  ', f));
    process.exit(1);
  }
  // Nothing at all to persist and no live snapshot to replace → leave the
  // segment strictly alone (never rewrite it just to prove we ran).
  if (!good.length && !opts.live) { console.log(`[${L}] nothing new to write — segment untouched.`); return; }
  const r = opts.live
    ? writeMergedSegmentWithLive(cfg.segment, good, liveLots, liveOk)
    : { ...writeMergedSegment(cfg.segment, good), upcoming: undefined as number | undefined };
  console.log(`[${L}] merged into segment '${cfg.segment}': +${r.added} new, ${r.total} total${r.upcoming !== undefined ? `, ${r.upcoming} upcoming` : ''}.`);
}
