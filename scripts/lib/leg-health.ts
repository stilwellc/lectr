// Per-leg crawl health — the SILENT-ZERO discipline shared by every crawl leg.
//
// Every nightly crawl leg (one matrix job per house) ends by calling
// reportLegHealth() exactly once per house it crawled. It:
//   · writes `leg-health.json` in the process working dir (the repo root the
//     nightly runs from) — shape {house, ok, fetched, parsed, settled, reason}.
//     The nightly uploads it as artifact `health-<house>` and a non-blocking
//     health job reads every leg's file. KEEP THE FILENAME + SHAPE STABLE.
//   · prints a GitHub `::error::` annotation naming the house when ok=false,
//     so a leg that answered but parsed nothing (or whose source API is down)
//     is red on the run page instead of a green job with "+0 new".
// It never throws and never changes the exit code: a crawl leg still exits 0
// so one house can never block publish (the existing hard guards — poison
// detector, invariant FATALs, segment-collapse — keep their own exits).
//
// Counters:
//   fetched  pages / API pages the source answered 2xx with a body
//   parsed   rows parsed out of them (live + settled + recognized-unsold)
//   settled  sold/bought-in rows produced for the segment this run
//   reason   null when ok; otherwise a short human-readable cause
import * as fs from 'fs';
import * as path from 'path';

export interface LegHealth {
  house: string;
  ok: boolean;
  fetched: number;
  parsed: number;
  settled: number;
  reason: string | null;
}

export const LEG_HEALTH_FILE = 'leg-health.json';

// one process can crawl more than one house for the same leg (the wright job
// also crawls LAMA): the first report in a process owns the file, later ones
// fold into it — ok is the AND, counters sum, reasons concatenate.
let current: LegHealth | null = null;

export function reportLegHealth(h: LegHealth): LegHealth {
  const clean: LegHealth = {
    house: h.house,
    ok: !!h.ok,
    fetched: Math.max(0, Math.round(h.fetched || 0)),
    parsed: Math.max(0, Math.round(h.parsed || 0)),
    settled: Math.max(0, Math.round(h.settled || 0)),
    reason: h.ok ? (h.reason || null) : (h.reason || 'unhealthy (no reason given)'),
  };
  if (!clean.ok) {
    // one line, greppable, annotated on the run page. Keep it single-line:
    // a newline would end the annotation early.
    const why = String(clean.reason).replace(/[\r\n]+/g, ' ');
    console.log(`::error title=crawl leg unhealthy (${clean.house})::${clean.house}: ${why} [fetched=${clean.fetched} parsed=${clean.parsed} settled=${clean.settled}]`);
  }
  if (current && current.house !== clean.house) {
    current = {
      house: current.house,
      ok: current.ok && clean.ok,
      fetched: current.fetched + clean.fetched,
      parsed: current.parsed + clean.parsed,
      settled: current.settled + clean.settled,
      reason: [current.reason, clean.reason ? `${clean.house}: ${clean.reason}` : null].filter(Boolean).join(' | ') || null,
    };
  } else {
    current = clean;
  }
  try {
    fs.writeFileSync(path.join(process.cwd(), LEG_HEALTH_FILE), JSON.stringify(current, null, 2) + '\n');
  } catch (e) {
    console.warn(`[leg-health] could not write ${LEG_HEALTH_FILE}: ${(e as Error)?.message || e}`);
  }
  console.log(`[leg-health] house=${clean.house} ok=${clean.ok} fetched=${clean.fetched} parsed=${clean.parsed} settled=${clean.settled}${clean.reason ? ` reason="${clean.reason}"` : ''}`);
  return current;
}

/** exit hook helper: hard guards that process.exit(1) still leave a health
 *  record behind (ok=false with the guard's reason) before they exit. */
export function reportAndExit(h: Omit<LegHealth, 'ok'>, code = 1): never {
  reportLegHealth({ ...h, ok: false });
  process.exit(code);
}
