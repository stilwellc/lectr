/**
 * mem-trace.ts — phase lines for the single-load nightly: wall clock (hrtime,
 * so a frozen Date in the equivalence harness can't zero it), heap, rss, and
 * the PEAK LIVE HEAP so far — the heap left right after each major
 * (mark-compact) GC, i.e. what the run actually holds, as opposed to
 * heapUsed at an arbitrary instant (which includes uncollected garbage).
 * Run with --expose-gc and each mark also forces a GC first (exact live).
 */
import { PerformanceObserver, constants } from 'perf_hooks';

let peakLive = 0;
let started = false;
let lastMark = 0;

function start(): void {
  if (started) return;
  started = true;
  try {
    const obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === constants.NODE_PERFORMANCE_GC_MAJOR) {
          const h = process.memoryUsage().heapUsed;
          if (h > peakLive) peakLive = h;
        }
      }
    });
    obs.observe({ entryTypes: ['gc'] });
  } catch { /* observer unavailable — marks still print */ }
}
start();

const MB = (n: number) => `${(n / 1048576).toFixed(0)}MB`;

/** Print one phase line. */
export function markPhase(name: string): void {
  (globalThis as { gc?: () => void }).gc?.();
  const mu = process.memoryUsage();
  if (mu.heapUsed > peakLive && (globalThis as { gc?: unknown }).gc) peakLive = mu.heapUsed;
  const now = performance.now();
  console.log(`[phase] ${name} · ${((now - lastMark) / 1000).toFixed(0)}s (t+${(now / 1000).toFixed(0)}s) · heap ${MB(mu.heapUsed)} · rss ${MB(mu.rss)} · peak live heap ${MB(peakLive)}`);
  lastMark = now;
}

export function peakLiveHeap(): number { return peakLive; }
