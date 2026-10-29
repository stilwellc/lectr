'use client';
/**
 * THE DAILY DESK NUDGE (Oct 29 2026) — one quiet line at the foot of the
 * Today band for a signed-in reader who hasn't turned the morning paper on:
 * "Get this desk as a morning paper — turn on the Daily Desk →", the link a
 * jump to #account (where the toggle lives, rooms/account.tsx). Never a
 * nag: × dismisses it for the tab session (sessionStorage), it never prints
 * once the paper is on, and it prints nothing while the preference is still
 * loading or the table isn't there. `?preview=daily` (never in production)
 * shows it without an account — local mode has no auth.
 */
import React, { useState } from 'react';
import { useDeskInternals } from './provider';
import { jump } from '../rail';

const DISMISS_KEY = 'lectr-daily-nudge';

/** the dev-only preview flag (the signed-out preview's own convention,
 *  provider.tsx). The desk renders client-side only, so the initializer may
 *  read the address bar (no effect, no second render). */
export function useDailyPreview(): boolean {
  const [on] = useState(() => {
    if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false;
    try { return new URLSearchParams(window.location.search).get('preview') === 'daily'; } catch { return false; }
  });
  return on;
}

export function DailyNudge() {
  // ONE read of the preference, the provider's (the Account toggle shares it)
  const { auth, daily: { state } } = useDeskInternals();
  const user = auth.authEnabled ? auth.user : null;
  const preview = useDailyPreview();
  // the session's memory, read once (client-only render: the initializer may read storage)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return window.sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const show = !dismissed && (preview || (!!user && state === 'off'));
  if (!show) return null;
  const dismiss = () => { setDismissed(true); try { window.sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage blocked */ } };
  return (
    <div className="rail dk-nudge" role="note">
      <p>
        Get this desk as a morning paper —{' '}
        <a href="#account" className="dk-nudge-link" onClick={e => { e.preventDefault(); jump('account'); }}>turn on the Daily Desk <span aria-hidden>→</span></a>
      </p>
      <button type="button" className="dk-nudge-x" aria-label="Dismiss for now" title="Not now" onClick={dismiss}><span aria-hidden>×</span></button>
    </div>
  );
}
