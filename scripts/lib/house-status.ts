/**
 * house-status.ts — the per-house health LEDGER and the public status.json
 * contract. Pure functions only (tested in scripts/__tests__/emit-status.test.ts);
 * scripts/emit-status.ts is the CLI that reads/writes the files.
 *
 * WHY A LEDGER: a crawl leg's leg-health.json only lives for one run (it is an
 * Actions artifact). "When did Hake's last crawl successfully?" needs memory
 * across nights, so assemble folds tonight's leg records into the previous
 * ledger (R2 latest/house-ledger.json) and writes it back every night — even a
 * night that does not publish, because crawl truth is independent of publish.
 *
 * A house is OK tonight when its crawl leg reported ok AND assemble received
 * its segment fresh from this run's crawl (handoff). A leg that crawled fine
 * but whose segment was refused by the per-house shrink gate is NOT ok — the
 * site is serving its last-good segment.
 *
 * STALE RULE: a house whose last OK crawl (or, never OK, the moment the
 * ledger started tracking it) is more than STALE_AFTER_H old is STALE: its
 * live/upcoming lots are hidden from the served live set (normalize rule
 * hideStaleHouseLive — never deleted) and status.json says staleHidden.
 */

export const STALE_AFTER_H = 48;

/** The nightly matrix houses (segment keys) and their display labels. */
export const HOUSE_LABELS: Record<string, string> = {
  goldin: 'Goldin', sothebys: "Sotheby's", christies: "Christie's", bonhams: 'Bonhams',
  phillips: 'Phillips', wright: 'Wright / Rago / LAMA', rrauction: 'RR Auction', rea: 'REA',
  hugginsscott: 'Huggins & Scott', scp: 'SCP', hakes: "Hake's", lelands: 'Lelands',
  memorylane: 'Memory Lane', lotg: 'Love of the Game', nflauction: 'NFL Auction', mlbauction: 'MLB Auctions',
};

export interface LegRecord {
  house: string;
  ok: boolean;
  fetched?: number;
  parsed?: number;
  settled?: number;
  reason?: string | null;
}

export interface LedgerEntry {
  /** ISO of the last night this house crawled OK and its segment landed fresh */
  lastOkAt: string | null;
  /** ISO of the last night a crawl was attempted for this house */
  lastAttemptAt: string | null;
  /** ISO the ledger first saw this house (the stale clock for a never-ok house) */
  trackedSince: string;
  ok: boolean;
  reason: string | null;
  /** where tonight's segment came from: this run's crawl, or R2 last-good */
  source: 'fresh' | 'last-good' | 'unknown';
  /** consecutive attempted nights not ok */
  failStreak: number;
  lastRunId: string | null;
}

export interface Ledger {
  version: 1;
  updatedAt: string;
  houses: Record<string, LedgerEntry>;
}

/** Fold several leg records for the same house into one (ok = AND, reasons
 *  joined). A crawl leg writes leg-health.json; the per-house shrink gate in
 *  data-store.sh writes data/qa/leg-health-gate.json for the same house. */
export function mergeLegRecords(recs: LegRecord[]): Map<string, LegRecord> {
  const out = new Map<string, LegRecord>();
  for (const r of recs) {
    if (!r || typeof r.house !== 'string') continue;
    const prev = out.get(r.house);
    if (!prev) { out.set(r.house, { ...r, ok: r.ok === true, reason: r.reason ?? null }); continue; }
    const reasons = [prev.reason, r.reason].filter((x): x is string => !!x);
    out.set(r.house, {
      house: r.house,
      ok: prev.ok && r.ok === true,
      fetched: Math.max(prev.fetched || 0, r.fetched || 0),
      parsed: Math.max(prev.parsed || 0, r.parsed || 0),
      settled: Math.max(prev.settled || 0, r.settled || 0),
      reason: Array.from(new Set(reasons)).join(' | ') || null,
    });
  }
  return out;
}

