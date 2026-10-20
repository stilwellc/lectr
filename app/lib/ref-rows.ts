/**
 * ref-rows.ts — the watch-reference rows refs.json carries (moved from
 * app/ref/[maker]/[key]/page.tsx so scripts/build-og.tsx renders one share card
 * per reference from the SAME rows the pages prerender).
 *
 * SERVER-ONLY at build (node:fs) — same doctrine as app/lot/flagged.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { encodeRefPath, decodeRefPath } from '../ref/ref-path';

export interface RefRow {
  key: string;
  maker: string;
  ref: string;
  n: number;
  medianUsd: number;
  ttmMedianUsd: number | null;
  houses: string[];
}

let cache: RefRow[] | null = null;

export function refRows(): RefRow[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'public', 'data', 'ray', 'refs.json'),
      'utf8',
    );
    const rows = (JSON.parse(raw)?.refs as RefRow[]) || [];
    const seen = new Set<string>();
    cache = rows.filter(r => {
      if (!r || typeof r.maker !== 'string' || typeof r.ref !== 'string') return false;
      if (!/^[a-z0-9-]+$/.test(r.maker) || !r.ref) return false;
      const p = `${r.maker}/${encodeRefPath(r.ref)}`;
      if (seen.has(p)) return false; // dupe params would collide as pages
      seen.add(p);
      return true;
    });
  } catch {
    cache = []; // no refs.json (fresh checkout) — build ships zero ref pages
  }
  return cache;
}

export function findRow(maker: string, key: string): RefRow | null {
  const ref = decodeRefPath(key);
  return refRows().find(r => r.maker === maker && r.ref === ref) ?? null;
}


/** the share card a reference ships (scripts/build-og.tsx renders it) */
export const refCardPath = (maker: string, ref: string) => `/og/r/${maker}/${encodeRefPath(ref)}.png`;
