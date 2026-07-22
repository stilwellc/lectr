import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { computeStats } from './compute-stats';
import { routeCulture } from './culture';

// ── Types ──
// Imported from app/types.ts — the app's types are the single source of truth.
// (This block used to be a hand-mirrored copy "to avoid import issues in a
// standalone script", but the script is no longer standalone — it already
// imports app/lib/comps and build-upcoming — and the mirror had drifted.)

import type {
  AuctionLot, AuctionHouse, LotStatus, Currency, LotCategory,
  MarketStats, PricePoint, HouseCount, PriceBasis,
} from '../app/types';

// v2 foundation — the single, deterministic normalization layer. Every FUTURE
// row is born v2 by stamping these (native money fact + dated USD, persisted
// identity keys) at parse/classify time. imageHash is the only I/O function and
// runs INCREMENTALLY (a bounded batch per crawl — decision #3), never all 41k.
import {
  toUsdDated, fxRateFor, normalizeDimensions, extractYear, canonMedium,
  extractEdition, extractSerial, extractCollectibleTags, classifyEntity,
  objectFingerprint, titleTokens,
  modelKey as normModelKey, watchKey as normWatchKey,
  normalizeTitle as normNormalizeTitle,
} from '../app/lib/normalize';

// ── Lot Classification ──
// Classifies a lot as original, print, photograph, sculpture, design, or unknown
// based on medium, title, sale name, URL, and artist context.

/** True if a YYYY-MM-DD saleDate is strictly BEFORE today (UTC day). Same-day
 *  counts as NOT past — matching validate.ts + the sanitize net. Using
 *  `new Date('YYYY-MM-DD') < new Date()` here (UTC midnight vs the now-instant)
 *  wrongly buries a still-live same-day lot as bought_in for the whole UTC day. */
const isSaleDayPast = (saleDate: string): boolean =>
  saleDate.slice(0, 10) < new Date().toISOString().slice(0, 10);

const DESIGN_ARTISTS = new Set(['george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret']);
// Watches makers + science collections: their lots are objects, never
// paintings/prints — pattern classifiers ("printed dial") must not touch them.
const OBJECT_ARTISTS = new Set([
  'rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier',
  'meteorites', 'fossils', 'space-exploration', 'scientific-instruments',
  'game-used', 'trophies-awards', 'tickets-passes',
]);
// Fine artists whose unclassified lots default to 'print' (edition-heavy output)
const EDITION_DEFAULT_ARTISTS = new Set(['andy-warhol', 'keith-haring', 'ed-ruscha', 'henri-matisse', 'pablo-picasso']);
// Fine artists whose unclassified lots default to 'original' (painting/drawing-heavy output)
const ORIGINAL_DEFAULT_ARTISTS = new Set([
  'george-condo', 'kaws', 'raymond-pettibon', 'peter-saul',
  'tom-sachs', 'barry-mcgee', 'futura-2000', 'r-crumb', 'fab-5-freddy',
  'eddie-martinez', 'kenny-scharf',
]);

const PRINT_PATTERNS = /\b(screenprint|silkscreen|serigraph|lithograph|etching|woodcut|woodblock|linocut|engraving|aquatint|monotype|monoprint|offset|poster|gicl[eé]e|print(?:ed)?|edition of|numbered.*\/|signed.*numbered|multiple|chromolithograph|intaglio)\b/i;
const PHOTO_PATTERNS = /\b(photograph|gelatin silver|c-print|chromogenic|daguerreotype|platinum print|pigment print|inkjet print|archival pigment|digital print|cibachrome|polaroid|albumen)\b/i;
const SCULPTURE_PATTERNS = /\b(sculpture|bronze|ceramic|porcelain|cast iron|resin|fibreglass|fiberglass|stainless steel|patinated|figure|figurine|plaster cast)\b/i;
const DESIGN_PATTERNS = /\b(lounge chair|dining chair|side chair|armchair|cabinet|desk|table|bookcase|shelf|shelving|headboard|bench|settee|sofa|credenza|dresser|nightstand|lamp|chandelier|sconce|light fixture|ottoman|stool|rocker|rocking chair|walnut|rosewood|teak|plywood|upholster|enameled|molded|fiberglass shell)\b/i;
const ORIGINAL_PATTERNS = /\b(oil on|acrylic on|tempera on|gouache on|watercolor on|watercolour on|mixed media on|ink on|charcoal on|pastel on|enamel on|spray paint on|oil and|acrylic and|encaustic|collage on|canvas|linen|panel|board|paper(?! print))\b/i;

// Title patterns that signal editions: "from [Series]", "plate(s)", known series formats
const TITLE_EDITION_PATTERNS = /\b(plates?\s*,?\s*from\b|,\s*from\s+[A-Z]|\bfrom\s+the\s+portfolio\b|\bfrom\s+(?:Myths|Ads|Flowers|Marilyn|Mao|Campbell|Electric Chair|Endangered Species|Cowboys and Indians|Ladies and Gentlemen|Flash|Martha Graham|Hans Christian Andersen|Wild Raspberries|In the Bottom|Ten Portraits|Space Fruit|Sunset|Ingrid Bergman|Reigning Queens))\b/i;

function classifyLot(lot: AuctionLot): LotCategory {
  // Watches & science lots are objects — before any pattern matching, or a
  // Rolex with a "printed dial" becomes a print.
  if (OBJECT_ARTISTS.has(lot.artist)) return 'object';

  // Combine all text signals
  const medium = (lot.medium || '').toLowerCase();
  const title = (lot.title || '').toLowerCase();
  const saleName = (lot.saleName || '').toLowerCase();
  const url = (lot.url || '').toLowerCase();
  const text = `${medium} ${title}`;

  // Design artists default to "design" unless clearly something else
  const isDesignArtist = DESIGN_ARTISTS.has(lot.artist);

  // 1. Check medium field first (most reliable when populated)
  // Photo checked before print since "c-print", "Polaroid print" etc. are photographs
  if (medium) {
    if (PHOTO_PATTERNS.test(medium)) return 'photograph';
    if (PRINT_PATTERNS.test(medium)) return 'print';
    if (SCULPTURE_PATTERNS.test(medium)) return 'sculpture';
    if (DESIGN_PATTERNS.test(medium)) return 'design';
    if (ORIGINAL_PATTERNS.test(medium)) return 'original';
  }

  // 2. Check title for explicit medium patterns
  if (PHOTO_PATTERNS.test(title)) return 'photograph';
  if (PRINT_PATTERNS.test(title)) return 'print';
  if (SCULPTURE_PATTERNS.test(title)) return 'sculpture';
  if (DESIGN_PATTERNS.test(title)) return 'design';

  // 3. Title patterns that strongly signal editions: "X plate(s), from Y", "from [Known Series]"
  if (TITLE_EDITION_PATTERNS.test(lot.title)) return 'print';

  // 4. Check sale name for category clues
  if (/prints?\s*[&+]\s*multiples?/i.test(saleName) || /prints?\s+unlimited/i.test(saleName)) return 'print';
  if (/photograph/i.test(saleName)) return 'photograph';
  if (/design/i.test(saleName) || /furniture/i.test(saleName)) return 'design';

  // 5. Check URL path
  if (/\/prints?\b/i.test(url)) return 'print';
  if (/\/photograph/i.test(url)) return 'photograph';
  if (/\/design/i.test(url)) return 'design';

  // 6. Artist-level defaults
  if (isDesignArtist) return 'design';
  if (EDITION_DEFAULT_ARTISTS.has(lot.artist)) return 'print';
  if (ORIGINAL_DEFAULT_ARTISTS.has(lot.artist)) return 'original';

  // 7. If we have a medium field but nothing matched the patterns, likely original
  if (medium && ORIGINAL_PATTERNS.test(text)) return 'original';

  return 'unknown';
}

// ── Artist Configuration ──

interface ArtistConfig {
  slug: string;
  displayName: string;
  phillips?: { id: string; slug: string };
  sothebys?: string;
  christies?: string;
  wright?: string;
  bonhams?: string;
  hindman?: string;
}

const ARTISTS: ArtistConfig[] = [
  {
    slug: 'george-condo',
    displayName: 'George Condo',
    phillips: { id: '10606', slug: 'george-condo' },
    sothebys: 'george-condo',
    christies: 'george-condo',
    wright: 'george-condo',
    bonhams: 'George Condo',
  },
  {
    slug: 'futura-2000',
    displayName: 'Futura 2000',
    phillips: { id: '4001', slug: 'futura-2000' },
    christies: 'futura',
    wright: 'futura-lenny-mcgurr',
    bonhams: 'Futura 2000',
  },
  {
    slug: 'kaws',
    displayName: 'KAWS',
    phillips: { id: '4271', slug: 'kaws' },
    sothebys: 'kaws',
    christies: 'kaws',
    wright: 'kaws-brian-donnelly',
    bonhams: 'KAWS',
  },
  {
    slug: 'george-nakashima',
    displayName: 'George Nakashima',
    phillips: { id: '379', slug: 'george-nakashima' },
    sothebys: 'george-nakashima',
    christies: 'george-nakashima',
    wright: 'george-nakashima',
    bonhams: 'George Nakashima',
  },
  {
    slug: 'charles-eames',
    displayName: 'Charles & Ray Eames',
    phillips: { id: '10514', slug: 'charles-eames-and-ray-eames' },
    wright: 'charles-and-ray-eames',
    bonhams: 'Charles Eames',
  },
  {
    slug: 'andy-warhol',
    displayName: 'Andy Warhol',
    phillips: { id: '10449', slug: 'andy-warhol' },
    sothebys: 'andy-warhol',
    christies: 'andy-warhol',
    wright: 'andy-warhol',
    bonhams: 'Andy Warhol',
  },
  {
    slug: 'tom-sachs',
    displayName: 'Tom Sachs',
    phillips: { id: '7698', slug: 'tom-sachs' },
    sothebys: 'tom-sachs',
    christies: 'tom-sachs',
    wright: 'tom-sachs',
    bonhams: 'Tom Sachs',
  },
  {
    slug: 'barry-mcgee',
    displayName: 'Barry McGee',
    phillips: { id: '3470', slug: 'barry-mcgee' },
    christies: 'barry-mcgee',
    wright: 'barry-mcgee',
    bonhams: 'Barry McGee',
  },
  {
    slug: 'keith-haring',
    displayName: 'Keith Haring',
    phillips: { id: '11032', slug: 'keith-haring' },
    sothebys: 'keith-haring',
    christies: 'keith-haring',
    wright: 'keith-haring',
    bonhams: 'Keith Haring',
  },
  {
    slug: 'peter-saul',
    displayName: 'Peter Saul',
    phillips: { id: '8398', slug: 'peter-saul' },
    christies: 'peter-saul',
    wright: 'peter-saul',
    bonhams: 'Peter Saul',
  },
  {
    slug: 'ed-ruscha',
    displayName: 'Ed Ruscha',
    phillips: { id: '11024', slug: 'ed-ruscha' },
    sothebys: 'ed-ruscha',
    christies: 'ed-ruscha',
    wright: 'ed-ruscha',
    bonhams: 'Ed Ruscha',
  },
  {
    slug: 'r-crumb',
    displayName: 'R. Crumb',
    phillips: { id: '7549', slug: 'robert-crumb' },
    wright: 'robert-crumb',
    bonhams: 'Robert Crumb',
  },
  {
    slug: 'raymond-pettibon',
    displayName: 'Raymond Pettibon',
    phillips: { id: '10831', slug: 'raymond-pettibon' },
    sothebys: 'raymond-pettibon',
    christies: 'raymond-pettibon',
    wright: 'raymond-pettibon',
    bonhams: 'Raymond Pettibon',
  },
  {
    slug: 'henri-matisse',
    displayName: 'Henri Matisse',
    phillips: { id: '10638', slug: 'henri-matisse' },
    sothebys: 'henri-matisse',
    christies: 'henri-matisse',
    wright: 'henri-matisse',
    bonhams: 'Henri Matisse',
  },
  {
    slug: 'pablo-picasso',
    displayName: 'Pablo Picasso',
    phillips: { id: '10800', slug: 'pablo-picasso' },
    sothebys: 'pablo-picasso',
    christies: 'pablo-picasso',
    wright: 'pablo-picasso',
    bonhams: 'Pablo Picasso',
  },
  {
    slug: 'fab-5-freddy',
    displayName: 'Fab 5 Freddy',
    phillips: { id: '10358', slug: 'fred-brathwaite-aka-fab-5-freddy' },
    bonhams: 'Fab 5 Freddy',
  },
  {
    slug: 'francesco-clemente',
    displayName: 'Francesco Clemente',
    phillips: { id: '8171', slug: 'francesco-clemente' },
    christies: 'francesco-clemente',
    wright: 'francesco-clemente',
    bonhams: 'Francesco Clemente',
  },
  {
    slug: 'jean-prouve',
    displayName: 'Jean Prouvé',
    phillips: { id: '5611', slug: 'jean-prouve' },
    christies: 'jean-prouve',
    wright: 'jean-prouve',
    bonhams: 'Jean Prouvé',
  },
  {
    slug: 'pierre-jeanneret',
    displayName: 'Pierre Jeanneret',
    phillips: { id: '7134', slug: 'pierre-jeanneret' },
    christies: 'pierre-jeanneret',
    wright: 'pierre-jeanneret',
    bonhams: 'Pierre Jeanneret',
  },
  {
    slug: 'eddie-martinez',
    displayName: 'Eddie Martinez',
    phillips: { id: '7287', slug: 'eddie-martinez' },
    sothebys: 'eddie-martinez',
    christies: 'eddie-martinez',
    bonhams: 'Eddie Martinez',
  },
  {
    slug: 'kenny-scharf',
    displayName: 'Kenny Scharf',
    phillips: { id: '1306', slug: 'kenny-scharf' },
    sothebys: 'kenny-scharf',
    christies: 'kenny-scharf',
    wright: 'kenny-scharf',
    bonhams: 'Kenny Scharf',
  },

  // ── The watches vertical: makers, not artists. Phillips (the watch house)
  // maker pages + Christie's maker pages + Bonhams keyword search.
  // Wright/Rago don't trade watches — deliberately absent.
  // christies omitted — crawlChristiesAuctions pulls full curated watch sales
  // (the maker/search page only gave 50 lots and would double-count).
  { slug: 'rolex', displayName: 'Rolex', phillips: { id: '5830', slug: 'rolex' }, bonhams: 'Rolex wristwatch' },
  { slug: 'patek-philippe', displayName: 'Patek Philippe', phillips: { id: '12634', slug: 'patek-philippe' }, bonhams: 'Patek Philippe' },
  { slug: 'audemars-piguet', displayName: 'Audemars Piguet', phillips: { id: '10464', slug: 'audemars-piguet' }, bonhams: 'Audemars Piguet' },
  { slug: 'omega', displayName: 'Omega', phillips: { id: '10364', slug: 'omega' }, bonhams: 'Omega wristwatch' },
  { slug: 'cartier', displayName: 'Cartier', phillips: { id: '4810', slug: 'cartier' }, bonhams: 'Cartier' },

  // ── The science vertical: Sotheby's curated Geek Week sales only (natural
  // history, space exploration, history of science & technology). No Bonhams
  // keyword dredging — that pulled thousands of junk fragments. These slugs
  // carry no house config; crawlSothebysAuctions populates them by routing
  // each lot's text. Rago would never have science.
  { slug: 'meteorites', displayName: 'Meteorites' },
  { slug: 'fossils', displayName: 'Fossils & Dinosaurs' },
  { slug: 'space-exploration', displayName: 'Space Exploration' },
  { slug: 'scientific-instruments', displayName: 'Scientific Instruments' },

  // ── The sports vertical: Goldin only, and ONLY the real objects —
  // game-used, trophies & awards, tickets & passes. NEVER cards.
  { slug: 'game-used', displayName: 'Game Worn & Used' },
  { slug: 'trophies-awards', displayName: 'Trophies & Awards' },
  { slug: 'tickets-passes', displayName: 'Tickets & Passes' },
];

const DATA_DIR = path.join(process.cwd(), 'public', 'data', 'ray');
// One-time (or occasional) history expander: RAY_DEEP=1 walks much deeper
// pagination on the houses that expose it, and enriches far more detail
// pages. Polite delays are kept; it just keeps walking.
const DEEP = process.env.RAY_DEEP === '1';
const DELAY_MS = 1500;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Phillips Crawler ──
// Phillips embeds lot data as a JSON string in ReactDOM.hydrate props for ArtistLanding.
// The "maker" prop contains a JSON-encoded string with pastLots.data[].

async function crawlPhillips(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.phillips) return [];
  const lots: AuctionLot[] = [];
  console.log(`  [Phillips] Fetching ${artist.displayName}...`);

  // ── primary: the paginated maker-lots API — 100% estimate-bearing, ~99%
  // sold-priced, and the ONLY way past the newest slice of a maker's history
  // (the artist page's hydration blob exposes one page, which is why only ~3%
  // of Phillips history had been captured). Nightly runs walk the first 2
  // pages (fresh sales); PHILLIPS_DEEP=1 walks the full history (backfill).
  let lotData: any[] = [];
  try {
    const per = 100;
    const first = await fetch(`https://api.phillips.com/api/maker/${artist.phillips.id}/lots?page=1&resultsPerPage=${per}`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000),
    });
    if (first.ok) {
      const j = await first.json();
      lotData = Array.isArray(j.data) ? j.data : [];
      const totalPages = j.totalPages || 1;
      const deep = process.env.PHILLIPS_DEEP === '1';
      const lastPage = deep ? totalPages : Math.min(totalPages, 2);
      console.log(`  [Phillips] API: ${j.totalCount || lotData.length} lots, walking ${lastPage}/${totalPages} pages${deep ? ' (deep)' : ''}`);
      for (let p = 2; p <= lastPage; p++) {
        await sleep(400);
        try {
          const r = await fetch(`https://api.phillips.com/api/maker/${artist.phillips.id}/lots?page=${p}&resultsPerPage=${per}`, {
            headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000),
          });
          if (!r.ok) { console.warn(`  [Phillips] page ${p}: HTTP ${r.status}`); break; }
          const jp = await r.json();
          if (!Array.isArray(jp.data) || jp.data.length === 0) break;
          lotData.push(...jp.data);
        } catch (e) { console.warn(`  [Phillips] page ${p} failed: ${(e as Error).message}`); break; }
      }
    } else {
      console.warn(`  [Phillips] maker API HTTP ${first.status} — falling back to page scrape`);
    }
  } catch (e) { console.warn(`  [Phillips] maker API failed: ${(e as Error).message} — falling back to page scrape`); }

  // ── fallback: the artist page's hydration blob (legacy path)
  if (lotData.length === 0) {
    try {
      const res = await fetch(`https://www.phillips.com/artist/${artist.phillips.id}/${artist.phillips.slug}`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) { console.log(`  [Phillips] HTTP ${res.status}`); return lots; }
      const html = await res.text();
      const $ = cheerio.load(html);
      let makerData: any = null;
      $('script').each((_, script) => {
        if (makerData) return;
        const text = $(script).html() || '';
        if (!text.includes('ArtistLanding')) return;
        // the maker prop uses \u0022 unicode escapes for quotes
        const makerMatch = text.match(/"maker":"([^"]*)"/);
        if (makerMatch) {
          try {
            const innerJson = JSON.parse('"' + makerMatch[1] + '"');
            makerData = JSON.parse(innerJson);
          } catch (e) {
            console.log('  [Phillips] Failed to parse maker prop:', (e as Error).message?.substring(0, 100));
          }
        }
      });
      lotData = [...(makerData?.upcomingLots?.data || []), ...(makerData?.pastLots?.data || [])];
    } catch (err) {
      console.error('  [Phillips] Error:', err);
      return lots;
    }
  }
  if (lotData.length === 0) { console.log('  [Phillips] No structured lot data found'); return lots; }
  console.log(`  [Phillips] Parsing ${lotData.length} lots…`);

  try {
    for (const lot of lotData) {
      if (lot.isNoLot) continue;
      const title = lot.description || lot.title || lot.lotTitle || 'Untitled';
      const saleNum = lot.saleNumber || '';
      const lotNum = lot.lotNumber || '';
      const detailLink = lot.detailLink || lot.url || `/detail/${saleNum}/${lotNum}`;
      const currency = detectCurrency(lot.currencySign || '');
      const hammerBP = lot.hammerPlusBP ?? lot.hammerPlusCommission ?? null;
      const hammer = lot.hammerPrice ?? null;
      const soldPrice = hammerBP ?? hammer;
      const isSold = soldPrice != null && soldPrice > 0;
      // Phillips is per-lot: premium-inclusive when hammerBP exists, else the
      // realized number is just the hammer (no premium published).
      const phillipsBasis: PriceBasis = hammerBP != null ? 'realized' : 'hammer-only';

      let auctionInPast = false;
      if (lot.auctionStartDateTimeOffset) {
        const aDate = new Date(lot.auctionStartDateTimeOffset);
        auctionInPast = !isNaN(aDate.getTime()) && aDate < new Date();
      }

      let imageUrl: string | null = null;
      if (lot.imagePath) {
        const ver = lot.cloudinaryVersion || '1';
        // If imagePath is already a full URL, use it as-is; otherwise build Cloudinary URL
        if (lot.imagePath.startsWith('http')) {
          imageUrl = lot.imagePath;
        } else {
          imageUrl = `https://assets.phillips.com/image/upload/t_Website_LotDetailMainImage/v${ver}/${lot.imagePath}`;
        }
      }

      let saleDate = '';
      if (lot.auctionStartDateTimeOffset) {
        saleDate = lot.auctionStartDateTimeOffset.split('T')[0];
      } else if (lot.saleDate) {
        saleDate = lot.saleDate;
      }

      lots.push({
        id: `phillips-${saleNum}-${lotNum}`,
        artist: artist.slug,
        title,
        year: lot.dates || lot.circa || null,
        medium: lot.medium || null,
        dimensions: lot.dimensions || null,
        description: lot.description || lot.catalogueNote || null,
        category: 'unknown' as LotCategory,
        imageUrl,
        auctionHouse: 'Phillips',
        saleName: lot.saleTitle || '',
        saleDate,
        lotNumber: lotNum ? parseInt(lotNum) : null,
        ...stampMoney({
          isSold,
          nativeCurrency: currency,
          saleDate: saleDate || null,
          hammerNative: hammer,
          premiumNative: hammerBP,
          estLowNative: lot.lowEstimate ?? null,
          estHighNative: lot.highEstimate ?? null,
          priceBasis: phillipsBasis,
        }),
        status: isSold ? 'sold' : auctionInPast ? 'bought_in' : 'upcoming',
        url: detailLink.startsWith('http') ? detailLink : `https://www.phillips.com${detailLink}`,
      });
    }
  } catch (err) {
    console.error('  [Phillips] Error:', err);
  }

  return lots;
}

