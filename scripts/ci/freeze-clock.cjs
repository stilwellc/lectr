// freeze-clock.cjs — pins the wall clock for the pipeline equivalence check
// (scripts/ci/equivalence.ts). Preload with
//   NODE_OPTIONS="--require ./scripts/ci/freeze-clock.cjs" RAY_FROZEN_NOW=2026-10-03T12:00:00Z
// so two builds of the SAME input run at different real times still read the
// same "today" — every recency window, decay weight, days-out bucket and
// generatedAt stamp becomes a pure function of the input. Date.now() and a
// no-arg `new Date()` return the frozen instant; every other Date use is
// untouched. Never loaded by the nightly itself.
'use strict';
const iso = process.env.RAY_FROZEN_NOW;
if (iso) {
  const FROZEN = Date.parse(iso);
  if (!Number.isFinite(FROZEN)) throw new Error(`[freeze-clock] RAY_FROZEN_NOW unparseable: ${iso}`);
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(FROZEN);
      else super(...args);
    }
    static now() { return FROZEN; }
  }
  // keep Date.parse / Date.UTC / prototype identity
  globalThis.Date = FrozenDate;
}
