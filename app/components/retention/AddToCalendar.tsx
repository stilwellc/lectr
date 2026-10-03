'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuctionLot } from '../../types';
import { makeAuctionIcs } from '../../utils';
import { track } from '../../lib/analytics';

/**
 * "Add to calendar" — an explicit, confirmed .ics hand-off (it replaced the
 * card's "Remind me", which downloaded a file silently and then claimed
 * "Added to calendar" whether or not anything was added).
 *
 * What happens, said plainly in the confirmation:
 *  - iPhone/iPad: the .ics opens in a new tab and iOS offers "Add to Calendar".
 *  - everywhere else: the file downloads; opening it adds the event.
 * Either way the event carries two alarms (a day + an hour ahead of a timed
 * close; ahead of the sale day for a date-only sale). A subscribable per-user
 * watchlist calendar is out of scope (no server) — docs/RETENTION.md.
 */
export function icsFileName(lotId: string): string {
  return `lectr-${lotId.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80)}.ics`;
}

export default function AddToCalendar({ lot, className = 'ray-lot-remind' }: { lot: AuctionLot; className?: string }) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function add(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation(); // the card behind opens the comps modal on click
    const ics = makeAuctionIcs(lot);
    if (!ics) {
      setToast('This lot has no readable sale date, so there is nothing to add.');
    } else {
      const name = icsFileName(lot.id);
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1);
      // iOS hands a text/calendar tab to Calendar; desktop gets a named download
      const opened = ios ? window.open(url, '_blank') : null;
      if (!opened) {
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const alarms = lot.saleDateTime ? 'the event is the closing hour, with reminders a day and an hour ahead' : 'with reminders ahead of the sale day';
      setToast(opened
        ? `Calendar event opened. Tap “Add to Calendar” to keep it (${alarms}).`
        : `Downloaded ${name}. Open it to add the sale to your calendar (${alarms}).`);
      track('calendar_add');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 7000);
  }

  return (
    <>
      <button onClick={add} className={className} aria-label={`Add the ${lot.title} sale to your calendar`}>
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1" y="2" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.25" fill="none" />
          <line x1="4" y1="1" x2="4" y2="4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          <line x1="10" y1="1" x2="10" y2="4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          <line x1="1" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.25" />
        </svg>
        Add to calendar
      </button>
      {toast && typeof document !== 'undefined' && createPortal(
        <div
          role="status"
          aria-live="polite"
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: '50%', bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
            transform: 'translateX(-50%)', zIndex: 300, width: 'max-content', maxWidth: 'min(92vw, 400px)',
            background: 'var(--toast-bg, rgba(28,26,20,0.96))', color: 'var(--color-fg)', border: '1px solid var(--hairline)',
            borderRadius: 10, padding: '11px 14px 11px 16px', fontSize: 13.5, lineHeight: 1.4,
            boxShadow: '0 8px 30px rgba(12,10,6,0.5)', display: 'flex', gap: 12, alignItems: 'flex-start',
          }}
        >
          <span>{toast}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            style={{ border: 'none', background: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 2, fontSize: 15, lineHeight: 1 }}
          >
            ×
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
