'use client';
/** ACCOUNT — who is signed in, where the desk lives, sign out (lifted from
 *  page.tsx unchanged); push opt-in rides here. */
import { useDailyEmail } from '../../../lib/email-prefs';
import React from 'react';
import PushOptIn from '../../../components/retention/PushOptIn';
import { TrackOnMount } from '../../../components/retention/trackers';
import { useDeskInternals } from '../provider';
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
      <DailyEmailOptIn user={authEnabled ? user : null} />
      {/* notifications for this device — renders nothing until push is configured */}
      <PushOptIn />
      <TrackOnMount event="profile_view" onceKey="profile" />
    </section>
  );
}

/** THE DAILY DESK email — opt-in, signed-in only; renders nothing until the table exists */
function DailyEmailOptIn({ user }: { user: Parameters<typeof useDailyEmail>[0] }) {
  const { state, busy, set } = useDailyEmail(user);
  if (!user || state === 'unavailable' || state === 'loading') return null;
  const on = state === 'on';
  return (
    <div className="ck-account-in ck-dailyemail">
      <span>
        <b>Daily Desk email</b> — each morning: your watches closing, bids past your max, your results and three picks.
        {on ? <> On, to {user.email}.</> : null}
      </span>
      <button type="button" className="ray-toolbar-pill" data-active={on} aria-pressed={on} disabled={busy} onClick={() => set(!on)}>
        {on ? 'Turn off' : 'Email me the Daily Desk'}
      </button>
    </div>
  );
}
