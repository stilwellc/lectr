/**
 * Incremental-crawl skip-set — shared by the Christie's and Sotheby's auction
 * crawlers (extracted from ray-crawl.ts's Christie's-only block so both houses
 * run the SAME predicate and it stays unit-testable).
 *
 * A sale is "fully resolved" — and therefore skippable — only when EVERY lot
 * recorded under its saleName in the prior segment is:
 *   - terminal (sold / bought_in): no upcoming, withdrawn, unknown-result
 *   - not results-pending
 *   - not an online-only sale (its true close/revival comes from enrichment)
 *   - datable, AND closed longer ago than RESULT_PENDING_MS (late results can
 *     still post inside the window)
 * Any single failing lot disqualifies the whole name (conservative). saleName
 * is a SUPERSET key (recurring sales fold seasons under one name) — collisions
 * only make the predicate STRICTER: a live cohort blocks the name, but a skip
 * can never hide an unresolved lot. At worst we re-fetch a skippable sale; we
 * never skip a sale that still has a live/pending lot.
 */

export interface SkipLot {
  id?: string;
  saleName?: string;
  status?: string;
  url?: string | null;
  saleDate?: string;
  saleDateTime?: string | null;
  resultsPending?: boolean;
}

const TERMINAL = new Set(['sold', 'bought_in']);

/** Mirror of ray-crawl.ts's RESULT_PENDING_MS (houses post hammers late). */
export const SKIP_RESULT_PENDING_MS = 14 * 86_400_000;

/** True when every lot of a sale is a terminal, old, non-online result. */
export function saleFullyResolved(
  list: SkipLot[],
  now: number = Date.now(),
  pendingMs: number = SKIP_RESULT_PENDING_MS,
): boolean {
  for (const l of list) {
    if (!TERMINAL.has(String(l.status))) return false;        // upcoming/unknown-result/withdrawn → fetch
    if (l.resultsPending) return false;                        // pending → fetch
    if (l.url && /onlineonly/.test(l.url)) return false;       // online-only → always fetch
    const t = l.saleDateTime ? Date.parse(l.saleDateTime) : (l.saleDate ? Date.parse(l.saleDate) : NaN);
    if (isNaN(t)) return false;                                // undatable → fetch (can't prove it's old)
    if (now - t <= pendingMs) return false;                    // inside the late-result window → fetch
  }
  return list.length > 0;
}

/**
 * Build { skippable sale names → prior-lot counts } from a segment.
 * `include` scopes which prior lots participate (e.g. only `christies-auc-*`
 * ids for Christie's; all Sotheby's-house lots for Sotheby's — the artist-page
 * lots that share a name only add STRICTNESS, never a wrongful skip).
 */
export function buildSkippableSaleNames(
  prior: SkipLot[],
  include: (l: SkipLot) => boolean,
  now: number = Date.now(),
): Map<string, number> {
  const byName = new Map<string, SkipLot[]>();
  for (const l of prior) {
    if (!include(l)) continue;
    const name = String(l.saleName || '');
    if (!name) continue; // unnamed lots can never key a skip
    const list = byName.get(name) || [];
    list.push(l);
    byName.set(name, list);
  }
  const out = new Map<string, number>();
  for (const [name, list] of Array.from(byName.entries())) {
    if (saleFullyResolved(list, now)) out.set(name, list.length);
  }
  return out;
}
