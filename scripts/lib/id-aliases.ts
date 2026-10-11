/**
 * LOT-ID ALIASES (W16, Oct 11 2026) — one lot, one id; every other id it was
 * ever carried under resolves to it.
 *
 * Christie's is crawled by two crawlers that mint different ids for the SAME
 * lot (both carry Christie's object id):
 *   christies-<objectId>      the per-artist page crawler (houses/christies.ts
 *                             parseChristiesJson: secondary title, start_date,
 *                             lot number, "<City> Sale <n>")
 *   christies-auc-<objectId>  the sale crawler (crawlChristiesAuctions: maker +
 *                             title, end_date, the sale's own name, no lot #)
 * The Oct 11 production segment carried 189 objects under both (177 live on
 * both sides, 12 with a result on one side). normalize's URL-scheme dedupe
 * caught them (same /lot/lot-<n> path), so no published count or median held
 * both — but it kept a STATUS-ranked survivor (sold beats upcoming, then the
 * lexically-first id): a live pair published `christies-<n>`, and the night the
 * sale crawler resolved the lot first the published id flipped to
 * `christies-auc-<n>` (4 such pairs that night) — a save, link or sold-ledger
 * lookup keyed under the first id stopped resolving. It also needs the URL:
 * a pair whose URL is an onlineonly / nulled dead-sso one is not caught at all.
 *
 * Now (dedupeChristiesIdSchemes, normalize, before the URL dedupe):
 *   - pairs are keyed by OBJECT ID (no URL needed), title-checked;
 *   - the CANONICAL id is fixed — `christies-<objectId>` — whatever either
 *     side's status, so it never flips;
 *   - the row's CONTENT is the better-resolved side (a result beats a live
 *     row, the URL dedupe's rank), its empty fields filled from the twin, the
 *     earliest firstSeen kept;
 *   - the twin's id is recorded on the row (`idAliases`), and build-market
 *     serves the alias → canonical map (public/data/ray/id-aliases.json) the
 *     /lot route, the saves resolution (app/lib/recs idAliases) and the
 *     Supabase lots sync (stale twin rows deleted) read.
 */

/** Christie's object id behind either crawler's lot id, or null. */
export function christiesObjectIdOf(id: string): string | null {
  const m = /^christies-(?:auc-)?(\d{5,})$/.exec(id);
  return m ? m[1] : null;
}

/** The canonical id of a Christie's lot id (`christies-<objectId>`), or null. */
export function canonicalChristiesId(id: string): string | null {
  const n = christiesObjectIdOf(id);
  return n ? `christies-${n}` : null;
}

type Row = Record<string, unknown> & { id?: unknown; auctionHouse?: unknown; status?: unknown; title?: unknown; firstSeen?: unknown; idAliases?: unknown };

const STATUS_RANK: Record<string, number> = { sold: 0, bought_in: 1, upcoming: 2, 'unknown-result': 3, withdrawn: 4 };
const fold = (s: unknown): string => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** The two crawlers title one lot differently — the artist crawler the
 *  secondary title ("Grand Vase aux danseurs (A.R. 114)"), the sale crawler
 *  maker + title ("Pablo Picasso (1881-1973) Grand Vase aux danseurs (A.R.
 *  114)"). Same lot = one folded title inside the other. */
export function sameChristiesLot(a: Row, b: Row): boolean {
  const ta = fold(a.title), tb = fold(b.title);
  if (!ta || !tb) return true; // an untitled side: the object id alone
  return ta.includes(tb) || tb.includes(ta);
}

/** what a twin may lend the kept row: descriptive facts of the object, the
 *  same for both crawls of one lot (never status, prices, bids, live flags) */
const FILL_FIELDS = ['lotNumber', 'imageUrl', 'medium', 'dimensions', 'description', 'year', 'yearNum', 'heightCm', 'widthCm', 'depthCm',
  'provenance', 'literature', 'exhibited', 'estimateLow', 'estimateHigh', 'estLowNative', 'estHighNative', 'estLowUsd', 'estHighUsd'] as const;

const aliasesOf = (r: Row): string[] => (Array.isArray(r.idAliases) ? (r.idAliases as unknown[]).map(String) : []);

/**
 * Collapse every Christie's object carried under both id schemes into ONE row
 * under the canonical id, in place. Idempotent (a second pass finds no pair;
 * the canonical row keeps its `idAliases`). Returns the pair count and the
 * alias → canonical map of this pass.
 */
export function dedupeChristiesIdSchemes(lots: Row[]): { pairs: number; aliases: Record<string, string> } {
  const byObj = new Map<string, number[]>();
  for (let i = 0; i < lots.length; i++) {
    const r = lots[i];
    if (r.auctionHouse !== "Christie's") continue;
    const n = christiesObjectIdOf(String(r.id || ''));
    if (n) (byObj.get(n) || byObj.set(n, []).get(n)!).push(i);
  }
  const drop = new Set<number>();
  const aliases: Record<string, string> = {};
  let pairs = 0;
  byObj.forEach((ix, n) => {
    if (ix.length < 2) return;
    const canonical = `christies-${n}`;
    // the better-resolved side carries the content; tie → the canonical side
    const sorted = ix.slice().sort((a, b) => {
      const ra = STATUS_RANK[String(lots[a].status)] ?? 9, rb = STATUS_RANK[String(lots[b].status)] ?? 9;
      if (ra !== rb) return ra - rb;
      return (lots[a].id === canonical ? 0 : 1) - (lots[b].id === canonical ? 0 : 1);
    });
    const keep = lots[sorted[0]];
    const twins = sorted.slice(1).filter(j => sameChristiesLot(keep, lots[j]));
    if (!twins.length) return;
    pairs++;
    const ids = new Set<string>(aliasesOf(keep));
    for (const j of twins) {
      const t = lots[j];
      // the twin's descriptive facts the content side lacks (the lot number,
      // an image, dimensions …) — never a status / price / live flag
      for (const k of FILL_FIELDS) if ((keep[k] === undefined || keep[k] === null || keep[k] === '') && t[k] !== undefined && t[k] !== null && t[k] !== '') keep[k] = t[k];
      if (typeof t.firstSeen === 'string' && (typeof keep.firstSeen !== 'string' || t.firstSeen < keep.firstSeen)) keep.firstSeen = t.firstSeen;
      ids.add(String(t.id));
      for (const a of aliasesOf(t)) ids.add(a);
      drop.add(j);
    }
    ids.add(String(keep.id));
    ids.delete(canonical);
    keep.id = canonical;
    keep.idAliases = Array.from(ids).sort();
    for (const a of Array.from(ids)) aliases[a] = canonical;
  });
  if (drop.size) {
    let w = 0;
    for (let i = 0; i < lots.length; i++) if (!drop.has(i)) lots[w++] = lots[i];
    lots.length = w;
  }
  return { pairs, aliases };
}

/** The alias → canonical map the served rows carry (`idAliases`), for
 *  public/data/ray/id-aliases.json. */
export function aliasMapOf(rows: Iterable<{ id?: unknown; idAliases?: unknown }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of Array.from(rows)) {
    if (!Array.isArray(r.idAliases)) continue;
    for (const a of r.idAliases as unknown[]) if (String(a) !== String(r.id)) out[String(a)] = String(r.id);
  }
  return out;
}
