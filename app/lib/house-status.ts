/**
 * house-status.ts — the pipeline's own account of how fresh each house is.
 *
 * CONTRACT (the pipeline emits it; it may be ABSENT on an older data build,
 * so every reader here fails soft):
 *   public/data/ray/status.json = {
 *     generatedAt,
 *     publish: { lastPublishedAt, runId, engineVersion, signal },
 *     houses: [{ house, asOf, lastSaleDate, live, ok, reason, staleHidden }]
 *   }
 *
 * When status.json is missing, a house's "as of" falls back to the newest
 * `lastSeen` stamp its own live lots carry (the last crawl that saw them) —
 * a weaker but honest proxy. No stamp, no claim.
 */
import { useEffect, useState } from 'react';

export interface HouseStatus {
  house: string;
  /** ISO — when the crawler last read this house successfully */
  asOf: string | null;
  /** YYYY-MM-DD of the newest sale the house has on the book */
  lastSaleDate: string | null;
  /** live lots currently served */
  live: number | null;
  ok: boolean | null;
  reason: string | null;
  /** live lots withheld because the house went stale */
  staleHidden: number | null;
}
export interface PublishStatus {
  lastPublishedAt: string | null;
  runId: string | null;
  engineVersion: string | null;
  signal: string | null;
}
export interface PipelineStatus {
  generatedAt: string | null;
  publish: PublishStatus | null;
  houses: HouseStatus[];
}

/** a house is shown as stale past this age */
export const HOUSE_STALE_MS = 36 * 3_600_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** Defensive parse — anything malformed becomes null, never a throw. */
export function parseStatus(raw: unknown): PipelineStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const p = r.publish && typeof r.publish === 'object' ? (r.publish as Record<string, unknown>) : null;
  const houses = Array.isArray(r.houses) ? r.houses : [];
  return {
    generatedAt: str(r.generatedAt),
    publish: p ? {
      lastPublishedAt: str(p.lastPublishedAt),
      runId: p.runId == null ? null : String(p.runId),
      engineVersion: p.engineVersion == null ? null : String(p.engineVersion),
      signal: str(p.signal),
    } : null,
    houses: houses
      .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object' && !!str((h as Record<string, unknown>).house))
      .map(h => ({
        house: String(h.house),
        asOf: str(h.asOf),
        lastSaleDate: str(h.lastSaleDate),
        live: num(h.live),
        ok: bool(h.ok),
        reason: str(h.reason),
        staleHidden: num(h.staleHidden),
      })),
  };
}

let statusP: Promise<PipelineStatus | null> | null = null;
/** status.json, once per session; null when absent or unreadable. */
export function loadStatus(): Promise<PipelineStatus | null> {
  if (!statusP) {
    statusP = fetch('/data/ray/status.json', { cache: 'no-cache' })
      .then(r => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null))
      .then(parseStatus)
      .catch(() => null);
  }
  return statusP;
}

/** undefined = loading · null = no status file · else the parsed status */
export function usePipelineStatus(): PipelineStatus | null | undefined {
  const [s, setS] = useState<PipelineStatus | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadStatus().then(v => { if (live) setS(v); });
    return () => { live = false; };
  }, []);
  return s;
}

/** house → as-of ISO. status.json first; the lots' own lastSeen stamps fill
    any house the status file doesn't name (or all of them when it's absent). */
export function houseAsOfMap(
  status: PipelineStatus | null | undefined,
  lots: ReadonlyArray<{ auctionHouse?: string | null; lastSeen?: string | null }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of status?.houses || []) if (h.asOf) m.set(h.house, h.asOf);
  const seen = new Map<string, string>();
  for (const l of lots) {
    const h = l.auctionHouse, s = l.lastSeen;
    if (!h || !s || m.has(h)) continue;
    const prev = seen.get(h);
    if (!prev || s > prev) seen.set(h, s);
  }
  seen.forEach((s, h) => m.set(h, s));
  return m;
}

/** The houses (among `houses`) whose as-of is older than 36h at `now`. */
export function staleHouses(asOf: Map<string, string>, houses: Iterable<string>, now: number): { house: string; asOf: string }[] {
  const out: { house: string; asOf: string }[] = [];
  const done = new Set<string>();
  for (const h of Array.from(houses)) {
    if (done.has(h)) continue;
    done.add(h);
    const a = asOf.get(h);
    if (!a) continue;
    // a bare day stamp means "seen some time that day" — measure from its end
    const t = /^\d{4}-\d{2}-\d{2}$/.test(a) ? Date.parse(`${a}T23:59:59Z`) : Date.parse(a);
    if (!isNaN(t) && now - t > HOUSE_STALE_MS) out.push({ house: h, asOf: a });
  }
  return out.sort((x, y) => (x.asOf < y.asOf ? -1 : 1));
}

/** "Sep 30" / "Sep 30, 14:05" — the short as-of stamp */
export function asOfLabel(iso: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = day ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(day ? { timeZone: 'UTC' } : {}) });
}

/** "4h" / "2d" — the age of a stamp at `now` */
export function ageLabel(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const ms = Math.max(0, now - t);
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
