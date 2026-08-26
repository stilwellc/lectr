/**
 * condition.ts — condition-qualifier detection for floor honesty (Aug 14).
 *
 * The deep-value board's failure mode is a CONDITION mismatch, not math: a
 * "Missing Back" SkyBox Ruby comped against clean copies read 96% under
 * floor. A lot whose title carries a condition qualifier must neither (a)
 * receive a floor built from clean comps, nor (b) pollute the comp medians
 * clean lots are valued against. Title-level detection — the houses put
 * condition language in titles precisely because it prices.
 */
const CONDITION_RE = /\b(damaged|incomplete|partial(?!\s+refund)|missing\b|trimmed|altered|recolou?red|restored|rebacked|creas(ed|es|ing)|torn|tear\b|taped|water damage|writing on|paper loss|as[- ]is|poor condition|heavily worn|miscut(?! error)|detached|hole punched|glue|residue)\b/i;

/** True when the title carries a value-destroying condition qualifier. */
export function hasConditionFlag(title: string | null | undefined): boolean {
  return !!title && CONDITION_RE.test(title);
}
