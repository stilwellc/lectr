/**
 * sw-register.ts — the page half of public/sw.js's last-seen-book cache
 * (W22, Oct 11 2026). The worker used to be registered only when someone
 * turned push on (app/lib/push.ts); now every production page registers it
 * once the page has loaded, so the SECOND visit paints from the cached book.
 *
 * Escape hatch: `?sw=off` on any URL turns caching off on this device (the
 * worker wipes its caches and passes everything through; a push
 * subscription keeps working — the worker is never unregistered, which
 * would drop it). `?sw=on` turns it back on.
 */

export const SW_OFF_KEY = 'lectr-sw-off';
const RELOAD_KEY = 'lectr-sw-reloaded';

export type SwStatus = {
  enabled: boolean;
  fromCache: boolean;
  offline: boolean;
  gen: string;
  lastCrawl: string;
  storedAt: number;
};

/** what a `?sw=` query asks for */
export function swToggle(search: string): 'off' | 'on' | null {
  const v = new URLSearchParams(search).get('sw');
  return v === 'off' || v === 'on' ? v : null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** the colophon's crawl stamp ("last read OCT 8"), UTC like the footer */
export function readStamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

/** the offline line — says the book is a saved copy and how old it is */
export function offlineLine(lastCrawl: string | null | undefined): string {
  const d = readStamp(lastCrawl);
  return d ? `Offline — showing the book as last read ${d}` : 'Offline — figures may be out of date';
}

function storage(kind: 'local' | 'session'): Storage | null {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; }
}

/** ask the controlling worker something; null when there is none / no answer */
export function askWorker<T>(msg: Record<string, unknown>, ms = 1500): Promise<T | null> {
  const ctl = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller : null;
  if (!ctl) return Promise.resolve(null);
  return new Promise(resolve => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = e => { clearTimeout(t); resolve(e.data as T); };
    ctl.postMessage(msg, [ch.port2]);
  });
}

/** register (or switch off) the worker; resolves once the decision is made */
export async function setupServiceWorker(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const toggle = swToggle(location.search);
  const ls = storage('local');
  if (toggle === 'off') {
    try { ls?.setItem(SW_OFF_KEY, '1'); } catch { /* private mode */ }
    await askWorker({ type: 'lectr-sw-off' });
    return;
  }
  if (toggle === 'on') {
    try { ls?.removeItem(SW_OFF_KEY); } catch { /* private mode */ }
    await askWorker({ type: 'lectr-sw-on' });
  }
  let off = false;
  try { off = ls?.getItem(SW_OFF_KEY) === '1'; } catch { /* private mode */ }
  if (off) return;
  const wasControlled = !!sw.controller;
  const reg = await sw.register('/sw.js', { scope: '/' });
  if (!wasControlled) {
    // this page loaded without the worker: once it takes over, have it store
    // this page and its book so the next visit paints from the cache
    await sw.ready;
    const warm = () => (reg.active || sw.controller)?.postMessage({ type: 'lectr-sw-warm', path: location.pathname });
    if (sw.controller) warm();
    else sw.addEventListener('controllerchange', warm, { once: true });
  }
}

/** a cached page whose code is gone from the server: reload onto the
 *  network copy, once per session (a loop is impossible) */
export function reloadOnce(): boolean {
  const ss = storage('session');
  try {
    if (ss?.getItem(RELOAD_KEY)) return false;
    ss?.setItem(RELOAD_KEY, '1');
  } catch { return false; }
  location.reload();
  return true;
}
