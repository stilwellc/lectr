/**
 * player-era.ts — a player's CAREER ERA from the corpus (Oct 29 2026, pass 8).
 *
 * players.json (scripts/build-market §3e) stamps each player with
 * `era: { from, to, n }` — the 10th and 90th percentile of the CARD YEARS
 * of their sold lots (every sold lot one sample, so a single 1952 reprint
 * never stretches a modern player), from at least ERA_MIN_LOTS dated lots.
 * The recommender (app/lib/recs) reads it as `TasteInput.playerEras` — the
 * desk's own saves of a name come first; this fills in when a save carries
 * no year ("JOE NAMATH … TEAM ISSUED JERSEY" with no date). Additive: an
 * older reader ignores the key. Pure; shared by the build, the profile's
 * taste hook, the Daily Desk runner and the sweep.
 */

export interface PlayerEra { from: number; to: number; /** dated lots behind it */ n: number }

/** dated lots a player needs before an era is stamped */
export const ERA_MIN_LOTS = 5;
const ERA_LO = 0.1, ERA_HI = 0.9;

/** the year a card parse carries ("2017", "1996-97", "1952") as a number, or null */
export function cardYear(y: string | number | null | undefined): number | null {
  if (y == null) return null;
  const m = String(y).match(/\b(1[89]\d{2}|20\d{2})\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1850 && n <= 2100 ? n : null;
}

/** the 10th–90th percentile span of the years (each one sample), or null under the floor */
export function eraFromYears(years: readonly number[], min = ERA_MIN_LOTS): PlayerEra | null {
  const xs = years.filter(y => Number.isFinite(y)).sort((a, b) => a - b);
  if (xs.length < min) return null;
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round((xs.length - 1) * q)))];
  return { from: at(ERA_LO), to: at(ERA_HI), n: xs.length };
}

/** players.json's eras as the recommender reads them: `pl:<slug>` → { lo, hi } */
export function playerErasOf(players: Iterable<{ slug: string; era?: PlayerEra | null }> | null | undefined): Map<string, { lo: number; hi: number }> {
  const out = new Map<string, { lo: number; hi: number }>();
  if (!players) return out;
  for (const p of Array.from(players)) if (p?.slug && p.era && Number.isFinite(p.era.from) && Number.isFinite(p.era.to)) out.set(`pl:${p.slug}`, { lo: p.era.from, hi: p.era.to });
  return out;
}
