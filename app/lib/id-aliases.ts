/**
 * Lot-id aliases, client side (W16, Oct 11 2026) — one lot, one id.
 *
 * The build collapses a lot carried under two ids into ONE row under a
 * canonical id (scripts/lib/id-aliases: Christie's `christies-auc-<n>` is the
 * same object as `christies-<n>`, canonical `christies-<n>`) and serves the
 * alias → canonical map as /data/ray/id-aliases.json. An old link or save
 * keyed under the other id resolves through it:
 *   - lotIdTwins: the ids one id may be keyed under, by rule (no fetch) —
 *     app/lib/recs idAliases walks them for saves / the sold ledger;
 *   - canonicalLotId: the /lot route's redirect (fetches the map only for an
 *     alias-shaped id).
 */

const CHRISTIES = /^christies-(auc-)?(\d{5,})$/;

/** The other ids this id's lot may be keyed under, by rule (Christie's twin). */
export function lotIdTwins(id: string): string[] {
  const m = CHRISTIES.exec(id);
  if (!m) return [];
  return [m[1] ? `christies-${m[2]}` : `christies-auc-${m[2]}`];
}

/** Can this id be an alias (the map is fetched only for these)? */
export function mayBeAliasId(id: string): boolean {
  return /^christies-auc-\d{5,}$/.test(id);
}

let mapP: Promise<Record<string, string>> | null = null;
/** id-aliases.json (alias → canonical) — one fetch per session; a failed
 *  read is an empty map (the id is then tried as itself, as before). */
export function loadIdAliases(): Promise<Record<string, string>> {
  if (!mapP) {
    mapP = fetch('/data/ray/id-aliases.json')
      .then(r => (r.ok ? r.json() : null))
      .then((j: { aliases?: Record<string, string> } | null) => (j && j.aliases) || {})
      .catch(() => ({}));
  }
  return mapP;
}

/** The canonical id of a lot id (itself when it is no alias). */
export async function canonicalLotId(id: string): Promise<string> {
  if (!mayBeAliasId(id)) return id;
  const m = await loadIdAliases();
  return m[id] || id;
}
