'use client';

import { useEffect, useState } from 'react';
import { askWorker, offlineLine, reloadOnce, setupServiceWorker, type SwStatus } from '../lib/sw-register';

/**
 * Registers public/sw.js on every production page (after load, so a first
 * visit never waits on it) and prints the ONE honest line the cache needs:
 * when the reader is offline, the book on screen is a saved copy, dated by
 * its crawl. Same toast as the account notices (app/lib/account.tsx) — no
 * new visual language. Renders nothing otherwise.
 */
export default function ServiceWorker() {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    let alive = true;

    const showOffline = async (lastCrawl?: string) => {
      let crawl = lastCrawl;
      if (!crawl) crawl = (await askWorker<SwStatus>({ type: 'lectr-sw-status' }))?.lastCrawl;
      if (alive) setLine(offlineLine(crawl));
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; offline?: boolean; reload?: boolean; lastCrawl?: string } | null;
      if (!d || d.type !== 'lectr-sw') return;
      if (d.reload) { reloadOnce(); return; }
      if (d.offline) showOffline(d.lastCrawl);
    };
    const onOffline = () => { showOffline(); };
    const onOnline = () => setLine(null);
    sw.addEventListener('message', onMsg);
    sw.startMessages?.();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    // the worker may already know this tab's page came from the cache with no
    // network behind it
    if (sw.controller) {
      askWorker<SwStatus>({ type: 'lectr-sw-status' }).then(s => {
        if (s && (s.offline || !navigator.onLine) && s.fromCache) showOffline(s.lastCrawl);
      });
    } else if (!navigator.onLine) {
      showOffline();
    }

    const start = () => { setupServiceWorker().catch(() => { /* no worker: the site works as before */ }); };
    let idle: number | undefined;
    const kick = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) idle = ric(start, { timeout: 4000 });
      else idle = window.setTimeout(start, 1500);
    };
    if (document.readyState === 'complete') kick();
    else window.addEventListener('load', kick, { once: true });

    return () => {
      alive = false;
      sw.removeEventListener('message', onMsg);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('load', kick);
      if (idle !== undefined) {
        const cic = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
        if (cic) cic(idle); else clearTimeout(idle);
      }
    };
  }, []);

  if (!line) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={() => setLine(null)}
      style={{
        position: 'fixed', left: '50%', bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
        transform: 'translateX(-50%)', zIndex: 300, maxWidth: 'min(92vw, 360px)',
        background: 'var(--toast-bg, rgba(28,26,20,0.96))', color: 'var(--color-fg)', border: '1px solid var(--hairline)',
        borderRadius: 10, padding: '11px 16px', fontSize: 13.5, lineHeight: 1.35, textAlign: 'center',
        boxShadow: '0 8px 30px rgba(12,10,6,0.5)', backdropFilter: 'blur(6px)',
      }}
    >
      {line}
    </div>
  );
}
