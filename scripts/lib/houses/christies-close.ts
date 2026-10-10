/**
 * Christie's ONLINE-sale close times — the onlineonly enrichment.
 * (Companion to enrichSothebysCloseTimes; see docs/christies-onlineonly-dates.md.)
 *
 * www.christies.com is STALE for online-only ("First Open" / onlineonly)
 * sales: it can report a live sale as over with years-old dates. The real
 * per-lot close lives on onlineonly.christies.com, reachable through the SSO
 * url each online lot carries:
 *
 *   https://onlineonly.christies.com/sso?ObjectID=24498.339&LotNumber=339
 *     302 → https://onlineonly.christies.com/s/photographs/andy-warhol-1928-1987-339/326588
 *
 * The lot page embeds `window.chrComponents` (probed Oct 10 2026):
 *
 *   lots.data.lots[0]      THIS lot: analytics_id "24498.339" (= the SSO
 *                          ObjectID), object_id "326588" (= the /s/ url tail),
 *                          lot_id_txt "339", event_type "OnlineSale",
 *                          end_date "2026-10-23T17:17:00.000Z"  ← the close
 *   lots.data.lots[0].sale the SALE block: end_date "2026-10-23T11:00:00.000Z"
 *                          (when lots BEGIN closing — not this lot's close)
 *   moreFrom.data.lots[]   neighbours, each with their own staggered end_date
 *
 * So the page carries a dozen end_dates; "first match on the page" is not this
 * lot's close. parseChristiesOnlineClose keys the read to THIS lot (analytics_id
 * / object_id / lot number) and fails closed when it cannot.
 *
 * A dated lot is stamped saleDateTime (full ISO, Z) + closeKind 'online' (the
 * end_date is the lot's own staggered close, so house-tz's 3h online slack —
 * not the 8h unmarked default — governs when it stops reading live), and its
 * saleDate becomes the sale-location day.
 *
 * HARD RULE: accuracy never costs a lot. An unreachable lot, a non-200, a page
 * without this lot's end_date — all keep the lot's existing date and status.
 * Best-effort, capped, concurrency-limited, wall-clock budgeted. Runs inside the
 * nightly crawl on GitHub Actions only (never serverless).
 */
import type { AuctionLot } from '../../../app/types';
import { fetchWithRetry } from '../fetch-retry';
import { saleDayOf } from '../sale-day';
import { RESULT_PENDING_MS } from '../skip-set';
import { UA, balancedObjectAfter, sleep } from './common';

const ONLINEONLY_RE = /^https?:\/\/onlineonly\.christies\.com\//i;

export function isChristiesOnlineUrl(url: string | null | undefined): boolean {
  return !!url && ONLINEONLY_RE.test(url);
}

/** What identifies the lot on its onlineonly page. */
export interface ChristiesOnlineKey {
  /** the SSO ObjectID ("24498.339") — the page's `analytics_id` */
  analyticsId?: string;
  /** the /s/<slug>/<id> tail ("326588") — the page's `object_id` */
  objectId?: string;
  /** the SSO LotNumber ("339") — the page's `lot_id_txt` */
  lotNumber?: string;
}

/** Keys from the lot's url and (after the SSO 302) the page's final url. */
export function christiesOnlineKey(url: string, finalUrl?: string | null): ChristiesOnlineKey {
  const key: ChristiesOnlineKey = {};
  for (const u of [url, finalUrl]) {
    if (!u) continue;
    let p: URL;
    try { p = new URL(u); } catch { continue; }
    const oid = p.searchParams.get('ObjectID') || p.searchParams.get('objectid');
    if (oid && !key.analyticsId) key.analyticsId = oid;
    const ln = p.searchParams.get('LotNumber') || p.searchParams.get('lotnumber');
    if (ln && !key.lotNumber) key.lotNumber = ln;
    const tail = /^\/s\/[^/]+\/[^/]+\/(\d+)\/?$/.exec(p.pathname);
    if (tail && !key.objectId) key.objectId = tail[1];
  }
  return key;
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

function lotMatches(o: Record<string, unknown>, key: ChristiesOnlineKey): boolean {
  if (key.analyticsId && o.analytics_id != null) return String(o.analytics_id) === key.analyticsId;
  if (key.objectId && o.object_id != null) return String(o.object_id) === key.objectId;
  return false;
}

/** Every object in the tree carrying this lot's identity and an end_date. */
function findLotObjects(root: unknown, key: ChristiesOnlineKey): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const stack: unknown[] = [root];
  while (stack.length) {
    const x = stack.pop();
    if (Array.isArray(x)) { for (const v of x) stack.push(v); continue; }
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if ('end_date' in o && lotMatches(o, key)) out.push(o);
    for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
  }
  return out;
}

/**
 * THIS lot's close instant (ISO, Z) from its onlineonly page, or null.
 * Only the lot's own object counts — never the sale block's end_date nor a
 * neighbour's. A lot-number fallback is used only when the page names no
 * analytics_id/object_id match and exactly one lot carries that number.
 */
