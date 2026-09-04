// ─────────────────────────────────────────────────────────────────────────────
// STRUTS AUCTION PLATFORM — the shared parser for Julien's and Propstore.
//
// Both houses run the same Struts/Java auction app, so one module reads both:
//   Julien's   julienslive.com/lot-details/index/catalog/<cat>/lot/<lot>
//   Propstore  propstoreauction.com/lot-details/index/catalog/<cat>/lot/<lot>
//
// NEITHER live host is reachable today (verified Sep 3 2026):
//   · juliensauctions.com  → 403, Cloudflare "Just a moment" challenge
//   · julienslive.com      → 301 → bid.juliensauctions.com, which is NXDOMAIN
//   · propstoreauction.com → 202 with an EMPTY body (AWS WAF challenge)
// so the only un-walled source of realized prices is the Wayback Machine, and
// this parser is fed archived snapshots (`/web/<ts>id_/<original>` — the `id_`
// suffix returns the original bytes with no Archive toolbar injected).
// Full recon, CDX numbers and yield measurements: scripts/_qa/JULIENS_PROPSTORE_PLAN.md
//
// ── SUBJECT ANCHORING ────────────────────────────────────────────────────────
// A lot-details page renders exactly ONE `div.message-closed` and ONE
// `div.tle-lot` (verified across 100 sampled snapshots), and carries no
// related-lot price rail — so the page-wide read that poisoned NFL Auction
// cannot occur here. The price is nonetheless taken only from inside the
// message-closed block, and the batch poison detector still gates every write.
//
// ── MONEY ────────────────────────────────────────────────────────────────────
// The printed figure is the WINNING BID = the HAMMER: propstore.com/auctions.action
// states "a Buyer's Premium will be added to all winning bids in each Live
// Auction", and the label itself reads "Winning bid" / "Sold Price". So rows are
// stamped on the `hammer` basis and premiums.ts supplies the all-in factor.
// Julien's is USD. **Propstore alternates USD (Los Angeles) and GBP (London)
// sale by sale** — the currency is read PER LOT off the figure's own symbol
// (corroborated by the platform's `rev="cur:N"` id: cur:1/cur:12 = USD,
// cur:2 = GBP) and converted with the DATED fx path (fxRateFor/toUsdDated),
// never the USD-only stampRealizedUsd.
// ─────────────────────────────────────────────────────────────────────────────
import { fxRateFor, toUsdDated } from '../../app/lib/normalize';
import type { AuctionLot, Currency, LotCategory, PriceBasis } from '../../app/types';
import { decodeHtml, classifySports, pseudoArtist, readAuth, type SportsCategory } from './sports-crawl';

export interface StrutsHouse {
  segment: string;
  label: string;
  idPrefix: string;
  auctionHouse: AuctionLot['auctionHouse'];
  /** the live host the archived urls belong to (for the canonical `url` field) */
  host: string;
  /** currency to assume when a page prints a bare number with no symbol.
   *  null = refuse the row rather than guess (Propstore: its sales alternate
   *  USD/GBP, so a default would be a coin flip on the money field). */
  defaultCurrency: Currency | null;
  /** require an inline provenance paragraph before trusting a "signed" lot */
  provenanceGate?: boolean;
}

const POP_RE = /\b(comic|comics|cgc|cbcs|original art|splash page|cover art|action figure|figure|toy|toys|playset|lunch\s?box|poster|one[-\s]?sheet|prop|props|costume|screen[-\s]?used|screen[-\s]?matched|model kit|maquette|miniature|pinback|robot|doll|board game|movie|film|animation|cel|statue|bust|guitar|drum|stage[-\s]worn|dress|gown|script|storyboard)\b/i;
const PROVENANCE_RE = /\b(provenance|property from|the collection of|estate of|consigned by|letter of authenticity|certificate of authenticity)\b/i;

export const JULIENS: StrutsHouse = {
  segment: 'juliens', label: "Julien's", idPrefix: 'juliens',
  auctionHouse: "Julien's", host: 'https://www.julienslive.com',
  defaultCurrency: 'USD',      // every sampled sold row printed $; pre-2012 pages print no symbol
  provenanceGate: true,        // a "signed" lot with no estate/provenance line is untrusted
};

export const PROPSTORE: StrutsHouse = {
  segment: 'propstore', label: 'Propstore', idPrefix: 'propstore',
  auctionHouse: 'Propstore', host: 'https://propstoreauction.com',
  defaultCurrency: null,       // LA sales are USD, London sales GBP — never guess
};

export const STRUTS_HOUSES: Record<string, StrutsHouse> = { juliens: JULIENS, propstore: PROPSTORE };

// ── low-level readers ────────────────────────────────────────────────────────

