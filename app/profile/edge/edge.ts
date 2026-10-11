/**
 * YOUR EDGE — the record deep-dive (THE DESK v3 §9, Oct 11 2026). Pure
 * reads over the desk's saves: the reader's CALLS against the hammer.
 *
 * THE CALL (the signed-signal law, app/lib/account signalCallOf): a call is
 * the engine's signal as it stood when the reader saved the lot — "comps sit
 * pct% above the ask" (Below Market, saved as +pct) or below it (Above
 * Market, −pct). Saves from before the signed convention carry no direction
 * and are never graded; a save with no signal at save time is not a call.
 *
 * THE GRADE, one yardstick for every number here:
 *   called  = estimate midpoint × (1 + call/100)   — where the call put the hammer
 *   miss    = realized ÷ called − 1                — how far the hammer landed off it
 *   hit     = |miss| ≤ EDGE_HIT_PCT                — within ±20% of the call
 *   side    = the hammer vs the estimate midpoint carries the call's sign
 * `realized` is the lot's recorded price exactly as the Record section reads
 * it (utils.overEstimatePct's basis: the published sold price, premium
 * included where the house includes it) — the desk's one "vs est".
 *
 * Every median prints with its n and only at EDGE_MIN_N; a month with fewer
 * calls is a gap, not a zero. Nothing here is fetched: inputs are the desk's
 * saves, their save-time meta, and the sold ledger (a ledger result flagged
 * provisional is labelled so on its row).
 */
import type { AuctionLot } from '../../types';
import type { SavedMeta } from '../../lib/account';
import { signalCallOf } from '../../lib/account';
import type { LedgerEntry } from '../../hooks/useRayData';
import { idAliases } from '../../lib/recs';
import { marketOf, MARKETS, type Market } from '../../constants';
import { lotFace } from '../../lib/lot-face';
import { displayMakerOf } from '../../lib/maker-subjects';
import { median, overEstimatePct } from '../../utils';

/** the record line prints at this many graded calls (one call is luck) */
export const EDGE_MIN_N = 3;
/** a hit: the hammer landed within ±this % of the called price */
export const EDGE_HIT_PCT = 20;
/** the monthly series: this many calendar months ending in the desk's month */
export const EDGE_MONTHS = 6;

export type CallDir = 'below' | 'above';

export interface GradedCall {
  id: string;
  title: string;
  maker: string | null;
  house: string;
  market: Market;
  marketLabel: string;
  /** the call's direction at save time */
  dir: CallDir;
  /** the signed call: +pct = comps sat pct% above the ask (Below Market) */
  callPct: number;
  /** the estimate midpoint the call was made against */
  estMid: number;
  /** where the call put the hammer (estMid × (1 + callPct/100)) */
  called: number;
  /** the recorded sold price (the Record's basis) */
  price: number;
  /** YYYY-MM-DD of the hammer */
  date: string;
  /** the result came from a ledger row the house has not finalised */
  provisional: boolean;
  /** realized vs called, % — the one miss figure */
  missPct: number;
  hit: boolean;
  /** the hammer landed on the side of the estimate the call named */
  side: boolean;
  /** the engine's read of the lot as it stands now (null: no read) */
  engine: CallDir | null;
  /** engine read now agrees with the saved call (null: no engine read) */
  agree: boolean | null;
}

export interface MarketRow {
  market: Market | 'all';
  label: string;
  n: number;
  /** median miss %, null under EDGE_MIN_N */
  medianMiss: number | null;
  hits: number;
  /** hits / n, null at n = 0 */
  hitRate: number | null;
  /** the sign of the median miss: hammers ran above / below your calls */
  bias: 'above' | 'below' | 'even' | null;
}

export interface MonthPoint {
  key: string;    // YYYY-MM
  label: string;  // "May"
  n: number;
  hits: number;
  /** median miss %, null under EDGE_MIN_N (a gap, not a zero) */
  medianMiss: number | null;
}

/** settled saves that could not be graded, and why */
export interface Excluded {
  /** settled with no signal at save time (not a call) */
  noCall: number;
  /** settled, saved before the signed convention — direction lost */
  legacy: number;
  /** a call, but no estimate anywhere to grade it against */
  noEstimate: number;
}

export interface EdgeReport {
  /** every graded call, hammer order (oldest first) */
  graded: GradedCall[];
  n: number;
  /** the desk's settled saves (graded or not) */
  settled: number;
  excluded: Excluded;
  provisional: number;
  all: MarketRow;
  markets: MarketRow[];
  streak: { current: number; best: number };
  best: GradedCall | null;
  worst: GradedCall | null;
  /** engine agreement: of the graded calls the engine still reads, how many
   *  it reads on the saved side */
  agreement: { agree: number; n: number };
  months: MonthPoint[];
  /** the Record section's own number, for the card: median realized vs
   *  estimate over every settled save with an estimate (not only calls) */
  record: { n: number; med: number | null };
}

export interface EdgeInputs {
  now: number;
  saved: readonly AuctionLot[];
  metaFor: (lotId: string) => SavedMeta | null;
  ledger: ReadonlyMap<string, LedgerEntry>;
}

/** local calendar day of a clock reading (the desk's one clock) */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Settled { price: number; date: string; provisional: boolean }

/** a save's result: the resolved row's own sold price, else the ledger's
 *  (walking the same id aliases the desk resolves saves through) */
export function settledOf(lot: AuctionLot, ledger: ReadonlyMap<string, LedgerEntry>): Settled | null {
  if (lot.status === 'sold' && (lot.priceUsd || 0) > 0) {
    return { price: lot.priceUsd!, date: (lot.saleDate || '').slice(0, 10), provisional: false };
  }
  for (const a of idAliases(lot.id)) {
    const e = ledger.get(a);
    if (e && e[0] > 0) return { price: e[0], date: (e[1] || '').slice(0, 10), provisional: e[2] === 1 };
  }
  return null;
}

