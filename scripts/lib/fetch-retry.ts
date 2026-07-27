/**
 * fetchWithRetry — shared transient-failure retry for the house crawlers.
 *
 * Retries on 5xx responses, network errors, timeouts, AND 429 (Too Many
 * Requests). Other 4xx responses are returned immediately (a 404/403 is an
 * answer, not a transient fault) and the final-attempt 5xx/429 is also
 * RETURNED (not thrown) so every existing `if (!res.ok)` call-site branch keeps
 * working byte-identically.
 *
 * 429 handling (rate-limit safety): a rate-limited maker must back OFF, not
 * drop its lots — a 429-banned crawler is worse than a slow one. So 429 gets a
 * LONGER, dedicated backoff: honor the Retry-After header if the server sent
 * one (delta-seconds or an HTTP-date), else exponential from ~2s, hard-capped
 * at 30s. This is independent of the 5xx backoff below so a rate-limit doesn't
 * inherit the shorter 5xx schedule.
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
const RATE_LIMIT_BACKOFF_MS = 2_000;
const RATE_LIMIT_CAP_MS = 30_000;

export interface FetchRetryOpts {
  /** attempts AFTER the first (default 2 → 3 total attempts) */
  retries?: number;
  /** first backoff delay; doubles per retry, capped at 8s (default 1000) */
  backoffMs?: number;
}

/**
 * Parse a Retry-After header (RFC 7231): either a delta in seconds or an
 * HTTP-date. Returns ms to wait, or null if absent/unparseable. Clamped to the
 * 30s cap so a hostile/huge value can't stall the whole pool.
 */
function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, RATE_LIMIT_CAP_MS);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), RATE_LIMIT_CAP_MS);
  return null;
}

export async function fetchWithRetry(
  url: string | URL,
  opts: RequestInit & { timeoutMs?: number } = {},
  { retries = 2, backoffMs = 1000 }: FetchRetryOpts = {},
): Promise<Response> {
  const { timeoutMs, signal, ...init } = opts;
  let lastErr: unknown = new Error('fetchWithRetry: no attempts made');
  // 429 gets its own longer backoff schedule, advanced only on a 429 (so a mix
  // of 5xx + 429 across attempts doesn't skip rate-limit steps).
  let rateLimitAttempt = 0;
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
      // 429 = rate limited → back off LONGER (Retry-After if given, else
      // exponential from ~2s, capped 30s) and retry. On the final attempt fall
      // through and return it so callers' `!res.ok` handling is unchanged.
      if (res.status === 429 && attempt < retries) {
        const backoff = parseRetryAfter(res) ??
          Math.min(RATE_LIMIT_BACKOFF_MS * 2 ** rateLimitAttempt, RATE_LIMIT_CAP_MS);
        rateLimitAttempt++;
        lastErr = new Error('HTTP 429');
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      // 5xx = transient server fault → retry (unless out of attempts, then
      // return it so callers' `!res.ok` handling is unchanged). Anything else
      // (2xx/3xx/other 4xx) is final.
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
