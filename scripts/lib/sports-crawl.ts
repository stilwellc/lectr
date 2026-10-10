// Shared helpers for the sports + pop-culture expansion crawlers (REA, Huggins
// & Scott, SCP, Lelands, Memory Lane, Love of the Game, Julien's, Hake's,
// Propstore). Each house's crawler writes an ISOLATED segment; none is wired
// into the nightly matrix or assemble list until it clears verification.
//
// Doctrine gates live here so every house applies them identically:
//  - game-used  → third-party photo-match / MeiGray / Resolution / ResMatch LOA
//  - unopened wax → BBCE authentication
//  - graded cards → PSA / SGC / CGC / BGS slab
//  - autographs → PSA/DNA / JSA / Beckett
// A lot that fails its category's gate is KEPT but stamped authConfidence:'low'
// (Collin: "bring them all in") — the drop-vs-flag threshold is tomorrow's tune.

import { fxRateFor, toUsdDated } from '../../app/lib/normalize';
import { readSegment, writeSegment } from '../corpus-io';
import type { PriceBasis, Currency, AuctionLot } from '../../app/types';
import { leadsWithSetCode } from './set-codes';
import { NON_SPORT_RE, SPORT_WORD_RE, GAME_USED_RE, PUBLICATION_RE, SEALED_PRODUCT_RE, SEALED_NOT_RE, isCardTitle, isPhotoTitle, isPhotographerSigned } from './classify';
import { saleCloseFor, labelStub } from './sale-close-dates';

// Nightly crawls a BOUNDED window; the segment must ACCUMULATE. Read the last-
// good segment, union the fresh lots over it (fresh id wins), write the union.
// A failed/empty crawl therefore leaves the segment intact (never wipes), and
// history grows night over night instead of the window overwriting it.
// Drop lots that would FATAL the write: a future/missing sale date (an
// upcoming or soft-closing auction that isn't settled history yet). One bad
// batch must not kill the whole house — filter, then write the good ones.
const TODAY_ISO = new Date().toISOString().slice(0, 10);
export function settledOnly(lots: AuctionLot[]): { good: AuctionLot[]; dropped: number } {
  const good = lots.filter((l) => {
    const d = (l as { saleDate?: string }).saleDate;
    return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= TODAY_ISO;
  });
  return { good, dropped: lots.length - good.length };
}

// ── BID HISTORY THROUGH SETTLEMENT ──────────────────────────────────────────
// The live leg appends a {d,b,n} snapshot per night; at the close the settled
// record REPLACES the live row by id (fresh id wins). Without a carry the
// snapshots died with the live row — only Goldin (ray-crawl) kept history on
// sold lots, so the nightly close-k fit (scripts/lib/close-k-fit.ts) had no
// own-row history for any sports-crawl house. A settled row now inherits the
// prior row's bidHistory, compacted to the FIRST sighting + the LAST
// SETTLED_SNAP_TAIL (the earliest horizon + the run-in to the close are what
// a days-out fit reads; the middle of a 59-snap trail is weight).
export const SETTLED_SNAP_TAIL = 12;
type Snap = { d: string; b: number; n: number };

/** first + last SETTLED_SNAP_TAIL snapshots (≤ 13), order kept; idempotent */
export function compactBidHistory(hist: Snap[]): Snap[] {
  const h = hist.filter(s => s && typeof s.d === 'string');
  if (h.length <= SETTLED_SNAP_TAIL + 1) return h;
  return [h[0], ...h.slice(-SETTLED_SNAP_TAIL)];
}

/** the settled `fresh` row, carrying `prev`'s bid trail when fresh has none.
 *  Live (upcoming) fresh rows pass through untouched — the live leg owns
 *  their history. A settled fresh row that brings its own bidHistory keeps it
 *  (compacted). */
export function withSettledHistory(fresh: AuctionLot, prev: AuctionLot | undefined): AuctionLot {
  if ((fresh as { status?: string }).status === 'upcoming') return fresh;
  const own = (fresh as { bidHistory?: Snap[] }).bidHistory;
  const carried = Array.isArray(own) && own.length ? own : (prev as { bidHistory?: Snap[] } | undefined)?.bidHistory;
  if (!Array.isArray(carried) || !carried.length) return fresh;
  const bidHistory = compactBidHistory(carried);
  return bidHistory.length ? ({ ...fresh, bidHistory } as AuctionLot) : fresh;
}