// ── Sotheby's Crawler ──
// Parses lot links from the artist page HTML.

async function crawlSothebys(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.sothebys) return [];
  const lots: AuctionLot[] = [];
  const url = `https://www.sothebys.com/en/artists/${artist.sothebys}`;
  console.log(`  [Sothebys] Fetching ${artist.displayName}...`);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      console.log(`  [Sothebys] HTTP ${res.status}`);
      return lots;
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const now = new Date();
    const seen = new Set<string>();
    const artistSlugParts = artist.sothebys!.split('-');
    const stripPrefix = new RegExp(`^${artistSlugParts.join('-?')}-?`, 'i');

    // Parse from Card elements (richer data: images, estimates, lot numbers)
    const cards = $('.Card.data-type-lot').toArray();
    console.log(`  [Sothebys] Found ${cards.length} lot cards`);

    for (const cardEl of cards) {
      const card = $(cardEl);
      const href = card.find('a[href*="/buy/auction/"]').first().attr('href') || '';
      if (!href) continue;

      const slug = href.split('/').pop() || '';
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      // Image from data-src (lazy loaded), fallback to src
      const img = card.find('img');
      const imageUrl = img.attr('data-src') || img.attr('src') || null;
      // Filter out SVG placeholders
      const finalImageUrl = imageUrl && imageUrl.startsWith('data:image/svg') ? null : imageUrl;

      // Lot number
      const lotNumText = card.find('.Card-lotNumber').text().trim();
      const lotNumber = lotNumText ? parseInt(lotNumText) || null : null;

      // Title from card info text — extract the actual work title
      const infoText = card.find('.Card-info-container').text().trim();
      // Info typically has: "Type: lot Category: Lot ArtistName ArtistName Title Estimate: ..."
      // Extract title by looking for text between duplicated artist name and "Estimate:"
      let title = '';
      const estimateIdx = infoText.indexOf('Estimate:');
      const relevantText = estimateIdx > 0 ? infoText.substring(0, estimateIdx) : infoText;
      // Find the display name repeated (Sotheby's shows it twice)
      const displayParts = artist.displayName.split(' ');
      const lastName = displayParts[displayParts.length - 1];
      const lastNameIdx = relevantText.lastIndexOf(lastName);
      if (lastNameIdx >= 0) {
        title = relevantText.substring(lastNameIdx + lastName.length).trim();
        // Clean up any Chinese characters or extra whitespace
        title = title.replace(/[\u4e00-\u9fff\u00b7\u2013\u2014|]+/g, ' ').replace(/\s+/g, ' ').trim();
        // Strip artist name if it appears at the start (ALL CAPS variant)
        const nameUpper = artist.displayName.toUpperCase();
        if (title.startsWith(nameUpper)) {
          title = title.substring(nameUpper.length).trim();
        }
      }
      if (!title || title.length < 2) {
        // Fallback to slug-based title
        let titleSlug = slug.replace(stripPrefix, '');
        titleSlug = titleSlug.replace(/^qiao-zhi?-?kang-duo-?/i, '');
        if (!titleSlug || titleSlug.length < 2) continue;
        title = titleSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }

      // Estimate parsing: "Estimate: 800,000 – 1,200,000 USD"
      const estText = card.find('.Card-estimate').text().trim();
      let estimateLow: number | null = null;
      let estimateHigh: number | null = null;
      let currency: Currency = 'USD';
      const estMatch = estText.match(/Estimate:\s*([\d,]+)\s*[–—-]\s*([\d,]+)\s*(\w+)/);
      if (estMatch) {
        estimateLow = parseInt(estMatch[1].replace(/,/g, ''));
        estimateHigh = parseInt(estMatch[2].replace(/,/g, ''));
        const cur = estMatch[3].toUpperCase();
        if (['USD', 'GBP', 'EUR', 'HKD', 'CNY', 'AUD', 'CHF'].includes(cur)) {
          currency = cur as Currency;
        }
      }

      // Sale name and year from href: /buy/auction/YYYY/sale-name/slug
      const hrefParts = href.split('/');
      const auctionIdx = hrefParts.indexOf('auction');
      const auctionYear = auctionIdx >= 0 && hrefParts[auctionIdx + 1] ? parseInt(hrefParts[auctionIdx + 1]) || null : null;
      const saleName = auctionIdx >= 0 && hrefParts[auctionIdx + 2]
        ? hrefParts[auctionIdx + 2].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : '';

      // The artist page exposes NO results (no hammer, no real sale date) — a
      // record without a realized price is not a sale, so lots from this path
      // are never 'sold'. A current-year card still showing a live Estimate is
      // treated as upcoming; everything else resolved without a knowable
      // result and is recorded as bought_in (matching how the other crawlers
      // handle indeterminate past lots). The June 1 date is a placeholder —
      // the year is all the page gives us.
      let status: LotStatus = 'bought_in';
      let saleDate = '';
      if (auctionYear) {
        saleDate = `${auctionYear}-06-01`;
        if (auctionYear >= now.getFullYear() && estimateLow !== null) {
          status = 'upcoming';
        }
      }

      const fullUrl = href.startsWith('http') ? href : `https://www.sothebys.com${href}`;

      // Try to extract medium, dimensions, and year from card info container
      // Sotheby's often includes this data in the info text after the title
      let medium: string | null = null;
      let dimensions: string | null = null;
      let year: string | null = null;
      const afterTitle = infoText.substring(infoText.indexOf(title) + title.length).trim();

      // Look for year (4-digit number, possibly with circa/c.)
      const yearMatch = afterTitle.match(/(?:(?:circa|c\.)\s*)?(\d{4})(?:\s|,|$)/i);
      if (yearMatch) {
        year = yearMatch[1];
      }

      // Look for medium patterns (oil on canvas, screenprint, etc.)
      const mediumMatch = afterTitle.match(/((?:oil|acrylic|watercolor|gouache|ink|mixed media|screenprint|lithograph|etching|woodcut|gelatin silver|c-print|bronze|ceramic|spray paint)[^,\.]{0,80})/i);
      if (mediumMatch) {
        medium = mediumMatch[1].trim();
      }

      // Look for dimensions (numbers followed by × or x and units)
      const dimMatch = afterTitle.match(/(\d+(?:\.\d+)?\s*[×x]\s*\d+(?:\.\d+)?\s*(?:in|cm)[^,\.]{0,40})/i);
      if (dimMatch) {
        dimensions = dimMatch[1].trim();
      }

      lots.push({
        id: `sothebys-${slug}`,
        artist: artist.slug,
        title,
        year,
        medium,
        dimensions,
        category: 'unknown' as LotCategory,
        imageUrl: finalImageUrl,
        auctionHouse: "Sotheby's",
        saleName,
        saleDate,
        lotNumber,
        ...stampMoney({
          isSold: false, // artist-page path exposes no realized price — never 'sold'
          nativeCurrency: currency,
          saleDate: saleDate || null,
          hammerNative: null,
          premiumNative: null,
          estLowNative: estimateLow,
          estHighNative: estimateHigh,
          priceBasis: 'realized',
        }),
        status,
        url: fullUrl,
      });
    }

    // Also pick up any additional lot links not in Card containers
    const allLinks = $('a[href*="/buy/auction/"]').toArray();
    for (const el of allLinks) {
      const href = $(el).attr('href') || '';
      const slug = href.split('/').pop() || '';
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      let titleSlug = slug.replace(stripPrefix, '');
      titleSlug = titleSlug.replace(/^qiao-zhi?-?kang-duo-?/i, '');
      if (!titleSlug || titleSlug.length < 2) continue;
      const title = titleSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      const yearMatch = href.match(/\/auction\/(\d{4})\//);
      const auctionYear = yearMatch ? parseInt(yearMatch[1]) : null;
      // Bare links carry no estimate and no result — never 'upcoming' (would
      // be a phantom that can't resolve) and never 'sold' (no realized price).
      let status: LotStatus = 'bought_in';
      let saleDate = '';
      if (auctionYear) saleDate = `${auctionYear}-06-01`;

      const fullUrl = href.startsWith('http') ? href : `https://www.sothebys.com${href}`;
      lots.push({
        id: `sothebys-${slug}`,
        artist: artist.slug,
        title,
        year: null,
        medium: null,
        dimensions: null,
        category: 'unknown' as LotCategory,
        imageUrl: null,
        auctionHouse: "Sotheby's",
        saleName: '',
        saleDate,
        lotNumber: null,
        ...stampMoney({
          isSold: false, // bare-link path: no estimate, no result — never 'sold'
          nativeCurrency: 'USD', // bare links carry no currency signal; default USD
          saleDate: saleDate || null,
          hammerNative: null,
          premiumNative: null,
          estLowNative: null,
          estHighNative: null,
          priceBasis: 'realized',
        }),
        status,
        url: fullUrl,
      });
    }

    const withImages = lots.filter(l => l.imageUrl).length;
    console.log(`  [Sothebys] Parsed ${lots.length} unique lots (${withImages} with images, ${lots.filter(l => l.status === 'upcoming').length} upcoming)`);
  } catch (err) {
    console.error('  [Sothebys] Error:', err);
  }

  return lots;
}

// ── Christie's Crawler ──
// Christie's embeds lot data as JSON in window.chrComponents.configurableSearch.

function parseChristiesHtml(html: string, artistSlug: string): AuctionLot[] {
  const searchMatch = html.match(/window\.chrComponents\s*=\s*window\.chrComponents\s*\|\|\s*\{\};\s*window\.chrComponents\.configurableSearch\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (searchMatch) return parseChristiesJson(searchMatch[1], artistSlug);
  const altMatch = html.match(/configurableSearch\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/);
  if (altMatch) return parseChristiesJson(altMatch[1], artistSlug);
  return [];
}

async function crawlChristies(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.christies) return [];

  const lots: AuctionLot[] = [];
  const seen = new Set<string>();

  // deep mode: the artist page paginates — walk back through history
  if (DEEP) {
    for (let p = 2; p <= 8; p++) {
      await sleep(800);
      try {
        const r = await fetch(`https://www.christies.com/en/artists/${artist.christies}?lotavailability=All&sortby=relevance&page=${p}`, {
          headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) break;
        const pageLots = parseChristiesHtml(await r.text(), artist.slug);
        let fresh = 0;
        pageLots.forEach(lot => { if (!seen.has(lot.id)) { seen.add(lot.id); lots.push(lot); fresh++; } });
        if (fresh === 0) break;
      } catch (e) { console.warn(`  [Christie's] deep-page fetch failed: ${(e as Error).message}`); break; }
    }
    if (lots.length) console.log(`  [Christie's] Deep pages added ${lots.length} lots`);
  }

  // Fetch from artist page (gets recent/past lots)
  const artistUrl = `https://www.christies.com/en/artists/${artist.christies}?lotavailability=All&sortby=relevance`;
  console.log(`  [Christie's] Fetching artist page for ${artist.displayName}...`);

  try {
    const res = await fetch(artistUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000)
    });
    if (res.ok) {
      parseChristiesHtml(await res.text(), artist.slug).forEach(lot => {
        if (!seen.has(lot.id)) {
          seen.add(lot.id);
          lots.push(lot);
        }
      });
    }
  } catch (err) {
    console.error("  [Christie's] Error fetching artist page:", err);
  }

  // Also fetch from search (gets upcoming lots that might not be on artist page)
  const searchUrl = `https://www.christies.com/en/search?entry=${encodeURIComponent(artist.displayName)}&page=1&sortby=relevance&tab=available_lots`;
  console.log(`  [Christie's] Fetching search for upcoming lots...`);

  try {
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000)
    });
    if (res.ok) {
      parseChristiesHtml(await res.text(), artist.slug).forEach(lot => {
        if (!seen.has(lot.id)) {
          seen.add(lot.id);
          lots.push(lot);
        }
      });
    }
  } catch (err) {
    console.error("  [Christie's] Error fetching search:", err);
  }

  console.log(`  [Christie's] Found ${lots.length} total lots`);
  return lots;
}

function parseChristiesJson(jsonStr: string, artistSlug: string): AuctionLot[] {
  const lots: AuctionLot[] = [];
  try {
    const data = JSON.parse(jsonStr);
    const lotData = data?.data?.lots || data?.lots || [];
    console.log(`  [Christie's] Found ${lotData.length} lots`);

    for (const lot of lotData) {
      const titleSecondary = lot.title_secondary_txt || '';
      const title = titleSecondary || lot.title_primary_txt || 'Untitled';
      const lotId = lot.object_id || lot.lot_id_txt || '';
      const lotUrl = lot.url || `https://www.christies.com/en/lot/lot-${lotId}`;

      const estimateStr = lot.estimate_txt || '';
      const currency = detectCurrency(estimateStr);
      let estimateLow: number | null = null;
      let estimateHigh: number | null = null;
      const estMatch = estimateStr.match(/([\d,]+)\s*[-–]\s*([\d,]+)/);
      if (estMatch) {
        estimateLow = parseInt(estMatch[1].replace(/,/g, ''));
        estimateHigh = parseInt(estMatch[2].replace(/,/g, ''));
      }

      const priceStr = lot.price_realised_txt || '';
      let priceRealized: number | null = null;
      const priceMatch = priceStr.match(/([\d,]+)/);
      if (priceMatch) {
        priceRealized = parseInt(priceMatch[0].replace(/,/g, ''));
      }

      const saleDate = lot.start_date ? lot.start_date.split('T')[0] : '';
      const auctionInPast = saleDate ? isSaleDayPast(saleDate) : true; // default to past if no date
      const isSold = priceRealized != null && priceRealized > 0;
      const imageUrl = lot.image?.image_src || null;
      const saleNum = lot.sale?.number || '';
      const lotNum = lot.lot_id_txt || '';

      // Try to extract medium from Christie's data — only use short medium_txt, not full description
      const rawMedium = lot.medium_txt || null;
      const christiesMedium = rawMedium && String(rawMedium).length < 150
        ? String(rawMedium).replace(/<[^>]*>/g, '')
        : null;

      // Extract dimensions from Christie's data
      const rawDimensions = lot.measurements_txt || lot.dimensions_txt || null;
      const christiesDimensions = rawDimensions && String(rawDimensions).length < 200
        ? String(rawDimensions).replace(/<[^>]*>/g, '').replace(/&times;/g, '×').replace(/&ndash;/g, '–')
        : null;

      // Christie's publishes price realised (buyer-inclusive) — the realized
      // number is the premium; hammer is not exposed here.
      const christiesDescription = lot.description_txt && String(lot.description_txt).length < 4000
        ? String(lot.description_txt).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null
        : null;

      lots.push({
        id: `christies-${lotId}`,
        artist: artistSlug,
        title: title.replace(/<[^>]*>/g, ''),
        year: lot.date_txt || null,
        medium: christiesMedium,
        dimensions: christiesDimensions,
        description: christiesDescription,
        category: 'unknown' as LotCategory,
        imageUrl,
        auctionHouse: "Christie's",
        saleName: lot.sale?.location ? `${lot.sale.location} Sale ${saleNum}` : '',
        saleDate,
        lotNumber: lotNum ? parseInt(lotNum) : null,
        ...stampMoney({
          isSold,
          nativeCurrency: currency,
          saleDate: saleDate || null,
          hammerNative: null,
          premiumNative: priceRealized,
          estLowNative: estimateLow,
          estHighNative: estimateHigh,
          priceBasis: 'realized',
        }),
        status: isSold ? 'sold' : auctionInPast ? 'bought_in' : 'upcoming',
        url: lotUrl.startsWith('http') ? lotUrl : `https://www.christies.com${lotUrl}`,
      });
    }
  } catch (e) {
    console.log("  [Christie's] JSON parse error:", (e as Error).message?.substring(0, 100));
  }
  return lots;
}

// ── Wright/Rago Crawler ──
// Wright uses Inertia.js (Laravel + Vue). All lot data is in the #app div's data-page attribute.
// Basic artist pages use results_grouped; advanced/custom pages use results.primary_results.paginator.

