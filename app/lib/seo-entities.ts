import fs from 'node:fs';
import path from 'node:path';
import { decodeEntities, isEntitiesWire } from './entity/wire';
import type { EntitySummary } from './entity/model';
import { slugify } from './seo';
import { displayName, KIND_NOUN } from './entity/display';
import { formatPrice } from '../utils';
import { entityQueryOf, encodeAliases } from './entity/aliases';

/**
 * The STATIC entity aliases (SEO wave, Oct 11 2026) — /p/<player> and
 * /e/<name> for the deepest names lectr tracks. The universal dossiers are
 * query pages (/player?id=, /entity?id=): a static export ships ONE shell for
 * them, so every one of the 600 sitemap'd query URLs carried the same
 * generic title, description and site card, with no canonical. These paths
 * prerender per name with their own head, share card and structured data.
 * Every in-app link lands on them (W12: app/lib/entity/aliases, inlined into
 * the bundle by next.config.js); the query routes keep working and forward
 * to the alias, declaring it as their canonical (app/player, app/entity).
 *
 * The set is decided HERE, once, from the served entities files the build
 * reads — the same deploy ships the pages, the cards (scripts/build-og.tsx),
 * the sitemap and the alias manifest, so they can never disagree. Bounded:
 * the top PLAYER_CAP players and ENTITY_CAP other entities by sales tracked,
 * each with at least MIN_SOLD sales (the dossier's own bar), so the deploy
 * stays far under Cloudflare Pages' 20,000-file cap (~7 files a page).
 *
 * SERVER-ONLY (node:fs): metadata, generateStaticParams, sitemap and the
 * build scripts. Never import from a client component.
 */

export const PLAYER_CAP = 300;
export const ENTITY_CAP = 300;
const MIN_SOLD = 10;

export interface StaticEntity {
  id: string;
  kind: 'player' | 'entity';
  slug: string;
  /** the alias path ('/p/michael-jordan', '/e/charizard') */
  path: string;
  /** the query permalink it aliases ('/player?id=michael-jordan') */
  query: string;
  e: EntitySummary;
}

let cache: StaticEntity[] | null = null;

function readEntities(): EntitySummary[] {
  const dir = path.join(process.cwd(), 'public', 'data', 'ray', 'pages');
  const all: EntitySummary[] = [];
  for (const f of ['entities-all.json', 'entities-all-tail.json']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const file = isEntitiesWire(j) ? decodeEntities(j) : j;
      if (Array.isArray(file?.entities)) all.push(...file.entities);
    } catch { /* a torn file: no aliases from it */ }
  }
  return all;
}

const bySold = (a: EntitySummary, b: EntitySummary) => (b.sold ?? 0) - (a.sold ?? 0) || a.id.localeCompare(b.id);

/** the label slug, or — when two names in the set share one — the label
 *  slug qualified by the market (and the kind of name) so each is unique and
 *  stable whatever order the two sort in */
export function assignSlugs(rows: EntitySummary[], base: (e: EntitySummary) => string, qualify: (e: EntitySummary) => string): Map<string, string> {
  const count = new Map<string, number>();
  for (const e of rows) count.set(base(e), (count.get(base(e)) || 0) + 1);
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const e of rows) {
    let s = base(e);
    // a bare number ('151', a Pokémon set) says nothing in a URL: qualify it too
    if (!s || (count.get(s) || 0) > 1 || /^\d+$/.test(s)) s = slugify(`${base(e)} ${qualify(e)}`);
    // a qualified slug can still meet another (same name, market and kind): last resort, the id
    if (!s || used.has(s)) s = slugify(e.id.replace(/[|:]/g, ' '));
    if (used.has(s)) continue;
    used.add(s);
    out.set(e.id, s);
  }
  return out;
}

