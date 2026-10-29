'use client';
/** ACCOUNT — who is signed in, where the desk lives, sign out (lifted from
 *  page.tsx unchanged); push opt-in rides here. */
import React from 'react';
import PushOptIn from '../../../components/retention/PushOptIn';
import { TrackOnMount } from '../../../components/retention/trackers';
import { useDeskInternals } from '../provider';
import { useDailyPreview } from '../nudge';
import { RoomHead } from '../../head';
import type { SectionProps, SectionMeta } from '../types';

/** the strip has no rail pill (it never had one) — `g a` still lands on it */
export function meta(): SectionMeta | null { return null; }

export default function AccountStrip(_p: SectionProps) {
  const { auth, signedOutView } = useDeskInternals();
  const { authEnabled, user, signInWithGoogle, signOut } = auth;
  return (
    <section id="account" className="rail ck-account" aria-label="Account">
      <RoomHead level={3} title="Account" style={{ marginBottom: 4 }} />
      <div className="ck-account-in">
        {authEnabled && user ? (
          <span>
            {user.email || 'Signed in'} · your desk syncs to your account ·{' '}
            <button type="button" className="ck-warn-btn ck-account-btn" onClick={() => signOut()}>Sign out</button>
          </span>
        ) : signedOutView ? (
          <span>
            Not signed in — follows, interests and what this device learned stay in this browser ·{' '}
            <button type="button" className="ck-warn-btn ck-account-btn" onClick={() => signInWithGoogle()}>Sign in with Google</button>
          </span>
        ) : authEnabled && !user ? (
          <span>
            Saved on this device — sign in to keep your saves, follows, record and collection on every device ·{' '}
            <button type="button" className="ck-warn-btn ck-account-btn" onClick={() => signInWithGoogle()}>Sign in with Google</button>
          </span>
        ) : (
          <span>Saved on this device</span>
        )}
        <a href="#on-device" className="ck-away-link">Clear on-device signals</a>
      </div>
      <DailyEmailOptIn />
      {/* notifications for this device — renders nothing until push is configured */}
      <PushOptIn />
      <TrackOnMount event="profile_view" onceKey="profile" />
    </section>
  );
}

/** THE DAILY DESK email — opt-in, signed-in only; renders nothing until the
 *  table exists. (Oct 29) the row says what the paper holds, in one line —
 *  its sections in the order the paper prints them (scripts/lib/daily-desk.ts);
 *  `?preview=daily` (never in production) shows the row without an account */
function DailyEmailOptIn() {
  // the provider's one read of the preference (desk/nudge shares it)
  const { auth, daily: { state, busy, set } } = useDeskInternals();
  const user = auth.authEnabled ? auth.user : null;
  const preview = useDailyPreview();
  if (!preview && (!user || state === 'unavailable' || state === 'loading')) return null;
  const on = state === 'on';
  return (
    <div className="ck-account-in ck-dailyemail" id="daily-desk">
      <span>
        <b>The Daily Desk</b> — a morning paper of your desk: what needs you (bids past your max, today&rsquo;s closes, results to confirm),
        every live watch, your week, new for you, the picks, your names, the market.
        {on && user ? <> <b>On</b>, to {user.email}.</> : null}
      </span>
      <button type="button" className="ray-toolbar-pill" data-active={on} aria-pressed={on} disabled={busy || !user} onClick={() => set(!on)}>
        {on ? 'Turn off' : 'Email me the Daily Desk'}
      </button>
    </div>
  );
}
