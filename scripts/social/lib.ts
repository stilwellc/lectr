/**
 * The social desk — data, selection, and the four post types.
 *
 * Everything a post says is read from the SAME served payload the site
 * renders from (public/data/ray/*), after the nightly has published it. The
 * rules that pick a lot are copied from the site's own selectors so a post
 * never names a lot the desk itself would not lead with:
 *
 *   call    → pickCall() in app/components/Terminal.tsx: live, close time
 *             still ahead, confidence ≥ medium, ranked by dealScore, a
 *             photograph preferred within the top eight
 *   receipt → receipts.json: the append-only calls ledger, first call wins,
 *             graded against the hammer. Misses post exactly like hits.
 *   index   → resolveTape() in MarketTape.tsx: repeat-sale over hedonic,
 *             publishable horizons only, the 95% interval always printed
 *   record  → backtest.json: the replayed record, flagged vs unflagged
 *
 * Nothing here invents a number. If a type has no honest candidate tonight
 * the rotation falls through to the next one; if none has, nothing posts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ARTIST_LABEL, ARTIST_MARKET } from '../../app/constants';
import { craftTitle, formatPrice, httpsImg, sizedImg, isLiveUpcoming, trueSaleDay } from '../../app/utils';

export const SITE = 'https://lectr.bid';
export const SERVED = path.join(process.cwd(), 'public', 'data', 'ray');
export const OUT = path.join(process.cwd(), 'public', 'social');

export type PostType = 'call' | 'receipt' | 'index' | 'record';

/** Weekday rotation (UTC). Calls carry the traffic, so they take three days;
 *  the receipt is the trust post and takes two; the two market posts take the
 *  weekend when nothing is closing. */
export const ROTATION: Record<number, PostType> = {
  0: 'record', // Sun
  1: 'call',
  2: 'receipt',
  3: 'call',
  4: 'index',
  5: 'call',
  6: 'receipt',
};
export const FALLBACK: PostType[] = ['call', 'receipt', 'index', 'record'];

// ── data ────────────────────────────────────────────────────────────────────