export function writeMergedSegment(name: string, fresh: AuctionLot[]): { total: number; added: number } {
  const existing = readSegment(name) as unknown as AuctionLot[];
  const byId = new Map<string, AuctionLot>();
  for (const l of existing) if (l && l.id) byId.set(l.id, l);
  const before = byId.size;
  // mid-run incremental flushes (H&S, MLB, Bidsquare) settle through HERE
  // before the live write — the carry must ride both writers
  for (const l of fresh) if (l && l.id) byId.set(l.id, withSettledHistory(l, byId.get(l.id)));
  const union = Array.from(byId.values());
  writeSegment(name, union as unknown as Record<string, unknown>[]);
  return { total: union.length, added: union.length - before };
}

// ── LIVE (upcoming) lots ─────────────────────────────────────────────────────
// The expansion houses carry current lots the same way Goldin/RR do: each crawl
// re-snapshots the house's live inventory and the segment's upcoming set is
// REPLACED by that snapshot (sold history still accumulates via union). The
// replace — not union — is the purge: a lot that closed, was withdrawn, or
// (H&S) settles under a different archive id can never linger as a zombie
// 'upcoming' row, because only tonight's live snapshot survives the write.
// The isolated segments never pass through ray-crawl's W11 reconciliation, so
// this write-time purge is the ONLY stale-upcoming defense these houses have.
// `liveLegOk` gates the replace exactly like Goldin gates eviction on a good
// auctions fetch: when the live enumeration itself failed (site down, CF wall),
// keep last night's upcoming rows rather than mass-evict on a transient error.
/** A kept-on-failure upcoming row older than this (last successful live
 *  observation) is not served as live any more. */
export const STALE_UPCOMING_DAYS = 3;

/** true when a prior 'upcoming' row must NOT ride a failed live leg: its close
 *  day has passed, or no successful live read has seen it for more than
 *  STALE_UPCOMING_DAYS. A row with no lastSeen stamp (pre-dates the stamp)
 *  falls back to its newest bid snapshot, then firstSeen; with none of them it
 *  is unobservable → stale. */
