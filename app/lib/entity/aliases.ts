/**
 * entity/aliases.ts — the STATIC entity aliases on the client (W12, Oct 11
 * 2026). The build prerenders /p/<player> and /e/<name> for the deepest names
 * (app/lib/seo-entities decides the set, once); every in-app entity link goes
 * through entityPageOf (./key), which lands on the alias when this deploy
 * ships one and on the query route (/player?id=, /entity?id=) otherwise — so
 * a copied link shares the name's own title and card, not the generic shell.
 *
 * The map rides in the JS bundle: next.config.js runs scripts/entity-aliases.ts
 * (the same staticEntities() the pages come from) and inlines the result as
 * NEXT_PUBLIC_ENTITY_ALIASES — synchronous at render, the same on the
 * prerendered HTML and the hydrated page (no fetch, no link that changes
 * under the reader). Compact: a JSON array of ids, an entry carrying its slug
 * (`<id>><slug>`) only where it differs from the id's own tail. Absent (a
 * data-less checkout, a node script, a test) → no aliases, every link stays
 * on its query route.
 */

export interface AliasEntry { id: string; slug: string }

/** the slug an id gets when nothing collides: a player's id slug, else the
 *  key after the last ':' ('sj:tcg|k:charizard' → 'charizard') */
export function defaultAliasSlug(id: string): string {
  if (id.startsWith('pl:')) return id.slice(3);
  return id.slice(id.lastIndexOf(':') + 1);
}

/** the path a static alias is served at */
export const aliasPathOf = (id: string, slug: string) => `${id.startsWith('pl:') ? '/p' : '/e'}/${slug}`;

export function encodeAliases(xs: readonly AliasEntry[]): string {
  return JSON.stringify(xs.map(x => (x.slug === defaultAliasSlug(x.id) ? x.id : `${x.id}>${x.slug}`)));
}

export function decodeAliases(s: string | undefined | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!s) return out;
  let list: unknown;
  try { list = JSON.parse(s); } catch { return out; }
  if (!Array.isArray(list)) return out;
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const gt = v.indexOf('>');
    const id = gt < 0 ? v : v.slice(0, gt);
    const slug = gt < 0 ? defaultAliasSlug(v) : v.slice(gt + 1);
    if (id && /^[a-z0-9-]+$/.test(slug)) out.set(id, aliasPathOf(id, slug));
  }
  return out;
}

let map: Map<string, string> | null = null;
function aliases(): Map<string, string> {
  // the literal `process.env.NEXT_PUBLIC_…` is what Next inlines at build
  if (!map) map = decodeAliases(process.env.NEXT_PUBLIC_ENTITY_ALIASES);
  return map;
}

/** an entity id's static alias path ('/p/michael-jordan'), or null */
export function aliasOf(id: string): string | null {
  return aliases().get(id) ?? null;
}

/** the entity id a static alias path serves ('/e/charizard' → its id), or
 *  null — the reverse of aliasOf (the first-screen preload names the slice
 *  an alias page paints from) */
export function idOfAlias(path: string): string | null {
  let hit: string | null = null;
  aliases().forEach((p, id) => { if (!hit && p === path) hit = id; });
  return hit;
}

/** test seam: install an alias set (null → re-read the env) */
export function setEntityAliasesForTest(xs: readonly AliasEntry[] | null): void {
  map = xs ? decodeAliases(encodeAliases(xs)) : null;
}

/** the athlete slug a player-dossier href names — the query route
 *  (/player?id=<slug>) or its alias (/p/<slug>), with any search / hash */
export function playerSlugOfHref(href: string): string | null {
  const m = href.match(/^\/(?:player\?id=|p\/)([^?&#/]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/* ── THE entity hrefs. The only place a /player?id= or /entity?id= href is
   spelled (app/lib/__tests__/entity-aliases.test.ts fails on any other). ── */

/** the query route of a player / entity id — the page every id has */
export function entityQueryOf(id: string): string {
  return id.startsWith('pl:')
    ? `/player?id=${encodeURIComponent(id.slice(3))}`
    : `/entity?id=${encodeURIComponent(id)}`;
}

/** where a player / entity id links: its static alias when this deploy
 *  ships one, else its query route (a maker goes through key.ts entityPageOf) */
export function entityHrefOf(id: string): string {
  return aliasOf(id) ?? entityQueryOf(id);
}

/** an athlete's dossier href by slug ('michael-jordan' → '/p/michael-jordan') */
export const playerHrefOf = (slug: string) => entityHrefOf(`pl:${slug}`);
