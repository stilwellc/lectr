/**
 * drill-rows.ts — the sub-market drill rows market.json carries (moved from
 * app/sub/[a]/[b]/page.tsx so scripts/build-og.tsx renders one share card per
 * sub-market from the SAME rows the pages prerender).
 *
 * SERVER-ONLY at build (node:fs); never import from a client component.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface DrillRow {
  slug: string;
  label?: string;
  vertical?: string;
  readType?: string;
  /** the figures a card prints (market.json carries them on every drill) */
  lots?: number;
  typicalUsd?: number | null;
  sellThroughPct?: number | null;
  record?: { usd?: number } | null;
  indexMethod?: string;
  indexSeries?: { period: string; value: number; n?: number }[];
}

let cache: DrillRow[] | null = null;

export function drillRows(): DrillRow[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'public', 'data', 'ray', 'market.json'),
      'utf8',
    );
    const drills = (JSON.parse(raw)?.drills ?? {}) as Record<string, DrillRow[]>;
    const seen = new Set<string>();
    cache = Object.values(drills).flat().filter(r => {
      // params come from here verbatim — guard the invariants the route
      // depends on (exactly one ':', both halves non-empty and path-safe)
      if (!r || typeof r.slug !== 'string') return false;
      if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(r.slug)) return false;
      if (seen.has(r.slug)) return false; // dupe slugs would collide as params
      seen.add(r.slug);
      return true;
    });
  } catch {
    cache = []; // no market.json (fresh checkout) — build ships zero sub pages
  }
  return cache;
}

export function findRow(a: string, b: string): DrillRow | null {
  return drillRows().find(r => r.slug === `${a}:${b}`) ?? null;
}


/** the share card a sub-market ships (scripts/build-og.tsx renders it) */
export const subCardPath = (slug: string) => `/og/s/${slug.replace(':', '/')}.png`;
