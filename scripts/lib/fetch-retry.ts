/**
 * fetchWithRetry — shared transient-failure retry for the house crawlers.
 *
 * Retries ONLY on 5xx responses, network errors, and timeouts. 4xx responses
 * are returned immediately (a 404/403 is an answer, not a transient fault) and
 * the final-attempt 5xx is also RETURNED (not thrown) so every existing
 * `if (!res.ok)` call-site branch keeps working byte-identically.
 *
 * Timeouts: pass `timeoutMs` instead of a pre-built AbortSignal — a fresh
 * AbortSignal.timeout() is armed PER ATTEMPT (a shared signal would already be
 * aborted on retry #1 and would keep ticking through backoff sleeps). Each
 * house passes its own existing timeout value, so per-house budgets are
 * preserved exactly.
 *
 * Backoff: exponential from backoffMs (1s → 2s → 4s …), hard-capped at 8s.
 */
const BACKOFF_CAP_MS = 8_000;

export interface FetchRetryOpts {
  /** attempts AFTER the first (default 2 → 3 total attempts) */
  retries?: number;
  /** first backoff delay; doubles per retry, capped at 8s (default 1000) */
  backoffMs?: number;
}

export async function fetchWithRetry(
  url: string | URL,
  opts: RequestInit & { timeoutMs?: number } = {},
  { retries = 2, backoffMs = 1000 }: FetchRetryOpts = {},
): Promise<Response> {
  const { timeoutMs, signal, ...init } = opts;
  let lastErr: unknown = new Error('fetchWithRetry: no attempts made');
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const wait = Math.min(backoffMs * 2 ** (attempt - 1), BACKOFF_CAP_MS);
      await new Promise(r => setTimeout(r, wait));
    }
    try {
      const res = await fetch(url, {
        ...init,
        signal: timeoutMs != null ? AbortSignal.timeout(timeoutMs) : signal,
      });
      // 5xx = transient server fault → retry (unless out of attempts, then
      // return it so callers' `!res.ok` handling is unchanged). Anything else
      // (2xx/3xx/4xx) is final.
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      // network error / DNS / abort-timeout → retry
      lastErr = e;
      if (attempt >= retries) throw e;
    }
  }
  throw lastErr; // unreachable, but satisfies control-flow analysis
}
