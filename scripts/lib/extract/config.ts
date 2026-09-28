/**
 * extract/config.ts — the ONE switchboard for the LLM structured-extraction
 * layer (Sep 28 2026).
 *
 * INERT BY DEFAULT. With no ANTHROPIC_API_KEY the layer never builds a client,
 * never reads or writes the cache, and never touches a lot: every hook returns
 * its input unchanged, so normalize + build-market are byte-identical to a
 * tree without this directory. The only trace is ONE log line per process.
 *
 * Two independent gates:
 *   · CALL gate  — `extractCallEnabled()`: ANTHROPIC_API_KEY present (and
 *     RAY_EXTRACT != '0'). Only the nightly runner (run.ts) and the eval
 *     harness make API calls; they need the key.
 *   · APPLY gate — `extractApplyEnabled()`: the key is present OR
 *     RAY_EXTRACT_APPLY=1 (and RAY_EXTRACT != '0'). The assemble step reads the
 *     cache the runner wrote; it does not need the secret itself, so CI binds
 *     RAY_EXTRACT_APPLY from `secrets.ANTHROPIC_API_KEY != ''` instead.
 */
import * as path from 'path';

export const EXTRACT_PROMPT_VERSION = 'x1-2026-09-28';
export const SAME_PROMPT_VERSION = 's1-2026-09-28';

export const env = (k: string): string => (process.env[k] || '').trim();

export function extractCallEnabled(): boolean {
  return env('RAY_EXTRACT') !== '0' && env('ANTHROPIC_API_KEY') !== '';
}
export function extractApplyEnabled(): boolean {
  if (env('RAY_EXTRACT') === '0') return false;
  return env('ANTHROPIC_API_KEY') !== '' || env('RAY_EXTRACT_APPLY') === '1';
}

let offLogged = false;
/** The single "extraction is off" line — printed at most once per process. */
export function logExtractionOff(where: string): void {
  if (offLogged) return;
  offLogged = true;
  const why = env('RAY_EXTRACT') === '0' ? 'RAY_EXTRACT=0' : 'no ANTHROPIC_API_KEY';
  console.log(`[extract] LLM extraction off (${why}) — regex parsers only [${where}]`);
}

/** Bulk field extraction model (Message Batches, 50% price). */
export const extractModel = (): string => env('RAY_EXTRACT_MODEL') || 'claude-haiku-4-5-20251001';
/** Same-object pair check model. */
export const sameModel = (): string => env('RAY_EXTRACT_SAME_MODEL') || 'claude-sonnet-5';

const intEnv = (k: string, d: number): number => {
  const n = parseInt(env(k), 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
/** Hard per-night cap on lots SENT for field extraction. */
export const maxLots = (): number => intEnv('RAY_EXTRACT_MAX', 20000);
/** Hard per-night cap on same-object PAIRS sent. */
export const maxPairs = (): number => intEnv('RAY_EXTRACT_PAIRS_MAX', 2000);
/** Minutes the runner waits on tonight's batches before leaving them pending
 *  (a pending batch is collected by the next night's run — results live 29d). */
export const waitMinutes = (): number => intEnv('RAY_EXTRACT_WAIT_MIN', 45);
/** Requests per submitted batch (the API cap is 100k / 256MB; each request
 *  repeats the ~16KB system prompt, so 4000 keeps a batch well under 256MB). */
export const BATCH_CHUNK = 4000;

export const cachePath = (): string =>
  env('RAY_EXTRACT_CACHE') || path.join(process.cwd(), 'data', 'corpus', 'extract-cache.json.gz');

/** $/MTok list prices (Batch API halves them). cacheWrite is the 1h-TTL write
 *  (2x base input — the system prefix is cached with ttl '1h'). Overridable
 *  for re-pricing without a code change: RAY_EXTRACT_PRICE="in,out". */
export interface Price { in: number; out: number; cacheRead: number; cacheWrite: number }
export function priceOf(model: string): Price {
  const o = env('RAY_EXTRACT_PRICE');
  if (o) {
    const [i, out] = o.split(',').map(Number);
    if (i > 0 && out > 0) return { in: i, out, cacheRead: i * 0.1, cacheWrite: i * 2 };
  }
  if (/haiku-4-5/.test(model)) return { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 2 };
  if (/sonnet-5/.test(model)) return { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 4 };
  if (/sonnet/.test(model)) return { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 6 };
  if (/opus/.test(model)) return { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 10 };
  return { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 6 };
}
export const BATCH_DISCOUNT = 0.5;
/** rough chars→tokens for pre-submit estimates (English + digits ≈ 3.6) */
export const tokensOf = (chars: number): number => Math.ceil(chars / 3.6);