export function parseChristiesOnlineClose(html: string, key: ChristiesOnlineKey): string | null {
  if (!key.analyticsId && !key.objectId && !key.lotNumber) return null;
  const json = balancedObjectAfter(html, /window\.chrComponents\s*=\s*/);
  if (!json) return null;
  let root: unknown;
  try { root = JSON.parse(json); } catch { return null; }
  let hits = findLotObjects(root, key);
  if (!hits.length && key.lotNumber) {
    const byNum: Record<string, unknown>[] = [];
    const stack: unknown[] = [root];
    while (stack.length) {
      const x = stack.pop();
      if (Array.isArray(x)) { for (const v of x) stack.push(v); continue; }
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      if ('end_date' in o && o.lot_id_txt != null && String(o.lot_id_txt) === key.lotNumber) byNum.push(o);
      for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
    }
    if (byNum.length === 1) hits = byNum;
  }
  const ends = new Set<string>();
  for (const o of hits) {
    const raw = typeof o.end_date === 'string' ? o.end_date.trim() : '';
    if (!ISO_Z.test(raw)) continue;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) continue;
    ends.add(new Date(ms).toISOString());
  }
  // the same lot appearing twice with two different closes is ambiguous → none
  return ends.size === 1 ? Array.from(ends)[0] : null;
}

type StampLot = AuctionLot & { saleDateTime?: string | null; closeKind?: 'online' | 'session' | null; resultsPending?: boolean; nativeCurrency?: string | null };

/**
 * Stamp a lot with its true online close. A future close revives a wrongly-
 * closed (stale-www) lot to upcoming; a past close keeps the status and lets
 * the global sanitize net adjudicate against the TRUE date (held pending
 * inside RESULT_PENDING_MS, settled after). Returns true when it revived.
 */
export function stampChristiesOnlineClose(lot: StampLot, iso: string, nowMs: number): boolean {
  const ms = Date.parse(iso);
  lot.saleDate = saleDayOf("Christie's", iso, { saleName: lot.saleName, currency: lot.nativeCurrency ?? lot.currency }) || iso.slice(0, 10);
  lot.saleDateTime = iso;
  lot.closeKind = 'online';
  if (ms > nowMs) {
    const revived = lot.status !== 'upcoming';
    lot.status = 'upcoming';
    lot.resultsPending = false;
    return revived;
  }
  // a real past close replaces the now-anchor guess: pending only while the
  // results window is open (the sanitize net reads this flag)
  if (lot.status === 'upcoming') lot.resultsPending = nowMs - ms <= RESULT_PENDING_MS;
  return false;
}

export interface ChristiesCloseOpts {
  /** max lots fetched per run (default 1500) */
  cap?: number;
  /** parallel fetches (default 6 — the Sotheby's pass's figure) */
  concurrency?: number;
  /** wall-clock budget; unreached lots keep their state (default 8 min) */
  budgetMs?: number;
  /** per-attempt timeout (default 20s) */
  timeoutMs?: number;
  /** pause between batches (default 120ms) */
  pauseMs?: number;
  nowMs?: number;
  /** test seam */
  fetchImpl?: (url: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>;
}

export interface ChristiesCloseStats {
  targets: number;
  attempted: number;
  dated: number;
  revived: number;
  /** fetch threw / non-200 */
  unreachable: number;
  /** 200, but no end_date keyed to this lot */
  undated: number;
  budgetHit: boolean;
}

/** Non-sold Christie's lots with an onlineonly url — live ones AND corpus rows
 *  the stale www data wrongly closed (the legacy id is not re-produced nightly). */
export function christiesOnlineTargets(lots: Iterable<AuctionLot>): AuctionLot[] {
  const out: AuctionLot[] = [];
  for (const l of Array.from(lots)) if (l.auctionHouse === "Christie's" && l.status !== 'sold' && isChristiesOnlineUrl(l.url)) out.push(l);
  // live first: when the cap or budget bites, it is the corpus rescue that waits
  return out.sort((a, b) => Number(b.status === 'upcoming') - Number(a.status === 'upcoming'));
}

export async function enrichChristiesCloseTimes(lots: Iterable<AuctionLot>, opts: ChristiesCloseOpts = {}): Promise<ChristiesCloseStats> {
  const { cap = 1500, concurrency = 6, budgetMs = 8 * 60_000, timeoutMs = 20_000, pauseMs = 120 } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const doFetch = opts.fetchImpl
    ?? ((url: string, init: RequestInit & { timeoutMs?: number }) => fetchWithRetry(url, init, { retries: 1 }));
  const targets = christiesOnlineTargets(lots);
  const slice = targets.slice(0, cap);
  const stats: ChristiesCloseStats = { targets: targets.length, attempted: 0, dated: 0, revived: 0, unreachable: 0, undated: 0, budgetHit: false };
  const start = Date.now();
  for (let i = 0; i < slice.length; i += concurrency) {
    if (Date.now() - start > budgetMs) {
      stats.budgetHit = true;
      console.log(`  [Christie's] onlineonly budget exhausted at ${i}/${slice.length} — stopping early so the crawl still writes`);
      break;
    }
    await Promise.all(slice.slice(i, i + concurrency).map(async lot => {
      stats.attempted++;
      try {
        const r = await doFetch(lot.url, { headers: { 'User-Agent': UA }, redirect: 'follow', timeoutMs });
        if (!r.ok) { stats.unreachable++; return; }
        const iso = parseChristiesOnlineClose(await r.text(), christiesOnlineKey(lot.url, r.url));
        if (!iso) { stats.undated++; return; }
        stats.dated++;
        if (stampChristiesOnlineClose(lot as StampLot, iso, nowMs)) stats.revived++;
      } catch { stats.unreachable++; /* keep date + status; never drop */ }
    }));
    if (pauseMs > 0 && i + concurrency < slice.length) await sleep(pauseMs);
  }
  if (targets.length) {
    console.log(`  [Christie's] onlineonly: dated ${stats.dated}/${stats.attempted} (of ${targets.length} targets), revived ${stats.revived} wrongly-closed lots to upcoming; ${stats.unreachable} unreachable, ${stats.undated} without a keyed end_date — all kept as-is`);
  }
  return stats;
}
