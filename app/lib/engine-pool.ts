/**
 * engine-pool.ts — ONE LOT, ONE NUMBER (r7, Oct 10 2026).
 *
 * When the engine VALUED a lot it stamped its comp pool on lot.value: the
 * pool ids, n, and the comps median. That pool is the lot's comps — on the
 * lot page, in the comps modal, in the build's lot-pack and comp evidence —
 * whatever the call: below / above, "at comparable market", or no direction
 * (the engine valued it but held the flag back, e.g. abstain 'flag:purity').
 * Before r7 only a below / above call carried its rows; every other valued
 * lot printed a client appraisal as its "Comps median" (Diamond Dust Shoes:
 * $3.30M against the engine's $2.04M) over an empty "No comparable sales
 * clear the gates" list (QA2 Q3, ~1,100 live lots).
 *
 * A client read (comps.contextComps, guarded) speaks only where this
 * returns null: the engine abstained outright, or the lot is a card-comp
 * lot (its proof surface is the card block).
 */
export type EngineValueLike = {
  poolIds?: readonly (string | number)[] | null;
  n?: number | null;
  compMedianUsd?: number | null;
  compValueUsd?: number | null;
  compRatio?: number | null;
  signal?: { label: string } | null;
  basis?: string | null;
} | null | undefined;

export interface EnginePool {
  /** the comps median the engine stamped (compMedianUsd; older data: compValueUsd) */
  med: number;
  /** the pool's size (the engine's n — poolIds may be truncated) */
  n: number;
  ids: string[];
  /** a below / above call (the lamp); false = at market or no direction */
  directional: boolean;
}

export function enginePoolOf(v: EngineValueLike): EnginePool | null {
  if (!v || v.basis === 'card-comp') return null;
  const ids = v.poolIds || [];
  if (!ids.length) return null;
  // ×5 ESTIMATE-BAND SANITY (scripts/build-upcoming.ts): a ratio outside
  // [1/5, 5] is a data fault the build killed — never resurrected here
  if (v.compRatio == null || !(v.compRatio <= 5 && v.compRatio >= 1 / 5)) return null;
  const med = v.compMedianUsd ?? v.compValueUsd;
  if (med == null || !(med > 0)) return null;
  return {
    med,
    n: v.n || ids.length,
    ids: ids.map(String),
    directional: !!v.signal && !v.signal.label.startsWith('at'),
  };
}
