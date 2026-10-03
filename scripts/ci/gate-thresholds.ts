/**
 * gate-thresholds.ts — the engine gate's thresholds AS DATA, mirrored from
 * scripts/validate-engine.ts so a proposed change can be REPLAYED against the
 * archived nightly reports before it ships (scripts/ci/gate-replay.ts).
 *
 * POLICY (docs/RUNBOOK.md "Engine-gate policy"): G1 flipped between blocking
 * and warning 3× in 23 days (Sep 2–27 2026), each time on one night's
 * evidence. Any change to a threshold in validate-engine.ts must:
 *   1. change the SAME value here (scripts/__tests__/gate-replay.test.ts is a
 *      tripwire: it fails when validate-engine.ts's literals and this file
 *      disagree), and
 *   2. ship with the replay output — which of the last 30 nights flip:
 *        npx tsx scripts/ci/gate-replay.ts --r2 --set g1.spreadMin=8
 */
export interface GateThresholds {
  /** a bucket is measured only at n ≥ minN */
  minN: number;
  /** dip tolerance: max(dipFloorPt, dipSe × SE of the rate difference) */
  dipFloorPt: number;
  dipSe: number;
  g1: { spreadMin: number; dipBlocks: boolean };
  g2: { spreadMin: number; dipBlocks: boolean };
  g3: { highMaxMedErr: number; highMustBeatLow: boolean };
  g4: { minCoveragePct: number };
}

export const CURRENT_GATE: GateThresholds = {
  minN: 30,
  dipFloorPt: 5,
  dipSe: 2,
  g1: { spreadMin: 10, dipBlocks: false },   // Sep 27 2026: dip WARNS (degraded), spread BLOCKS
  g2: { spreadMin: 5, dipBlocks: true },
  g3: { highMaxMedErr: 1.6, highMustBeatLow: true },
  g4: { minCoveragePct: 10 },
};
