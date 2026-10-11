'use client';

import { useEffect } from 'react';
import { track, type EventName } from '../../lib/analytics';

/**
 * Delegated product-event counters (app/lib/analytics — anonymous daily
 * counts, the event NAME only). One capture listener on the document, so the
 * cards, rows and pages need no wiring and nothing about the click — the
 * lot, the href, the house — ever leaves the page.
 *
 *   outbound_house  a "View at <house>" click (lot page, comps modal)
 *   pick_open       a pick opened — inside a [data-pick] card / row or the
 *                   /profile For you room (#for-you), on its open control
 */

/** True for the "View at <house>" CTA: an off-site link whose visible text
 *  starts "View at". Exported for tests. */
export function isHouseOutbound(text: string, href: string, pageHost: string): boolean {
  if (!/^\s*View at\b/.test(text)) return false;
  try {
    const u = new URL(href, `https://${pageHost}`);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.host !== pageHost;
  } catch { return false; }
}

interface ControlLike { getAttribute(k: string): string | null; hasAttribute(k: string): boolean }

/** Is this control (the nearest button / link to the click) the one that
 *  OPENS a pick? A whitelist — the card's stretched comps button, the phone
 *  row, a /lot link — so Save, More like this / Not for me, the tune menu,
 *  the calendar and a folded note's search never count as an open. */
export function isPickOpenControl(el: ControlLike | null): boolean {
  if (!el) return false;
  const role = el.getAttribute('role');
  if (role === 'link' || role === 'menuitem' || el.hasAttribute('aria-pressed') || el.hasAttribute('aria-haspopup')) return false;
  const label = el.getAttribute('aria-label') || '';
  if (/^(View comparable sales for|Comps for)\b/.test(label)) return true;
  const href = el.getAttribute('href') || '';
  return /^\/lot\?id=/.test(href);
}

export function DelegatedTrackers() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest) return;
      const a = t.closest('a[href]') as HTMLAnchorElement | null;
      if (a && isHouseOutbound(a.textContent || '', a.href, window.location.host)) track('outbound_house');
      const pick = t.closest('[data-pick], #for-you');
      if (pick && !t.closest('[role="dialog"]')) {
        const ctl = t.closest('button, a[href], [role="link"]');
        // the table view's whole row opens its pick (a pointer convenience
        // beside the row's real title button)
        if (isPickOpenControl(ctl) || (!ctl && pick.tagName === 'TR')) track('pick_open');
      }
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

/** Counts `event` once per `onceKey` per page-session when it mounts.
 *  Renders nothing. The key de-duplicates in the browser only; it is never
 *  sent. */
export function TrackOnMount({ event, onceKey }: { event: EventName; onceKey?: string }) {
  useEffect(() => { track(event, onceKey); }, [event, onceKey]);
  return null;
}