export function staticEntities(): StaticEntity[] {
  if (cache) return cache;
  const all = readEntities();
  const seen = new Set<string>();
  const uniq = all.filter(e => e && typeof e.id === 'string' && !seen.has(e.id) && (seen.add(e.id), true));
  const players = uniq
    .filter(e => e.kind === 'player' && e.id.startsWith('pl:') && (e.sold ?? 0) >= MIN_SOLD)
    .sort(bySold).slice(0, PLAYER_CAP);
  const others = uniq
    .filter(e => (e.kind === 'subject' || e.kind === 'set' || e.kind === 'sub') && (e.sold ?? 0) >= MIN_SOLD)
    .sort(bySold).slice(0, ENTITY_CAP);

  // a player's slug IS its id slug (pl:<slug>) — already unique and path-clean
  const pSlug = new Map(players.map(e => [e.id, e.id.slice(3)] as const));
  const eSlug = assignSlugs(others, e => slugify(e.label || ''), e => `${e.market} ${e.subKind || e.kind}`);

  const out: StaticEntity[] = [];
  for (const e of players) {
    const s = pSlug.get(e.id)!;
    if (!/^[a-z0-9-]+$/.test(s)) continue;
    out.push({ id: e.id, kind: 'player', slug: s, path: `/p/${s}`, query: entityQueryOf(e.id), e });
  }
  for (const e of others) {
    const s = eSlug.get(e.id);
    if (!s) continue;
    out.push({ id: e.id, kind: 'entity', slug: s, path: `/e/${s}`, query: entityQueryOf(e.id), e });
  }
  cache = out;
  return out;
}

/** the alias set as the client bundle carries it (app/lib/entity/aliases:
 *  next.config.js inlines it as NEXT_PUBLIC_ENTITY_ALIASES via
 *  scripts/entity-aliases.ts) — the same set the pages prerender from */
export function encodedEntityAliases(): string {
  return encodeAliases(staticEntities().map(x => ({ id: x.id, slug: x.slug })));
}

export function staticPlayers(): StaticEntity[] { return staticEntities().filter(x => x.kind === 'player'); }
export function staticOthers(): StaticEntity[] { return staticEntities().filter(x => x.kind === 'entity'); }

export function staticEntityBySlug(kind: StaticEntity['kind'], slug: string): StaticEntity | null {
  return staticEntities().find(x => x.kind === kind && x.slug === slug) ?? null;
}

/** the share card a static entity ships (scripts/build-og.tsx renders it) */
export const entityCardPath = (x: StaticEntity) => `/og/${x.kind === 'player' ? 'p' : 'e'}/${x.slug}.png`;

const nf = (x: number) => x.toLocaleString('en-US');

/** The measured facts a static dossier's head and card print — each one
 *  the summary's own field, with its n (honesty laws: no median without its
 *  count, nothing the page itself doesn't print). */
export interface EntityFacts {
  name: string;
  /** 'Basketball', 'Pokémon · Vintage (1996–2003)', 'Apollo' */
  kicker: string;
  sold: string | null;
  median: string | null;
  record: string | null;
  /** the median's lens, named ('Sports Cards · Singles') */
  medScope: string | null;
}

export function entityFacts(x: StaticEntity): EntityFacts {
  const e = x.e;
  const name = displayName(e.label || x.slug);
  const noun = e.kind === 'player' ? null : KIND_NOUN[e.kind === 'subject' ? (e.subKind || '') : e.kind] || null;
  const disc = e.discipline && e.discipline.length <= 40 ? e.discipline : null;
  const kicker = [noun && noun[0].toUpperCase() + noun.slice(1), disc].filter(Boolean).join(' · ') || (e.kind === 'player' ? 'Player' : 'Dossier');
  const sold = e.sold ? `${nf(e.sold)} ${e.sold === 1 ? 'sale' : 'sales'} tracked` : null;
  const median = e.med12m != null && e.med12mN ? `past-year median ${money(e.med12m)} (n=${nf(e.med12mN)})` : null;
  const yr = e.record?.d ? e.record.d.slice(0, 4) : null;
  const record = e.record?.p ? `record ${money(e.record.p)}${yr ? ` (${yr})` : ''}` : null;
  // the median's lens, only when it narrows the name (a collection's lens IS its name)
  const scope = e.medScope && e.medScope !== 'all' && e.medScope !== e.label && e.medScope !== e.discipline ? e.medScope : null;
  return { name, kicker, sold, median, record, medScope: scope };
}

/** the page's own figure, printed the way its ledger prints it (formatPrice:
 *  '$2K', '$10.09M') — one number, one spelling, head and page alike */
const money = formatPrice;

/** the dossier's meta description — measured facts first, then what the page is */
export function entityDescription(x: StaticEntity): string {
  const f = entityFacts(x);
  const med = f.median && f.medScope ? f.median.replace(' (n=', ` (${f.medScope}, n=`) : f.median;
  const facts = [f.sold, med, f.record].filter(Boolean).join(' · ');
  const what = x.kind === 'player'
    ? 'Cards, game-worn and memorabilia read together: live lots, the yearly median and the top results, read nightly.'
    : 'Live lots, what it sells for, the yearly median and the record, read nightly.';
  return `${f.name} at auction — ${facts ? `${facts}. ` : ''}${what} lectr auction intelligence.`;
}
