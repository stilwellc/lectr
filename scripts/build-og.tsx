/**
 * Pre-renders the share cards a static export cannot render per request
 * (Next can't export dynamic-segment metadata images under output:'export',
 * and a static host has no server to draw them per scrape). Card grammar:
 * scripts/og/cards.tsx. Run before `next build` (package.json build script).
 *
 *   public/og/<maker>.png          maker dossiers — name + the verified read
 *                                  (committed, as before)
 *   public/og/live/call-<m>.png    tonight's call, per market ('all' = /value)
 *   public/og/live/record.png      the replayed record (/receipts)
 *   public/og/lot/<id>.png         every static /lot/<id> page — its own call
 *   (live/ and lot/ are build outputs, gitignored — regenerated every build)
 *
 * The call is chosen by the social desk's selector (scripts/social/lib.ts
 * pickCall — the mirror of app/components/Terminal.tsx pickCall), scoped to
 * a vertical exactly as the lander scopes it (the vertical's makers, then
 * lotFitsMarket). Photographs are fetched once with a real Chrome UA and
 * cached under .og-cache/ (gitignored); a photo that will not load drops the
 * plate and the card reflows type-only.
 *
 * OG_LOTS=0 skips the per-lot cards (fast local iteration).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTISTS, MARKETS, marketArtists, marketOf } from '../app/constants';
import { craftTitle, formatPrice, isLiveUpcoming, trueSaleDay } from '../app/utils';
import { lotFitsMarket } from '../app/lib/comps';
import { flaggedLots } from '../app/lot/flagged';
import { loadData, pickCall, imageDataUri, makerLine, shortTitle, type Data, type Lot } from './social/lib';
import { callCard, makerCard, ledgerCard, toPng, type CallCardProps } from './og/cards';
import type { AuctionLot } from '../app/types';
import { marketFacts, fmtExpected, lotNoun } from '../app/lib/og-meta';


const ROOT = process.cwd();
const OG = path.join(ROOT, 'public', 'og');
const CACHE = path.join(ROOT, '.og-cache');

// ── photographs, fetched once ───────────────────────────────────────────────
const RETRY_FAIL_MS = 12 * 3600_000;
async function photo(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.txt');
  if (fs.existsSync(f)) {
    const v = fs.readFileSync(f, 'utf8');
    if (v) return v;
    if (Date.now() - fs.statSync(f).mtimeMs < RETRY_FAIL_MS) return null; // a recent failure
  }
  const v = await imageDataUri(url, 800);
  fs.writeFileSync(f, v || '');
  return v;
}

/** run fn over items, `limit` at a time */
async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