function readJson<T>(name: string): T | null {
  const p = path.join(SERVED, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

export interface Lot {
  id: string;
  artist: string;
  title: string;
  auctionHouse: string;
  saleDate: string;
  saleDateTime?: string | null;
  status: string;
  resultsPending?: boolean;
  imageUrl?: string | null;
  currency?: string;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  currentBid?: number | null;
  bidCount?: number | null;
  url?: string;
  category?: string;
  subCat?: string;
  value?: { signal?: { beatRatePct?: number } | null; compRatio?: number | null; compValueUsd?: number | null } | null;
  signal?: { label: string; pct: number; basis: number; med: number; confidence?: string } | null;
}

export interface ReceiptRow {
  id: string;
  k: 'card' | 'vsbid' | 'gap' | 'quiet';
  d: string;   // call date
  sd?: string; // sale date
  p: number;   // the call, USD
  r: number;   // the hammer, USD
  f?: number;  // floor / opening ask
  m?: string;  // market
  t: string | null;
  a: string | null; // maker slug
  h: string | null; // house
}

interface Horizon { publishable?: boolean; changePct: number | null; ciLoPct?: number | null; ciHiPct?: number | null; nEnd?: number }
interface Series { period: string; value: number }
interface RepeatSale { basis: string; scope: string | null; nPairs: number; horizons: Record<string, Horizon>; series?: Series[] }
interface Hedonic { horizons: Record<string, Horizon>; series?: Series[] }

export interface Data {
  meta: { lastCrawl: string; totalLots: number; totalSold: number; sources: unknown[] } | null;
  upcoming: Lot[];
  receipts: ReceiptRow[];
  market: { repeatSale?: Record<string, RepeatSale>; hedonic?: Record<string, Hedonic> } | null;
  backtest: {
    generatedAt: string;
    flagged: { n: number; medianPerfPct: number; beatHighPct: number; failToSellPct: number };
    unflagged: { n: number; medianPerfPct: number };
  } | null;
}

export function loadData(): Data {
  const up = readJson<{ lots: Lot[] }>('upcoming.json');
  const rc = readJson<{ rows: ReceiptRow[] }>('receipts.json');
  return {
    meta: readJson('meta.json'),
    upcoming: up?.lots || [],
    receipts: rc?.rows || [],
    market: readJson('market.json'),
    backtest: readJson('backtest.json'),
  };
}

/** What the desk remembers about a lot it flagged — captured the night it
 *  was live, because the served payload drops the photograph once it sells
 *  (sold-ledger-*.json is just id → [price, date]). */
export interface FlagMemory { [id: string]: { image: string; title: string; house: string; artist: string; seen: string } }

/** Tonight's flags, worth remembering. Merged into the R2 memory by render. */
export function rememberFlags(d: Data, memory: FlagMemory): FlagMemory {
  const today = new Date().toISOString().slice(0, 10);
  for (const l of d.upcoming) {
    if (!l.imageUrl || !l.signal || l.signal.label !== 'Below Market') continue;
    if (!memory[l.id]) memory[l.id] = { image: l.imageUrl, title: l.title, house: l.auctionHouse, artist: l.artist, seen: today };
  }
  // forget anything older than a year — the ledger only grades within that
  const cut = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  for (const id of Object.keys(memory)) if (memory[id].seen < cut) delete memory[id];
  return memory;
}

/** Find a lot by id — in tonight's live book, then the flag memory, then the
 *  sold shards (streamed, first hit wins). */
export function findInCorpus(id: string, d?: Data, memory?: FlagMemory): Lot | null {
  const live = d?.upcoming.find(l => l.id === id);
  if (live) return live;
  const m = memory?.[id];
  if (m) return { id, artist: m.artist, title: m.title, auctionHouse: m.house, saleDate: '', status: 'sold', imageUrl: m.image };
  const files = fs.readdirSync(SERVED).filter(f => /^lots-\d+\.json$/.test(f)).sort();
  for (const f of files) {
    const rows = JSON.parse(fs.readFileSync(path.join(SERVED, f), 'utf8')) as Lot[];
    const hit = rows.find(l => l.id === id);
    if (hit) return hit;
  }
  return null;
}

// ── the site's own rules, copied verbatim ───────────────────────────────────

const CONF_RANK: Record<string, number> = { 'very-high': 3, high: 2, medium: 1, low: 0 };

/** app/lib/comps.ts dealScore — THE ONE RANKING */
export function dealScore(lot: Lot, signalPct: number): number {
  const br = lot.value?.signal?.beatRatePct ?? 50;
  return br * 1000 + Math.min(signalPct, 400);
}

/** app/preview/terminal/TonightsWall.tsx gapMultiple */
export function gapMultiple(pct: number): string {
  return pct > 400 ? '5×+' : `${(pct / 100 + 1).toFixed(1)}×`;
}

const BUCKET = /-cards$|^cards$|^misc/;
export const makerLabel = (slug: string): string => ARTIST_LABEL[slug] || slug;
/** The line above the title. A real maker's name — or, for the generic card
 *  buckets, the house and the market, which is what the reader actually
 *  learns from it. */
export function makerLine(slug: string, house: string | null | undefined, market?: string | null): string {
  if (BUCKET.test(slug)) return [house, market ? marketLabel(market) : null].filter(Boolean).join(' · ');
  return makerLabel(slug);
}
/** Titles on a card have one line and a half; the house's full listing title
 *  does not. */
export const shortTitle = (t: string, max = 110): string => (t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');
export const marketOf = (slug: string): string => ARTIST_MARKET[slug] || 'all';

const MARKET_LABEL: Record<string, string> = {
  art: 'Art', design: 'Design', watches: 'Watches', sports: 'Sports', tcg: 'TCG', science: 'Science', culture: 'Pop Culture', all: 'The book',
};
export const marketLabel = (m: string): string => MARKET_LABEL[m] || m;

// ── candidates ──────────────────────────────────────────────────────────────

export interface CallPost {
  type: 'call';
  key: string;
  lot: Lot;
  pct: number;
  multiple: string;
  med: number;      // comps median, USD
  askUsd: number;   // the engine's own USD read of the ask
  estimate: string | null; // the house's printed estimate, native currency
  basis: number;
  maker: string;
  title: string;
  closes: string;   // ISO or date-only
  url: string;
}

export function pickCall(d: Data, exclude: Set<string>): CallPost | null {
  const today = new Date().toISOString().slice(0, 10);
  const deals = d.upcoming
    .filter(l => isLiveUpcoming(l, today) && !l.resultsPending && (!l.saleDateTime || Date.parse(l.saleDateTime) > Date.now()))
    .filter(l => l.signal && l.signal.label === 'Below Market' && CONF_RANK[l.signal.confidence || 'low'] >= 1)
    .filter(l => !exclude.has(l.id))
    .sort((a, b) => dealScore(b, b.signal!.pct) - dealScore(a, a.signal!.pct));
  const lot = deals.slice(0, 8).find(l => l.imageUrl) || deals[0];
  if (!lot || !lot.signal) return null;
  const pct = lot.signal.pct;
  const med = lot.signal.med;
  return {
    type: 'call',
    key: lot.id,
    lot,
    pct,
    multiple: gapMultiple(pct),
    med,
    askUsd: Math.round(med / (pct / 100 + 1)),
    estimate: houseEstimate(lot),
    basis: lot.signal.basis,
    maker: makerLine(lot.artist, lot.auctionHouse, marketOf(lot.artist)),
    title: shortTitle(craftTitle(lot.title)),
    closes: lot.saleDateTime || trueSaleDay(lot),
    url: `${SITE}/lot/${encodeURIComponent(lot.id)}`,
  };
}

export interface ReceiptPost {
  type: 'receipt';
  key: string;
  row: ReceiptRow;
  lot: Lot | null;
  maker: string;
  title: string;
  deltaPct: number;   // hammer vs call
  hit: boolean;       // within the record's own ±30% band
  url: string;
}

export function pickReceipt(d: Data, exclude: Set<string>, memory: FlagMemory = {}): ReceiptPost | null {
  // The comp-flag lane only ('card') — the one lane the site certifies; the
  // bid-projection and gap lanes are still accruing receipts and do not
  // belong in a post (app/lib/lanes.ts). One row per lot, earliest call
  // wins, exactly as the ledger grades it. Newest settled first; prefer one
  // we can photograph.
  const byId = new Map<string, ReceiptRow>();
  for (const r of d.receipts) {
    if (r.k !== 'card' || !(r.p > 0 && r.r > 0)) continue;
    const prev = byId.get(r.id);
    if (!prev || r.d < prev.d) byId.set(r.id, r);
  }
  const rows = Array.from(byId.values())
    .filter(r => !exclude.has(`receipt:${r.id}`))
    .sort((a, b) => (b.sd || b.d).localeCompare(a.sd || a.d))
    .slice(0, 12);
  const build = (row: ReceiptRow, lot: Lot | null): ReceiptPost => {
    const deltaPct = Math.round((row.r / row.p - 1) * 100);
    return {
      type: 'receipt',
      key: `receipt:${row.id}`,
      row,
      lot,
      maker: makerLine(row.a || lot?.artist || '', row.h || lot?.auctionHouse, row.m),
      title: shortTitle(craftTitle(row.t || lot?.title || '')),
      deltaPct,
      hit: Math.abs(deltaPct) <= 30,
      url: `${SITE}/receipts`,
    };
  };
  const found = rows.map(row => ({ row, lot: findInCorpus(row.id, d, memory) }));
  const withPhoto = found.find(x => x.lot?.imageUrl);
  if (withPhoto) return build(withPhoto.row, withPhoto.lot);
  return found[0] ? build(found[0].row, found[0].lot) : null;
}

export interface IndexPost {
  type: 'index';
  key: string;
  market: string;
  method: 'repeat-sale' | 'hedonic';
  basis: string;
  horizon: string;
  changePct: number;
  ciLo: number;
  ciHi: number;
  n: number;
  nLabel: string;
  series: number[]; // the index line, oldest → newest
  url: string;
}

const RS_PREF = ['5Y', '3Y', '1Y'];
const H_PREF = ['1Y', '3Y', '5Y'];

/** One publishable market number per market, resolveTape's ladder; the post
 *  takes the market least recently posted. */
export function pickIndex(d: Data, exclude: Set<string>): IndexPost | null {
  if (!d.market) return null;
  const out: IndexPost[] = [];
  for (const m of ['watches', 'sports', 'art', 'tcg', 'design', 'science', 'culture']) {
    const rs = d.market.repeatSale?.[m];
    const hd = d.market.hedonic?.[m];
    const unscopedHedonic = !!hd && H_PREF.some(h => hd.horizons?.[h]?.publishable && hd.horizons[h].changePct != null);
    let row: IndexPost | null = null;
    if (rs && !(rs.scope && unscopedHedonic)) {
      for (const h of RS_PREF) {
        const x = rs.horizons?.[h];
        if (x?.publishable && x.changePct != null) {
          row = { type: 'index', key: `index:${m}:${h}`, market: m, method: 'repeat-sale', basis: rs.basis + (rs.scope ? ` · ${rs.scope}` : ''), horizon: h, changePct: x.changePct, ciLo: x.ciLoPct ?? x.changePct, ciHi: x.ciHiPct ?? x.changePct, n: rs.nPairs, nLabel: 'pairs', series: (rs.series || []).map(x => x.value), url: `${SITE}/analytics` };
          break;
        }
      }
    }
    if (!row && hd) {
      for (const h of H_PREF) {
        const x = hd.horizons?.[h];
        if (x?.publishable && x.changePct != null) {
          row = { type: 'index', key: `index:${m}:${h}`, market: m, method: 'hedonic', basis: 'like-for-like, mix held constant', horizon: h, changePct: x.changePct, ciLo: x.ciLoPct ?? x.changePct, ciHi: x.ciHiPct ?? x.changePct, n: x.nEnd || 0, nLabel: 'lots', series: (hd.series || []).map(x => x.value), url: `${SITE}/analytics` };
          break;
        }
      }
    }
    if (row && !exclude.has(row.key)) out.push(row);
  }
  return out[0] || null;
}

export interface RecordPost {
  type: 'record';
  key: string;
  n: number;
  flaggedMedianPct: number;
  unflaggedMedianPct: number;
  beatHighPct: number;
  failToSellPct: number;
  asOf: string;
  url: string;
}

export function pickRecord(d: Data, exclude: Set<string>): RecordPost | null {
  const b = d.backtest;
  if (!b || !b.flagged || b.flagged.n < 1000) return null;
  const key = `record:${b.generatedAt}`;
  if (exclude.has(key)) return null;
  return {
    type: 'record',
    key,
    n: b.flagged.n,
    flaggedMedianPct: b.flagged.medianPerfPct,
    unflaggedMedianPct: b.unflagged.medianPerfPct,
    beatHighPct: b.flagged.beatHighPct,
    failToSellPct: b.flagged.failToSellPct,
    asOf: b.generatedAt,
    url: `${SITE}/receipts`,
  };
}

export type Post = CallPost | ReceiptPost | IndexPost | RecordPost;

export function pickTonight(d: Data, exclude: Set<string>, force?: PostType, memory: FlagMemory = {}): Post | null {
  const want = force || ROTATION[new Date().getUTCDay()];
  const order = [want, ...FALLBACK.filter(t => t !== want)];
  for (const t of order) {
    const p =
      t === 'call' ? pickCall(d, exclude) :
      t === 'receipt' ? pickReceipt(d, exclude, memory) :
      t === 'index' ? pickIndex(d, exclude) :
      pickRecord(d, exclude);
    if (p) return p;
  }
  return null;
}

// ── formatting shared by copy + cards ───────────────────────────────────────

/** Exact dollars below six figures — a receipt is a receipt, and a comps
 *  median of $3,500 is not "$4K". Above that the site's own rounding. */
export const money = (n: number): string => (n < 100_000 ? `$${Math.round(n).toLocaleString('en-US')}` : formatPrice(n));

const SYM: Record<string, string> = { USD: '$', GBP: '£', EUR: '€', CHF: 'CHF ', HKD: 'HK$', AUD: 'A$', CAD: 'C$', JPY: '¥', SGD: 'S$' };
/** The house's own printed estimate, in its own currency — "$600–800", "£39,000–65,000". */
export function houseEstimate(l: Lot): string | null {
  if (!l.estimateLow) return null;
  const sym = SYM[l.currency || 'USD'] ?? `${l.currency} `;
  const f = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return l.estimateHigh && l.estimateHigh > l.estimateLow ? `${sym}${f(l.estimateLow)}–${f(l.estimateHigh)}` : `${sym}${f(l.estimateLow)}`;
}
export const signed = (n: number, digits = 0): string => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`;

export function whenLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const hasTime = iso.length > 10;
  // a date-only string is a calendar day, not an instant — never shift it
  if (!hasTime) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return `${day}, ${time} ET`;
}

/** Fetch a house photograph as a data URI for satori. Real Chrome UA — the
 *  house CDNs refuse a bare fetch. Returns null on webp/gif/anything satori
 *  cannot decode, so the card falls back to its type-only layout. */
export async function imageDataUri(url: string | null | undefined, width = 1200): Promise<string | null> {
  const u = httpsImg(sizedImg(url || undefined, width) || url || undefined);
  if (!u) return null;
  try {
    const r = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    if (!isJpeg && !isPng) return null;
    return `data:image/${isJpeg ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
