/**
 * Pages Function: every /api/* request. The router, validation and caching
 * live in functions/_lib/api.ts; this file only adapts the Pages context.
 * Binding: CORPUS → R2 bucket lectr-data (wrangler.toml).
 */
import { handleApi } from '../_lib/api';
import type { Env } from '../_lib/store';

interface PagesContext {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
  const edge = (globalThis as unknown as { caches?: { default?: unknown } }).caches?.default as Parameters<typeof handleApi>[3];
  return handleApi(context.request, context.env, { waitUntil: p => context.waitUntil(p) }, edge ?? null);
};