export function isStaleUpcoming(l: AuctionLot, todayDay = new Date().toISOString().slice(0, 10)): boolean {
  const r = l as { saleDate?: string; lastSeen?: string; firstSeen?: string; bidHistory?: { d: string }[] };
  const sd = (r.saleDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sd) && sd < todayDay) return true;
  const hist = r.bidHistory || [];
  const seen = r.lastSeen || (hist.length ? String(hist[hist.length - 1].d).slice(0, 10) : '') || r.firstSeen || '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(seen)) return true;
  const ageDays = (Date.parse(`${todayDay}T00:00:00Z`) - Date.parse(`${seen.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  return !(ageDays <= STALE_UPCOMING_DAYS);
}

export function writeMergedSegmentWithLive(
  name: string,
  freshSettled: AuctionLot[],
  freshLive: AuctionLot[],
  liveLegOk: boolean,
): { total: number; added: number; upcoming: number } {
  // A crash-guarded run (installCrashGuard swallowed an uncaught network
  // error) may have lost an arbitrary slice of its live enumeration — its
  // snapshot is NOT authoritative, so never let it evict last night's rows.
  if (liveLegOk && crashGuardTripped()) {
    console.error(`[${name}] live leg downgraded to NOT-ok: ${crashGuardCount()} uncaught error(s) were swallowed by the crash guard — keeping the prior upcoming snapshot`);
    liveLegOk = false;
  }
  const existing = readSegment(name) as unknown as AuctionLot[];
  const byId = new Map<string, AuctionLot>();
  const prevById = new Map<string, AuctionLot>();
  const todayDay = new Date().toISOString().slice(0, 10);
  let demoted = 0;
  for (const l of existing) {
    if (!l || !l.id) continue;
    prevById.set(l.id, l);
    if ((l as { status?: string }).status === 'upcoming') {
      if (liveLegOk) continue; // replaced by tonight's snapshot
      // A FAILED live leg keeps last night's snapshot — but never a stale one
      // (Sep 27 audit: 2,350 H&S / 1,068 REA / 646 MLB 'upcoming' rows rode
      // for weeks behind failed grids, served as live lots that had long
      // closed). A kept row must be (a) not past its own close day and (b)
      // actually observed by a successful live leg within STALE_UPCOMING_DAYS.
      // Anything else is demoted to 'unknown-result': out of the live feed,
      // still in the segment so a later good night can settle it by id.
      if (isStaleUpcoming(l, todayDay)) {
        byId.set(l.id, { ...l, status: 'unknown-result', staleSince: todayDay } as AuctionLot);
        demoted++;
        continue;
      }
    }
    byId.set(l.id, l);
  }
  if (demoted) console.warn(`[${name}] live leg NOT ok — demoted ${demoted} stale upcoming row(s) (closed, or unobserved >${STALE_UPCOMING_DAYS}d) to unknown-result instead of re-serving them`);
  const before = byId.size;
  // live first, settled second: a lot that closed mid-crawl and parsed BOTH
  // ways settles as sold (a live bid is not a sale; the sold record wins).
  // Each pass also APPENDS a bid snapshot {d,b,n} (the Goldin bidHistory
  // pattern) so build-upcoming's bidVelocity can rank these houses too —
  // REA scrapes real bidCounts nightly; snapshots cap at 59 like Goldin's.
  const todayIso = new Date().toISOString();
  for (const l of freshLive) {
    if (!l || !l.id) continue;
    const prev = prevById.get(l.id);
    if (prev && (prev as { status?: string }).status === 'sold') continue; // never un-sell
    const firstSeen = (prev as { firstSeen?: string } | undefined)?.firstSeen || (l as { firstSeen?: string }).firstSeen;
    const hist: Snap[] = ((prev as { bidHistory?: Snap[] } | undefined)?.bidHistory || []).slice(-58);
    const b = (l as { currentBid?: number }).currentBid || 0;
    const n = (l as { bidCount?: number }).bidCount || 0;
    const last = hist[hist.length - 1];
    if (!last || last.b !== b || last.n !== n) hist.push({ d: todayIso, b, n });
    // lastSeen = the last night a SUCCESSFUL live read observed this lot —
    // what the stale gate above ages on (bidHistory only appends on change)
    byId.set(l.id, { ...l, firstSeen, lastSeen: todayDay, ...(hist.length ? { bidHistory: hist } : {}) } as AuctionLot);
  }
  // settled last: the sold record wins, but inherits the live row's bid trail
  // (prevById = last night's row, which tonight's live pass may have extended)
  for (const l of freshSettled) if (l && l.id) byId.set(l.id, withSettledHistory(l, byId.get(l.id) || prevById.get(l.id)));
  const union = Array.from(byId.values());
  writeSegment(name, union as unknown as Record<string, unknown>[]);
  const upcoming = union.filter(l => (l as { status?: string }).status === 'upcoming').length;
  return { total: union.length, added: union.length - before, upcoming };
}

/** Delete specific ids from a segment — for lots the source now says were
 *  WITHDRAWN/passed. The old unbounded card-walk stamped some of these with a
 *  NEIGHBOR's sold price (the $3.1M ×27 bleed); the fixed extractors skip them
 *  going forward, so the poisoned ghosts must be removed explicitly. */
export function purgeFromSegment(name: string, ids: Set<string>): number {
  if (!ids.size) return 0;
  const rows = readSegment(name);
  const keep = rows.filter(r => !ids.has(String((r as { id?: string }).id)));
  const purged = rows.length - keep.length;
  if (purged) writeSegment(name, keep);
  return purged;
}

const TODAY = new Date().toISOString().slice(0, 10);

/** Money block for a LIVE lot — the mirror of stampRealizedUsd for isSold:false
 *  (ray-crawl's stampMoney non-sold branch): every realized/hammer/premium field
 *  NULL (invariant FATAL-2), USD identity fx, estimates only if the house posts
 *  them. currentBid/bidCount ride NEXT TO this block, never inside it. */
export function stampUpcomingUsd(saleDate: string, est?: { low?: number | null; high?: number | null }) {
  const { rate, asOf } = fxRateFor('USD', saleDate);
  const estLow = est?.low ?? null;
  const estHigh = est?.high ?? null;
  return {
    nativeCurrency: 'USD' as Currency,
    hammerNative: null, premiumNative: null, realizedNative: null,
    buyerPremiumPct: null,
    fxRate: rate, fxAsOf: asOf,
    hammerUsd: null, premiumUsd: null, realizedUsd: null,
    estLowNative: estLow, estHighNative: estHigh,
    estLowUsd: estLow, estHighUsd: estHigh,
    currency: 'USD' as Currency, estimateLow: estLow, estimateHigh: estHigh,
    hammerPrice: null, premiumPrice: null, priceUsd: null,
  };
}

/** Shared shape check for a live lot before it enters a segment: dated today or
 *  later (FATAL-3), and carrying NO realized money (FATAL-2). Filter — the same
 *  one-bad-batch philosophy as settledOnly. */
export function liveOnly(lots: AuctionLot[]): { good: AuctionLot[]; dropped: number } {
  const good = lots.filter((l) => {
    const d = (l as { saleDate?: string }).saleDate;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < TODAY) return false;
    const p = l as { realizedUsd?: number | null; priceUsd?: number | null; realizedNative?: number | null };
    return p.realizedUsd == null && p.priceUsd == null && p.realizedNative == null;
  });
  return { good, dropped: lots.length - good.length };
}

export const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Per-process fetch health for the sports crawlers: every non-2xx answer is
 *  counted (and logged — a silent null is how a rate-limited night used to
 *  read as "the archive ended") so a run can tell "nothing to fetch" from
 *  "the house said no". */
export const FETCH_STATS = { non2xx: 0, rateLimited: 0, failed: 0 };
const RATE_LIMIT_BACKOFF_MS = [2000, 6000]; // 429/503: 2 tries, 2s then 6s
let non2xxLogged = 0;

export async function getHtml(url: string, timeoutMs = 30000, retries = 2): Promise<string | null> {
  let rateLimitTries = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': REAL_UA }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return await r.text();
      // 429/503 = the house is throttling us, not answering — back off (2s, 6s)
      // and retry before believing it. Does not consume a transient retry.
      if ((r.status === 429 || r.status === 503) && rateLimitTries < RATE_LIMIT_BACKOFF_MS.length) {
        const wait = RATE_LIMIT_BACKOFF_MS[rateLimitTries++];
        FETCH_STATS.rateLimited++;
        console.warn(`[getHtml] HTTP ${r.status} ${url} — backing off ${wait}ms (try ${rateLimitTries}/${RATE_LIMIT_BACKOFF_MS.length})`);
        await new Promise((res) => setTimeout(res, wait));
        attempt--;
        continue;
      }
      // a real 404/4xx (or an exhausted 429/503) is a fact — count + log it,
      // don't retry. Log the first 20 per process, then one line per 100 so a
      // 5k-lot archive gap can't drown the run log.
      FETCH_STATS.non2xx++;
      if (++non2xxLogged <= 20 || non2xxLogged % 100 === 0) console.warn(`[getHtml] HTTP ${r.status} ${url}${non2xxLogged === 20 ? ' (further non-2xx logged every 100th)' : ''}`);
      return null;
    } catch (e) {
      // transient (UND_ERR_SOCKET, HTTP/2 stream reset, timeout) — back off + retry
      if (attempt < retries) await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      else { FETCH_STATS.failed++; console.warn(`[getHtml] FAILED ${url}: ${(e as Error)?.message || e}`); }
    }
  }
  return null;
}

// Long backfills hit occasional undici HTTP/2 socket errors that surface as
// UNCAUGHT (async, past the per-fetch try/catch) and kill the process. Combined
// with incremental per-auction segment writes, this backstop means a crash
// loses at most the in-flight auction, never the whole run.
// Bounded-concurrency map: run fn over items with at most `conc` in flight.
// The full-depth per-lot crawls are I/O-bound, so N-way concurrency is ~N×
// faster; keep N moderate on small-business servers to avoid rate-limit/blocks.
// Errors thrown by `fn` are COUNTED (process-wide + per call), logged for the
// first few items, and summarized — a pool that swallowed 500 failures used to
// look exactly like a pool that found 500 gaps.
export const POOL_STATS = { errors: 0 };
export async function mapPool<T, R>(items: T[], conc: number, fn: (item: T, i: number) => Promise<R>, label = 'mapPool'): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0, errors = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch (e) {
        out[i] = undefined as unknown as R;
        errors++; POOL_STATS.errors++;
        if (errors <= 5) console.warn(`[${label}] item ${i} threw: ${(e as Error)?.message || e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, () => worker()));
  if (errors) console.warn(`[${label}] ${errors}/${items.length} items threw (counted in POOL_STATS.errors)`);
  return out;
}
/** Errors swallowed by mapPool since process start. */
export function mapPoolErrors(): number { return POOL_STATS.errors; }