async function crawlWright(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.wright) return [];
  const lots: AuctionLot[] = [];
  const url = `https://www.wright20.com/artists/${artist.wright}`;
  console.log(`  [Wright] Fetching ${artist.displayName}...`);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      console.log(`  [Wright] HTTP ${res.status}`);
      return lots;
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const dataPage = $('#app').attr('data-page');
    if (!dataPage) {
      console.log('  [Wright] No data-page attribute found on #app');
      return lots;
    }

    const pageData = JSON.parse(dataPage);
    const resultsGrouped = pageData?.props?.results_grouped;

    // Try basic page format (results_grouped)
    if (resultsGrouped && Array.isArray(resultsGrouped) && resultsGrouped.length > 0) {
      let totalItems = 0;
      for (const group of resultsGrouped) {
        const sessions = group.sessions || {};
        for (const sessionKey of Object.keys(sessions)) {
          const session = sessions[sessionKey];
          const items = session.items || [];
          for (const item of items) {
            totalItems++;
            lots.push(parseWrightBasicItem(item, session, sessionKey, artist.slug));
          }
        }
      }
      console.log(`  [Wright] Parsed ${totalItems} lots (basic page)`);
      return lots;
    }

    // Try advanced/custom page format (paginator)
    const paginator = pageData?.props?.results?.primary_results?.paginator?.items
      || pageData?.props?.results?.primary_results?.sorted_items?.results;
    if (paginator?.data && Array.isArray(paginator.data)) {
      const items = paginator.data;
      const lastPage = paginator.last_page || 1;
      console.log(`  [Wright] Found ${items.length} lots on page 1 of ${lastPage} (${paginator.total || items.length} total, advanced page)`);
      for (const item of items) {
        lots.push(parseWrightAdvancedItem(item, artist.slug));
      }
      // deep mode: walk the whole paginator (history lives back here)
      if (DEEP && lastPage > 1) {
        const cap = Math.min(lastPage, 30);
        for (let p = 2; p <= cap; p++) {
          await sleep(600);
          try {
            const r2 = await fetch(`${url}?page=${p}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
            if (!r2.ok) break;
            const $2 = cheerio.load(await r2.text());
            const dp2 = $2('#app').attr('data-page');
            if (!dp2) break;
            const pd2 = JSON.parse(dp2);
            const pag2 = pd2?.props?.results?.primary_results?.paginator?.items
              || pd2?.props?.results?.primary_results?.sorted_items?.results;
            const items2 = pag2?.data;
            if (!items2 || !Array.isArray(items2) || items2.length === 0) break;
            for (const item of items2) lots.push(parseWrightAdvancedItem(item, artist.slug));
          } catch { break; }
        }
        console.log(`  [Wright] Deep walk complete: ${lots.length} lots total`);
      }
      return lots;
    }

    console.log('  [Wright] No lot data found in page data');
  } catch (err) {
    console.error('  [Wright] Error:', err);
  }

  return lots;
}

function parseWrightBasicItem(item: any, session: any, sessionKey: string, artistSlug: string): AuctionLot {
  const title = item.name || 'Untitled';
  const lotNum = item.lot_number || null;
  const house = (item.house || 'Wright') as string;
  const result = item.result || null;
  const resultSansPremium = item.result_sans_premium || null;

  const estStr = item.estimate_formatted || '';
  let estimateLow: number | null = null;
  let estimateHigh: number | null = null;
  const estMatch = estStr.match(/([\d,]+)\s*[–\-]\s*([\d,]+)/);
  if (estMatch) {
    estimateLow = parseInt(estMatch[1].replace(/,/g, ''));
    estimateHigh = parseInt(estMatch[2].replace(/,/g, ''));
  }

  const sessionDate = session.date || item.session?.date || '';
  let saleDate = '';
  if (sessionDate) {
    try {
      const d = new Date(sessionDate);
      if (!isNaN(d.getTime())) saleDate = d.toISOString().split('T')[0];
    } catch { /* skip */ }
  }

  const auctionInPast = saleDate ? isSaleDayPast(saleDate) : false;
  const isSold = result != null && result > 0;
  const imageUrl = item.primary_index_image || null;

  let lotUrl = item.alias || '';
  if (lotUrl.startsWith('//')) lotUrl = 'https:' + lotUrl;
  else if (!lotUrl.startsWith('http') && lotUrl) lotUrl = 'https://www.wright20.com' + lotUrl;

  const auctionHouse: AuctionHouse = house.toLowerCase().includes('rago') ? 'Rago' : 'Wright';
  const dims = item.formatted_dimensions || null;

  // Extract year from Wright basic item
  const year = item.year_designed || item.circa || item.year || null;

  // Rago's lots are crawled through Wright's Inertia stack — record the crawl-
  // origin platform when the selling house differs (identity §1a / W12). W12
  // also renamespaces the id: a Rago lot is `rago-*` (invariant 6, id prefix
  // matches the SELLING house), with `platform:'wright'` carrying the origin.
  // Existing wright-* Rago rows are renamespaced by migrate-v2, so born-v2
  // crawler ids line up after the migration lands.
  const platform = auctionHouse === 'Rago' ? 'wright' : null;
  const idPrefix = auctionHouse === 'Rago' ? 'rago' : 'wright';

  return {
    id: `${idPrefix}-${item.fd_key || `${lotNum}-${sessionKey}`}`,
    artist: artistSlug,
    title,
    year,
    medium: item.material || null,
    dimensions: dims ? dims.replace(/&times;/g, '×').replace(/&ndash;/g, '–') : null,
    description: item.description ? String(item.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null : null,
    platform,
    category: 'unknown' as LotCategory,
    imageUrl,
    auctionHouse,
    saleName: session.title || '',
    saleDate,
    lotNumber: lotNum,
    ...stampMoney({
      isSold,
      nativeCurrency: 'USD', // Wright/Rago publish USD
      saleDate: saleDate || null,
      hammerNative: resultSansPremium,
      premiumNative: result,
      estLowNative: estimateLow,
      estHighNative: estimateHigh,
      priceBasis: 'realized',
    }),
    status: isSold ? 'sold' : auctionInPast ? 'bought_in' : 'upcoming',
    url: lotUrl,
  };
}

function parseWrightAdvancedItem(item: any, artistSlug: string): AuctionLot {
  const title = item.name || 'Untitled';
  const lotNum = item.lot_number || null;
  const result = item.result_premium_amount || null;
  const hammer = item.result_amount || null;
  const isSold = item.item_status === 'Sold' || (result != null && result > 0);

  let saleDate = '';
  if (item.session?.start_date) {
    saleDate = item.session.start_date.split('T')[0];
  }

  const auctionInPast = saleDate ? isSaleDayPast(saleDate) : false;

  // Build image URL
  let imageUrl: string | null = null;
  if (item.primary_index_image?.filename) {
    const img = item.primary_index_image;
    imageUrl = `https://www.wright20.com/items/index/220/${img.seo_filename || img.filename}`;
  }

  let lotUrl = item.alias || '';
  if (lotUrl.startsWith('//')) lotUrl = 'https:' + lotUrl;
  else if (!lotUrl.startsWith('http') && lotUrl) lotUrl = 'https://www.wright20.com/' + lotUrl;

  const houseName = item.session?.auction?.auction_house?.name || item.auction?.auction_house?.name || 'Wright';
  const auctionHouse: AuctionHouse = houseName.toLowerCase().includes('rago') ? 'Rago' : 'Wright';

  // Extract dimensions from Wright advanced item
  const dims = item.formatted_dimensions || item.dimensions || null;

  // W12 — renamespace Rago ids to `rago-*` (invariant 6); platform carries the
  // Wright-stack origin.
  const platform = auctionHouse === 'Rago' ? 'wright' : null;
  const idPrefix = auctionHouse === 'Rago' ? 'rago' : 'wright';

  return {
    id: `${idPrefix}-${item.fd_key || item.id || `${lotNum}`}`,
    artist: artistSlug,
    title,
    year: item.year_designed || null,
    medium: item.material || null,
    dimensions: dims ? String(dims).replace(/&times;/g, '×').replace(/&ndash;/g, '–') : null,
    description: item.description ? String(item.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null : null,
    platform,
    category: 'unknown' as LotCategory,
    imageUrl,
    auctionHouse,
    saleName: item.session?.title || '',
    saleDate,
    lotNumber: lotNum,
    ...stampMoney({
      isSold,
      nativeCurrency: 'USD', // Wright/Rago publish USD
      saleDate: saleDate || null,
      hammerNative: hammer,
      premiumNative: result,
      estLowNative: item.estimate_low || null,
      estHighNative: item.estimate_high || null,
      priceBasis: 'realized',
    }),
    status: isSold ? 'sold' : auctionInPast ? 'bought_in' : 'upcoming',
    url: lotUrl,
  };
}

// ── Bonhams Crawler ──
// Bonhams uses Typesense search with a public API key.
// We query the 'lots' collection for the artist name.

const BONHAMS_TYPESENSE_KEY = '7YZqOyG0twgst4ACc2VuCyZxpGAYzM0weFTLCC20FQY';

// ── Sotheby's Auction Crawler (GraphQL) ──
// Sotheby's has no maker pages; their real auction lots (watches + the
// curated Geek Week science sales) come from the auction pages, whose lots
// load through a public GraphQL API — full titles, estimates, hammer prices
// and images, no auth. We seed known watch & science sales and also discover
// the current ones from the department / Geek Week pages so CI stays fresh.
const SOTHEBYS_GQL = 'https://clientapi.prod.sothelabs.com/graphql';
const SOTHEBYS_LOT_QUERY = `query LotCards($id: String!, $limit: Int, $offset: Int) {
  auction(id: $id, language: ENGLISH) {
    currency
    lotCards: lotCardsConnection(offset: $offset, limit: $limit, filter: ALL) {
      hasNextPage
      totalCount
      lots {
        lotId
        title
        subtitle
        creatorsDisplayTitle
        lotNumber { ... on VisibleLotNumber { lotDisplayNumber } }
        slug { lotSlug }
        estimateV2 { ... on LowHighEstimateV2 { lowEstimate { amount } highEstimate { amount } } }
        bidState { sold { ... on ResultVisible { isSold premiums { finalPrice: finalPriceV2 { currency amount } } } } }
        media(imageSizes: [Medium, Large]) { images { renditions { url imageSize } } }
      }
    }
  }
}`;

// Known Sotheby's sales for historical depth (the crawler also discovers the
// current ones live). Watches map to a maker by lot; science sales carry a
// default routing hint but each lot is re-routed by its own text.
const SOTHEBYS_WATCH_SALES = [
  '2026/important-watches', '2026/fine-watches', '2025/important-watches',
  '2025/important-watches-2', '2025/fine-watches-2', '2025/fine-watches-3',
  '2024/important-watches', '2024/fine-watches',
];
const SOTHEBYS_SPORTS_SALES = ['2025/sports', '2025/sports-2', '2024/sports', '2024/the-one'];
// Art & design come through the SAME reliable GraphQL auction path as watches/
// science (NOT the flaky artist-page scrape, which carries no hammer and rots
// art in unknown-result). Sales are discovered live from the contemporary /
// modern departments; these seeds are a fallback. Sale names are diverse (no
// shared keyword), so art sales are NOT name-filtered — routeItem keeps only
// tracked-maker lots per the item-level doctrine.
const SOTHEBYS_ART_SALES = [
  '2026/contemporary-discoveries', '2026/modern-discoveries-l26158',
  '2026/surrealism-and-its-legacy-pf2666', '2026/modernites-pf2616',
];
const SOTHEBYS_SCIENCE_SALES = [
  '2026/natural-history', '2026/space-exploration-2', '2026/history-of-science-technology',
  '2026/history-of-science-technology-2', '2025/natural-history', '2025/space-exploration',
  '2025/history-of-science-technology', '2024/natural-history', '2024/space-exploration',
  '2023/space-exploration',
];

// A sale closes hours-to-days before the house posts hammer results. For that
// window a just-closed lot has no result yet — but it is NOT bought-in and must
// not vanish. We keep it VISIBLE as pending (upcoming) until the window lapses;
// a later crawl flips it to sold when the result posts. Beyond the window, a
// still-resultless lot is treated as a genuine bought-in. Two weeks comfortably
// covers every house's posting lag while limiting how long a real bought-in can
// masquerade as pending.
const RESULT_PENDING_MS = 14 * 86_400_000;

// Sotheby's gates realized prices behind a login. When a logged-in session
// cookie is provided (SOTHEBYS_COOKIE env / GitHub secret), every Sotheby's
// request carries it and sold results resolve like any other house. Without
// it the crawler still works — results just stay pending until the window
// lapses. Cookie format: the raw Cookie header value from a logged-in browser.
const SOTHEBYS_COOKIE = process.env.SOTHEBYS_COOKIE || '';
const sothebysAuth = (): Record<string, string> => (SOTHEBYS_COOKIE ? { Cookie: SOTHEBYS_COOKIE } : {});

// Tracked art & design makers → slug. Order: specific before ambiguous.
// Ambiguous surnames (condo=apartment, saul, sachs) require the full name.
const ART_MAKER_ROUTES: [RegExp, string][] = [
  [/\bgeorge condo\b/, 'george-condo'],
  [/\bkaws\b/, 'kaws'],
  [/\bandy warhol\b|\bwarhol\b/, 'andy-warhol'],
  [/\bkeith haring\b|\bharing\b/, 'keith-haring'],
  [/\bed(ward)? ruscha\b|\bruscha\b/, 'ed-ruscha'],
  [/\bpablo picasso\b|\bpicasso\b/, 'pablo-picasso'],
  [/\bhenri matisse\b|\bmatisse\b/, 'henri-matisse'],
  [/\btom sachs\b/, 'tom-sachs'],
  [/\bpeter saul\b/, 'peter-saul'],
  [/\braymond pettibon\b|\bpettibon\b/, 'raymond-pettibon'],
  [/\bbarry mcgee\b/, 'barry-mcgee'],
  [/\bfutura\s?2000\b|\bfutura\b/, 'futura-2000'],
  [/\brobert crumb\b|\br\.?\s?crumb\b/, 'r-crumb'],
  [/\bfab(ulous)?\s5\sfreddy\b|\bfred(erick)? brathwaite\b/, 'fab-5-freddy'],
  [/\bfrancesco clemente\b|\bclemente\b/, 'francesco-clemente'],
  [/\beddie martinez\b/, 'eddie-martinez'],
  [/\bkenny scharf\b|\bscharf\b/, 'kenny-scharf'],
  // design
  [/\bgeorge nakashima\b|\bnakashima\b/, 'george-nakashima'],
  [/\bcharles (and |& )?ray eames\b|\b(charles|ray) eames\b|\beames\b/, 'charles-eames'],
  [/\bprouv[eé]/, 'jean-prouve'],
  [/\bpierre jeanneret\b|\bjeanneret\b/, 'pierre-jeanneret'],
];

/**
 * ITEM-LEVEL routing — the doctrine. An auction is only a container; every
 * lot is classified on its OWN text, never by which sale it appeared in.
 * A Speedmaster in a Space Exploration sale is an Omega watch; a meteorite
 * in a jewelry sale would be a meteorite. A lot that matches nothing we
 * track is skipped — never guessed into a bucket.
 */
function routeItem(creators: string | null, title: string, extra = ''): string | null {
  const t = `${creators || ''} ${title} ${extra}`.toLowerCase();
  // NEVER cards — unambiguous trading-card signals gate EVERYTHING, before any
  // science/sports route can claim the lot (mirrors goldinRoute: exclusions
  // first). Deliberately narrower than the sports-route blocklist below: no
  // bare 'card'/'psa', or a Steve Jobs business card / PSA-DNA-authenticated
  // Apollo lot would be dropped.
  if (/\b(topps|bowman|panini|goudey|fleer|donruss|upper deck|rookie card|trading card|tobacco (card|silk)|pok[eé]mon|yu-?gi-?oh|\btcg\b)\b/.test(t)) return null;
  // tracked watch makers first — the strongest identity a lot can have
  if (/\brolex\b/.test(t)) return 'rolex';
  if (/\bpatek\b/.test(t)) return 'patek-philippe';
  if (/\baudemars\b/.test(t)) return 'audemars-piguet';
  if (/\bomega\b/.test(t)) return 'omega';
  if (/\bcartier\b/.test(t)) return 'cartier';
  // tracked art & design makers — the maker IS the identity (the creators field
  // carries it). Matched by name so a Condo/Warhol/Picasso lot in a Sotheby's
  // contemporary/modern sale routes correctly instead of being dropped. Full
  // names first; distinctive surnames allowed (ambiguous ones like Saul/Condo
  // require the full name). Untracked makers still fall through to null.
  for (const [re, slug] of ART_MAKER_ROUTES) if (re.test(t)) return slug;
  // science collections — positive signals only, no sale-level fallback
  if (/meteorite|pallasite|tektite|moldavite|chondrite|gibeon|seymchan|impactite|lunar meteorite|martian/.test(t)) return 'meteorites';
  if (/fossil|dinosaur|trilobite|ammonite|megalodon|mammoth|mosasaur|tyrannosaur|triceratops|pterosaur|ichthyosaur|plesiosaur|neanderthal|paleolithic|petrified|tooth of|amber with|coprolite|stromatolite/.test(t)) return 'fossils';
  // generic anatomy words are fossils ONLY with paleo context — a
  // "skeletonized" watch dial, skull-logo jersey, or Jaws poster is not a fossil
  if (/\b(skeletons?|skulls?|tusks?|claws?|jaws?)\b/.test(t) && /\b(prehistoric|cretaceous|jurassic|triassic|permian|eocene|oligocene|miocene|pliocene|pleistocene|ice age|saber[- ]tooth(ed)?|cave (bear|lion)|woolly|dire wolf|raptor|extinct)\b/.test(t)) return 'fossils';
  if (/apollo|nasa|space[- ]flown|space (exploration|shuttle|suit|program|station)|spacesuit|lunar|astronaut|cosmonaut|sputnik|gemini \d|soyuz|vostok|skylab|\brocket\b|x-15|satellite|mission (control|patch)|flight plan|star chart/.test(t)) return 'space-exploration';
  // video games are NOT science (doctrine) — a Nintendo/Atari console prototype
  // must not fall into scientific-instruments via 'prototype'/'computer'
  if (/\b(nintendo|sega|playstation|\bxbox\b|game ?boy|atari (2600|vcs|jaguar|lynx|5200|7800)|super nintendo|sega (genesis|saturn|dreamcast)|\bnes\b|\bsnes\b|game cartridge|arcade (cabinet|machine)|video ?game)\b/.test(t)) return null;
  // political / literary / entertainment Americana is NOT science — it floods
  // in from Books & Manuscripts sales, where a loose science term (globe,
  // manuscript, patent) in a long description misroutes a Washington letter or
  // Marilyn Monroe script. Block it before the science branch. Franklin is
  // deliberately absent (his electrical work IS science); a hard instrument or
  // named-scientist signal overrides the block.
  if (/\b(washington|thomas jefferson|abraham lincoln|john adams|john quincy adams|alexander hamilton|james madison|james monroe|andrew jackson|ulysses grant|robert e\.? lee|general sherman|jefferson davis|john wilkes booth|confederate|civil war|continental (army|congress)|declaration of independence|revolutionary war|colonial governor|bunker hill|fort (sumter|ticonderoga)|emancipation|hemingway|walt whitman|washington irving|ezra pound|marilyn monroe|bette davis|marlene dietrich|bruce springsteen|jacqueline (bouvier|kennedy)|cotton mather|ecclesiastical history)\b/.test(t)
      && !/telescope|microscope|astrolab|sextant|orrery|armillary|chronometer|patent (model|no|for)|scientific instrument|albert einstein|isaac newton|thomas edison|nikola tesla|charles darwin|\bsmyth\b|orville|atomic|nuclear|manhattan project/.test(t)) return null;
  if (/telescope|microscope|astrolabe|sextant|octant|orrery|armillary|barometer|theodolite|chronometer\b|slide rule|surveying (instrument|compass|chain|cross)|(terrestrial|library|pocket|table) globe|globe by|celestial|enigma machine|cipher|calculat(or|ing)|typewriter|computer|macintosh|apple[- ](1|ii)|altair|commodore|prototype|patent model|anatomical|medical (instrument|kit)|laboratory|albert einstein|isaac newton|charles darwin|marie curie|nikola tesla|thomas edison|bell labs|bell telephone laborator|transistor|semiconductor|integrated circuit|microprocessor|vacuum tube|punch(ed)? card|mainframe|eniac|univac|\bcray\b|\bibm\b|pdp-\d|\bvax\b|apple lisa|\bnext(cube|step)?\b|xerox (alto|parc|star)|difference engine|analytical engine|babbage|\bturing\b|von neumann|shockley|grace hopper|wozniak|steve jobs|kenbak|imsai|trs-80|\bamiga\b|osborne 1|manuscript.*(scien|math|physic)|first edition.*(scien|math|physic)/.test(t)) return 'scientific-instruments';
  // sports objects — Christie's/Sotheby's sports sales, same doctrine as
  // Goldin: game-used, trophies & awards, tickets & passes. NEVER cards.
  if (/\b(cards?|n172|t20[0-9]|tobacco (card|silk)|psa\b|sgc\b|topps|bowman|panini|goudey|leaf\b|cabinet (photo|card)|carte de visite)\b/.test(t)) return null;
  if (/\b(game[- ](used|worn|issued)|match[- ](used|worn)|player[- ]worn|team[- ]issued|tour[- ](used|worn)|worn (jersey|uniform|cleats|boots|gloves|jacket|cap|shirt)|game (bat|ball|jersey|uniform|glove|worn)|match[- ]worn (shirt|jersey|boots))\b/.test(t)) return 'game-used';
  if (/\b(trophy|championship (ring|trophy|belt|pennant)|title belt|winners? medal|olympic (medal|torch)|world series (ring|trophy)|super bowl ring|mvp award|heisman|vince lombardi|stanley cup|green jacket|lombardi trophy)\b/.test(t)) return 'trophies-awards';
  if (/\b(full ticket|ticket stub|game[- ]used ticket|world series ticket|super bowl ticket|world cup (ticket|final ticket)|olympic ticket|season pass|press pass|all[- ]access (pass|credential))\b/.test(t)) return 'tickets-passes';
  return null; // nothing we track — never guess
}

async function sothebysAuctionMeta(slug: string): Promise<{ uuid: string; endDate: string | null; state: string; title: string } | null> {
  try {
    const res = await fetch(`https://www.sothebys.com/en/buy/auction/${slug}`, { headers: { 'User-Agent': UA, ...sothebysAuth() }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) { console.warn(`[Sotheby's] meta ${slug}: HTTP ${res.status}`); return null; }
    const html = await res.text();
    const uuid = (html.match(/"auctionId":"([0-9a-f-]{36})"/) || [])[1];
    if (!uuid) return null;
    const state = (html.match(/"state":"(Closed|Opened|Published)"/) || [])[1] || 'Unknown';
    const title = (html.match(/"title":"([^"]{2,80})"/) || [])[1] || slug;
    const ends = (html.match(/"endDate":"20[0-9-]+T[^"]+"/g) || []).map(s => s.slice(11, -1));
    const latest = ends.map(d => new Date(d)).filter(d => !isNaN(d.getTime())).sort((x, y) => y.getTime() - x.getTime())[0];
    return { uuid, endDate: latest ? latest.toISOString() : null, state, title };
  } catch { return null; }
}

async function sothebysAuctionLots(uuid: string): Promise<{ currency: Currency; lots: any[] }> {
  const out: any[] = [];
  let offset = 0;
  let currency: Currency = 'USD';
  for (let guard = 0; guard < 40; guard++) {
    try {
      const res = await fetch(SOTHEBYS_GQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apollographql-client-name': 'sothebys-web', 'User-Agent': UA, ...sothebysAuth() },
        body: JSON.stringify({ query: SOTHEBYS_LOT_QUERY, variables: { id: uuid, limit: 100, offset } }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await res.json() as any;
      const auc = j?.data?.auction;
      const lc = auc?.lotCards;
      if (auc?.currency && ['USD', 'GBP', 'EUR', 'HKD', 'CNY', 'AUD', 'CHF'].includes(auc.currency)) currency = auc.currency;
      if (!lc || !lc.lots) break;
      out.push(...lc.lots);
      if (!lc.hasNextPage) break;
      offset += 100;
      await sleep(350);
    } catch { break; }
  }
  return { currency, lots: out };
}

// Sotheby's timed auctions close lots individually; the sale-level schedule the
// auction page embeds LAGS (a stale max endDate), so a live lot reads as past.
// The real per-lot close only lives on the lot page (`scheduledOpeningDate`, the
// value behind the on-page countdown). Enrich UPCOMING Sotheby's lots with it so
// close times are accurate. Best-effort + capped + concurrency-limited: a lot we
// can't reach keeps its sale-level date and stays visible — accuracy NEVER costs
// a tracked lot (Collin's rule).
async function enrichSothebysCloseTimes(lots: AuctionLot[]): Promise<void> {
  const targets = lots.filter(l => l.auctionHouse === "Sotheby's" && l.status === 'upcoming' && l.url);
  if (!targets.length) return;
  const CONC = 6, CAP = 1000;
  const slice = targets.slice(0, CAP);
  let enriched = 0;
  for (let i = 0; i < slice.length; i += CONC) {
    await Promise.all(slice.slice(i, i + CONC).map(async lot => {
      try {
        const r = await fetch(lot.url, { headers: { 'User-Agent': UA, ...sothebysAuth() }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) return;
        const h = await r.text();
        const raw = (h.match(/"scheduledOpeningDate":"([^"]+)"/) || [])[1]
                 || (h.match(/"cutoffTime":"([^"]+)"/) || [])[1];
        if (!raw) return;
        const d = new Date(raw);
        if (isNaN(d.getTime())) return;
        const iso = d.toISOString();
        lot.saleDate = iso.slice(0, 10);
        (lot as AuctionLot & { saleDateTime?: string }).saleDateTime = iso;
        // genuinely future now → it stands on its own date; drop the keep-visible flag
        if (d.getTime() > Date.now()) (lot as AuctionLot & { resultsPending?: boolean }).resultsPending = false;
        enriched++;
      } catch { /* unreachable → keep sale-level date + resultsPending; never drop */ }
    }));
    await sleep(120);
  }
  console.log(`  [Sotheby's] enriched ${enriched}/${slice.length} live lots with accurate per-lot close times`);
}

async function crawlSothebysAuctions(scope: 'watches' | 'science' | 'sports' | 'art' | 'all'): Promise<AuctionLot[]> {
  const lots: AuctionLot[] = [];

  // discover current sales live so CI picks up new Geek Week / watch / art sales
  const discovered = { watches: new Set<string>(), science: new Set<string>(), sports: new Set<string>(), art: new Set<string>() };
  const grab = async (url: string, into: Set<string>) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      const h = await r.text();
      (h.match(/\/en\/buy\/auction\/20[0-9]{2}\/[a-z0-9-]+/g) || []).forEach(s => into.add(s.replace('/en/buy/auction/', '')));
    } catch { /* ignore */ }
  };
  if (scope === 'watches' || scope === 'all') await grab('https://www.sothebys.com/en/departments/watches', discovered.watches);
  if (scope === 'science' || scope === 'all') await grab('https://www.sothebys.com/en/buy/series/geek-week?locale=en', discovered.science);
  if (scope === 'sports' || scope === 'all') await grab('https://www.sothebys.com/en/departments/popular-culture', discovered.sports);
  if (scope === 'art' || scope === 'all') {
    // contemporary + modern departments list the current art sales; take them
    // all (names are too varied to keyword-filter) and let routeItem keep only
    // tracked-maker lots.
    await grab('https://www.sothebys.com/en/departments/contemporary-art', discovered.art);
    await grab('https://www.sothebys.com/en/departments/impressionist-modern-art', discovered.art);
  }

  const watchSales = Array.from(new Set([...SOTHEBYS_WATCH_SALES, ...Array.from(discovered.watches)]))
    .filter(s => /watch/i.test(s));
  const scienceSales = Array.from(new Set([...SOTHEBYS_SCIENCE_SALES, ...Array.from(discovered.science)]))
    .filter(s => /natural-history|space-exploration|science|meteor|fossil/i.test(s));
  const sportsSales = Array.from(new Set([...SOTHEBYS_SPORTS_SALES, ...Array.from(discovered.sports)]))
    .filter(s => /sport|memorabilia|olympic|the-one/i.test(s));
  // Art sales are NOT name-filtered (diverse names); cap the count so a busy
  // season cannot explode the run — routeItem drops untracked-maker lots.
  const artSales = Array.from(new Set([...SOTHEBYS_ART_SALES, ...Array.from(discovered.art)])).slice(0, 60);

  const jobs: { sale: string; kind: 'watches' | 'science' | 'sports' | 'art' }[] = [];
  if (scope === 'watches' || scope === 'all') watchSales.forEach(sale => jobs.push({ sale, kind: 'watches' }));
  if (scope === 'science' || scope === 'all') scienceSales.forEach(sale => jobs.push({ sale, kind: 'science' }));
  if (scope === 'sports' || scope === 'all') sportsSales.forEach(sale => jobs.push({ sale, kind: 'sports' }));
  if (scope === 'art' || scope === 'all') artSales.forEach(sale => jobs.push({ sale, kind: 'art' }));

  console.log(`  [Sotheby's] ${jobs.length} sales to crawl (${watchSales.length} watch, ${scienceSales.length} science, ${sportsSales.length} sports, ${artSales.length} art)`);

  for (const { sale, kind } of jobs) {
    const meta = await sothebysAuctionMeta(sale);
    if (!meta) { console.log(`  [Sotheby's] ${sale}: no metadata, skip`); continue; }
    const { currency: auctionCur, lots: rawLots } = await sothebysAuctionLots(meta.uuid);
    const saleName = sale.split('/').pop()!.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    let kept = 0;
    for (const lot of rawLots) {
      if (!lot.title) continue;
      // item-level: the lot's own text decides where it belongs, never the sale
      const artist = routeItem(lot.creatorsDisplayTitle, lot.title, lot.subtitle || '');
      if (!artist) continue; // nothing we track — skip, never guess

      const soldRes = lot.bidState?.sold;
      const finalPrice = soldRes?.premiums?.finalPrice;
      const isSold = !!soldRes?.isSold && !!finalPrice;
      let status: string, saleDate: string, resultsPending = false;
      if (isSold) {
        status = 'sold';
        saleDate = meta.endDate || new Date().toISOString();
      } else if (meta.state === 'Opened' || meta.state === 'Published') {
        // TRUST THE STATE over the schedule date. A timed auction closes lot by
        // lot and the embedded endDate lags — for a live ('Opened') or announced
        // ('Published') sale it can read as past, which wrongly buried these lots.
        // The house says the sale is live/upcoming, so the lot IS upcoming. Use
        // the real endDate when it's genuinely future; otherwise anchor to now
        // (the sale is live and closing imminently) so it lands correctly upcoming
        // without depending on a stale date or clock skew.
        status = 'upcoming';
        const em = meta.endDate ? new Date(meta.endDate).getTime() : NaN;
        saleDate = (!isNaN(em) && em > Date.now()) ? meta.endDate! : new Date().toISOString();
      } else if (meta.endDate && new Date(meta.endDate).getTime() > Date.now()) {
        status = 'upcoming';
        saleDate = meta.endDate;
      } else if (meta.endDate && Date.now() - new Date(meta.endDate).getTime() <= RESULT_PENDING_MS) {
        // Closed, but the house has not posted a hammer yet — keep the lot
        // VISIBLE as pending (upcoming) rather than dropping it, so a just-closed
        // sale does not vanish while we wait for results.
        status = 'upcoming';
        saleDate = meta.endDate;
        resultsPending = true;
      } else {
        continue; // closed past the results window & unsold — a true bought-in
      }
      const saleDay = saleDate.split('T')[0];

      const est = lot.estimateV2;
      const rendition = lot.media?.images?.[0]?.renditions;
      const img = rendition?.find((r: any) => r.imageSize === 'Large') || rendition?.find((r: any) => r.imageSize === 'Medium') || rendition?.[0];

      // W2: keep NATIVE, convert with a dated rate. finalPrice carries its own
      // currency (may differ from the sale's, e.g. an HKD lot in a mixed sale);
      // estimates are in the sale currency. The finalPrice is buyer-inclusive
      // (a Sotheby's realized/premium number), so it maps to premiumNative.
      const finalCur = (finalPrice?.currency || auctionCur) as Currency;
      const premiumNative = isSold && finalPrice ? parseFloat(finalPrice.amount) : null;

      lots.push({
        id: `sothebys-${lot.lotId}`,
        artist,
        title: lot.title,
        year: null,
        medium: lot.subtitle || null,
        dimensions: null,
        description: lot.subtitle || null,
        category: 'unknown',
        imageUrl: img?.url || null,
        auctionHouse: "Sotheby's",
        saleName,
        saleDate: saleDay,
        saleDateTime: saleDate, // GraphQL gives a genuine ISO timestamp
        lotNumber: lot.lotNumber?.lotDisplayNumber ? parseInt(lot.lotNumber.lotDisplayNumber, 10) || null : null,
        ...stampMoney({
          isSold,
          nativeCurrency: finalCur,
          saleDate: saleDay,
          hammerNative: null,
          premiumNative,
          estLowNative: est?.lowEstimate?.amount ? parseFloat(est.lowEstimate.amount) : null,
          estHighNative: est?.highEstimate?.amount ? parseFloat(est.highEstimate.amount) : null,
          priceBasis: 'realized',
        }),
        status: status as any,
        resultsPending,
        url: `https://www.sothebys.com/en/buy/auction/${sale}/${lot.slug?.lotSlug || lot.lotId}`,
      } as AuctionLot);
      kept++;
    }
    console.log(`  [Sotheby's] ${sale} (${meta.state}): ${rawLots.length} lots → ${kept} kept`);
    await sleep(500);
  }
  console.log(`  [Sotheby's] Total ${lots.length} lots (${lots.filter(l => l.status === 'sold').length} sold, ${lots.filter(l => l.status === 'upcoming').length} upcoming)`);
  return lots;
}

// ── Christie's Auction Crawler ──
// Same bar as the Sotheby's crawler: full watch & science auction lots (not
// the 50-lot maker/search page). Christie's auction pages embed all lot data
// in `window.chrComponents.lots` — titles, estimates, prices realised, images.
// Pages ≥2 return the whole sale; we dedupe by object_id to be safe.
const CHRISTIES_WATCH_SEEDS = [
  'important-watches-30715', 'important-watches-24504',
  'rare-watches-including-watches-for-ela-24403', 'watches-online-the-new-york-edit-24505',
];
const CHRISTIES_SCIENCE_SEEDS = ['jurassic-icons-allosaurus-stegosaurus-30576'];
const CHRISTIES_SPORTS_SEEDS = ['the-golden-age-of-baseball-selections-of-works-from-the-national-pastime-museum-26565'];
// Art discovered live from the contemporary / modern / prints departments;
// names too varied to keyword-filter, so routeItem keeps only tracked makers.
const CHRISTIES_ART_SEEDS = ['avant-garde-s-including-thinking-italian-24607', 'art-contemporain-vente-du-jour-24609', 'art-moderne-24608'];

function parseChristiesCurrency(txt: string): Currency {
  if (/HK\$|HKD/.test(txt)) return 'HKD';
  if (/£|GBP/.test(txt)) return 'GBP';
  if (/€|EUR/.test(txt)) return 'EUR';
  if (/CHF/.test(txt)) return 'CHF';
  if (/CN¥|RMB|CNY/.test(txt)) return 'CNY';
  if (/AU\$|AUD/.test(txt)) return 'AUD';
  return 'USD';
}

async function christiesAuctionLots(slug: string): Promise<any[]> {
  const byId = new Map<string, any>();
  let total = Infinity;
  // Cap high enough to cover flagship sales (hundreds of lots) — a hard 12 could
  // silently truncate a large sale. The `byId.size < total` guard stops early on
  // normal sales; this is just the runaway ceiling.
  const MAX_PAGES = 60;
  for (let page = 1; page <= MAX_PAGES && byId.size < total; page++) {
    try {
      const res = await fetch(`https://www.christies.com/en/auction/${slug}?sortby=lotnumber&page=${page}`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) break;
      const html = await res.text();
      const m = html.match(/window\.chrComponents\.lots\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/);
      if (!m) break;
      const d = JSON.parse(m[1]);
      const lots = d?.data?.lots;
      if (!Array.isArray(lots)) break; // malformed/empty page — don't throw
      total = d.data.total_hits_filtered || lots.length;
      const before = byId.size;
      for (const lot of lots) byId.set(lot.object_id, lot);
      if (byId.size === before) break; // no new lots
      await sleep(400);
    } catch { break; }
  }
  if (byId.size < total && total !== Infinity) console.warn(`[Christie's] ${slug}: paginated ${byId.size}/${total} lots — sale may be truncated (raise MAX_PAGES?)`);
  return Array.from(byId.values());
}

async function crawlChristiesAuctions(scope: 'watches' | 'science' | 'sports' | 'art' | 'all'): Promise<AuctionLot[]> {
  const lots: AuctionLot[] = [];
  const discovered = { watches: new Set<string>(), science: new Set<string>(), sports: new Set<string>(), art: new Set<string>() };
  const grab = async (url: string, into: Set<string>) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      const h = await r.text();
      (h.match(/\/en\/auction\/[a-z0-9-]+-[0-9]{4,6}/g) || []).forEach(s => into.add(s.replace('/en/auction/', '')));
    } catch { /* ignore */ }
  };
  if (scope === 'watches' || scope === 'all') await grab('https://www.christies.com/en/departments/watches-and-wristwatches', discovered.watches);
  if (scope === 'science' || scope === 'all') await grab('https://www.christies.com/en/departments/science-and-natural-history', discovered.science);
  if (scope === 'sports' || scope === 'all') await grab('https://www.christies.com/en/departments/sports-memorabilia', discovered.sports);
  if (scope === 'art' || scope === 'all') {
    await grab('https://www.christies.com/en/departments/post-war-and-contemporary-art', discovered.art);
    await grab('https://www.christies.com/en/departments/impressionist-and-modern-art', discovered.art);
    await grab('https://www.christies.com/en/departments/prints-and-multiples', discovered.art);
  }

  const watchSales = Array.from(new Set([...CHRISTIES_WATCH_SEEDS, ...Array.from(discovered.watches)]));
  const scienceSales = Array.from(new Set([...CHRISTIES_SCIENCE_SEEDS, ...Array.from(discovered.science)]));
  const sportsSales = Array.from(new Set([...CHRISTIES_SPORTS_SEEDS, ...Array.from(discovered.sports)]));
  const artSales = Array.from(new Set([...CHRISTIES_ART_SEEDS, ...Array.from(discovered.art)])).slice(0, 60);

  const jobs: { sale: string; kind: 'watches' | 'science' | 'sports' | 'art' }[] = [];
  if (scope === 'watches' || scope === 'all') watchSales.forEach(sale => jobs.push({ sale, kind: 'watches' }));
  if (scope === 'science' || scope === 'all') scienceSales.forEach(sale => jobs.push({ sale, kind: 'science' }));
  if (scope === 'sports' || scope === 'all') sportsSales.forEach(sale => jobs.push({ sale, kind: 'sports' }));
  if (scope === 'art' || scope === 'all') artSales.forEach(sale => jobs.push({ sale, kind: 'art' }));
  console.log(`  [Christie's Auctions] ${jobs.length} sales (${watchSales.length} watch, ${scienceSales.length} science, ${sportsSales.length} sports, ${artSales.length} art)`);

  for (const { sale, kind } of jobs) {
    const rawLots = await christiesAuctionLots(sale);
    const saleName = sale.replace(/-\d{4,6}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    let kept = 0;
    for (const lot of rawLots) {
      const primary = lot.title_primary_txt || '';
      const secondary = lot.title_secondary_txt || '';
      const title = secondary ? `${primary} ${secondary}`.trim() : primary;
      if (!title) continue;
      if (lot.lot_withdrawn) continue;
      // item-level: the lot's own text decides where it belongs, never the sale
      const artist = routeItem(primary, secondary, lot.description_txt || '');
      if (!artist) continue; // nothing we track — skip, never guess

      const realisedNum = parseFloat(lot.price_realised || '');
      const isSold = !!realisedNum && realisedNum > 0;
      const cur = parseChristiesCurrency(`${lot.price_realised_txt || ''} ${lot.estimate_txt || ''}`);
      const endDate = lot.end_date || lot.start_date;
      const endMs = endDate ? new Date(endDate).getTime() : NaN;
      let status: string, saleDate: string, resultsPending = false;
      if (isSold) {
        status = 'sold';
        saleDate = endDate || new Date().toISOString();
      } else {
        // DO NOT trust www.christies.com's is_auction_over / schedule date to
        // CLOSE a lot — it is STALE for online ("First Open"/onlineonly) sales,
        // reporting a sale as over (2013 dates!) when it is actually live and
        // days from closing. That buried live lots (Collin's Tom Sachs). So a
        // resultless lot is ALWAYS kept VISIBLE: a genuinely-future endDate
        // stands as-is; anything else is held pending (upcoming) so a live lot
        // is never lost to a bad date. (Accurate close times come from the
        // onlineonly enrichment pass.)
        status = 'upcoming';
        if (!isNaN(endMs) && endMs > Date.now()) {
          saleDate = endDate; // a genuine future date can be trusted
        } else {
          // stale/unreliable www date (can be years old for online sales) —
          // anchor to now so we never render a garbage date; keep it VISIBLE.
          // The true close comes from the onlineonly enrichment.
          saleDate = new Date().toISOString();
          resultsPending = true;
        }
      }
      const saleDay = saleDate.split('T')[0];
      const christiesAucDescription = lot.description_txt && String(lot.description_txt).length < 4000
        ? String(lot.description_txt).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null
        : null;

      lots.push({
        id: `christies-auc-${lot.object_id}`,
        artist,
        title,
        year: null,
        medium: secondary || null,
        dimensions: null,
        description: christiesAucDescription,
        category: 'unknown',
        imageUrl: lot.image?.image_src || null,
        auctionHouse: "Christie's",
        saleName,
        saleDate: saleDay,
        saleDateTime: endDate || null,
        lotNumber: null,
        // W2: price realised is buyer-inclusive → premiumNative; keep native +
        // convert with a dated rate. Estimates are in the same sale currency.
        ...stampMoney({
          isSold,
          nativeCurrency: cur,
          saleDate: saleDay,
          hammerNative: null,
          premiumNative: isSold ? realisedNum : null,
          estLowNative: lot.estimate_low ? parseFloat(lot.estimate_low) : null,
          estHighNative: lot.estimate_high ? parseFloat(lot.estimate_high) : null,
          priceBasis: 'realized',
        }),
        status: status as any,
        resultsPending,
        url: lot.url || `https://www.christies.com/en/auction/${sale}`,
      } as AuctionLot);
      kept++;
    }
    console.log(`  [Christie's Auctions] ${sale}: ${rawLots.length} lots → ${kept} kept`);
    await sleep(500);
  }
  console.log(`  [Christie's Auctions] Total ${lots.length} lots (${lots.filter(l => l.status === 'sold').length} sold, ${lots.filter(l => l.status === 'upcoming').length} upcoming)`);
  return lots;
}


// ── Goldin Crawler ──
// goldin.co runs bid auctions (no published estimates). Their lots_v2 API is
// open and FACETED — Goldin curates item types themselves, so we query the
// object facets directly and never touch Single Cards, Cases/Boxes/Packs, or
// Video Games. DOCTRINE, item-level and belt-and-braces:
//   sports  = game-used / trophies & awards / tickets & passes — NEVER cards
//   science = Apple & computing history + fossils/meteorites — NEVER video games
// Live inventory only (no public sold archive): the crawl returns the CURRENT
// live set; the merge step promotes tracked lots to sold when their auction
// flips 'Completed' (Ray IS the archive) and evicts genuinely delisted stock.
const GOLDIN_API_V2 = 'https://d1wu47wucybvr3.cloudfront.net/api/lots_v2';
const GOLDIN_AUCTIONS_API = 'https://d2l9s2774i83t9.cloudfront.net/api/auctions';
const GOLDIN_IMG = (lotId: string, img: string) =>
  `https://d2tt46f3mh26nl.cloudfront.net/public/Lots/${lotId}/${img}@1x`;

const GOLDIN_CARD_MAKERS = /\b(topps|panini|bowman|upper deck|fleer|donruss|prizm|optic|mosaic|refractor|rookie card|\brc\b|pok[eé]mon|yu-?gi-?oh|magic the gathering|\bmtg\b|\btcg\b|booster|wax pack|hobby box|checklist|parallel|kakawow|skybox|pro set|leaf\b|trading card|patch card|sticker)\b/i;
const GOLDIN_GRADED = /\b(psa|bgs|sgc|cgc|slab|gem m(in)?t)\b/i;
const GOLDIN_EXCLUDE_GAMES = /\b(video game|nintendo|playstation|\bps[1-5]\b|xbox|sega|atari|game ?boy|n64|game ?cube|wii|famicom|wata|vga\b|sealed game|arcade)\b/i;
const GOLDIN_EXCLUDE_MISC = /\b(sports illustrated|magazine|newsstand|comic|shonen|disney(land)?|universal studios|concert|music festival|movie (prop|pass|premiere)|screening pass|production[- ]used)\b/i;
// Leaked internal consignment notes that ride in on a lot title ("DO NOT LIST
// IN AUCTION - PER Shaneeza/Wagner …"). These are private staff annotations,
// never a public lot — filtered at both ingest paths so they can never reach
// lots.json OR sold-archive.json, where a surface could render them verbatim.
const GOLDIN_LEAK_NOTE = /\bdo not list\b|per shaneeza|per wagner|do not sell\b/i;

const GOLDIN_GAME_USED = /\b(game[- ](used|worn|issued)|match[- ](used|worn)|player[- ]worn|team[- ]issued|fight[- ]worn|tour[- ](used|worn)|warm[- ]?up[- ]worn|practice[- ]worn|game bat|game ball|photo[- ]?match(ed)?|mears\b)\b/i;
const GOLDIN_TROPHY = /\b(trophy|award|championship ring|title belt|winners? medal|olympic medal|plaque|mvp\b|heisman|hall of fame ring|championship pendant)\b/i;
const GOLDIN_TICKET = /\b(tickets?\b|stub|full ticket|season pass|press pass|credential|all[- ]access pass)\b/i;

// Returns a routing slug, 'blocked' (hard exclusion — the facet fallback must
// NEVER override it, or the slab gate is dead code on the fallback passes), or
// null (no signal — the facet fallback may apply).
//
// sportScoped: the lot came from a query filtered to Goldin's own `category:
// ['Sport']`, which already excludes Pokémon/TCG (those are Non-Sport). In that
// context a card is a SPORTS CARD we want (→ 'sports-cards'), not blocked; and a
// Sport lot with no object signal is, overwhelmingly, a card. Unscoped passes
// keep the original doctrine (cards blocked) since they can surface Non-Sport.
function goldinRoute(title: string, sportScoped = false): string | null {
  const t = title.toLowerCase();
  if (GOLDIN_EXCLUDE_GAMES.test(t)) return 'blocked';   // never video games
  if (GOLDIN_EXCLUDE_MISC.test(t)) return 'blocked';    // magazines, theme parks, props
  if (!sportScoped && GOLDIN_CARD_MAKERS.test(t)) return 'blocked'; // unscoped: never cards
  // sports objects win over the card default — a game-used jersey in a Sport
  // pass is game-used, not a card (checked before the sportScoped card fallback)
  const objectSignal = GOLDIN_GAME_USED.test(t) ? 'game-used'
    : GOLDIN_TROPHY.test(t) ? 'trophies-awards'
    : GOLDIN_TICKET.test(t) ? 'tickets-passes'
    : null;
  if (sportScoped) return objectSignal || 'sports-cards';
  if (objectSignal) return objectSignal;
  // space first — Apollo/NASA artifacts head the science vertical's space slug
  if (/\b(apollo|nasa|lunar|moon landing|astronaut|spacesuit|space suit|mercury (program|capsule)|gemini (program|capsule)|saturn v|cosmonaut|sputnik|space[- ]?flown)\b/.test(t)) return 'space-exploration';
  // then computing/tech: an Apple-1 or a sealed iPhone is science even in a sports house
  if (/\b(apple[- ]?(1|i{1,3}|ii)|iphone|ipod|macintosh|apple lisa|steve jobs|wozniak|apple computer|commodore|ibm\b|altair|enigma|bell labs|transistor|semiconductor|integrated circuit|microprocessor|vacuum tube|punch(ed)? card|eniac|univac|\bcray\b|pdp-\d|\bvax\b|\bnext(cube|step)?\b|xerox (alto|parc)|difference engine|babbage|\bturing\b|kenbak|imsai|trs-80)\b/.test(t)) return 'scientific-instruments';
  if (/\b(meteorite|pallasite|tektite)\b/.test(t)) return 'meteorites';
  if (/\b(fossil|dinosaur|trilobite|ammonite|megalodon|mammoth|amber with|t[- ]rex|raptor)\b/.test(t)) return 'fossils';
  if (GOLDIN_GRADED.test(t)) return 'blocked';          // graded, no object signal = a slab
  return null;
}

const GOLDIN_FACET_PASSES: { itemType: string; fallback: string | null }[] = [
  { itemType: 'Game-Used Memorabilia', fallback: 'game-used' },
  { itemType: 'Tickets and Passes', fallback: 'tickets-passes' },
  { itemType: 'Awards and Trophies', fallback: 'trophies-awards' },
  { itemType: 'Memorabilia', fallback: null }, // mixed — router only
];
const GOLDIN_SCIENCE_QUERIES = ['apple computer', 'macintosh', 'steve jobs', 'fossil', 'meteorite', 'dinosaur', 'amber'];
// RESULTS ARCHIVE — the buy page's `show_only:'Sold'` filter serves Goldin's
// full sold history with realized prices (verified: Ohtani 50th-HR ball
// current_price $3.6M × 1.22 premium = the $4.39M widely reported). These are
// permanent facts; we pull them into lots.json as sold records. Game-Used and
// Tickets are the clean, card-free sport buckets (~13k sold combined);
// 'Awards and Trophies' returns 0 sold and 'Memorabilia' is 34k card-heavy —
// both left to the live pass + router until they earn a dedicated gate.
const GOLDIN_SOLD_PASSES: { label: string; scope: Record<string, unknown>; fallback: string | null; sportScoped?: boolean }[] = [
  // sport OBJECTS — these buckets are small enough that Ending_Soonest's tail
  // window (from ≈ total-500) stays under the 10k Algolia cap. sportScoped so a
  // game-used relic card still routes game-used, not dropped.
  { label: 'Game-Used', scope: { item_type: ['Game-Used Memorabilia'], category: ['Sport'] }, fallback: 'game-used', sportScoped: true },
  { label: 'Tickets', scope: { item_type: ['Tickets and Passes'], category: ['Sport'] }, fallback: 'tickets-passes', sportScoped: true },
  // sold CARDS are NOT pulled here: at 348k the newest closes sit past the 10k
  // cap (Ending_Soonest tail unreachable). Instead the live Sport pass tracks
  // upcoming cards and the Completed-flip promotes them to sold — so the card
  // archive grows nightly — while the one-time backfill seeds the history.
  // science: NASA/space + Apple/computing (Collin's science sold sources)
  { label: 'NASA', scope: { sub_category: ['NASA'], category: ['Non-Sport'] }, fallback: 'space-exploration' },
  { label: 'iPhone', scope: { item_type: ['iPhone'], category: ['Non-Sport'] }, fallback: 'scientific-instruments' },
  { label: 'Apple', scope: { item_type: ['Apple'], category: ['Non-Sport'] }, fallback: 'scientific-instruments' },
];

async function goldinQuery(body: object): Promise<{ lots: any[]; total: number }> {
  const res = await fetch(GOLDIN_API_V2, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ search: { queryType: 'Featured', hasAnalyticsConsent: false, ...body } }),
    signal: AbortSignal.timeout(25000),
  });
  // a 5xx/403 HTML body must throw here, not half-parse — the callers treat a
  // failed page as an INCOMPLETE feed (goldinFeedComplete=false), never as
  // "these lots are gone".
  if (!res.ok) throw new Error(`Goldin lots_v2 HTTP ${res.status}`);
  const j = await res.json() as any;
  return { lots: j?.searchalgolia?.lots || [], total: j?.searchalgolia?.total || 0 };
}

// Goldin's live index purges each lot the instant its auction closes, but the
// buy page's show_only:'Sold' filter serves the full realized-price archive
// (see GOLDIN_SOLD_PASSES) — that is the primary sold source. This set carries
// the completed-auction ids to the merge as a SAME-CRAWL FALLBACK only, for the
// freshest closes not yet in the sold index.
let goldinCompletedAuctions = new Set<string>();
// True only when the auctions-status fetch succeeded this run. When false the
// merge must NOT touch tracked Goldin lots at all — with an empty Completed set
// every closed lot would look "delisted" and be evicted, permanently destroying
// the sold archive over one transient network error (Ray IS the archive).
let goldinStatusOk = false;
// True only when every facet/keyword pass enumerated fully. A failed page
// truncates freshGoldinIds — absence from a partial feed is UNKNOWN, not
// delisted, so eviction is skipped for the run when this is false.
let goldinFeedComplete = true;

async function crawlGoldin(): Promise<AuctionLot[]> {
  const byId = new Map<string, AuctionLot>();
  console.log('  [Goldin] Fetching live auction lots (facet-driven: objects, never cards)...');
  let dropped = 0;
  // Title-cleaner from the comps lib — strips a leaked-note prefix and the
  // "Month DD, YYYY - " / "YYYY-YY - " date prefixes Goldin titles carry, so
  // the stored title is the object, not the annotation. Imported here (not at
  // module scope) to match the dynamic-import pattern the classification pass
  // already uses for comps.
  const { cleanGoldinTitle } = await import('../app/lib/comps');

  // ingest LIVE inventory only (upcoming, with the running bid + its auction id).
  // There is no ended branch on the live feed — sold is decided at merge time,
  // strictly from the auction's own 'Completed' status, never a timestamp or bid.
  // A live bid is NEVER a sale: Goldin's clock crosses end_timestamp BEFORE
  // extended bidding resolves, and its lot-level `status` field lies (always
  // "Live"), so sold is never inferred here from a timestamp or a bid.
  const ingest = (lot: any, fallback: string | null, sportScoped = false, cultureScoped = false) => {
    if (!lot.title || !lot.lot_id) return;
    const t = lot.title.toLowerCase();
    if (GOLDIN_LEAK_NOTE.test(lot.title)) { dropped++; return; }
    // culture-scoped (Goldin's Pop-Culture/Entertainment/Rock-N-Roll/History
    // sub-categories): route via routeCulture (drops mass/graded, keeps the 1/1
    // artifacts). Otherwise sport-scoped or plain object routing.
    // sport-scoped (category:['Sport']) passes KEEP cards → sports-cards; only
    // unscoped passes hard-drop cards (they could be Non-Sport/Pokémon).
    if (!cultureScoped && (GOLDIN_EXCLUDE_GAMES.test(t) || GOLDIN_EXCLUDE_MISC.test(t) || (!sportScoped && GOLDIN_CARD_MAKERS.test(t)))) { dropped++; return; }
    const routed = cultureScoped ? routeCulture(lot.title) : goldinRoute(lot.title, sportScoped);
    // 'blocked' is a hard exclusion (slab with no object signal, etc.) — the
    // facet fallback must never resurrect it, or graded cards ride the
    // Tickets/Game-Used facets straight into the sports vertical.
    if (routed === 'blocked') { dropped++; return; }
    const artist = routed || fallback;
    if (!artist) { dropped++; return; }
    const end = lot.end_timestamp || lot.start_timestamp;
    if (!end) return;
    const bp = lot.buyer_premium || 22;
    const bid = lot.current_price || 0;

    if (byId.has(lot.lot_id)) return;
    if (lot.status && lot.status !== 'Live' && lot.status !== 'Preview') return;
    // A lot whose end has passed but that Goldin still SERVES is in extended
    // bidding / awaiting its auction's 'Completed' flip — keep tracking it as
    // upcoming (with its latest bid). Dropping it here would keep it out of
    // freshGoldinIds and the merge would evict it as delisted, losing the
    // hammer forever. The Completed flip decides its fate, nothing else.
    byId.set(lot.lot_id, {
      id: `goldin-${lot.lot_id}`,
      artist,
      title: cleanGoldinTitle(lot.title),
      year: null, medium: null, dimensions: null,
      category: 'object',
      imageUrl: lot.primary_image_name ? GOLDIN_IMG(lot.lot_id, lot.primary_image_name) : null,
      auctionHouse: 'Goldin',
      saleName: lot.auction_type ? `Goldin ${lot.auction_type} Auction` : 'Goldin Auction',
      // born-v2: saleDate is the canonical bare YYYY-MM-DD (invariant 7); the
      // full close timestamp is retained on saleDateTime.
      saleDate: (end || '').split('T')[0],
      saleDateTime: end || null,
      lotNumber: lot.lot_number || null,
      // v2 money: a live lot is NOT sold — all price fields null (a live bid is
      // never a sale). currentBid carries the running bid; buyerPremiumPct is
      // stamped so a later promotion can gross it to realized.
      ...stampMoney({
        isSold: false,
        nativeCurrency: 'USD',
        saleDate: (end || '').split('T')[0] || null,
        hammerNative: null,
        premiumNative: null,
        estLowNative: null,
        estHighNative: null,
        priceBasis: 'final-bid-plus-bp',
        buyerPremiumPct: bp,
      }),
      status: 'upcoming',
      url: lot.meta_slug ? `https://goldin.co/item/${lot.meta_slug}` : 'https://goldin.co',
      currentBid: bid,
      bidCount: lot.number_of_bids || 0,
      buyerPremium: bp,
      auctionId: lot.auction_id || undefined, // app type: string | undefined, never null
    } as unknown as AuctionLot);
  };

  // ingest a SOLD result (show_only:'Sold') — a permanent record at the
  // realized price (winning bid + buyer's premium). Same gates as live; a
  // zero-price row is unusable and skipped. Returns true when it logged one.
  const ingestSold = (lot: any, fallback: string | null, sportScoped = false): boolean => {
    if (!lot.title || !lot.lot_id) return false;
    if (byId.has(lot.lot_id)) return false; // live pass or an earlier sold row won
    const t = lot.title.toLowerCase();
    if (GOLDIN_LEAK_NOTE.test(lot.title)) { dropped++; return false; }
    if (GOLDIN_EXCLUDE_GAMES.test(t) || GOLDIN_EXCLUDE_MISC.test(t) || (!sportScoped && GOLDIN_CARD_MAKERS.test(t))) { dropped++; return false; }
    const routed = goldinRoute(lot.title, sportScoped);
    if (routed === 'blocked') { dropped++; return false; }
    const artist = routed || fallback;
    if (!artist) { dropped++; return false; }
    const bid = lot.current_price || 0;
    if (bid <= 0) return false;
    const bp = lot.buyer_premium || 22;
    const end = lot.end_timestamp || lot.start_timestamp;
    // Drop phantom future closes (a Goldin sold row dated 2050-01-01 slips
    // through the archive feed). A "sold" record whose saleDate is more than a
    // month out is bad data, not a realized sale — it would otherwise wear a
    // fabricated "current quarter" in the realized series.
    const endMs = new Date(end).getTime();
    if (!isNaN(endMs) && endMs > Date.now() + 30 * 24 * 60 * 60 * 1000) { dropped++; return false; }
    byId.set(lot.lot_id, {
      id: `goldin-${lot.lot_id}`,
      artist,
      title: cleanGoldinTitle(lot.title),
      year: null, medium: null, dimensions: null,
      category: 'object',
      imageUrl: lot.primary_image_name ? GOLDIN_IMG(lot.lot_id, lot.primary_image_name) : null,
      auctionHouse: 'Goldin',
      saleName: lot.auction_type ? `Goldin ${lot.auction_type} Auction` : 'Goldin Auction',
      // born-v2: canonical bare YYYY-MM-DD saleDate; full timestamp on saleDateTime.
      saleDate: (end || '').split('T')[0],
      saleDateTime: end || null,
      lotNumber: lot.lot_number || null,
      // v2 money: hammer = the winning bid; realized = hammer + buyer's premium.
      // Goldin is USD; basis 'final-bid-plus-bp'. estimates: none (bid auction).
      ...stampMoney({
        isSold: true,
        nativeCurrency: 'USD',
        saleDate: (end || '').split('T')[0] || null,
        hammerNative: bid,
        premiumNative: Math.round(bid * (1 + bp / 100)),
        estLowNative: null,
        estHighNative: null,
        priceBasis: 'final-bid-plus-bp',
        buyerPremiumPct: bp,
      }),
      status: 'sold',
      url: lot.meta_slug ? `https://goldin.co/item/${lot.meta_slug}` : 'https://goldin.co',
      currentBid: bid,
      bidCount: lot.number_of_bids || 0,
      buyerPremium: bp,
      auctionId: lot.auction_id || undefined,
    } as unknown as AuctionLot);
    return true;
  };

  // 1 · LIVE inventory — object facets + science keyword passes. A failed or
  // capped page marks the whole feed incomplete: the merge must never read
  // "absent from a partial fetch" as "delisted".
  for (const pass of GOLDIN_FACET_PASSES) {
    let from = 0, total = Infinity;
    const CAP = 3000; // headroom for flagship events; today's facets run ~30-160
    while (from < Math.min(total, CAP)) {
      try {
        const { lots, total: t } = await goldinQuery({ item_type: [pass.itemType], size: 100, from });
        total = t;
        if (!lots.length) break;
        lots.forEach((l: any) => ingest(l, pass.fallback));
        from += 100;
        await sleep(400);
      } catch (e) {
        console.log(`  [Goldin] facet '${pass.itemType}' truncated at ${from}:`, e);
        goldinFeedComplete = false;
        break;
      }
    }
    if (Number.isFinite(total) && total > CAP) goldinFeedComplete = false; // windowed, not enumerated
  }
  // 1a · LIVE SPORT CARDS — the whole live Sport book (category:['Sport'],
  // which is Goldin's own line: Non-Sport/Pokémon is a separate category we
  // never touch). sportScoped ingest routes cards → sports-cards, objects →
  // their slugs. ~3.5k live lots; capped generously. This is the on-the-block
  // + ⌘K-searchable card feed; the 348k SOLD history is the one-time backfill.
  {
    let from = 0, total = Infinity;
    const CAP = 8000;
    while (from < Math.min(total, CAP)) {
      try {
        const { lots, total: t } = await goldinQuery({ queryType: 'Featured', category: ['Sport'], size: 100, from });
        total = t;
        if (!lots.length) break;
        lots.forEach((l: any) => ingest(l, 'sports-cards', true));
        from += 100;
        await sleep(400);
      } catch (e) {
        console.log(`  [Goldin] live Sport pass truncated at ${from}:`, e);
        goldinFeedComplete = false;
        break;
      }
    }
    if (Number.isFinite(total) && total > CAP) goldinFeedComplete = false;
    console.log(`  [Goldin] live Sport pass: ${Math.min(total, CAP)} lots enumerated`);
  }
  // 1a-culture · LIVE POP CULTURE — Goldin's curated Non-Sport sub-categories
  // (Pop Culture/Entertainment, Rock N' Roll, History): the high-end 1/1
  // artifacts. cultureScoped ingest drops mass/graded (comics/cards/games/VHS/
  // vinyl/toys/posters) via routeCulture and routes the rest to culture slugs.
  {
    let from = 0, total = Infinity;
    const CAP = 8000;
    while (from < Math.min(total, CAP)) {
      try {
        const { lots, total: t } = await goldinQuery({ queryType: 'Featured', category: ['Non-Sport'], sub_category: ['Pop Culture/Entertainment', "Rock N' Roll", 'History'], size: 100, from });
        total = t;
        if (!lots.length) break;
        lots.forEach((l: any) => ingest(l, null, false, true));
        from += 100;
        await sleep(400);
      } catch (e) {
        console.log(`  [Goldin] live Culture pass truncated at ${from}:`, e);
        goldinFeedComplete = false;
        break;
      }
    }
    if (Number.isFinite(total) && total > CAP) goldinFeedComplete = false;
    console.log(`  [Goldin] live Culture pass: ${Math.min(total, CAP)} lots enumerated`);
  }
  // 1b · AUCTION-AWARE LIVE PASS — newly launched flagship auctions (e.g.
  // "2026 Summer Game Used Memorabilia Auction") can go Active with their
  // lots carrying NO item_type facet yet, so the facet passes above miss the
  // entire event (581 live lots invisible, verified Jul 2026). Enumerate
  // Active object auctions by NAME from the auctions API and ingest their
  // lots by auction_id through the SAME per-lot gates — the router still
  // decides every lot (cards/slabs still drop), so a mixed auction is safe.
  try {
    const aRes = await fetch(GOLDIN_AUCTIONS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ status: 'All', order: 'desc' }),
      signal: AbortSignal.timeout(25000),
    });
    if (aRes.ok) {
      const auctions = ((await aRes.json() as any).auctions || []) as any[];
      const objectAuctions = auctions.filter(a =>
        a.status === 'Active'
        && /\b(game.used|memorabilia|jersey|sneaker)\b/i.test(a.name || a.title || '')
        && !/\b(tcg|card|pok[eé]mon|comic|box break)\b/i.test(a.name || a.title || ''));
      for (const a of objectAuctions) {
        let from = 0, total = Infinity;
        while (from < Math.min(total, 3000)) {
          const { lots, total: t } = await goldinQuery({ auction_id: [a.auction_id], size: 100, from });
          total = t;
          if (!lots.length) break;
          lots.forEach((l: any) => ingest(l, 'game-used'));
          from += 100;
          await sleep(400);
        }
        console.log(`  [Goldin] auction pass '${(a.name || '').slice(0, 48)}': ${Math.min(total, 3000)} lots enumerated`);
      }
    }
  } catch (e) {
    console.log('  [Goldin] auction-aware live pass failed:', e);
    goldinFeedComplete = false;
  }

  for (const q of GOLDIN_SCIENCE_QUERIES) {
    try {
      const { lots } = await goldinQuery({ searchTerm: q, size: 100, from: 0 });
      lots.forEach((l: any) => ingest(l, null));
      await sleep(400);
    } catch (e) {
      console.log(`  [Goldin] science query '${q}' failed:`, e);
      goldinFeedComplete = false;
    }
  }

  // 2 · RESULTS ARCHIVE — show_only:'Sold' serves the full sold history with
  // realized prices. Sold rows are permanent, so we pull DEEP once (the whole
  // history) and a tail window daily. `Ending_Soonest` sorts oldest→newest, so
  // the freshest closes sit at the tail (from ≈ total); the daily window reads
  // just those. Skipping any lot already in byId keeps the live pass's own
  // records authoritative.
  let soldLogged = 0;
  for (const pass of GOLDIN_SOLD_PASSES) {
    try {
      const scope = { queryType: 'Ending_Soonest', show_only: 'Sold', ...pass.scope };
      const head = await goldinQuery({ ...scope, size: 1, from: 0 });
      const total = head.total;
      const windowN = DEEP ? total : 500; // daily: the last ~500 closes; DEEP: all of it
      const start = Math.max(0, total - windowN);
      for (let from = start; from < total; from += 100) {
        const { lots } = await goldinQuery({ ...scope, size: 100, from });
        if (!lots.length) break;
        for (const l of lots) if (ingestSold(l, pass.fallback, pass.sportScoped)) soldLogged++;
        await sleep(400);
      }
    } catch (e) {
      console.log(`  [Goldin] sold '${pass.label}' pass failed:`, e);
    }
  }
  console.log(`  [Goldin] results archive: ${soldLogged} sold lots logged (${DEEP ? 'DEEP full-history' : 'daily tail window'})`);

  // 3 · COMPLETION — a same-crawl fallback for the very freshest closes that
  // haven't hit the sold index yet: record which auctions Goldin marks
  // 'Completed' so the merge can promote a still-tracked lot's LAST bid to a
  // sold record. The results archive above is the primary, authoritative source
  // (true realized price); this only catches the tail between a lot's auction
  // closing and its appearance under show_only:'Sold'. Never a bid on an open lot.
  try {
    const aRes = await fetch(GOLDIN_AUCTIONS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ status: 'All', order: 'desc' }),
      signal: AbortSignal.timeout(25000),
    });
    if (!aRes.ok) throw new Error(`Goldin auctions HTTP ${aRes.status}`);
    const auctions = (await aRes.json() as any).auctions || [];
    goldinCompletedAuctions = new Set<string>(
      auctions.filter((a: any) => a.status === 'Completed').map((a: any) => a.auction_id)
    );
    goldinStatusOk = true; // only a verified fetch may drive promotion/eviction
    console.log(`  [Goldin] ${goldinCompletedAuctions.size} auctions marked Completed (promotion source)`);
  } catch (e) {
    // Leave goldinStatusOk false: the merge skips the whole promotion/eviction
    // pass and tracked lots simply wait for the next run — nothing is lost by
    // waiting, everything is lost by evicting on an empty Completed set.
    console.log('  [Goldin] auction-status fetch FAILED — promotion/eviction deferred to next run:', e);
  }

  const goldinSold = Array.from(byId.values()).filter(l => l.status === 'sold').length;
  console.log(`  [Goldin] ${byId.size} lots kept — ${byId.size - goldinSold} live, ${goldinSold} sold results (${dropped} gated out)`);
  return Array.from(byId.values());
}

