/**
 * neighbour-domain.ts — (Oct 9) the culture DOMAIN of a lot no rule and no
 * learned name could domain, read off its CATALOGUE NEIGHBOURS.
 *
 * RR Auction (and the other houses that section a catalogue) group a sale's
 * lots into themed runs by lot number: a run of presidents, then the music
 * section, then Hollywood. A bare "Bobby Darin" lot sitting inside a run whose
 * worded lots the rules domained 'music' is music. The fill reads only:
 *  - the SAME sale (house + sale name + sale date), lot numbers parsed numerically;
 *  - a window of ±k lot numbers around the lot;
 *  - votes from the lots the RULES domained (never a name-learned or a
 *    neighbour-learned stamp, so a re-run converges);
 * and stamps a domain only when ≥ minN neighbours voted and the top domain
 * holds ≥ purity of the votes. It never overwrites a domain.
 */

/** the evidence gate of the neighbour fill */
export interface NeighbourGate { k: number; minN: number; purity: number }
/** (Oct 9 corpus, 1.14M rows) ±8 lots, ≥4 rule-domained neighbours, ≥90% of
 *  them one domain — see the commit for the threshold table and hand sample */
export const NEIGHBOUR_GATE: NeighbourGate = { k: 8, minN: 4, purity: 0.9 };

/** the space programs and the generic space figure vote as ONE family (an
 *  Apollo run holds Gemini lots); the stamp re-reads the lot's own text */
const SPACE_FAMILY = new Set(['apollo', 'shuttle-iss', 'mercury-gemini', 'soviet', 'space-science']);
export const domainFamily = (d: string): string => (SPACE_FAMILY.has(d) ? 'space-science' : d);

/** a lot number as a number: 123, "123", "123A" → 123; anything else → null */
export function lotNumberOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{1,6})(?![\d.])/);
  return m ? +m[1] : null;
}

/** one culture lot of the fill */
export interface NeighbourEntry {
  /** the sale identity: house | sale name | sale date */
  sale: string;
  /** the parsed lot number (null → neither votes nor is filled) */
  lot: number | null;
  /** the domain the RULES gave the lot (votes), or null */
  vote: string | null;
  /** a lot to fill (culture, undomained after every rule and the name map) */
  target: boolean;
}

/**
 * The neighbour domain FAMILY of every target entry (index → family) that
 * clears the gate. Pure: a function of the entries alone.
 */
export function neighbourDomains(entries: readonly NeighbourEntry[], gate: NeighbourGate = NEIGHBOUR_GATE): Map<number, string> {
  const out = new Map<number, string>();
  const bySale = new Map<string, number[]>();
  let anyTarget = false;
  entries.forEach((e, i) => {
    if (e.lot == null || (!e.vote && !e.target)) return;
    if (e.target) anyTarget = true;
    const g = bySale.get(e.sale);
    if (g) g.push(i); else bySale.set(e.sale, [i]);
  });
  if (!anyTarget) return out;
  bySale.forEach(idx => {
    if (!idx.some(i => entries[i].target)) return;
    idx.sort((a, b) => (entries[a].lot as number) - (entries[b].lot as number));
    for (let p = 0; p < idx.length; p++) {
      const e = entries[idx[p]];
      if (!e.target) continue;
      const n0 = e.lot as number;
      const c = new Map<string, number>();
      let tot = 0;
      const take = (q: number) => { const v = entries[idx[q]].vote; if (v) { const f = domainFamily(v); c.set(f, (c.get(f) || 0) + 1); tot++; } };
      for (let q = p - 1; q >= 0 && n0 - (entries[idx[q]].lot as number) <= gate.k; q--) take(q);
      for (let q = p + 1; q < idx.length && (entries[idx[q]].lot as number) - n0 <= gate.k; q++) take(q);
      if (tot < gate.minN) continue;
      let best = '', bestN = 0;
      c.forEach((n, d) => { if (n > bestN || (n === bestN && d < best)) { best = d; bestN = n; } });
      if (bestN / tot >= gate.purity) out.set(idx[p], best);
    }
  });
  return out;
}