const stripTags = (s: string) => decodeHtml(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const CLOSED_BLOCK_RE = /class="message-closed">([\s\S]{0,1400}?)(?:<\/div>\s*<\/div>|<div class="clear">)/i;
const RESULT_RE = /(?:Winning bid|Sold Price)\s*:?\s*([£$€])?\s*([\d,]+(?:\.\d+)?|N\/A)/i;
const BIDS_RE = /\((\d+)\s*bids?\)/i;
const EST_RE = /Estimate:\s*([£$€])?\s*([\d,]+(?:\.\d+)?)\s*-\s*([£$€])?\s*([\d,]+(?:\.\d+)?)/i;

const SYMBOL_CUR: Record<string, Currency> = { '$': 'USD', '£': 'GBP', '€': 'EUR' };

const numOrNull = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return isFinite(n) && n > 0 ? n : null;
};

export type CloseOutcome =
  | { kind: 'sold'; amount: number; symbol: string | null; bids: number | null; estLow: number | null; estHigh: number | null; estSymbol: string | null }
  | { kind: 'unsold' }
  | { kind: 'still-open' };

/** Read the subject's `div.message-closed` block. `still-open` means the
 *  snapshot predates the sale close (the Archive's most common Propstore
 *  capture) — it carries a live current-bid, never a result, and must NEVER be
 *  priced. */
export function readClose(html: string): CloseOutcome {
  const m = html.match(CLOSED_BLOCK_RE);
  if (!m) return { kind: 'still-open' };
  const t = stripTags(m[1]);
  if (/unsold/i.test(t)) return { kind: 'unsold' };
  const r = t.match(RESULT_RE);
  if (!r) return { kind: 'still-open' };
  if (/^N\/A$/i.test(r[2])) return { kind: 'unsold' };
  const amount = numOrNull(r[2]);
  if (amount == null) return { kind: 'unsold' };
  const b = t.match(BIDS_RE);
  const e = t.match(EST_RE);
  return {
    kind: 'sold',
    amount,
    symbol: r[1] || null,
    bids: b ? parseInt(b[1], 10) : null,
    estLow: e ? numOrNull(e[2]) : null,
    estHigh: e ? numOrNull(e[4]) : null,
    estSymbol: e ? (e[1] || e[3] || null) : null,
  };
}

export interface StrutsHeader { saleName: string | null; saleNo: string | null; saleDate: string | null; lotNumber: string | null; title: string | null; }

/** Two markup generations live in the archive; both sit under `div.tle-lot`.
 *  gen1: `<h3> NAME <span class="sale-no">(#23)</span><span class="sale-date">…`
 *  gen2: `<span class="sale-name">NAME</span><span class="sale-no">…<span class="start-end-dates">…`
 *  A date RANGE ("A - B") dates the lot on its END. */