const BONHAMS_SEARCH_URL = 'https://api01.bonhams.com/search-proxy/collections/lots/documents/search';

async function crawlBonhams(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.bonhams) return [];
  const lots: AuctionLot[] = [];
  const query = encodeURIComponent(artist.bonhams);
  console.log(`  [Bonhams] Fetching ${artist.displayName}...`);

  try {
    // Fetch up to 250 lots per artist (paginate if needed)
    let page = 1;
    let totalFetched = 0;
    let totalFound = 0;

    do {
      const url = `${BONHAMS_SEARCH_URL}?q=${query}&query_by=catalogDesc,title&per_page=250&page=${page}`;
      const res = await fetch(url, {
        headers: {
          'X-TYPESENSE-API-KEY': BONHAMS_TYPESENSE_KEY,
          'User-Agent': UA,
        },
      });

      if (!res.ok) {
        console.log(`  [Bonhams] HTTP ${res.status}`);
        break;
      }

      const data = await res.json() as any;
      totalFound = data.found || 0;
      const hits = data.hits || [];

      if (page === 1) {
        console.log(`  [Bonhams] Found ${totalFound} lots`);
      }

      for (const hit of hits) {
        const doc = hit.document;
        const lot = parseBonhamsLot(doc, artist.slug);
        if (lot) lots.push(lot);
      }

      totalFetched += hits.length;
      page++;

      if (totalFetched < totalFound && hits.length > 0) {
        await sleep(500);
      }
    } while (totalFetched < totalFound && page <= (DEEP ? 40 : 10));

    console.log(`  [Bonhams] Parsed ${lots.length} lots (${lots.filter(l => l.status === 'sold').length} sold)`);
  } catch (err) {
    console.error('  [Bonhams] Error:', err);
  }

  return lots;
}