// The guard keeps the process alive but the run is no longer trustworthy: an
// uncaught error may have dropped part of a live enumeration mid-flight. It
// COUNTS every trip; writeMergedSegmentWithLive reads crashGuardTripped() and
// refuses to treat that run's live snapshot as authoritative (liveOk=false).
let crashGuardTrips = 0;
export function installCrashGuard(label: string) {
  const onErr = (e: unknown) => {
    crashGuardTrips++;
    console.error(`[${label}] uncaught error #${crashGuardTrips} swallowed by crash guard (run marked NOT-ok for live replace):`, (e as Error)?.message || e);
  };
  process.on('uncaughtException', onErr);
  process.on('unhandledRejection', onErr);
}
export function crashGuardTripped(): boolean { return crashGuardTrips > 0; }
export function crashGuardCount(): number { return crashGuardTrips; }

export function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
}

// ── money (USD houses; premium-inclusive "Sold For" → realized basis) ────────
export function stampRealizedUsd(realizedNative: number, saleDate: string, opts?: { basis?: PriceBasis }) {
  const cur: Currency = 'USD';
  const basis: PriceBasis = opts?.basis ?? 'realized';
  const { rate, asOf } = fxRateFor(cur, saleDate);
  const usd = toUsdDated(realizedNative, cur, saleDate).usd;
  const premiumInclusive = basis === 'realized';
  return {
    nativeCurrency: cur,
    hammerNative: premiumInclusive ? null : realizedNative,
    premiumNative: premiumInclusive ? realizedNative : null,
    realizedNative,
    buyerPremiumPct: null,
    fxRate: rate, fxAsOf: asOf,
    hammerUsd: premiumInclusive ? null : usd,
    premiumUsd: premiumInclusive ? usd : null,
    realizedUsd: usd,
    estLowNative: null, estHighNative: null, estLowUsd: null, estHighUsd: null,
    priceBasis: basis,
    currency: cur, estimateLow: null, estimateHigh: null,
    hammerPrice: premiumInclusive ? null : realizedNative,
    premiumPrice: premiumInclusive ? realizedNative : null,
    priceUsd: usd,
  };
}

