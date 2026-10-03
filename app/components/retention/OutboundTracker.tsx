'use client';

import { useEffect } from 'react';
import { track } from '../../lib/analytics';

/** True for the "View at <house>" CTA (LotPage + ComparableModal): an
 *  off-site link whose visible text starts "View at". Exported for tests. */
export function isHouseOutbound(text: string, href: string, pageHost: string): boolean {
  if (!/^\s*View at\b/.test(text)) return false;
  try {
    const u = new URL(href, `https://${pageHost}`);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.host !== pageHost;
  } catch { return false; }
}

/**
 * Counts outbound house clicks by DELEGATION — one capture listener on the
 * document, so the lot page and the comparable modal need no wiring. Counts
 * the verb only: the href, the lot and the house are never sent.
 */
export default function OutboundTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (a && isHouseOutbound(a.textContent || '', a.href, window.location.host)) track('outbound_house');
    };
    document.addEventListener('click', onClick, { capture: true });
    // middle-click / ctrl-click open in a new tab without a 'click' on some engines
    const onAux = (e: MouseEvent) => { if (e.button === 1) onClick(e); };
    document.addEventListener('auxclick', onAux, { capture: true });
    return () => {
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('auxclick', onAux, { capture: true });
    };
  }, []);
  return null;
}