function parseBonhamsLot(doc: any, artistSlug: string): AuctionLot | null {
  // W16 — resolve both ids BEFORE emitting: a missing auctionId interpolates
  // into the URL as "auction/undefined/" (legacy records: "auction//") and a
  // missing/zero lotId ends it "lot/0" — both 404 on bonhams.com. The same
  // ids also form the composite lot id, so an unresolved record can't be
  // deduped either. Never emit an unlinkable lot; a flag on a dead link is a
  // lie the publish-time guard below would have to catch anyway.
  const auctionId = doc.auctionId ?? doc.auction_id ?? doc.auction?.id ?? null;
  const lotId = doc.lotId ?? doc.lot_id ?? doc.id ?? null;
  if (!auctionId || !lotId) return null;

  const rawTitle = doc.title || '';
  // Extract a clean title from styledDescription if available
  let title = rawTitle;
  if (doc.styledDescription) {
    const lines: string[] = [];
    const lineMatches = doc.styledDescription.match(/<div class="[^"]*">(.*?)<\/div>/g) || [];
    for (const m of lineMatches) {
      const text = m.replace(/<[^>]*>/g, '').trim();
      if (text) lines.push(text);
    }
    // Filter out artist name and date lines, keep actual title/description
    const titleParts = lines.filter(l =>
      !l.match(/^\(?[bB](?:orn)?\.\s*\d{4}\)?$/) &&         // "(B. 1957)" or "(born 1957)"
      !l.match(/^\(\d{4}[-–]\d{4}\)$/) &&                    // "(1928-1987)"
      !l.match(/^\(?born \d{4}\)?$/i) &&                      // "(born 1974)"
      !l.match(/^\(?[A-Za-z]+,?\s+(?:born\s+)?\d{4}[-–]?\d{0,4}\)?$/) && // "(American, 1928-1987)"
      !l.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+$/) &&            // "George Condo"
      !l.match(/^[A-Z]{2,}$/)                                 // "KAWS"
    );
    if (titleParts.length > 0) {
      // Use the "otherLine" div if available (usually the artwork title), else first non-artist line
      const otherIdx = lineMatches.findIndex((m: string) => m.includes('otherLine'));
      if (otherIdx >= 0) {
        const otherText = lineMatches[otherIdx].replace(/<[^>]*>/g, '').trim();
        if (otherText) {
          title = otherText;
        } else {
          title = titleParts[0];
        }
      } else {
        title = titleParts[0];
      }
    }
  }
  // Strip HTML tags from title
  title = title.replace(/<[^>]*>/g, '').trim() || 'Untitled';

  // Extract medium, dimensions, and year from styledDescription lines
  // Bonhams structured descriptions often include this data after the title line
  let medium: string | null = null;
  let dimensions: string | null = null;
  let year: string | null = null;
  if (doc.styledDescription) {
    const descLines: string[] = [];
    const descMatches = doc.styledDescription.match(/<div class="[^"]*">(.*?)<\/div>/g) || [];
    for (const m of descMatches) {
      const text = m.replace(/<[^>]*>/g, '').trim();
      if (text) descLines.push(text);
    }
    // Look for medium, dimensions, and year
    for (const line of descLines) {
      if (line === title) continue; // skip the title itself
      if (/^\(?[bB](?:orn)?\.\s*\d{4}\)?$/.test(line)) continue;
      if (/^\(\d{4}[-–]\d{4}\)$/.test(line)) continue;
      if (/^\(?born \d{4}\)?$/i.test(line)) continue;
      if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(line)) continue; // artist name
      if (/^[A-Z]{2,}$/.test(line)) continue; // "KAWS"
      if (/^\(?[A-Za-z]+,?\s+(?:born\s+)?\d{4}[-–]?\d{0,4}\)?$/.test(line)) continue; // "(American, 1928-1987)"

      // Year line (standalone 4-digit year, possibly with circa)
      if (!year && /^(?:circa|c\.?)?\s*\d{4}$/i.test(line)) {
        const yearMatch = line.match(/(\d{4})/);
        if (yearMatch) year = yearMatch[1];
        continue;
      }

      // Dimension line (has cm or in measurements) — Bonhams order is
      // title → medium → dimensions, so guard on !dimensions (a !medium guard
      // would skip the dims line once medium is captured)
      if (/\d+\s*(?:×|x)\s*\d+|\b(?:cm|in)\b/.test(line) && !dimensions) {
        dimensions = line;
        continue;
      }
      // Medium line — contains material/technique keywords, but skip very long lines (full catalog entries)
      if (!medium && line.length < 150 && /(?:oil|acrylic|gouache|watercolor|ink|charcoal|pencil|pastel|spray|enamel|screenprint|silkscreen|lithograph|etching|woodcut|print|photograph|gelatin|silver|bronze|ceramic|porcelain|mixed media|collage|canvas|linen|paper|board|panel|synthetic polymer|offset|poster|gicl[eé]e|marker|crayon|felt[- ]?tip)/i.test(line)) {
        medium = line;
      }
    }
  }

  const currency = isoCurrencyToInternal(doc.currency?.iso_code || '');
  const hammerPrice = doc.price?.hammerPrice || null;
  const hammerPremium = doc.price?.hammerPremium || null;
  const estimateLow = doc.price?.estimateLow || null;
  const estimateHigh = doc.price?.estimateHigh || null;

  let saleDate = '';
  const endDate = doc.hammerTime?.datetime || doc.auctionEndDate?.datetime || doc.biddableFrom?.datetime;
  if (endDate) {
    saleDate = endDate.split('T')[0];
  }

  const isSold = doc.status === 'SOLD';
  const isBoughtIn = doc.status === 'BI';
  const auctionEnded = doc.flags?.isAuctionEnded ?? (saleDate ? isSaleDayPast(saleDate) : true); // default to ended if no date

  let status: LotStatus = 'upcoming';
  if (isSold) status = 'sold';
  else if (isBoughtIn) status = 'bought_in';
  else if (auctionEnded) status = 'bought_in';

  const imageUrl = doc.image?.url || null;
  const lotUrl = `https://www.bonhams.com/auction/${auctionId}/lot/${lotId}`;

  // Retain the raw description (styledDescription stripped to text, else the
  // catalog desc) — non-destructive re-parse source for the identity layer.
  const bonhamsDescription = (() => {
    const src = doc.styledDescription || doc.catalogDesc || doc.description || '';
    if (!src) return null;
    const txt = String(src).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return txt ? txt.slice(0, 4000) : null;
  })();

  // Bonhams exposes both hammer + premium-inclusive: realized when a premium
  // number exists, else the hammer is the realized (hammer-only basis).
  const bonhamsBasis: PriceBasis = hammerPremium != null ? 'realized' : 'hammer-only';

  return {
    id: `bonhams-${auctionId}-${lotId}`,
    artist: artistSlug,
    title,
    year,
    medium,
    dimensions,
    description: bonhamsDescription,
    category: 'unknown' as LotCategory,
    imageUrl,
    auctionHouse: 'Bonhams',
    saleName: doc.heading || '',
    saleDate,
    lotNumber: doc.lotNo?.number || null,
    ...stampMoney({
      isSold,
      nativeCurrency: currency,
      saleDate: saleDate || null,
      hammerNative: hammerPrice,
      premiumNative: hammerPremium,
      estLowNative: estimateLow,
      estHighNative: estimateHigh,
      priceBasis: bonhamsBasis,
    }),
    status,
    url: lotUrl,
  };
}