// ── category classification → lectr sports/pop pseudo-artist + fake-risk gate ──
export type SportsCategory =
  | 'game-used' | 'graded-card' | 'ticket' | 'autograph' | 'unopened-wax'
  | 'equipment' | 'photograph' | 'program-publication' | 'trophy-award'
  | 'pop-memorabilia' | 'other-memorabilia';

/** Maps a house's category label + title into our taxonomy. `catLabel` is the
 *  house's own field (REA/H&S "Auction Category"); `title` is the lot title. */
export function classifySports(catLabel: string, title: string): SportsCategory {
  const c = (catLabel || '').toLowerCase();
  const t = (title || '').toLowerCase();
  const both = c + ' ' + t;
  // (Oct 8 sports audit, E8) the TITLE must name the sealed product (pack /
  // box / case / set …): "Unopened Official League Baseballs", a "Card Vending
  // Machine" and a "Vending Hoard (1,000 Cards)" are not wax
  if (/\b(unopened|sealed|wax box|wax pack|cello|rack pack|vending)\b/.test(both) && SEALED_PRODUCT_RE.test(title) && !SEALED_NOT_RE.test(title)) return 'unopened-wax';
  // a leading vintage set code (T206, E224, N172, R319 …) is a CARD whatever
  // follows — "T206 … with Bat" must not fall into game-used below (Sep 27 audit:
  // ~13k pre-war cards filed as memorabilia/game-used). See set-codes.ts.
  if (leadsWithSetCode(title)) return 'graded-card';
  // CARD FIRST (Oct 6 2026 audit): a signed card is a card, never an autograph
  // or game-used lot — the shared routing detector (classify.ts isCardTitle).
  if (isCardTitle(title)) return 'graded-card';
  if (/\b(ticket|stub|pass|full ticket)\b/.test(both)) return 'ticket';
  // game-used needs explicit USE language — a jersey/bat/helmet alone is a
  // retail or signed item (5.5k signed bats/jerseys were filed game-used)
  if (GAME_USED_RE.test(both)) return 'game-used';
  // (Oct 8 sports audit) a PHOTO before the trophy it shows (E3) — any photo
  // (Type I–IV, RPPC, negative); an athlete-SIGNED photo is an autograph
  // unless the photographer signed it (E5) — classify.ts sportsObjectKind
  const photo = isPhotoTitle(title) || /\b(type (1|i|one)|type-1|photograph|original photo|wire photo|press photo)\b/.test(c);
  if (photo) return /\b(signed|autograph(?:ed)?|inscribed)\b/.test(t) && !isPhotographerSigned(title) ? 'autograph' : 'photograph';
  // (E2) an award OBJECT word — a bare "MVP" names no trophy
  if (/\b(trophy|trophies|award|ring|medal|plaque|statuette|championship ring|championship belt)\b/.test(both)) return 'trophy-award';
  if (/\b(program|yearbook|magazine|publication|pennant|scorecard)\b/.test(both) || PUBLICATION_RE.test(title)) return 'program-publication';
  if (/\b(seat|turnstile|base|stadium|signage|display)\b/.test(both)) return 'equipment';
  if (/\b(signed|autograph|auto|cut signature|inscribed)\b/.test(both) && !/\bcard\b/.test(c)) return 'autograph';
  if (/\bcard\b/.test(both) || /\b(psa|sgc|bgs|cgc)\s*(gem|mint|nm|ex|vg|good|fair|poor|pr|\d)/.test(both) || /\b(topps|bowman|leaf|fleer|donruss|upper deck|panini|goudey|cracker jack|t20[0-9]|e9[0-9])\b/.test(both)) return 'graded-card';
  // pop-memorabilia (a CULTURE slug) only when the lot reads NON-sport — at a
  // sports house a fight poster or a team figure is sports memorabilia (Oct 6
  // 2026 audit: 79% of 14k pop-memorabilia rows were sports). The same rule
  // re-runs over the back-catalogue: classify.ts sportsHousePopKind.
  if (NON_SPORT_RE.test(both) && !SPORT_WORD_RE.test(both)) return 'pop-memorabilia';
  return 'other-memorabilia';
}

