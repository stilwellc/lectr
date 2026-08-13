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

export function writeMergedSegment(name: string, fresh: AuctionLot[]): { total: number; added: number } {
  const existing = readSegment(name) as unknown as AuctionLot[];
  const byId = new Map<string, AuctionLot>();
  for (const l of existing) if (l && l.id) byId.set(l.id, l);
  const before = byId.size;
  for (const l of fresh) if (l && l.id) byId.set(l.id, l);
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
export function writeMergedSegmentWithLive(
  name: string,
  freshSettled: AuctionLot[],
  freshLive: AuctionLot[],
  liveLegOk: boolean,
): { total: number; added: number; upcoming: number } {
  const existing = readSegment(name) as unknown as AuctionLot[];
  const byId = new Map<string, AuctionLot>();
  const prevById = new Map<string, AuctionLot>();
  for (const l of existing) {
    if (!l || !l.id) continue;
    prevById.set(l.id, l);
    if ((l as { status?: string }).status === 'upcoming' && liveLegOk) continue; // replaced by tonight's snapshot
    byId.set(l.id, l);
  }
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
    type Snap = { d: string; b: number; n: number };
    const hist: Snap[] = ((prev as { bidHistory?: Snap[] } | undefined)?.bidHistory || []).slice(-58);
    const b = (l as { currentBid?: number }).currentBid || 0;
    const n = (l as { bidCount?: number }).bidCount || 0;
    const last = hist[hist.length - 1];
    if (!last || last.b !== b || last.n !== n) hist.push({ d: todayIso, b, n });
    byId.set(l.id, { ...l, firstSeen, ...(hist.length ? { bidHistory: hist } : {}) } as AuctionLot);
  }
  for (const l of freshSettled) if (l && l.id) byId.set(l.id, l);
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

export async function getHtml(url: string, timeoutMs = 30000, retries = 2): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': REAL_UA }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) return null; // a real 404/4xx is a fact, not a transient error — don't retry
      return await r.text();
    } catch {
      // transient (UND_ERR_SOCKET, HTTP/2 stream reset, timeout) — back off + retry
      if (attempt < retries) await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
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
export async function mapPool<T, R>(items: T[], conc: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch { out[i] = undefined as unknown as R; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, () => worker()));
  return out;
}

export function installCrashGuard(label: string) {
  const noop = (e: unknown) => console.error(`[${label}] non-fatal network error (continuing):`, (e as Error)?.message || e);
  process.on('uncaughtException', noop);
  process.on('unhandledRejection', noop);
}

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
  if (/\b(unopened|sealed|wax box|wax pack|cello|rack pack|vending)\b/.test(both)) return 'unopened-wax';
  if (/\b(ticket|stub|pass|full ticket)\b/.test(both)) return 'ticket';
  if (/\b(game[- ]?used|game[- ]?worn|match[- ]?worn|player[- ]?worn|jersey|bat|glove|cleats|helmet|worn)\b/.test(both)) return 'game-used';
  if (/\b(trophy|award|ring|medal|championship ring|mvp)\b/.test(both)) return 'trophy-award';
  if (/\b(type (1|i|one)|type-1|photograph|original photo|wire photo|press photo)\b/.test(both)) return 'photograph';
  if (/\b(program|yearbook|magazine|publication|pennant|scorecard)\b/.test(both)) return 'program-publication';
  if (/\b(seat|turnstile|base|stadium|signage|display)\b/.test(both)) return 'equipment';
  if (/\b(signed|autograph|auto|cut signature|inscribed)\b/.test(both) && !/\bcard\b/.test(c)) return 'autograph';
  if (/\bcard\b/.test(both) || /\b(psa|sgc|bgs|cgc)\s*(gem|mint|nm|ex|vg|\d)/.test(both) || /\b(topps|bowman|leaf|fleer|donruss|upper deck|panini|goudey|cracker jack|t20[0-9]|e9[0-9])\b/.test(both)) return 'graded-card';
  if (/\b(poster|prop|costume|comic|toy|figure|record|album|guitar|memorabilia)\b/.test(both)) return 'pop-memorabilia';
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
const GRADE_RE = /\b(?:PSA|SGC|BGS|CGC)\s*(GEM[- ]?MT|MINT|NM[- ]?MT|NM|EX[- ]?MT|EX|VG[- ]?EX|VG|GOOD|PR|AUTHENTIC|\d{1,2}(?:\.\d)?)\b/i;
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
 *  and H&S publish "2018 Spring" etc.; the exact day isn't posted. */
export function seasonToDate(label: string): string | null {
  const m = label.match(/(20[0-2]\d)/);
  if (!m) return null;
  const year = m[1];
  const l = label.toLowerCase();
  const mm = /spring/.test(l) ? '04' : /summer/.test(l) ? '07' : /(fall|autumn)/.test(l) ? '10' : /winter/.test(l) ? '12'
    : /jan/.test(l) ? '01' : /feb/.test(l) ? '02' : /mar/.test(l) ? '03' : /apr/.test(l) ? '04' : /may/.test(l) ? '05'
    : /jun/.test(l) ? '06' : /jul/.test(l) ? '07' : /aug/.test(l) ? '08' : /sep/.test(l) ? '09' : /oct/.test(l) ? '10'
    : /nov/.test(l) ? '11' : /dec/.test(l) ? '12' : '06';
  return `${year}-${mm}-15`;
}