// ── Helpers ──

function detectCurrency(text: string): Currency {
  if (!text) return 'USD';
  if (text.includes('GBP') || text.includes('£')) return 'GBP';
  if (text.includes('EUR') || text.includes('€')) return 'EUR';
  if (text.includes('HKD') || text.includes('HK$')) return 'HKD';
  if (text.includes('CNY') || text.includes('¥')) return 'CNY';
  if (text.includes('AUD') || text.includes('AU$')) return 'AUD';
  if (text.includes('CHF')) return 'CHF';
  return 'USD';
}

function isoCurrencyToInternal(iso: string): Currency {
  const map: Record<string, Currency> = {
    USD: 'USD', GBP: 'GBP', EUR: 'EUR', HKD: 'HKD', CNY: 'CNY', AUD: 'AUD', CHF: 'CHF',
  };
  return map[iso] || 'USD';
}

// The flat single-rate toUsd()/USD_RATES table was removed in the v2 money
// rewrite: every conversion now flows through toUsdDated()/stampMoney(), which
// use the DATED per-sale-year FX_BY_YEAR table in normalize.ts (a 2015 GBP sale
// converts at 2015's rate, not one frozen 16-year snapshot). Native is the
// fact; USD is a derived, dated view.

// ── v2 money stamping ──────────────────────────────────────────────────────
// The load-bearing rewrite: native is the FACT, USD is a DERIVED view via a
// DATED per-lot rate (toUsdDated from normalize.ts), and priceBasis says what
// the number is. Called at every soldPrice choice so a fresh row carries the
// full money block. Never blanket-forces 'USD' — the native currency is passed
// through as the fact; estimates are stored native + derived to USD.
//
// A sold lot MUST end with realizedUsd>0 + priceBasis; a non-sold lot has NULL
// price fields (the write-time invariant gate enforces this). We therefore null
// every price field when !isSold, regardless of what a house returned.
interface MoneyIn {
  isSold: boolean;
  nativeCurrency: Currency;
  saleDate: string | null;
  hammerNative: number | null;
  premiumNative: number | null;
  estLowNative: number | null;
  estHighNative: number | null;
  priceBasis: PriceBasis; // basis to stamp when sold
  buyerPremiumPct?: number | null;
}
type MoneyBlock = Pick<AuctionLot,
  'nativeCurrency' | 'hammerNative' | 'premiumNative' | 'realizedNative' |
  'buyerPremiumPct' | 'fxRate' | 'fxAsOf' | 'hammerUsd' | 'premiumUsd' |
  'realizedUsd' | 'estLowNative' | 'estHighNative' | 'estLowUsd' | 'estHighUsd' |
  'priceBasis' | 'currency' | 'estimateLow' | 'estimateHigh' |
  'hammerPrice' | 'premiumPrice' | 'priceUsd'>;

function stampMoney(m: MoneyIn): MoneyBlock {
  const { rate, asOf } = fxRateFor(m.nativeCurrency, m.saleDate);
  // conversion goes through toUsdDated (normalize.ts) so the fresh row's USD
  // rounding is byte-identical to the backfill's — ONE definition of "native →
  // dated USD", shared by crawler + migrate-v2.
  const conv = (n: number | null) => toUsdDated(n, m.nativeCurrency, m.saleDate).usd;

  // estimates are ALWAYS native + derived (present on sold and upcoming alike)
  const estLowNative = m.estLowNative;
  const estHighNative = m.estHighNative;
  const estLowUsd = conv(estLowNative);
  const estHighUsd = conv(estHighNative);

  if (!m.isSold) {
    // DOCTRINE: a non-sold lot has NULL price fields. Keep estimates + the fx
    // stamp (so a computed estUsd band is dated) but no realized/hammer/premium.
    return {
      nativeCurrency: m.nativeCurrency,
      hammerNative: null, premiumNative: null, realizedNative: null,
      buyerPremiumPct: m.buyerPremiumPct ?? null,
      fxRate: rate, fxAsOf: asOf,
      hammerUsd: null, premiumUsd: null, realizedUsd: null,
      estLowNative, estHighNative, estLowUsd, estHighUsd,
      // old aliases
      currency: m.nativeCurrency,
      estimateLow: estLowUsd, estimateHigh: estHighUsd,
      hammerPrice: null, premiumPrice: null, priceUsd: null,
      priceBasis: undefined,
    };
  }

  const hammerNative = m.hammerNative;
  const premiumNative = m.premiumNative;
  const realizedNative = premiumNative ?? hammerNative;
  const hammerUsd = conv(hammerNative);
  const premiumUsd = conv(premiumNative);
  const realizedUsd = conv(realizedNative);
  // derive BP% when both native numbers are present and it wasn't supplied
  let bp = m.buyerPremiumPct ?? null;
  if (bp == null && hammerNative != null && premiumNative != null && hammerNative > 0) {
    bp = Math.round((premiumNative / hammerNative - 1) * 1000) / 10;
  }

  return {
    nativeCurrency: m.nativeCurrency,
    hammerNative, premiumNative, realizedNative,
    buyerPremiumPct: bp,
    fxRate: rate, fxAsOf: asOf,
    hammerUsd, premiumUsd, realizedUsd,
    estLowNative, estHighNative, estLowUsd, estHighUsd,
    priceBasis: m.priceBasis,
    // old aliases (priceUsd = realizedUsd; estimate* = *Usd, NOT native)
    currency: m.nativeCurrency,
    estimateLow: estLowUsd, estimateHigh: estHighUsd,
    hammerPrice: hammerNative, premiumPrice: premiumNative, priceUsd: realizedUsd,
  };
}

// ── Stats Computation ──


// ── Detail Page Enrichment ──
// Fetches individual lot pages to backfill missing medium, dimensions, and year.
// Only enriches lots that are missing at least one of these fields.

type EnrichResult = { medium?: string; dimensions?: string; year?: string };

const MEDIUM_PATTERNS = /(?:oil|acrylic|gouache|watercolor|watercolour|ink|charcoal|pencil|pastel|spray|enamel|screenprint|silkscreen|lithograph|etching|woodcut|woodblock|linocut|engraving|aquatint|monotype|monoprint|offset|poster|gicl[eé]e|print|photograph|gelatin silver|c-print|chromogenic|pigment print|inkjet|cibachrome|bronze|ceramic|porcelain|earthenware|stoneware|terracotta|glazed|mixed media|collage|canvas|linen|paper|board|panel|synthetic polymer|marker|crayon|felt[- ]?tip|tempera|encaustic|aluminum|steel|wood|glass|leather|fabric|textile|neon|plaster|resin|fiberglass|marble)/i;

async function enrichPhillips(lot: AuctionLot): Promise<EnrichResult> {
  try {
    const res = await fetch(lot.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);
    const result: EnrichResult = {};

    // Phillips renders lot details in div[data-testid="html-parser"] spans.
    // Collect all text blocks from these elements.
    const blocks: string[] = [];
    $('div[data-testid="html-parser"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text) blocks.push(text);
    });

    for (const block of blocks) {
      // Dimensions: contains measurement patterns (e.g. "7 x 5 1/8 in.")
      if (!result.dimensions && /\d+\s*[x×]\s*\d+.*(?:in|cm)/i.test(block)) {
        result.dimensions = block;
        continue;
      }
      // Medium: contains material keywords
      if (!result.medium && MEDIUM_PATTERNS.test(block) && block.length < 200) {
        result.medium = block;
        continue;
      }
      // Year: "Painted in 1994." or "Executed in 2005"
      if (!result.year) {
        const yearMatch = block.match(/(?:painted|executed|created|conceived|dated|made)\s+(?:circa\s+)?(?:in\s+)?(\d{4})/i);
        if (yearMatch) {
          result.year = yearMatch[1];
          continue;
        }
      }
    }

    return result;
  } catch { return {}; }
}

async function enrichChristies(lot: AuctionLot): Promise<EnrichResult> {
  try {
    const res = await fetch(lot.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);
    const result: EnrichResult = {};

    // Strategy 1: Parse the accordion text (most reliable)
    // Christie's has lot details in <span class="chr-lot-section__accordion--text">
    let detailText = '';
    $('span.chr-lot-section__accordion--text').each((_, el) => {
      const t = $(el).text().trim();
      if (t && !detailText) detailText = t;
    });

    // Strategy 2: Try window.chrComponents.lotHeader_* JSON for dimensions
    if (!detailText) {
      $('script').each((_, script) => {
        const content = $(script).html() || '';
        const m = content.match(/window\.chrComponents\.lotHeader_\d+\s*=\s*(\{[\s\S]*?\});/);
        if (m) {
          try {
            const json = JSON.parse(m[1]);
            const lotData = json?.data?.lots?.[0];
            if (lotData?.lot_assets?.[0]?.measurements_txt) {
              result.dimensions = lotData.lot_assets[0].measurements_txt;
            }
          } catch {}
        }
      });
    }

    // Strategy 3: Fallback to data-scroll-section
    if (!detailText) {
      detailText = $('[data-scroll-section="Details"]').text().trim();
    }

    if (!detailText && !result.dimensions) return {};

    if (detailText) {
      // Extract medium
      const medMatch = detailText.match(new RegExp(`(${MEDIUM_PATTERNS.source}[^,\\.\\n]{0,80})`, 'i'));
      if (medMatch) result.medium = medMatch[0].trim();

      // Extract dimensions: "243.8 x 203.2 cm. (97 x 80 in.)" or "24 x 18 in."
      if (!result.dimensions) {
        const dimMatch = detailText.match(/(\d+(?:[.,]\d+)?(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\s+\d+\/\d+)?\s*[×x]\s*\d+(?:[.,]\d+)?(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\s+\d+\/\d+)?\s*(?:in|cm)\.?(?:\s*\([^)]+\))?)/i);
        if (dimMatch) result.dimensions = dimMatch[1].trim();
      }

      // Extract year
      const yearPatterns = [
        /(?:executed|painted|conceived|made|created|dated)\s+(?:circa|c\.?\s*)?\s*(?:in\s+)?(\d{4})/i,
        /(?:circa|c\.)\s*(\d{4})/i,
        /,\s*(\d{4})\s*(?:[,.]|$)/,
      ];
      for (const pat of yearPatterns) {
        const m = detailText.match(pat);
        if (m) { result.year = m[1]; break; }
      }
    }

    return result;
  } catch { return {}; }
}

async function enrichBonhams(lot: AuctionLot): Promise<EnrichResult> {
  try {
    const res = await fetch(lot.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);
    const result: EnrichResult = {};

    // Bonhams embeds lot data in JSON-LD (@type: Product) with a combined description string
    let description = '';

    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const json = JSON.parse($(script).html() || '{}');
        if (json.description) description = json.description;
      } catch {}
    });

    if (!description) return {};

    // Parse medium: look for material keywords
    const medMatch = description.match(new RegExp(`(${MEDIUM_PATTERNS.source}[^,;.]{0,60})`, 'i'));
    if (medMatch) result.medium = medMatch[0].trim();

    // Parse dimensions — multiple formats:
    const dimPatterns = [
      // Standard W x H: "24 x 18 in", "63 × 52 cm", "99.8 by 73 cm."
      /(\d+(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\s+\d+\/\d+)?(?:\.\d+)?\s*(?:[×x]|\bby\b)\s*\d+(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\s+\d+\/\d+)?(?:\.\d+)?\s*(?:in|cm)\.?(?:\s*\([^)]+\))?)/i,
      // "height 34in; width 32in" or "height of chair 32 1/2in (83cm); width 32in"
      /height\s+(?:of\s+\w+\s+)?(\d+(?:\s+\d+\/\d+)?(?:[.,]\d+)?)\s*in[^;]*;\s*width\s+(\d+(?:\s+\d+\/\d+)?(?:[.,]\d+)?)\s*in/i,
      // Single dimension: "ht. 9 3/8 in." or "height 24in"
      /(?:ht\.?|height)\s+(\d+(?:\s+\d+\/\d+)?(?:[.,]\d+)?)\s*in/i,
    ];

    for (let i = 0; i < dimPatterns.length; i++) {
      const m = description.match(dimPatterns[i]);
      if (m) {
        if (m[2]) {
          // height/width format — reconstruct as "H x W in"
          result.dimensions = `${m[1]} x ${m[2]} in`;
        } else if (i === 2) {
          // Single dimension (ht. only) — store as-is for reference
          result.dimensions = `${m[1]} in (height)`;
        } else {
          result.dimensions = m[1].trim();
        }
        break;
      }
    }

    // Parse year — multiple patterns
    const yearPatterns = [
      /(?:executed|painted|dated|conceived|created)\s+(?:circa\s+)?(?:in\s+)?(\d{4})/i,
      /(?:circa|c\.)\s*(\d{4})/i,
      // "designed 1956" or "produced 1984"
      /(?:designed|produced|made)\s+(?:circa\s+)?(\d{4})/i,
      // Standalone year after comma: ", 1963" (common in descriptions)
      /,\s*(\d{4})(?:\s|,|$)/,
    ];
    for (const pat of yearPatterns) {
      const m = description.match(pat);
      if (m) { result.year = m[1]; break; }
    }

    return result;
  } catch { return {}; }
}

async function enrichSothebys(lot: AuctionLot): Promise<EnrichResult> {
  try {
    const res = await fetch(lot.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);
    const result: EnrichResult = {};

    // Try JSON-LD description
    let description = '';
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const json = JSON.parse($(script).html() || '{}');
        if (json.description) description = json.description;
      } catch {}
    });

    // Fallback to og:description
    if (!description) {
      description = $('meta[property="og:description"]').attr('content') || '';
    }

    if (!description) return {};

    const medMatch = description.match(new RegExp(`(${MEDIUM_PATTERNS.source}[^,;.]{0,60})`, 'i'));
    if (medMatch) result.medium = medMatch[0].trim();

    // Sotheby's uses "X by Y in." format
    const dimMatch = description.match(/(\d+(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\.\d+)?\s*(?:by|[×x])\s*\d+(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\.\d+)?\s*(?:in|cm|mm)\.?)/i);
    if (dimMatch) result.dimensions = dimMatch[1].trim();

    const yearPatterns = [
      /(?:executed|painted|conceived|created)\s+(?:circa\s+)?(?:in\s+)?(\d{4})/i,
      /(?:circa|c\.)\s*(\d{4})/i,
    ];
    for (const pat of yearPatterns) {
      const m = description.match(pat);
      if (m) { result.year = m[1]; break; }
    }

    return result;
  } catch { return {}; }
}

const ENRICH_MAX_PER_RUN = DEEP ? 6000 : 500;
const ENRICH_DELAY = 250;
// Wall-clock budget: worst case (a stalled house timing out every 10s fetch)
// would run ~85 min while the CI workflow is killed at 45 — taking the day's
// crawl (and Goldin bid tracking) down with it. Stop enriching and let the
// run write/commit; the backlog picks up next run.
const ENRICH_TIME_BUDGET_MS = 20 * 60_000;
// Only houses with an enricher in the switch below — anything else (Goldin
// especially: all upcoming, always null medium/dims/year) would sort to the
// front of the batch and burn slots on guaranteed no-ops.
const ENRICHABLE_HOUSES = new Set<AuctionHouse>(['Phillips', "Christie's", 'Bonhams', "Sotheby's"]);