/** The pseudo-artist slug a category slots into (the sports vertical is keyed on
 *  category pseudo-artists, exactly like Goldin's game-used/tickets-passes). */
export function pseudoArtist(cat: SportsCategory): string {
  const map: Record<SportsCategory, string> = {
    'game-used': 'game-used', 'graded-card': 'graded-cards', 'ticket': 'tickets-passes',
    'autograph': 'autographs', 'unopened-wax': 'unopened-wax', 'equipment': 'equipment-artifacts',
    'photograph': 'type-1-photos', 'program-publication': 'programs-publications',
    'trophy-award': 'trophies-awards', 'pop-memorabilia': 'pop-memorabilia',
    'other-memorabilia': 'memorabilia',
  };
  return map[cat];
}

// ── authentication extraction + per-category doctrine gate ───────────────────
export interface AuthRead { cert: string | null; grade: string | null; confidence: 'high' | 'low'; marks: string[]; }

const CERT_RE = /\b(PSA\/?DNA|PSA|SGC|BGS|BVG|CGC|CBCS|JSA|Beckett|GAI)\b/gi;
// A descriptor grade may carry its numeric ("PSA NM 7", "SGC EX-MT 6",
// "BGS GEM MT 9.5") — capture the number too, or "PSA NM 7" reads as "PSA NM"
// and every NM 7/8/9 collapses into one ladder rung. The 1–2 digit cap keeps a
// following year ("PSA NM 1952 Topps") out of the grade.
const GRADE_RE = /\b(?:PSA|SGC|BGS|CGC)\s*(?:(?:GEM[- ]?MT|MINT|NM[- ]?MT|NM|EX[- ]?MT|EX|VG[- ]?EX|VG|GOOD|PR|AUTHENTIC)(?:\s+\d{1,2}(?:\.\d)?)?|\d{1,2}(?:\.\d)?)\b/i;
const PHOTOMATCH_RE = /\b(photo[- ]?match(?:ed|ing)?|MeiGray|Resolution Photomatching|ResMatch|Sports Investors Auth|SIA)\b/i;
const BBCE_RE = /\bBBCE\b/i;