export function updateLedger(
  prev: Ledger | null,
  input: {
    houses: string[];
    legs: Map<string, LegRecord>;
    /** house → segment source tonight ('fresh' = this run's crawl handoff) */
    sources: Record<string, 'fresh' | 'last-good' | 'unknown'>;
    /** false on a skip_crawl run: nothing was attempted, entries carry forward */
    crawled: boolean;
    now: Date;
    runId?: string | null;
    /** BOOTSTRAP only (a house with no ledger entry yet): the newest
     *  lastSeen/validatedAt in its segment — so a house that was already dead
     *  when the ledger began is not granted a fresh 48h. */
    bootstrapSince?: Record<string, string | null>;
  },
): Ledger {
  const nowIso = input.now.toISOString();
  const houses: Record<string, LedgerEntry> = {};
  for (const h of input.houses) {
    const p = prev?.houses?.[h];
    const seed = input.bootstrapSince?.[h];
    const base: LedgerEntry = p ? { ...p } : {
      lastOkAt: null, lastAttemptAt: null, trackedSince: seed && seed < nowIso ? seed : nowIso, ok: false,
      reason: 'no crawl recorded yet', source: 'unknown', failStreak: 0, lastRunId: null,
    };
    if (!input.crawled) { houses[h] = base; continue; }
    const leg = input.legs.get(h);
    const source = input.sources[h] || 'unknown';
    const fresh = source === 'fresh';
    let ok: boolean;
    let reason: string | null;
    if (!leg) {
      ok = fresh;
      reason = fresh ? 'no leg-health record (segment landed fresh)' : 'crawl leg crashed or timed out — no health record, serving last-good segment';
    } else if (!leg.ok) {
      ok = false;
      reason = leg.reason || 'leg reported not ok';
    } else if (!fresh) {
      ok = false;
      reason = 'crawl ok but its segment did not land (push refused by the shrink gate, or the handoff failed) — serving last-good segment';
    } else {
      ok = true;
      reason = leg.reason || null; // informational (e.g. "between sales")
    }
    houses[h] = {
      ...base,
      ok,
      reason,
      source,
      lastAttemptAt: nowIso,
      lastOkAt: ok ? nowIso : base.lastOkAt,
      failStreak: ok ? 0 : (base.failStreak || 0) + 1,
      lastRunId: input.runId ?? base.lastRunId ?? null,
    };
  }
  // houses dropped from the matrix keep their entry (history), untouched
  for (const [h, e] of Object.entries(prev?.houses || {})) if (!(h in houses)) houses[h] = e;
  return { version: 1, updatedAt: nowIso, houses };
}

/** Hours since the house last crawled OK (or since tracking began). */
export function houseAgeHours(e: LedgerEntry, now: Date): number {
  const ref = Date.parse(e.lastOkAt || e.trackedSince);
  if (!Number.isFinite(ref)) return 0;
  return (now.getTime() - ref) / 3600e3;
}

/** Segment keys whose live lots must be hidden tonight. */
export function staleHouseKeys(ledger: Ledger | null, now: Date, maxAgeH = STALE_AFTER_H): Set<string> {
  const out = new Set<string>();
  for (const [h, e] of Object.entries(ledger?.houses || {})) if (houseAgeHours(e, now) > maxAgeH) out.add(h);
  return out;
}

export interface HouseStats {
  rows: number;
  sold: number;
  /** lots in the served live set (after the stale hide) */
  live: number;
  /** live lots hidden by the stale-house rule */
  hiddenLive: number;
  lastSaleDate: string | null;
}

/** THE status.json CONTRACT (rendered by the /status page). Additive changes
 *  only — never rename or retype a field without updating the page. */
export interface StatusJson {
  generatedAt: string;
  publish: {
    /** when this payload was assembled for publish (this run) */
    lastPublishedAt: string;
    runId: string | null;
    engineVersion: string | null;
    /** 'ok' = every house fresh + engine validated; 'degraded' = published,
     *  but ≥1 house down/stale or the engine signal degraded. A MISSED night
     *  cannot write this file: the page infers it from lastPublishedAt age
     *  (> 30h = the nightly did not publish). */
    signal: 'ok' | 'degraded';
    engineSignal: string | null;
    housesDown: string[];
  };
  houses: Array<{
    house: string;
    label: string;
    /** ISO of the last successful crawl (null = never recorded) */
    asOf: string | null;
    lastSaleDate: string | null;
    live: number;
    ok: boolean;
    reason: string | null;
    staleHidden: boolean;
    hiddenLive: number;
    failStreak: number;
  }>;
}

export function buildStatus(input: {
  now: Date;
  houses: string[];
  ledger: Ledger | null;
  stats: Record<string, HouseStats> | null;
  engineVersion: string | null;
  engineSignal: string | null;
  runId: string | null;
  maxAgeH?: number;
}): StatusJson {
  const maxAgeH = input.maxAgeH ?? STALE_AFTER_H;
  const houses = input.houses.map(h => {
    const e = input.ledger?.houses?.[h];
    const s = input.stats?.[h];
    const staleHidden = !!e && houseAgeHours(e, input.now) > maxAgeH;
    const ok = !!e && e.ok && !staleHidden;
    let reason = e ? e.reason : 'no crawl recorded yet';
    if (staleHidden) reason = `no successful crawl in ${Math.floor(houseAgeHours(e!, input.now))}h — live lots hidden${reason ? ` (last: ${reason})` : ''}`;
    return {
      house: h,
      label: HOUSE_LABELS[h] || h,
      asOf: e?.lastOkAt ?? null,
      lastSaleDate: s?.lastSaleDate ?? null,
      live: s?.live ?? 0,
      ok,
      reason: reason ?? null,
      staleHidden,
      hiddenLive: s?.hiddenLive ?? 0,
      failStreak: e?.failStreak ?? 0,
    };
  });
  const housesDown = houses.filter(h => !h.ok).map(h => h.house);
  const engineOk = input.engineSignal == null || input.engineSignal === 'validated';
  return {
    generatedAt: input.now.toISOString(),
    publish: {
      lastPublishedAt: input.now.toISOString(),
      runId: input.runId,
      engineVersion: input.engineVersion,
      signal: housesDown.length === 0 && engineOk ? 'ok' : 'degraded',
      engineSignal: input.engineSignal,
      housesDown,
    },
    houses,
  };
}