// ── the numbers a call card prints ──────────────────────────────────────────
const expected = fmtExpected;
function estimateRange(lo?: number | null, hi?: number | null): string | null {
  const a = lo || hi, b = hi || lo;
  if (!a || !b) return null;
  if (b < 100_000) return a === b ? `$${a.toLocaleString('en-US')}` : `$${a.toLocaleString('en-US')}–${b.toLocaleString('en-US')}`;
  return a === b ? formatPrice(a) : `${formatPrice(a)}–${formatPrice(b)}`;
}
const CONF_WORD: Record<string, string> = { 'very-high': 'very high confidence', high: 'high confidence', medium: 'medium confidence', low: 'low confidence' };
function hammersLabel(lot: Pick<Lot, 'saleDate' | 'saleDateTime'>): string {
  const day = trueSaleDay(lot as Parameters<typeof trueSaleDay>[0]) || lot.saleDate;
  const t = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(t) ? `hammers ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : 'hammer date to come';
}

type CallLot = Lot & { value?: (Lot['value'] & { compValueUsd?: number | null }) | null; lotNumber?: number | null };
function callProps(lot: CallLot, kicker: string, folio: string, img: string | null): CallCardProps | null {
  const sig = lot.signal;
  const estMid = lot.estimateLow && lot.estimateHigh ? (lot.estimateLow + lot.estimateHigh) / 2 : (lot.estimateLow || lot.estimateHigh || null);
  // X = the engine's prediction; crawl-time signals that carry no value
  // block fall back to the comps median, exactly as CallPlate derives it
  const x = lot.value?.compValueUsd ?? sig?.med ?? (estMid != null && sig ? estMid * (1 + sig.pct / 100) : null);
  if (!x || !Number.isFinite(x)) return null;
  const maker = makerLine(lot.artist, lot.auctionHouse, marketOf(lot.artist));
  return {
    kicker,
    house: lot.auctionHouse,
    houseSays: estimateRange(lot.estimateLow, lot.estimateHigh),
    recordSays: expected(x),
    overPct: estMid ? (x / estMid - 1) * 100 : null,
    maker,
    title: shortTitle(craftTitle(lot.title).replace(new RegExp(`^${maker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:,—–-]\\s*`, 'i'), '').replace(/^["“]([^"”]*)["”]/, '$1'), 70),
    hammers: hammersLabel(lot),
    basis: sig ? `${sig.basis} comparable sale${sig.basis === 1 ? '' : 's'} · ${CONF_WORD[sig.confidence || 'low']}` : 'read from comparable sales',
    photo: img,
    folio,
  };
}

async function write(file: string, res: Parameters<typeof toPng>[0]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await toPng(res));
}

// ── market + maker reads ────────────────────────────────────────────────────
interface Horizon { publishable?: boolean; changePct: number | null; ciLoPct?: number | null; ciHiPct?: number | null; reason?: string }
interface MakerIndex { horizons?: Record<string, Horizon> }
interface MakerStats { totalSoldTracked?: number; recordPrice?: number; recordDate?: string; recordHouse?: string; medianPriceLast12Months?: number }
const HZ_WORD: Record<string, string> = { '1Y': 'over one year', '3Y': 'over three years', '5Y': 'over five years' };
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

async function main() {
  const t0 = Date.now();
  const d: Data = loadData();
  const folio = d.meta?.lastCrawl ? `Read ${d.meta.lastCrawl.slice(0, 10)}` : 'lectr.bid';
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'ray', 'market.json'), 'utf8')) as { makerIndex?: Record<string, MakerIndex> };
  const stats = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'ray', 'stats.json'), 'utf8')) as Record<string, MakerStats>;
  const today = new Date().toISOString().slice(0, 10);
  let photos = 0, misses = 0;
  const shot = async (u?: string | null) => { const v = await photo(u); if (u) (v ? photos++ : misses++); return v; };

  // ── tonight's call, per market ──
  fs.mkdirSync(path.join(OG, 'live'), { recursive: true });
  for (const m of MARKETS) {
    const set = marketArtists(m.key);
    const scoped: Data = m.key === 'all' ? d : { ...d, upcoming: d.upcoming.filter(l => set.has(l.artist) && lotFitsMarket(l as unknown as AuctionLot, m.key)) };
    const call = pickCall(scoped, new Set());
    const file = path.join(OG, 'live', `call-${m.key}.png`);
    const label = m.key === 'all' ? null : m.label;
    const props = call ? callProps(call.lot as CallLot, `Tonight's call${label ? ` · ${label}` : ''}`, folio, await shot(call.lot.imageUrl)) : null;
    if (props) {
      await write(file, callCard(props));
    } else {
      // a quiet vertical: say so, with the counts that are true tonight
      const f = marketFacts(m.key);
      await write(file, ledgerCard({
        kicker: `Tonight · ${m.label}`,
        headline: f.live ? `No ${lotNoun(m.key)} clears the bar tonight.` : `No ${lotNoun(m.key, 2)} on the block tonight.`,
        sub: 'The engine reads each lot on the block against its comparable sales, and prints nothing it cannot stand behind.',
        rows: [
          { k: 'On the block', v: f.live.toLocaleString('en-US') },
          { k: 'Flagged tonight', v: f.flagged.toLocaleString('en-US') },
          ...(f.settled ? [{ k: 'Results on file', v: f.settled.toLocaleString('en-US') }] : []),
        ],
        folio,
      }));
    }
  }

  // ── the record ──
  const bt = d.backtest as (Data['backtest'] & { flagged: { hammerMedianPct?: number; hammerBeatPct?: number }; unflagged: { hammerMedianPct?: number; hammerBeatPct?: number } }) | null;
  if (bt) {
    const rows: { k: string; v: string; dir?: 'up' | 'down' }[] = [];
    if (bt.flagged.hammerMedianPct != null) rows.push({ k: 'Flagged, hammer vs est.', v: pct(bt.flagged.hammerMedianPct).replace('.0%', '%'), dir: bt.flagged.hammerMedianPct >= 0 ? 'up' : 'down' });
    if (bt.unflagged.hammerMedianPct != null) rows.push({ k: 'Unflagged', v: pct(bt.unflagged.hammerMedianPct).replace('.0%', '%'), dir: bt.unflagged.hammerMedianPct >= 0 ? 'up' : 'down' });
    if (bt.flagged.hammerBeatPct != null) rows.push({ k: 'Flags past the high est.', v: `${bt.flagged.hammerBeatPct}%` });
    rows.push({ k: 'Failed to sell', v: `${bt.flagged.failToSellPct}%` });
    await write(path.join(OG, 'live', 'record.png'), ledgerCard({
      kicker: 'The record, replayed',
      headline: `${bt.flagged.n.toLocaleString('en-US')} calls, graded against the hammer.`,
      sub: 'Each flag replayed against the price the lot actually made — misses printed exactly like hits.',
      rows,
      folio,
    }));
  }

  // ── makers ──
  for (const a of ARTISTS) {
    const s = stats[a.slug] || {};
    const hz = market.makerIndex?.[a.slug]?.horizons || {};
    const okH = ['5Y', '3Y', '1Y'].find(h => hz[h]?.publishable && hz[h].changePct != null);
    const read = okH ? {
      line: `${pct(hz[okH].changePct!)} ${HZ_WORD[okH]}, like for like`,
      ci: `95% interval ${pct(hz[okH].ciLoPct ?? hz[okH].changePct!)} to ${pct(hz[okH].ciHiPct ?? hz[okH].changePct!)}`,
      dir: (hz[okH].changePct! >= 0 ? 'up' : 'down') as 'up' | 'down',
    } : null;
    const abstainRaw = hz['5Y']?.reason || hz['3Y']?.reason || hz['1Y']?.reason || '';
    const abstain = /thin/.test(abstainRaw) ? 'too few like-for-like sales to measure'
      : /spans zero/.test(abstainRaw) ? 'the interval still spans zero' : null;
    const yr = s.recordDate ? new Date(s.recordDate).getUTCFullYear() : null;
    const mk = marketOf(a.slug);
    const mLabel = mk === 'tcg' ? 'TCG market' : `${(MARKETS.find(x => x.key === mk)?.label || 'collectibles').toLowerCase()} market`;
    // the face: tonight's best photographed live lot by this maker, flags first
    const live = d.upcoming
      .filter(l => l.artist === a.slug && l.imageUrl && isLiveUpcoming(l, today))
      .sort((x, y) => (y.signal?.label === 'Below Market' ? 1 : 0) - (x.signal?.label === 'Below Market' ? 1 : 0) || (y.estimateHigh || 0) - (x.estimateHigh || 0));
    let img: string | null = null;
    for (const l of live.slice(0, 3)) { img = await shot(l.imageUrl); if (img) break; }
    await write(path.join(OG, `${a.slug}.png`), makerCard({
      name: a.label,
      market: mLabel,
      read,
      abstain,
      sold: s.totalSoldTracked ?? null,
      record: s.recordPrice ? `${formatPrice(s.recordPrice)}${s.recordHouse || yr ? ` · ${[s.recordHouse, yr].filter(Boolean).join(', ')}` : ''}` : null,
      median: s.medianPriceLast12Months ? expected(s.medianPriceLast12Months) : null,
      photo: img,
      folio,
    }));
  }
  const tMakers = Date.now();

  // ── every static lot page: its own call ──
  let lotCards = 0;
  if (process.env.OG_LOTS !== '0') {
    const lots = flaggedLots();
    const dir = path.join(OG, 'lot');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // fetch in parallel (network-bound), render serially (CPU-bound)
    const imgs = new Map<string, string | null>();
    await pool(lots, 16, async l => { imgs.set(l.id, await shot(l.imageUrl)); });
    for (const l of lots) {
      const kicker = `The call${l.lotNumber ? ` · Lot ${l.lotNumber}` : ''} · ${l.auctionHouse}`;
      const props = callProps(l as unknown as CallLot, kicker, folio, imgs.get(l.id) ?? null);
      if (!props) continue;
      await write(path.join(dir, `${l.id}.png`), callCard(props));
      lotCards++;
    }
  }
  const t1 = Date.now();
  console.log(`[og] ${MARKETS.length} call cards + record + ${ARTISTS.length} makers (${((tMakers - t0) / 1000).toFixed(1)}s) · ${lotCards} lot cards (${((t1 - tMakers) / 1000).toFixed(1)}s) · photos ${photos} ok / ${misses} missed`);
}

main().catch(err => { console.error('[og] failed:', err); process.exit(1); });