/** Reads cert/grade from title+description and applies the per-category gate.
 *  Never drops — flags. */
export function readAuth(cat: SportsCategory, title: string, description: string): AuthRead {
  const text = `${title}\n${description}`;
  const marks = Array.from(new Set((text.match(CERT_RE) || []).map(s => s.toUpperCase())));
  const gradeM = text.match(GRADE_RE);
  const grade = gradeM ? gradeM[0].replace(/\s+/g, ' ').trim() : null;
  const hasPhotoMatch = PHOTOMATCH_RE.test(text);
  const hasBBCE = BBCE_RE.test(text);
  if (hasPhotoMatch) marks.push('PHOTO-MATCH');
  if (hasBBCE) marks.push('BBCE');

  let confidence: 'high' | 'low' = 'low';
  switch (cat) {
    case 'game-used': confidence = hasPhotoMatch ? 'high' : 'low'; break;         // photo-match required
    case 'unopened-wax': confidence = hasBBCE ? 'high' : 'low'; break;            // BBCE required
    case 'graded-card': confidence = marks.some(m => /PSA|SGC|BGS|CGC/.test(m)) ? 'high' : 'low'; break;
    case 'autograph': confidence = marks.some(m => /PSA|JSA|BECKETT/.test(m)) ? 'high' : 'low'; break;
    case 'photograph': confidence = /type[- ]?(1|i|one)/i.test(text) ? 'high' : 'low'; break;
    default: confidence = 'high'; break; // tickets/programs/equipment/trophies = provenance/condition
  }
  return { cert: marks[0] || null, grade, confidence, marks: Array.from(new Set(marks)) };
}

/** Season/quarter label → an approximate mid-month sale date (YYYY-MM-DD). REA
 *  and H&S publish "2018 Spring" etc.; the exact day isn't posted.
 *  With `house` = 'REA' | 'Huggins & Scott' | a gallery house (Lelands / Love
 *  of the Game / Memory Lane) the label resolves through the cited close-date
 *  table (scripts/lib/sale-close-dates.ts) first — the real close day, or (REA
 *  / H&S) a conservative season-end bound — and only a label that table leaves
 *  alone falls through to the month stub. */
export function seasonToDate(label: string, house?: string): string | null {
  if (house) {
    const close = saleCloseFor(house, label);
    if (close) return close.date;
  }
  // winter → FEBRUARY, not December: hobby "Winter YYYY" auctions close early
  // in the label year. The old '12' future-dated every in-progress winter
  // month and settledOnly dropped ENTIRE months nightly (H&S 2026-winter:
  // 1,485 lots, all FATAL "future saleDate", Aug 13 audit). The stub itself
  // lives in sale-close-dates.ts (labelStub) so the gallery heal can invert it.
  return labelStub(label);
}
