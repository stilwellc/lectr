/**
 * dossier-share.ts — per-link previews for the /player?id= and /entity?id=
 * query shells (Oct 20 2026), the dossier twin of functions/lot.
 *
 * One static HTML serves every player / entity dossier, so every shared link
 * unfurled as the site card. scripts/build-og.tsx writes each dossier's head
 * (title, measured facts, card — its own card when it has a /p or /e alias,
 * else its market's) into 64 shards under /og/q/ (app/lib/share-shard). A
 * link-preview bot gets the shell with that head; people, misses and errors
 * get the static page untouched. One ~40 KB static read per bot request,
 * memoised per isolate for the deploy's life (shards are immutable per deploy).
 */
import { isUnfurler, rewriteHead } from './share';
import { shareShardOf, shareShardPath, type ShareShard } from '../../app/lib/share-shard';

export interface PagesCtx {
  request: Request;
  env: { ASSETS: { fetch(req: Request): Promise<Response> } };
  waitUntil?(p: Promise<unknown>): void;
}

const memo = new Map<string, ShareShard>();
/** test hook */
export function resetDossierMemo() { memo.clear(); }

async function shardOf(ctx: PagesCtx, origin: string, n: number): Promise<ShareShard | null> {
  const p = shareShardPath(n);
  const hit = memo.get(p);
  if (hit) return hit;
  const res = await ctx.env.ASSETS.fetch(new Request(`${origin}${p}`, { method: 'GET' }));
  if (!res.ok) return null;
  const sh = (await res.json()) as ShareShard;
  memo.set(p, sh);
  return sh;
}

/** the shell, or — for an unfurler with a known id — the shell wearing that dossier's head */
export async function dossierPreview(ctx: PagesCtx, keyOf: (id: string) => string): Promise<Response> {
  const { request } = ctx;
  const page = await ctx.env.ASSETS.fetch(request);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id || !page.ok || !isUnfurler(request.headers.get('user-agent'))) return page;
  try {
    const key = keyOf(id);
    const row = (await shardOf(ctx, url.origin, shareShardOf(key)))?.[key];
    if (!row) return page;
    const [title, description, image] = row;
    const html = rewriteHead(await page.text(), {
      title, description, imageAlt: title, url: url.toString(),
      image: /^https?:/.test(image) ? image : `${url.origin}${image}`, card: true,
    });
    const headers = new Headers(page.headers);
    headers.delete('content-length');
    headers.set('cache-control', 'public, max-age=300');
    headers.set('vary', 'user-agent');
    return new Response(html, { status: 200, headers });
  } catch {
    return page;
  }
}