export function readHeader(html: string): StrutsHeader {
  const out: StrutsHeader = { saleName: null, saleNo: null, saleDate: null, lotNumber: null, title: null };
  const i = html.search(/class="tle-lot"/i);
  if (i < 0) return out;
  const win = html.slice(i, i + 3000);
  // the lot line is the LAST <h3> in the block that names a lot number — gen1
  // nests the sale header in its own <h3> first, gen2 in a whole <section>, so
  // "the first <h3>" is the sale, never the lot.
  let head = win, lotLine = '';
  for (const m of Array.from(win.matchAll(/<h3[^>]*>([\s\S]{0,800}?)<\/h3>/gi))) {
    if (/Lot\s*#/i.test(m[1])) { lotLine = m[1]; head = win.slice(0, m.index ?? 0); }
  }
  const no = head.match(/class="sale-no">\(#(\w+)\)/i);
  out.saleNo = no ? no[1] : null;
  const named = head.match(/class="sale-name">([\s\S]{0,300}?)<\/span>/i);
  if (named) out.saleName = stripTags(named[1]) || null;
  else {
    const pre = head.split(/<span class="sale-no">/i)[0];
    const h3 = pre.match(/<h3[^>]*>([\s\S]*)$/i);
    out.saleName = stripTags(h3 ? h3[1] : pre) || null;
  }
  const d = head.match(/class="(?:sale-date|start-end-dates)">([\s\S]{0,220}?)<\/span>/i);
  if (d) {
    const txt = stripTags(d[1]);
    const days = Array.from(txt.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g));
    const last = days[days.length - 1];   // a range dates on its END
    if (last) out.saleDate = `${last[3]}-${last[1]}-${last[2]}`;
  }
  const ln = lotLine.match(/Lot\s*#\s*([\w.-]+)/i);
  out.lotNumber = ln ? ln[1] : null;
  const nm = lotLine.match(/class="lot-name">([\s\S]*?)<\/span>/i);
  out.title = nm ? stripTags(nm[1]) || null : null;
  if (!out.title) {
    const t = html.match(/<title>([^<]{3,300})<\/title>/i);
    out.title = t ? decodeHtml(t[1]).trim() || null : null;
  }
  return out;
}

/** The body copy, capped — used for the auth read and the description field. */
export function readDescription(html: string): string {
  const m = html.match(/class="lot-desc[^"]*"[^>]*>([\s\S]{0,6000}?)<\/div>/i)
    || html.match(/class="auc_info_txt"[^>]*>([\s\S]{0,6000}?)<\/div>/i)
    || html.match(/class="expert-?notes?[^"]*"[^>]*>([\s\S]{0,6000}?)<\/div>/i);
  if (m) return stripTags(m[1]).slice(0, 4000);
  // fallback: everything between the close block and the "Tell a friend" links
  const i = html.search(/class="message-closed"/i);
  const j = html.search(/Tell a friend/i);
  if (i > 0 && j > i) return stripTags(html.slice(i, j)).slice(0, 4000);
  return '';
}

// ── money (dated FX, hammer basis) ───────────────────────────────────────────
/** The hammer-basis mirror of resolve-phillips' stampSold: the printed figure
 *  is the winning bid, the premium is added on top by the house, so the hammer
 *  fields are populated and the premium-inclusive ones stay null. */
export function stampHammerFx(
  cur: Currency, saleDate: string, hammerNative: number,
  estLowNative: number | null, estHighNative: number | null,
) {
  const { rate, asOf } = fxRateFor(cur, saleDate);
  const conv = (n: number | null) => toUsdDated(n, cur, saleDate).usd;
  const hammerUsd = conv(hammerNative);
  const estLowUsd = conv(estLowNative), estHighUsd = conv(estHighNative);
  return {
    nativeCurrency: cur,
    hammerNative, premiumNative: null, realizedNative: hammerNative,
    buyerPremiumPct: null,
    fxRate: rate, fxAsOf: asOf,
    hammerUsd, premiumUsd: null, realizedUsd: hammerUsd,
    estLowNative, estHighNative, estLowUsd, estHighUsd,
    priceBasis: 'hammer' as PriceBasis,
    currency: cur, estimateLow: estLowUsd, estimateHigh: estHighUsd,
    hammerPrice: hammerNative, premiumPrice: null, priceUsd: hammerUsd,
  };
}

// ── the lot parser ───────────────────────────────────────────────────────────

export type ParseReason = 'sold' | 'unsold' | 'still-open' | 'header-miss' | 'no-date' | 'no-currency' | 'future-date';
export interface ParseResult { lot: AuctionLot | null; reason: ParseReason; }

const TODAY = new Date().toISOString().slice(0, 10);

export function parseStrutsLot(cfg: StrutsHouse, html: string, catalogId: string, lotId: string): ParseResult {
  const close = readClose(html);
  if (close.kind !== 'sold') return { lot: null, reason: close.kind };
  const h = readHeader(html);
  if (!h.title) return { lot: null, reason: 'header-miss' };
  if (!h.saleDate) return { lot: null, reason: 'no-date' };
  if (h.saleDate > TODAY) return { lot: null, reason: 'future-date' };

  // currency: the figure's own symbol, then the estimate's, then the house
  // default — Propstore has none, so an unmarked Propstore figure is REFUSED
  // rather than coin-flipped between USD and GBP.
  const sym = close.symbol || close.estSymbol;
  const cur = sym ? SYMBOL_CUR[sym] : cfg.defaultCurrency;
  if (!cur) return { lot: null, reason: 'no-currency' };

  const description = readDescription(html);
  const base = classifySports('', h.title);
  const cat: SportsCategory = (base === 'autograph' || base === 'other-memorabilia') && POP_RE.test(`${h.title} ${description}`)
    ? 'pop-memorabilia' : base;
  const auth = readAuth(cat, h.title, description);
  // house doctrine: a "signed" lot with no inline provenance/estate paragraph
  // is an untrusted standalone autograph — flagged, never silently trusted
  if (cfg.provenanceGate && cat === 'autograph' && !PROVENANCE_RE.test(`${h.title}\n${description}`)) auth.confidence = 'low';

  const img = html.match(/class="MagicZoom"[^>]*href="([^"]+)"/i) || html.match(/<img[^>]*src="([^"]*\/images\/lot\/[^"]+)"/i);
  const imageUrl = img ? (img[1].startsWith('http') ? img[1] : cfg.host + img[1]) : null;

  const lot = {
    id: `${cfg.idPrefix}-${catalogId}-${lotId}`,
    artist: pseudoArtist(cat),
    title: h.title,
    year: null, medium: null, dimensions: null,
    description: description ? description.slice(0, 1200) : null,
    platform: null,
    category: 'object' as LotCategory,
    imageUrl,
    auctionHouse: cfg.auctionHouse,
    saleName: h.saleName,
    saleDate: h.saleDate,
    lotNumber: h.lotNumber,
    ...stampHammerFx(cur, h.saleDate, close.amount, close.estLow, close.estHigh),
    gradeLabel: auth.grade,
    authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    authConfidence: auth.confidence,
    subCat: cat,
    status: 'sold',
    url: `${cfg.host}/lot-details/index/catalog/${catalogId}/lot/${lotId}`,
    ...(close.bids != null ? { bidCount: close.bids } : {}),
  } as unknown as AuctionLot;
  return { lot, reason: 'sold' };
}
