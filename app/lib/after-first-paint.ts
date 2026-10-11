/**
 * afterFirstPaint — run deferred, non-visual work once the first screen has
 * had the CPU (perf wave W18, Oct 11 2026).
 *
 * The lazy chunks split off the first-load JS (the supabase client, the lot
 * modal) must not land in the same seconds the page is hydrating and painting
 * its first rows: on a 4×-throttled phone their parse + init cost ~0.5s of
 * main thread exactly when the rows render. The gate opens after the window
 * load event + a short settle + an idle slot — or at once on the reader's
 * first interaction (a tap, a key), so anything a reader asks for is never
 * held back.
 */
type Ric = (cb: () => void, o?: { timeout: number }) => number;

let gate: Promise<void> | null = null;

export function afterFirstPaint(): Promise<void> {
  if (gate) return gate;
  if (typeof window === 'undefined') return (gate = Promise.resolve());
  gate = new Promise<void>(resolve => {
    let done = false;
    const open = () => {
      if (done) return;
      done = true;
      for (const ev of EVENTS) window.removeEventListener(ev, open, true);
      resolve();
    };
    const EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const ev of EVENTS) window.addEventListener(ev, open, { capture: true, passive: true });
    const ric = (window as Window & { requestIdleCallback?: Ric }).requestIdleCallback;
    const settle = () => setTimeout(() => (ric ? ric(open, { timeout: 2000 }) : open()), 1500);
    if (document.readyState === 'complete') settle();
    else window.addEventListener('load', settle, { once: true });
  });
  return gate;
}