/** the estimate midpoint the call is graded against: the lot's own, else
 *  the midpoint recorded at save time */
export function estMidFor(lot: AuctionLot, meta: SavedMeta | null): number | null {
  const lo = lot.estimateLow || lot.estimateHigh || 0;
  const hi = lot.estimateHigh || lot.estimateLow || 0;
  const mid = (lo + hi) / 2;
  if (mid > 0) return mid;
  return meta?.estMid && meta.estMid > 0 ? meta.estMid : null;
}

const engineDirOf = (lot: AuctionLot): CallDir | null => {
  const label = lotFace(lot).call?.label;
  return label === 'Below Market' ? 'below' : label === 'Above Market' ? 'above' : null;
};

const marketLabelOf = (m: Market) => MARKETS.find(x => x.key === m)?.label ?? m;

function rowOf(market: Market | 'all', label: string, calls: readonly GradedCall[]): MarketRow {
  const n = calls.length;
  const hits = calls.filter(c => c.hit).length;
  const med = n >= EDGE_MIN_N ? median(calls.map(c => c.missPct)) : null;
  return {
    market, label, n, hits,
    medianMiss: med,
    hitRate: n ? hits / n : null,
    bias: med == null ? null : Math.round(med) > 0 ? 'above' : Math.round(med) < 0 ? 'below' : 'even',
  };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** the last EDGE_MONTHS calendar months ending in the clock's month */
export function monthKeys(now: number, months = EDGE_MONTHS): { key: string; label: string }[] {
  const d = new Date(now);
  const out: { key: string; label: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: MONTH_SHORT[m.getMonth()] });
  }
  return out;
}

export function gradeDesk(input: EdgeInputs): EdgeReport {
  const today = dayOf(input.now);
  const graded: GradedCall[] = [];
  const excluded: Excluded = { noCall: 0, legacy: 0, noEstimate: 0 };
  let settled = 0;
  const judged: number[] = [];

  for (const lot of input.saved) {
    const s = settledOf(lot, input.ledger);
    if (!s || (s.date && s.date > today)) continue;
    settled++;
    const meta = input.metaFor(lot.id);
    // the Record's own judgment, exactly as /profile's Record computes it:
    // every settled save with the lot's own estimate, realized vs midpoint
    const over = overEstimatePct({ ...lot, priceUsd: s.price });
    if (over != null) judged.push(over);
    const mid = estMidFor(lot, meta);

    const call = signalCallOf(meta ?? undefined);
    if (!call) { excluded.noCall++; continue; }
    if (call.dir === 'unknown') { excluded.legacy++; continue; }
    if (!mid) { excluded.noEstimate++; continue; }
    const callPct = call.dir === 'below' ? call.pct : -call.pct;
    const called = mid * (1 + callPct / 100);
    const missPct = (s.price / called - 1) * 100;
    const vsEst = s.price / mid - 1;
    const engine = engineDirOf(lot);
    const market = marketOf(lot.artist);
    graded.push({
      id: lot.id,
      title: lot.title,
      maker: displayMakerOf(lot)?.name ?? null,
      house: lot.auctionHouse,
      market,
      marketLabel: marketLabelOf(market),
      dir: call.dir,
      callPct,
      estMid: mid,
      called,
      price: s.price,
      date: s.date,
      provisional: s.provisional,
      missPct,
      hit: Math.abs(missPct) <= EDGE_HIT_PCT,
      side: callPct > 0 ? vsEst > 0 : vsEst < 0,
      engine,
      agree: engine == null ? null : engine === call.dir,
    });
  }

  graded.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));

  // streaks: hits in a row, hammer order; current = the trailing run
  let best = 0, run = 0;
  for (const c of graded) { run = c.hit ? run + 1 : 0; if (run > best) best = run; }
  let current = 0;
  for (let i = graded.length - 1; i >= 0 && graded[i].hit; i--) current++;

  const byMarket = new Map<Market, GradedCall[]>();
  for (const c of graded) { const l = byMarket.get(c.market) ?? []; l.push(c); byMarket.set(c.market, l); }
  const markets = Array.from(byMarket.entries())
    .map(([m, calls]) => rowOf(m, marketLabelOf(m), calls))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));

  const byAbs = graded.slice().sort((a, b) => Math.abs(a.missPct) - Math.abs(b.missPct));
  const read = graded.filter(c => c.agree != null);

  const months = monthKeys(input.now).map(({ key, label }) => {
    const calls = graded.filter(c => c.date.slice(0, 7) === key);
    return {
      key, label, n: calls.length,
      hits: calls.filter(c => c.hit).length,
      medianMiss: calls.length >= EDGE_MIN_N ? median(calls.map(c => c.missPct)) : null,
    };
  });

  return {
    graded,
    n: graded.length,
    settled,
    excluded,
    provisional: graded.filter(c => c.provisional).length,
    all: rowOf('all', 'All markets', graded),
    markets,
    streak: { current, best },
    best: byAbs[0] ?? null,
    worst: byAbs.length > 1 ? byAbs[byAbs.length - 1] : null,
    agreement: { agree: read.filter(c => c.agree).length, n: read.length },
    months,
    record: { n: judged.length, med: judged.length ? median(judged) : null },
  };
}

/** "hammers ran 8% above your calls" — the bias in words, n-gated */
export function biasText(row: MarketRow): string | null {
  if (row.medianMiss == null || row.bias == null) return null;
  const m = Math.abs(Math.round(row.medianMiss));
  if (row.bias === 'even') return 'hammers landed on your calls';
  return `hammers ran ${m}% ${row.bias} your calls`;
}
