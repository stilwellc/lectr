/**
 * collection-logic.ts — the Collection room's pure reads (Oct 29 2026).
 *
 * THE MARK'S BASIS: every engine mark on an owned piece prints where it comes
 * from — how many comps, and how stale: a settled piece's value is the W31
 * settled appraisal, stamped with the night it was read (lot.valueAsOf);
 * the Portfolio room prints that clock (portfolio.asOfText) and the Collection
 * ledger printed "12 comps" alone. One text for both rooms.
 */
import { asOfText } from '../../portfolio/portfolio';

/** "12 comps · as of Oct 12" for a settled piece; "12 comps · live, read nightly"
 *  for a piece still on the block (no stamp); "12 comps" when the row carries a
 *  value with no clock (served before W31) */
export function markBasisText(compN: number, valueAsOf: string | null | undefined, nowYear: number, live = false): string {
  const comps = `${compN.toLocaleString()} ${compN === 1 ? 'comp' : 'comps'}`;
  const asOf = asOfText(valueAsOf, nowYear);
  if (asOf) return `${comps} · ${asOf}`;
  return live ? `${comps} · live, read nightly` : comps;
}
