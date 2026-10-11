/**
 * aliases.ts — the lot API's side of ONE LOT, ONE ID (W16 id aliases).
 *
 * The build collapses a lot carried under two ids into one row under its
 * canonical id (scripts/lib/id-aliases: Christie's `christies-auc-<n>` →
 * `christies-<n>`) and serves the alias → canonical map as
 * /data/ray/id-aliases.json. The /lot route and the saves resolution read
 * that map (app/lib/id-aliases); the API reads the SAME served file — never a
 * second copy of the rule — so an old link, save or ledger key under the
 * alias id answers with the canonical row here too.
 *
 * Cost: only an alias-shaped id (app/lib/id-aliases mayBeAliasId) that MISSED
 * the index ever reads the map, once per isolate per corpus version (a few KB
 * from the Pages asset binding, no R2). A failed or non-JSON read (the map not
 * deployed yet: the asset fallback is HTML) is an empty map for a minute — the
 * id then answers as itself (404), as before.
 */
import { mayBeAliasId } from '../../app/lib/id-aliases';

/** the served map — the same file app/lib/id-aliases loadIdAliases reads */
export const ID_ALIASES_PATH = '/data/ray/id-aliases.json';

/** the Pages static-asset binding (env.ASSETS) — only `fetch` is used */
export interface AssetsLike { fetch(req: Request): Promise<Response> }

const OK_TTL_MS = 10 * 60_000; // a code-only redeploy can ship a new map under the same corpus version
const FAIL_TTL_MS = 60_000;

let memo: { version: string; at: number; ttl: number; p: Promise<Record<string, string>> } | null = null;

/** Test hook. */
export function resetAliasMemo() { memo = null; }

async function readMap(assets: AssetsLike, origin: string): Promise<Record<string, string> | null> {
  const r = await assets.fetch(new Request(`${origin}${ID_ALIASES_PATH}`, { method: 'GET' }));
  if (!r.ok) return null;
  const j = JSON.parse(await r.text()) as { aliases?: unknown };
  const a = j && j.aliases;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a as Record<string, unknown>)) if (typeof v === 'string' && v && v !== k) out[k] = v;
  return out;
}

/** alias → canonical, memoized per isolate and corpus version */
export function aliasMap(assets: AssetsLike | undefined, origin: string, version: string): Promise<Record<string, string>> {
  if (!assets) return Promise.resolve({});
  const now = Date.now();
  if (memo && memo.version === version && now - memo.at < memo.ttl) return memo.p;
  const m = { version, at: now, ttl: OK_TTL_MS, p: Promise.resolve({} as Record<string, string>) };
  m.p = readMap(assets, origin)
    .catch(() => null)
    .then(x => { if (!x) m.ttl = FAIL_TTL_MS; return x || {}; });
  memo = m;
  return m.p;
}

/** The canonical id an id that missed the index answers under, or null (not
 *  an alias). Ids that are not alias-shaped never read the map. */
export async function canonicalOf(id: string, assets: AssetsLike | undefined, origin: string, version: string): Promise<string | null> {
  if (!mayBeAliasId(id)) return null;
  const c = (await aliasMap(assets, origin, version))[id];
  return c && c !== id ? c : null;
}
