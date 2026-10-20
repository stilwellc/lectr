/**
 * /lot — the lot query shell, with a per-lot head for link-preview bots.
 *
 * Every /lot?id=<id> link used to unfurl as the generic site card: one static
 * HTML serves every lot. For an unfurler (functions/_lib/share.ts isUnfurler)
 * this looks the lot up through the read-only lot API (same store, same id
 * aliases) and rewrites the head to that lot's title, sale facts and house
 * photo. Everyone else — and any miss, error or slow store — gets the static
 * page untouched, so a broken lookup can never break the page.
 */
import { handleApi } from '../_lib/api';
import { isUnfurler, lotShareMeta, rewriteHead, type ShareLot } from '../_lib/share';
import type { Env } from '../_lib/store';

interface Ctx { request: Request; env: Env & { ASSETS: { fetch(req: Request): Promise<Response> } }; waitUntil(p: Promise<unknown>): void }

const LOOKUP_MS = 2500;
const edgeCache = () => ((globalThis as unknown as { caches?: { default?: unknown } }).caches?.default as Parameters<typeof handleApi>[3]) ?? null;

/** an API body as text — stored rows may pass through gzipped */
async function textOf(res: Response): Promise<string> {
  if (res.headers.get('content-encoding') !== 'gzip' || !res.body) return res.text();
  return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  const page = await env.ASSETS.fetch(request);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id || !page.ok || !isUnfurler(request.headers.get('user-agent'))) return page;
  try {
    const api = new Request(`${url.origin}/api/lot/${encodeURIComponent(id)}`, { method: 'GET' });
    const res = await Promise.race([
      handleApi(api, env, { waitUntil: p => ctx.waitUntil(p) }, edgeCache()),
      new Promise<null>(r => setTimeout(() => r(null), LOOKUP_MS)),
    ]);
    if (!res || !res.ok) return page;
    const { lot } = JSON.parse(await textOf(res)) as { lot?: ShareLot };
    if (!lot?.id) return page;
    const html = rewriteHead(await page.text(), lotShareMeta(lot, url.origin));
    const headers = new Headers(page.headers);
    headers.delete('content-length');
    headers.set('cache-control', 'public, max-age=300');
    headers.set('vary', 'user-agent');
    return new Response(html, { status: 200, headers });
  } catch {
    return page;
  }
}