async function enrichLots(lots: AuctionLot[]): Promise<void> {
  // Find lots missing any of medium, dimensions, year (Wright/Rago already good)
  const needsEnrich = lots.filter(l =>
    ENRICHABLE_HOUSES.has(l.auctionHouse) &&
    (!l.medium || !l.dimensions || !l.year) &&
    l.url
  );

  if (needsEnrich.length === 0) {
    console.log('[Enrich] All lots already have complete data.');
    return;
  }

  // Prioritize: upcoming first, then most recent sold
  needsEnrich.sort((a, b) => {
    if (a.status === 'upcoming' && b.status !== 'upcoming') return -1;
    if (b.status === 'upcoming' && a.status !== 'upcoming') return 1;
    return new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime();
  });

  const batch = needsEnrich.slice(0, ENRICH_MAX_PER_RUN);

  // Pre-loop breakdown by house
  const houseBreakdown: Record<string, number> = {};
  for (const lot of batch) {
    houseBreakdown[lot.auctionHouse] = (houseBreakdown[lot.auctionHouse] || 0) + 1;
  }

  console.log(`\n[Enrich] ${needsEnrich.length} lots need enrichment, processing ${batch.length} this run...`);
  console.log('[Enrich] Per-house breakdown for this batch:');
  for (const [house, count] of Object.entries(houseBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  [${house}] ${count} lots`);
  }
  console.log('[Enrich] Starting enrichment loop...\n');

  let enriched = 0;
  const houseCounts: Record<string, { total: number; success: number }> = {};
  const enrichStart = Date.now();

  for (const lot of batch) {
    if (Date.now() - enrichStart > ENRICH_TIME_BUDGET_MS) {
      console.log('[Enrich] Time budget exhausted — stopping early so the crawl still writes/commits.');
      break;
    }
    const house = lot.auctionHouse;
    if (!houseCounts[house]) houseCounts[house] = { total: 0, success: 0 };
    houseCounts[house].total++;

    let result: EnrichResult = {};
    switch (house) {
      case 'Phillips': result = await enrichPhillips(lot); break;
      case "Christie's": result = await enrichChristies(lot); break;
      case 'Bonhams': result = await enrichBonhams(lot); break;
      case "Sotheby's": result = await enrichSothebys(lot); break;
      default: continue;
    }

    let updated = false;
    if (result.medium && !lot.medium) { lot.medium = result.medium; updated = true; }
    if (result.dimensions && !lot.dimensions) { lot.dimensions = result.dimensions; updated = true; }
    if (result.year && !lot.year) { lot.year = result.year; updated = true; }

    if (updated) {
      enriched++;
      houseCounts[house].success++;
    }

    await sleep(ENRICH_DELAY);
  }

  console.log(`[Enrich] Enriched ${enriched}/${batch.length} lots.`);
  for (const [house, counts] of Object.entries(houseCounts)) {
    console.log(`  [${house}] ${counts.success}/${counts.total} enriched`);
  }
}

// ── Crawl a single artist across all houses ──

async function crawlArtist(artist: ArtistConfig): Promise<AuctionLot[]> {
  const allLots: AuctionLot[] = [];

  console.log(`\n[Ray] === ${artist.displayName} ===`);

  console.log(`[Ray] Crawling Phillips...`);
  const phillipsLots = await crawlPhillips(artist);
  console.log(`[Ray] Phillips: ${phillipsLots.length} lots`);
  allLots.push(...phillipsLots);

  await sleep(DELAY_MS);

  console.log(`[Ray] Crawling Sothebys...`);
  const sothebysLots = await crawlSothebys(artist);
  console.log(`[Ray] Sothebys: ${sothebysLots.length} lots`);
  allLots.push(...sothebysLots);

  await sleep(DELAY_MS);

  console.log(`[Ray] Crawling Christie's...`);
  const christiesLots = await crawlChristies(artist);
  console.log(`[Ray] Christie's: ${christiesLots.length} lots`);
  allLots.push(...christiesLots);

  await sleep(DELAY_MS);

  console.log(`[Ray] Crawling Wright/Rago...`);
  const wrightLots = await crawlWright(artist);
  console.log(`[Ray] Wright/Rago: ${wrightLots.length} lots`);
  allLots.push(...wrightLots);

  await sleep(DELAY_MS);

  console.log(`[Ray] Crawling Bonhams...`);
  const bonhamsLots = await crawlBonhams(artist);
  console.log(`[Ray] Bonhams: ${bonhamsLots.length} lots`);
  allLots.push(...bonhamsLots);

  return allLots;
}

// ── Main ──

async function main() {
  console.log('[Ray] Starting auction crawl...');
  console.log(`[Ray] Data directory: ${DATA_DIR}`);
  console.log(`[Ray] Artists: ${ARTISTS.map(a => a.displayName).join(', ')}`);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Load existing data. MUST read the FULL corpus (data/corpus/{lots,sold-
  // archive}.json.gz) — NOT the slim public/data/ray/lots.json, which OMITS the
  // Goldin sold-archive (~11k permanent hammer records split out for payload
  // size). Reading the slim file silently drops the entire archive every crawl:
  // the merge would rebuild sold-archive.json from only this run's Goldin tail,
  // erasing accumulated history. readCorpus() concats both files back together.
  let existingLots: AuctionLot[] = [];
  const existingStatsByArtist: Record<string, MarketStats> = {};
  const statsPath = path.join(DATA_DIR, 'stats.json');

  try {
    const { readCorpus } = await import('./corpus-io');
    existingLots = readCorpus() as unknown as AuctionLot[];
    for (const lot of existingLots) {
      if (!lot.artist) lot.artist = 'george-condo';
      if (!lot.category) lot.category = 'unknown' as LotCategory;
    }
    console.log(`[Ray] Loaded ${existingLots.length} existing lots (full corpus incl. sold-archive).`);
  } catch (e) { console.log('[Ray] Could not read corpus:', (e as Error).message); }
  if (fs.existsSync(statsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
      // Handle both old format (single MarketStats) and new format (keyed by artist)
      if (raw.lastUpdated) {
        // Old format — assign to george-condo
        existingStatsByArtist['george-condo'] = raw;
      } else {
        Object.assign(existingStatsByArtist, raw);
      }
    } catch { /* ignore */ }
  }

  // Crawl all artists (RAY_ONLY=slug,slug scopes a run to specific entries —
  // used when onboarding a new vertical without recrawling the world)
  const only = process.env.RAY_ONLY ? new Set(process.env.RAY_ONLY.split(',')) : null;
  const roster = only ? ARTISTS.filter(a => only.has(a.slug)) : ARTISTS;
  if (only) console.log(`[Ray] RAY_ONLY: crawling ${roster.map(a => a.slug).join(', ')}`);
  const freshLots: AuctionLot[] = [];
  for (const artist of roster) {
    const lots = await crawlArtist(artist);
    freshLots.push(...lots);
    if (artist !== roster[roster.length - 1]) await sleep(DELAY_MS);
  }

  // Sotheby's watch & science auctions ride the GraphQL API — one cross-roster
  // pass, not per-artist. Scope to whichever verticals this run touches.
  const WATCH_SLUGS = ['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier'];
  const SCIENCE_SLUGS = ['meteorites', 'fossils', 'space-exploration', 'scientific-instruments'];
  const SPORTS_SLUGS = ['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia'];
  const ART_SLUGS = ['george-condo', 'kaws', 'andy-warhol', 'keith-haring', 'ed-ruscha', 'pablo-picasso', 'henri-matisse', 'tom-sachs', 'peter-saul', 'raymond-pettibon', 'barry-mcgee', 'futura-2000', 'r-crumb', 'fab-5-freddy', 'francesco-clemente', 'eddie-martinez', 'kenny-scharf', 'george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret'];
  const wantWatch = !only || WATCH_SLUGS.some(s => only.has(s));
  const wantScience = !only || SCIENCE_SLUGS.some(s => only.has(s));
  const wantSports = !only || SPORTS_SLUGS.some(s => only.has(s));
  const wantArt = !only || ART_SLUGS.some(s => only.has(s));
  const scopeCount = [wantWatch, wantScience, wantSports, wantArt].filter(Boolean).length;
  const auctionScope: 'watches' | 'science' | 'sports' | 'art' | 'all' | null =
    scopeCount > 1 ? 'all' : wantWatch ? 'watches' : wantScience ? 'science' : wantSports ? 'sports' : wantArt ? 'art' : null;
  if (auctionScope) {
    freshLots.push(...await crawlSothebysAuctions(auctionScope));
    freshLots.push(...await crawlChristiesAuctions(auctionScope));
    // accurate per-lot close times for the live Sotheby's lots (best-effort)
    await enrichSothebysCloseTimes(freshLots);
  }
  // Goldin: sports objects (never cards) + computing/fossils (never games).
  // Live inventory only — each crawl replaces the previous Goldin set
  // wholesale, so gate refinements purge immediately.
  const GOLDIN_SLUGS = ['game-used', 'trophies-awards', 'tickets-passes', 'meteorites', 'fossils', 'scientific-instruments'];
  let goldinRan = false;

  // Coverage baseline — captured NOW, before reconcile/sanitize mutate lot.status
  // in place on the existingLots objects (they're shared by reference with lotMap).
  // Computing "before" from existingLots at the end would read post-crawl status
  // and silently mask a collapse — the exact failure the tripwire guards against.
  const coverageBefore: Record<string, number> = { art: 0, watches: 0, sports: 0, science: 0 };
  {
    const g: Record<string, string[]> = { art: ART_SLUGS, watches: WATCH_SLUGS, sports: SPORTS_SLUGS, science: SCIENCE_SLUGS };
    for (const l of existingLots) {
      if (l.status !== 'upcoming') continue;
      for (const k in g) if (g[k].includes(l.artist)) coverageBefore[k]++;
    }
  }
  let freshGoldinIds = new Set<string>();
  if (!only || GOLDIN_SLUGS.some(s => only.has(s))) {
    const goldinLots = await crawlGoldin();
    goldinRan = true;
    freshGoldinIds = new Set(goldinLots.map(l => l.id));
    freshLots.push(...goldinLots);
  }

  // DOCTRINE: Ray is AUCTION intelligence. Buy-now / fixed-price / retail
  // listings are NEVER crawled — an asking price is not market data. A
  // marketplace crawler was added and removed here in July 2026; do not
  // reintroduce it.

  // Merge: new data overwrites existing by ID — but carry forward enriched
  // fields the fresh list-page copy lacks (medium/dims/year/image are facts
  // about the object; wiping them re-burns the enrich budget on the same lots
  // forever). Fresh always wins for price/status/bid fields via the spread.
  //
  // firstSeen (W15): lotMap is seeded from the previous lots.json, so `prev`
  // is undefined exactly when an id has never been seen before — those get
  // stamped with today's ISO date. Previously-seen ids carry their stamp
  // forward from the prior record (crawlers never set firstSeen on fresh
  // copies, so without the carry the spread would wipe it every run). Lots
  // that predate the feature stay unstamped — they were not new when first
  // observed, and a fabricated date would be a lie ("New today" must mean it).
  const todayIso = new Date().toISOString().split('T')[0];
  const lotMap = new Map<string, AuctionLot>();
  for (const lot of existingLots) lotMap.set(lot.id, lot);
  // bid snapshots: nightly {d,b,n} appended per live bid-auction lot — the raw
  // material for a future bid-momentum feature (final bidCount already
  // stratifies outcomes 0.74×→1.00×, but last-write-wins was discarding the
  // trajectory). Corpus-only (STRIPped from served).
  type Snap = { d: string; b: number; n: number };
  const withSnaps = (fresh: AuctionLot, prev?: AuctionLot): Snap[] | undefined => {
    const hist: Snap[] = ((prev as { bidHistory?: Snap[] } | undefined)?.bidHistory || []).slice(-59);
    const bid = fresh.currentBid || 0;
    const n = fresh.bidCount || 0;
    if (fresh.status === 'upcoming' && (bid > 0 || n > 0)) {
      const last = hist[hist.length - 1];
      if (!last || last.b !== bid || last.n !== n) hist.push({ d: todayIso, b: bid, n });
    }
    return hist.length ? hist : undefined;
  };
  for (const lot of freshLots) {
    const prev = lotMap.get(lot.id);
    const bidHistory = lot.auctionHouse === 'Goldin' ? withSnaps(lot, prev) : undefined;
    if (bidHistory) (lot as AuctionLot & { bidHistory?: Snap[] }).bidHistory = bidHistory;
    lotMap.set(lot.id, prev ? {
      ...lot,
      medium: lot.medium ?? prev.medium,
      dimensions: lot.dimensions ?? prev.dimensions,
      year: lot.year ?? prev.year,
      imageUrl: lot.imageUrl ?? prev.imageUrl,
      // estimates are facts about the lot: some crawl paths (Wright/Rago
      // artist search) return copies WITHOUT them — never let an estimate-less
      // fresh copy wipe an enriched estimate (fresh still wins when it has one)
      estimateLow: (lot.estimateLow ?? null) !== null ? lot.estimateLow : prev.estimateLow,
      estimateHigh: (lot.estimateHigh ?? null) !== null ? lot.estimateHigh : prev.estimateHigh,
      estLowUsd: (lot.estLowUsd ?? null) !== null ? lot.estLowUsd : prev.estLowUsd,
      estHighUsd: (lot.estHighUsd ?? null) !== null ? lot.estHighUsd : prev.estHighUsd,
      estLowNative: (lot.estLowNative ?? null) !== null ? lot.estLowNative : prev.estLowNative,
      estHighNative: (lot.estHighNative ?? null) !== null ? lot.estHighNative : prev.estHighNative,
      firstSeen: prev.firstSeen,
    } : { ...lot, firstSeen: todayIso });
  }

  // Clean up stale/bad entries
  const SCIENCE_SET = new Set(['meteorites', 'fossils', 'space-exploration', 'scientific-instruments']);
  const WATCH_SET = new Set(['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier']);
  const badIds = new Set<string>();
  let goldinPromoted = 0;

  // W11 — GENERALIZE vanished-lot reconciliation to ALL houses (not just
  // Goldin). A non-Goldin lot that stood 'upcoming', whose sale date has now
  // passed, but that did NOT reappear in this run's fresh crawl of its own
  // scope, is a zombie: the source dropped it without ever publishing a result
  // (withdrawn, or an unknown result). We can't fabricate a sold/bought_in — so
  // we mark it 'withdrawn' when it's a clean disappearance short after the sale,
  // else 'unknown-result'. This fixes the ~424 stale upcoming rows that never
  // resolve. GUARDED: only reconcile a lot whose SCOPE was actually crawled
  // this run (else a RAY_ONLY run would strand every other house's upcoming as
  // "vanished"), and never touch sold/bought_in (permanent) or Goldin (its own
  // Completed-flip pass above owns Goldin adjudication).
  const freshNonGoldinIds = new Set<string>();
  const crawledArtists = new Set<string>();
  const houseOk = new Set<string>(); // houses that returned ≥1 lot this run
  for (const l of freshLots) {
    if (l.auctionHouse !== 'Goldin') freshNonGoldinIds.add(l.id);
    crawledArtists.add(l.artist);
    houseOk.add(l.auctionHouse);
  }
  // A house appears in this run's fresh set → we have authority to reconcile
  // its still-upcoming past-sale lots. (A house crawled but returning zero
  // lots for an artist is indistinguishable from a not-crawled house, so we
  // gate on the artist having produced ANY fresh lot this run.)
  const nowMs = Date.now();
  const RECONCILE_GRACE_MS = 3 * 86_400_000; // 3-day grace after sale close
  let reconciledWithdrawn = 0, reconciledUnknown = 0;
  for (const [id, lot] of Array.from(lotMap.entries())) {
    if (lot.title?.match(/^Lot\.\d+/i)) badIds.add(id);
    if (id === 'sothebys-upcoming-boy-white-hat' && lotMap.has('sothebys-george-condo-qiao-zhikang-duo-the-boy-with-white')) {
      badIds.add(id);
    }
    // Evict legacy Bonhams keyword-dredge junk from the science verticals.
    // Sotheby's/Christie's curated science auctions AND Goldin (whose crawler
    // deliberately ingests Apple/computing + fossils — invariant: science from
    // Goldin exists) are the legitimate sources; sold records are permanent
    // archive and never swept here.
    if (SCIENCE_SET.has(lot.artist) && lot.status !== 'sold'
      && lot.auctionHouse !== "Sotheby's" && lot.auctionHouse !== "Christie's" && lot.auctionHouse !== 'Goldin') badIds.add(id);
    // Evict the deprecated Algolia crawler's lots (sothebys-lux-*, no images) —
    // superseded by the GraphQL auction crawler's sothebys-<uuid> lots.
    if (id.startsWith('sothebys-lux-')) badIds.add(id);
    // Evict any buy-now marketplace lots — fixed-price asks are not auction
    // data and must never be in the dataset (see doctrine above).
    if (id.startsWith('sothebys-mkt-')) badIds.add(id);
    // Goldin has no public sold archive — RAY IS THE ARCHIVE. When a tracked
    // lot's auction flips to 'Completed', promote its LAST bid to a hammer (bid
    // + buyer's premium) — that's the authoritative, time-based sold signal, and
    // the only one Goldin gives us (it purges the lot from its live feed on
    // close). Sold records are permanent. A lot still live stays upcoming; a lot
    // that vanished with no completed auction and no bid is delisted stock and
    // leaves; a legacy stale 'upcoming' past its end also goes.
    // The whole pass is gated on goldinStatusOk: with a failed status fetch the
    // Completed set is empty and every closed lot would read as "delisted" —
    // one transient error must never erase the pending archive. Deferring a run
    // loses nothing (lots are keyed by id); evicting loses the hammer forever.
    if (id.startsWith('goldin-') && goldinRan && goldinStatusOk && lot.status === 'upcoming') {
      const auctionDone = !!lot.auctionId && goldinCompletedAuctions.has(lot.auctionId);
      const bid = lot.currentBid || 0;
      if (auctionDone) {
        if (bid > 0) {
          const bp = lot.buyerPremium || 22;
          // v2: stamp the FULL money block on promotion (native hammer =
          // last bid, realized = hammer + premium, dated USD, basis) so a
          // promoted lot is byte-identical to a fresh ingestSold row.
          Object.assign(lot, stampMoney({
            isSold: true,
            nativeCurrency: 'USD',
            saleDate: (lot.saleDate || '').split('T')[0] || null,
            hammerNative: bid,
            premiumNative: Math.round(bid * (1 + bp / 100)),
            estLowNative: null,
            estHighNative: null,
            priceBasis: 'final-bid-plus-bp',
            buyerPremiumPct: bp,
          }));
          lot.status = 'sold';
          goldinPromoted++;
        } else {
          badIds.add(id); // closed with no bid = bought-in
        }
      } else if (goldinFeedComplete && !freshGoldinIds.has(id)) {
        // Gone from a FULLY-enumerated live feed but its auction isn't
        // Completed yet. A lot carrying real money is held pending — its
        // Completed flip adjudicates it (promote or bought-in) on a later run;
        // evicting now would destroy the only hammer record that will ever
        // exist. Only zero-bid delisted stock leaves, plus legacy records we
        // can't adjudicate (no auctionId) that are stale past their end.
        if (bid > 0 && lot.auctionId) {
          // hold — awaiting the Completed flip
        } else if (lot.auctionId || new Date(lot.saleDate).getTime() < Date.now() - 86_400_000) {
          badIds.add(id);
        }
      }
    }
    // Watch makers: evict the old Christie's maker-search lots (now superseded
    // by christies-auc-* from the full auction crawler) to avoid double-count.
    if (WATCH_SET.has(lot.artist) && lot.auctionHouse === "Christie's" && !id.startsWith('christies-auc-')) badIds.add(id);

    // W11 — non-Goldin zombie reconciliation (see the comment block above).
    if (lot.auctionHouse !== 'Goldin' && lot.status === 'upcoming' && !badIds.has(id)) {
      const saleMs = new Date(lot.saleDate).getTime();
      const salePassed = !isNaN(saleMs) && saleMs < nowMs;
      const scopeCrawled = crawledArtists.has(lot.artist);
      const reappeared = freshNonGoldinIds.has(id);
      // Only reconcile if the lot's OWN house actually returned lots this run —
      // if its house's fetch failed transiently (0 lots), a same-artist lot from
      // another house must NOT authorize withdrawing it (that's the silent
      // live-lot-loss under a flaky source).
      const houseCrawled = houseOk.has(lot.auctionHouse);
      if (salePassed && scopeCrawled && houseCrawled && !reappeared) {
        // vanished from a scope we crawled, after its sale — never resolved.
        // Recently past → a clean withdrawal; long past → unknown result.
        if (nowMs - saleMs <= RECONCILE_GRACE_MS) {
          lot.status = 'withdrawn';
          reconciledWithdrawn++;
        } else {
          lot.status = 'unknown-result';
          reconciledUnknown++;
        }
      }
    }
  }
  for (const id of Array.from(badIds)) lotMap.delete(id);

  // ── GLOBAL status-sanitize + results-pending net (house-agnostic) ──
  // EVERY house has the same failure mode: a sale closes, the house has not
  // posted hammers yet, and the lot lands in a state that (a) hides it from both
  // active and sold (the "double miss") or (b) is outright invalid (upcoming
  // with a past date; sold with no price — flaky artist-page scrapes produce
  // both). The write-gate is all-or-nothing, so a handful of such rows would
  // block the entire 44k-row publish. This one pass sanitizes them so the gate
  // passes AND no just-closed lot vanishes: a resultless lot whose sale closed
  // within RESULT_PENDING_MS is held VISIBLE as pending (upcoming); anything
  // past the window or otherwise invalid settles to bought_in. Goldin is
  // excluded — its Completed-flip pass owns its own adjudication.
  const HIDDEN = new Set(['bought_in', 'withdrawn', 'unknown-result']);
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  let heldPending = 0, demoted = 0;
  const held = (lot: AuctionLot & { resultsPending?: boolean }) => { lot.status = 'upcoming'; lot.resultsPending = true; heldPending++; };
  for (const lot of Array.from(lotMap.values())) {
    if (lot.auctionHouse === 'Goldin') continue;
    const hasHammer = (lot.realizedUsd || 0) > 0;
    const sMs = new Date(lot.saleDate).getTime();
    const saleStr = (lot.saleDate || '').slice(0, 10);
    const past = /^\d{4}-\d{2}-\d{2}$/.test(saleStr) && saleStr < todayStr;
    const withinWindow = !isNaN(sMs) && sMs <= nowMs && nowMs - sMs <= RESULT_PENDING_MS;

    // (a) 'sold' with no usable price is a parse miss, not a real sale → demote
    //     to bought_in AND strip any partial money (the non-sold-null-price
    //     invariant requires every realized/hammer/premium field be null).
    if (lot.status === 'sold' && !hasHammer) {
      lot.status = 'bought_in';
      const L = lot as unknown as Record<string, unknown>;
      for (const f of ['realizedUsd', 'realizedNative', 'hammerUsd', 'hammerNative', 'premiumUsd', 'premiumNative', 'hammerPrice', 'premiumPrice', 'priceUsd', 'priceBasis']) L[f] = null;
      demoted++; continue;
    }
    // (b) hidden + resultless + just-closed → hold visible as pending
    if (HIDDEN.has(lot.status as string) && !hasHammer && past && withinWindow) { held(lot as AuctionLot & { resultsPending?: boolean }); continue; }
    // (c) 'upcoming' with a PAST sale date — keep it VISIBLE if it is just-closed
    //     OR already flagged results-pending (a deliberately-held live lot whose
    //     source date is stale, e.g. Christie's online sales). Only a stale
    //     upcoming with NO pending flag beyond the window is a real closed
    //     listing → bought_in. NEVER demote a results-pending lot (that is how
    //     live lots were being lost).
    if (lot.status === 'upcoming' && past) {
      if (withinWindow || (lot as AuctionLot & { resultsPending?: boolean }).resultsPending) held(lot as AuctionLot & { resultsPending?: boolean });
      else { lot.status = 'bought_in'; demoted++; }
    }
  }
  if (heldPending) console.log(`[Ray] Held ${heldPending} just-closed lots visible as results-pending (all houses)`);
  if (demoted) console.log(`[Ray] Sanitized ${demoted} invalid rows (sold-no-price / stale-upcoming → bought_in)`);

  // ── Christie's online-sale TRUE dates + rescue (onlineonly) ──
  // www.christies.com is STALE for online ("First Open") sales — it reports live
  // lots as over with years-old dates, so they get stranded as bought_in. The
  // real close lives on onlineonly (the SSO url each lot carries). Fetch it for
  // EVERY non-sold Christie's lot with an onlineonly url — existing corpus rows
  // included, since the legacy id format is not re-produced each crawl — stamp
  // the true end_date, and revive future-dated lots to 'upcoming'. Best-effort:
  // an unreachable lot keeps its state (never dropped). This un-strands live lots
  // that the stale www data wrongly closed (e.g. saved Tom Sachs).
  {
    const targets = Array.from(lotMap.values()).filter(l =>
      l.auctionHouse === "Christie's" && l.status !== 'sold' && !!l.url && /onlineonly\.christies\.com/.test(l.url));
    const CONC = 6, CAP = 1500;
    const slice = targets.slice(0, CAP);
    let dated = 0, revived = 0;
    for (let i = 0; i < slice.length; i += CONC) {
      await Promise.all(slice.slice(i, i + CONC).map(async lot => {
        try {
          const r = await fetch(lot.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
          if (!r.ok) return;
          const h = await r.text();
          const raw = (h.match(/"end_date":"([0-9T:.\-]+Z)"/) || [])[1];
          if (!raw) return;
          const d = new Date(raw);
          if (isNaN(d.getTime())) return;
          const iso = d.toISOString();
          lot.saleDate = iso.slice(0, 10);
          (lot as AuctionLot & { saleDateTime?: string }).saleDateTime = iso;
          dated++;
          if (d.getTime() > Date.now()) {
            if (lot.status !== 'upcoming') revived++;
            lot.status = 'upcoming';
            (lot as AuctionLot & { resultsPending?: boolean }).resultsPending = false;
          }
        } catch { /* unreachable → keep state; never drop */ }
      }));
      await sleep(120);
    }
    if (slice.length) console.log(`  [Christie's] onlineonly: dated ${dated}/${slice.length}, revived ${revived} wrongly-closed lots to upcoming`);
  }

  if (goldinRan) console.log(`[Ray] Goldin: promoted ${goldinPromoted} closed lots to final hammer (last-bid + premium)`);
  if (reconciledWithdrawn || reconciledUnknown) {
    // NOTE: the global sanitize net below RE-HOLDS any of these still within the
    // 14-day RESULT_PENDING window as upcoming+resultsPending (the safe, don't-
    // lose-a-lot direction), so only the >14-day 'unknown-result' ones actually
    // publish in that state. These counts are the reconcile-pass tallies, not the
    // final published statuses.
    console.log(`[Ray] Reconcile pass flagged ${reconciledWithdrawn + reconciledUnknown} vanished upcoming lots (${reconciledWithdrawn} recent→withdrawn, ${reconciledUnknown} old→unknown-result); recent ones are re-held as results-pending below`);
  }

  const allLots = Array.from(lotMap.values()).sort((a, b) => {
    const da = new Date(a.saleDate).getTime();
    const db = new Date(b.saleDate).getTime();
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });

  // Enrich lots missing medium/dimensions/year from detail pages
  await enrichLots(allLots);

  // Classify every lot. comps is imported once here (dynamically, matching
  // the buildUpcoming pattern) for the form/object-class work in this pass,
  // the watch filter below, and the W16 signal-scoped image check.
  const { classifyForm, objectClassOf, computeDeepSignal, isSportsScienceObject, extractSportsTags } =
    await import('../app/lib/comps');
  // sport tag (title-derived) for the SPORT filter on the sports vertical —
  // sportOf lives in app/utils (pure, no client deps; same fn the UI uses).
  const { sportOf } = await import('../app/utils');
  const SPORT_SLUGS = new Set(['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia']);
  let categoryCounts: Record<string, number> = {};
  for (const lot of allLots) {
    lot.category = classifyLot(lot);
    // W17 — object-class tag for the watch-maker ambiguity (a Cartier
    // Panthère ring is jewelry, not a watch): stamped on 'object' lots so
    // vertical pools and pickCall can gate without re-deriving forms
    // client-side. Runs over the whole merged set, so archive records pick
    // up the tag too; a stale tag is cleared if a lot reclassifies out.
    if (lot.category === 'object') lot.objectClass = objectClassOf(lot);
    else if (lot.objectClass) delete lot.objectClass;
    // W2 — crawl-time sports/science tags (entity/objectType/eventKey/sportYear).
    // Additive, gated on the sports/science object choke point, and mirrored on
    // the objectClass cleanup: stamp when the lot qualifies, clear a stale tag
    // when it reclassifies out. Short keys so the archive stays lean.
    if (isSportsScienceObject(lot)) {
      const tags = extractSportsTags(lot.title, lot.artist);
      if (tags.entity !== undefined) lot.entity = tags.entity; else delete lot.entity;
      if (tags.objectType !== undefined) lot.objectType = tags.objectType as AuctionLot['objectType']; else delete lot.objectType;
      if (tags.eventKey !== undefined) lot.eventKey = tags.eventKey; else delete lot.eventKey;
      if (tags.sportYear !== undefined) lot.sportYear = tags.sportYear; else delete lot.sportYear;
    } else {
      if (lot.entity !== undefined) delete lot.entity;
      if (lot.objectType !== undefined) delete lot.objectType;
      if (lot.eventKey !== undefined) delete lot.eventKey;
      if (lot.sportYear !== undefined) delete lot.sportYear;
    }
    // SPORT tag — which sport a sports-vertical lot belongs to, read from the
    // title. Stamped on the three sports slugs only (null = no sport cue →
    // "Other" in the UI filter); cleared when a lot lives outside the sports
    // vertical, mirroring the entity/objectType cleanup above.
    if (SPORT_SLUGS.has(lot.artist)) lot.sport = sportOf(lot.title);
    else if (lot.sport !== undefined) delete lot.sport;

    // ── v2 IDENTITY STAMP ──────────────────────────────────────────────────
    // Persist what the value/similarity engine joins on, using the SAME pure
    // functions the backfill uses (normalize.ts), so a fresh row and a migrated
    // row are byte-identical. Runs after category/objectClass/sports tags are
    // set (objectFingerprint reads entity/objectType). Every field is additive;
    // an absent signal produces null (never fabricated identity).
    lot.formKey = classifyForm(lot);
    lot.modelKey = normModelKey(lot);
    lot.reference = normWatchKey(lot);
    lot.normalizedTitle = normNormalizeTitle(lot.title);
    // ART lots: drop the maker's own name words from the tokens — they carry
    // zero signal within a same-maker comp pool and inflate cosine between
    // unrelated works (holdout: art coverage 19.8→21.1%, edge +2pt).
    const isArtLot = !DESIGN_ARTISTS.has(lot.artist) && !OBJECT_ARTISTS.has(lot.artist);
    lot.titleTokens = titleTokens(lot.title, isArtLot ? lot.artist.split('-') : undefined);

    const { makerSlug, entityClass } = classifyEntity(lot.artist);
    lot.makerSlug = makerSlug;
    lot.entityClass = entityClass;

    const yr = extractYear(lot.year, lot.title, lot.description || undefined);
    lot.yearNum = yr.yearNum;
    lot.yearSource = yr.yearSource;
    lot.yearIsCirca = yr.yearIsCirca;

    const dims = normalizeDimensions(lot.dimensions);
    lot.heightCm = dims?.heightCm ?? null;
    lot.widthCm = dims?.widthCm ?? null;
    lot.depthCm = dims?.depthCm ?? null;
    lot.sizeClass = dims?.sizeClass ?? null;
    lot.dimSource = dims?.dimSource ?? null;

    const med = canonMedium(lot.medium);
    lot.mediumCanon = med.mediumCanon;
    lot.materialTokens = med.materialTokens;

    const ed = extractEdition(lot.title, lot.description || undefined);
    lot.editionOf = ed.editionOf;
    lot.editionTotal = ed.editionTotal;
    lot.editionMarker = ed.editionMarker;
    lot.serialNo = extractSerial(lot.title, lot.description || undefined);

    // collectible auth signals (game-used sports) — title-borne
    const tags = extractCollectibleTags(lot.title);
    lot.photoMatched = tags.photoMatched;
    lot.authCert = tags.authCert;
    lot.gradeLabel = tags.gradeLabel;

    // Layer-B fingerprint LAST — reads makerSlug/model/dims/edition + sports
    // tags all stamped above. NULL when discriminators are thin (never fabricate
    // exact identity — guards the Untitled collisions + the Eames over-merge).
    lot.objectFingerprint = objectFingerprint(lot);

    lot.schemaVersion = 2;

    categoryCounts[lot.category] = (categoryCounts[lot.category] || 0) + 1;
  }
  console.log(`[Ray] Category breakdown:`, categoryCounts);

  // A science slug must never hold a wristwatch-form lot — the router vetoes
  // them at intake; this form-level gate catches anything older data or a new
  // source slips through (a $150K Richard Mille was briefly the meteorites
  // "record sale" before this class of row was purged). In-place: allLots is
  // const and shared with everything downstream.
  {
    const SCI_GUARD = new Set(['meteorites', 'fossils', 'space-exploration', 'scientific-instruments']);
    let evictedSciWatch = 0;
    for (let i = allLots.length - 1; i >= 0; i--) {
      const l = allLots[i];
      if (SCI_GUARD.has(l.artist) && l.formKey === 'wristwatch') { allLots.splice(i, 1); evictedSciWatch++; }
    }
    if (evictedSciWatch) console.warn(`[Ray] evicted ${evictedSciWatch} wristwatch-form lots from science slugs`);
  }

  // The watches vertical trades WATCHES only. Cartier especially is a jeweler
  // as much as a watchmaker — maker crawls drag in thermometer cases, lipstick
  // holders, earclips, pearl sets, bracelets. A blocklist is whack-a-mole, so
  // require a POSITIVE horology signal: keep a lot only if its form is a
  // watch/clock or its text names a watch (movement, ref, a Cartier watch
  // line, etc). Everything without a watch signal is dropped.
  const WATCH_MAKERS = new Set(['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier']);
  const HOROLOGY = new Set(['wristwatch', 'pocket-watch', 'clock']);
  const WATCH_SIGNAL = /watch|montre|chronograph|chronometer|chronometre|tourbillon|calibre|caliber|\bref\.?\b|reference|automatic|self-?winding|manual wind|movement|\bdial\b|perpetual|minute repeat|moonphase|moon phase|day-?date|tank|santos|panth|ballon|pasha|tortue|baignoire|\bronde\b|roadster|\bdrive\b|cloche|oyster|cosmograph|datejust|submariner|seamaster|speedmaster|constellation|nautilus|aquanaut|calatrava|royal oak|cellini|de ville|must de|must 21|jaeger|reverso/i;
  const beforeWatch = allLots.length;
  const keptLots = allLots.filter(l => {
    if (!WATCH_MAKERS.has(l.artist)) return true;
    if (HOROLOGY.has(classifyForm(l as any))) return true;
    return WATCH_SIGNAL.test(`${l.title || ''} ${l.medium || ''}`);
  });
  if (keptLots.length < beforeWatch) {
    console.log(`[Ray] Dropped ${beforeWatch - keptLots.length} non-watch lots from watch makers (jewelry/objects)`);
  }
  allLots.length = 0;
  allLots.push(...keptLots);

  // ── W16 · dead-link guard (publish-time backstop) ──
  // Catches URLs that predate the parse-time id resolution above: an empty/
  // undefined auction segment ("auction//", "auction/undefined/") or a
  // lot/0 tail 404s at the house. Upcoming lots are DROPPED — a bid link
  // that can't be followed is not intelligence, and a flag must never sit on
  // a dead link. Sold/bought-in records are the permanent archive and are
  // never evicted here — their link is repaired to the house origin (a live
  // page) instead.
  const DEAD_URL = /auction\/(?:\/|undefined\/|null\/)|\/lot\/(?:0|undefined|null)(?:[/?#]|$)/;
  let deadDropped = 0, deadRepaired = 0;
  const linkedLots = allLots.filter(lot => {
    if (!lot.url || !DEAD_URL.test(lot.url)) return true;
    if (lot.status === 'upcoming') { deadDropped++; return false; }
    try { lot.url = new URL(lot.url).origin; deadRepaired++; } catch { /* unparsable — keep the record as-is */ }
    return true;
  });
  if (deadDropped || deadRepaired) {
    console.log(`[Ray] Dead-link guard: dropped ${deadDropped} upcoming lots, repaired ${deadRepaired} archive URLs`);
    allLots.length = 0;
    allLots.push(...linkedLots);
  }

  // ── W16 · image liveness, scoped to signal-bearing lots ──
  // SCOPE (deliberate): only UPCOMING lots that would carry a Below/Above
  // Market flag are probed — those are the images the flag counts and the
  // call surfaces stand on, and they run a few dozen per crawl. A full-corpus
  // check would add minutes of network time for lots nothing renders. HEAD
  // only, small concurrency, hard wall-clock budget so a stalled CDN can't
  // eat the CI window. Only a definitive 404/410 clears imageUrl — timeouts,
  // 403s and HEAD-rejecting CDNs are inconclusive, and absence of proof must
  // never strip a live image (data honesty applies to absence too).
  const IMG_CONCURRENCY = 6;
  const IMG_BUDGET_MS = 90_000;
  const flaggedLots = allLots.filter(l =>
    l.status === 'upcoming' && l.imageUrl && computeDeepSignal(l, allLots) !== null);
  if (flaggedLots.length > 0) {
    console.log(`[Ray] Image check: probing ${flaggedLots.length} flagged upcoming lots (HEAD, ${IMG_CONCURRENCY}-wide)...`);
    const imgStart = Date.now();
    let imgCursor = 0, imgCleared = 0;
    const probe = async () => {
      while (imgCursor < flaggedLots.length && Date.now() - imgStart < IMG_BUDGET_MS) {
        const lot = flaggedLots[imgCursor++];
        try {
          const res = await fetch(lot.imageUrl!, {
            method: 'HEAD',
            headers: { 'User-Agent': UA },
            redirect: 'follow',
            signal: AbortSignal.timeout(5000),
          });
          if (res.status === 404 || res.status === 410) { lot.imageUrl = null; imgCleared++; }
        } catch { /* inconclusive — keep the image */ }
      }
    };
    await Promise.all(Array.from({ length: IMG_CONCURRENCY }, probe));
    console.log(`[Ray] Image check: cleared ${imgCleared} dead image URLs in ${Math.round((Date.now() - imgStart) / 1000)}s`);
  }

  // Compute per-artist stats
  const statsByArtist: Record<string, MarketStats> = {};
  for (const artist of ARTISTS) {
    const artistLots = allLots.filter(l => l.artist === artist.slug);
    statsByArtist[artist.slug] = computeStats(artistLots, existingStatsByArtist[artist.slug] || null);
    console.log(`[Ray] ${artist.displayName}: ${artistLots.length} lots, ${artistLots.filter(l => l.status === 'sold').length} sold`);
  }

  // The eager payload + backtest run over the FULL in-memory corpus, BEFORE
  // the payload split — so the sports/science sold-comp pool and the realized
  // cohort see every Goldin sold row, not the truncated lots.json. Non-fatal:
  // the CI workflow reruns both as their own steps, so a throw here must not
  // take the crawl's lots.json down with it. Runs before the writes so a
  // precompute pass (which stamps lot.soldComp in place) lands in the split.
  try {
    const { buildUpcoming } = await import('./build-upcoming');
    buildUpcoming(DATA_DIR, allLots);
  } catch (e) {
    console.error('[Ray] buildUpcoming failed (crawl data intact):', e);
  }
  try {
    const { buildBacktest } = await import('./build-backtest');
    buildBacktest(DATA_DIR, allLots);
  } catch (e) {
    console.error('[Ray] buildBacktest failed (crawl data intact):', e);
  }

  // (imageHash removed: different houses photograph the same object differently,
  // so a perceptual hash never matches the same item across sales — Collin.
  // Same-object identity is title + structured attributes, scored as a % in
  // step 2; the fingerprint is a coarse blocking key only, imageHash is not
  // worth the network pass for near-zero cross-sale value.)

  // ── §4 WRITE-TIME VALIDATION GATE ─────────────────────────────────────────
  // assertInvariants(lots) is PURE — it returns {fatal, warn} and throws
  // nothing; the crawler owns the policy: log warnings, then THROW on any FATAL
  // so the crawl aborts with the JSON untouched (data honesty > a bad publish).
  // Imported dynamically (matching the comps/buildUpcoming pattern); the
  // consumers agent owns app/lib/validate.ts. A sold lot MUST have realizedUsd>0
  // + priceBasis + a real non-future saleDate; a non-sold lot MUST have null
  // price fields; every *Usd == native×fxRate; ids/dates well-formed. Runs on
  // the FULL corpus (allLots) BEFORE the payload split so an archive row can't
  // skip the gate; passing rows are stamped validatedAt.
  {
    const { assertInvariants } = await import('../app/lib/validate');
    const report = assertInvariants(allLots);
    for (const w of report.warn) console.warn(`[Ray] WARN invariant: ${w}`);
    if (report.fatal.length > 0) {
      console.error(`[Ray] ${report.fatal.length} FATAL invariant violation(s):`);
      for (const f of report.fatal.slice(0, 50)) console.error(`  ✗ ${f}`);
      if (report.fatal.length > 50) console.error(`  … and ${report.fatal.length - 50} more`);
      // A LARGE count means systemic corruption → abort with data untouched.
      // A SMALL count of stragglers must not block a 44k-row publish: drop just
      // those rows and publish the rest (honest — bad rows excluded, not faked).
      // The sanitize pass above already fixes the known patterns; this catches
      // the unforeseen few so the pipeline is never wedged by a handful of rows.
      const DROP_CEILING = 30;
      if (report.fatal.length > DROP_CEILING) {
        throw new Error(`assertInvariants: ${report.fatal.length} FATAL (> ${DROP_CEILING}) — systemic, refusing to publish`);
      }
      const badIds = new Set(report.fatal.map(f => (f.match(/^\[\d+\] ([^:]+):/) || [])[1]).filter(Boolean));
      const kept = allLots.filter(l => !badIds.has(l.id));
      console.warn(`[Ray] Dropping ${allLots.length - kept.length} invalid row(s) and publishing the remaining ${kept.length}.`);
      allLots.length = 0; allLots.push(...kept);
      const recheck = assertInvariants(allLots);
      if (recheck.fatal.length > 0) throw new Error(`assertInvariants: ${recheck.fatal.length} FATAL remain after drop — refusing to publish`);
    }
    const validatedAt = new Date().toISOString();
    for (const lot of allLots) lot.validatedAt = validatedAt;
    console.log(`[Ray] Invariant gate PASSED (${report.warn.length} warnings) — stamped validatedAt on ${allLots.length} lots`);
  }

  // ── COVERAGE TRIPWIRE ─────────────────────────────────────────────────────
  // The class of bug that hid science: a market's live lots silently vanish and
  // nobody notices until it's spotted by eye. Compare active (upcoming, incl.
  // results-pending) counts per market against the PRE-crawl corpus and shout on
  // a collapse. Non-fatal (a market can legitimately be between sale cycles), but
  // the alert line is greppable so CI can notify on it. Also logs every market's
  // before→after so a slow bleed is visible in the crawl log.
  {
    const groups: Record<string, string[]> = {
      art: ART_SLUGS, watches: WATCH_SLUGS, sports: SPORTS_SLUGS, science: SCIENCE_SLUGS,
    };
    const activeByMarket = (lots: AuctionLot[]) => {
      const m: Record<string, number> = { art: 0, watches: 0, sports: 0, science: 0 };
      for (const l of lots) {
        if (l.status !== 'upcoming') continue;
        for (const k in groups) if (groups[k].includes(l.artist)) m[k]++;
      }
      return m;
    };
    const before = coverageBefore; // pre-crawl snapshot (before in-place mutation)
    const after = activeByMarket(allLots);
    console.log('[coverage] active (upcoming) lots per market, pre-crawl → post-crawl:');
    let alerts = 0;
    for (const k of Object.keys(after)) {
      const b = before[k], a = after[k];
      // collapse = a market with real prior coverage falls to zero, or loses >60%
      const collapse = (b >= 8 && a === 0) || (b >= 20 && a < b * 0.4);
      if (collapse) alerts++;
      console.log(`[coverage]   ${k.padEnd(8)} ${String(b).padStart(4)} → ${String(a).padStart(4)}${collapse ? '   ⚠️  COVERAGE ALERT — sharp drop, investigate' : ''}`);
    }
    if (alerts) console.warn(`[Ray] ⚠️  COVERAGE ALERT: ${alerts} market(s) lost their active lots this crawl — check the crawler/source before trusting this data.`);
  }

  // W3 · Payload split at write time. Goldin *sold* is ~35% of the corpus and
  // no estimate engine ever reads it (signal/backtest/demand all require
  // estimates Goldin never has), so it moves to a lazy sold-archive.json;
  // lots.json keeps everything else (incl. Goldin *upcoming*). lots.json is
  // minified (like upcoming.json): every first-visit client streams the whole
  // file, so indentation is pure waste.
  const isGoldinSold = (l: AuctionLot) => l.auctionHouse === 'Goldin' && l.status === 'sold';
  // Full v2 corpus (gz, source of truth) + slim served files (client). The
  // corpus carries every engine field; the client gets a null-omitted display
  // projection under Cloudflare's 25MB/file cap. See scripts/corpus-io.ts.
  // ── PUBLISH SANITY GATE ───────────────────────────────────────────────
  // The last line of defense before the corpus is written and self-deployed:
  // compare against the PREVIOUS corpus and refuse to publish a collapse. A
  // crawler regression that silently drops a house/vertical must fail the run
  // loudly (no commit, no deploy, yesterday's good data keeps serving) — not
  // ship a hollowed-out book. Growth is never blocked; only shrinkage is.
  {
    try {
      const zlibMod = await import('zlib');
      const prevPath = path.join(process.cwd(), 'data', 'corpus', 'lots.json.gz');
      if (fs.existsSync(prevPath)) {
        const prev = JSON.parse(zlibMod.gunzipSync(fs.readFileSync(prevPath)).toString('utf8')) as { status?: string; auctionHouse?: string }[];
        const prevTotal = prev.length;
        const newTotal = allLots.filter(l => !isGoldinSold(l)).length;
        if (prevTotal > 1000 && newTotal < prevTotal * 0.97) {
          throw new Error(`corpus shrank ${prevTotal} → ${newTotal} (>3%) — refusing to publish`);
        }
        const prevSold = prev.filter(l => l.status === 'sold').length;
        const newSold = allLots.filter(l => l.status === 'sold' && !isGoldinSold(l)).length;
        if (prevSold > 1000 && newSold < prevSold * 0.97) {
          throw new Error(`sold book shrank ${prevSold} → ${newSold} (>3%) — refusing to publish`);
        }
        const prevHouses = new Set(prev.map(l => l.auctionHouse)).size;
        const newHouses = new Set(allLots.map(l => l.auctionHouse)).size;
        if (newHouses < prevHouses) {
          throw new Error(`an auction house vanished (${prevHouses} → ${newHouses}) — refusing to publish`);
        }
        console.log(`[Ray] publish gate OK: lots ${prevTotal}→${newTotal}, sold ${prevSold}→${newSold}, houses ${prevHouses}→${newHouses}`);
      }
    } catch (e) {
      if (String(e).includes('refusing to publish')) throw e;
      console.warn('[Ray] publish gate check skipped:', e);
    }
  }

  const { writeCorpusAndServed } = await import('./corpus-io');
  const io = writeCorpusAndServed(
    allLots as unknown as Record<string, unknown>[],
    (l: Record<string, unknown>) => isGoldinSold(l as unknown as AuctionLot),
  );
  const mb = (p: string) => (fs.statSync(p).size / (1024 * 1024)).toFixed(2);
  console.log(`[Ray] Wrote corpus ${io.corpusMb}+${io.archiveMb}MB gz | served lots.json ${io.servedMb}MB (slim)`);
  fs.writeFileSync(statsPath, JSON.stringify(statsByArtist, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'meta.json'), JSON.stringify({
    lastCrawl: new Date().toISOString(),
    artists: ARTISTS.map(a => ({ slug: a.slug, displayName: a.displayName })),
    // derived from the data so it never drifts as houses are added
    sources: Array.from(new Set(allLots.map(l => l.auctionHouse))).sort(),
    // W4 · full-corpus totals so the home aggregate counts + Colophon read
    // honest numbers without paying for the lazy sold-archive.json.
    totalLots: allLots.length,
    totalSold: allLots.filter(l => l.status === 'sold').length,
    version: 2,
  }, null, 2));

  // ── PART-2 ENGINE PASS ──────────────────────────────────────────────────
  // Value the upcoming lots, group repeat sales, and build the market
  // dashboards from the freshly-written corpus. Non-fatal: a failure here
  // leaves the crawl's data intact (the engine outputs just go stale a day).
  try {
    const { runMarketBuild } = await import('./build-market');
    await runMarketBuild();
  } catch (e) {
    console.error('[Ray] market/value engine pass failed (crawl data intact):', e);
  }

  console.log(`\n[Ray] Done. ${allLots.length} total lots written (corpus gz + slim served + engine).`);
}

main().catch(err => {
  console.error('[Ray] Fatal error:', err);
  process.exit(1);
});
