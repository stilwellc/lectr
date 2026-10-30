'use client';
/**
 * ACCOUNT — the desk's quiet settings foot (pass 7, Oct 29 2026). One head,
 * one identity line, then a ledger of rows (NORTHSTAR §2.5: label over
 * value, dotted hairlines): the Daily Desk (its switch, Today's edition, one
 * line on what the paper holds), this device (where the on-device signals
 * live, and the secondary action that clears them), notifications (only
 * where push is configured), and the session (sign in / sign out). Nothing
 * about migrations or tables lives here: a preference the account can't
 * hold yet simply doesn't show its row.
 */
import React from 'react';
import PushOptIn from '../../../components/retention/PushOptIn';
import { TrackOnMount } from '../../../components/retention/trackers';
import { useDeskInternals } from '../provider';
import { useDailyPreview } from '../nudge';
import { EditionButton } from '../edition';
import { RoomHead } from '../../head';
import type { SectionProps, SectionMeta } from '../types';

/** the strip has no rail pill (it never had one) — `g a` still lands on it */
export function meta(): SectionMeta | null { return null; }

/** one ledger row: a gray label, the row's line and its note */
function Row({ id, label, children, note }: { id?: string; label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="ck-acct-row" id={id}>
      <span className="ck-acct-k">{label}</span>
      <div className="ck-acct-v">
        <div className="ck-acct-line">{children}</div>
        {note && <p className="ck-acct-note">{note}</p>}
      </div>
    </div>
  );
}

/** the switch: a track and a knob, ink when on; 44px of tap around it */
function Switch({ on, disabled, busy, label, onChange }: { on: boolean; disabled?: boolean; busy?: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} aria-busy={busy || undefined} disabled={disabled}
      className="ck-switch" onClick={() => onChange(!on)}>
      <i aria-hidden />
    </button>
  );
}

export default function AccountStrip(_p: SectionProps) {
  const { auth, signedOutView } = useDeskInternals();
  const { authEnabled, user, signInWithGoogle, signOut } = auth;
  const signedIn = authEnabled && !!user;
  const identity = signedIn
    ? <>Signed in as <b>{user!.email || 'you'}</b> — your saves, follows, record and collection sync to your account.</>
    : signedOutView
      ? <>Not signed in — follows, interests and what this device learned stay in this browser.</>
      : authEnabled
        ? <>Saved on this device — sign in to keep your saves, follows, record and collection on every device.</>
        : <>Saved on this device.</>;
  return (
    <section id="account" className="rail ck-account" aria-label="Account">
      <RoomHead level={3} title="Account" sub={identity} />
      <div className="ck-acct">
        <DailyDeskRow />
        <Row label="This device" note="Follows, interests, hidden picks and what you open on lectr are kept in this browser and tune your picks. Never uploaded.">
          <a href="#on-device" className="ck-acct-quiet">Clear on-device signals</a>
        </Row>
        {/* notifications for this device — renders nothing until push is configured */}
        <PushOptIn />
        <Row label={signedIn ? 'Session' : 'Sign in'}>
          {signedIn
            ? <button type="button" className="ray-toolbar-pill ck-acct-pill" onClick={() => signOut()}>Sign out</button>
            : authEnabled
              ? <button type="button" className="ray-toolbar-pill ck-acct-pill" onClick={() => signInWithGoogle()}>Sign in with Google</button>
              : <span className="ck-acct-muted">Accounts aren&rsquo;t on in this build.</span>}
        </Row>
      </div>
      <TrackOnMount event="profile_view" onceKey="profile" />
    </section>
  );
}

/** THE DAILY DESK — the morning paper's switch, Today's edition beside it, and
 *  one line on what the paper holds. Signed in: the switch is live; signed
 *  out: it reads what it is and that it needs an account. The row hides only
 *  while the preference is still loading or the account can't hold it yet.
 *  `?preview=daily` (never in production) shows it without an account. */
function DailyDeskRow() {
  // the provider's one read of the preference (desk/nudge shares it)
  const { auth, daily: { state, busy, set } } = useDeskInternals();
  const user = auth.authEnabled ? auth.user : null;
  const preview = useDailyPreview();
  if (!preview && user && (state === 'unavailable' || state === 'loading')) return null;
  const on = state === 'on';
  const live = preview || !!user;
  return (
    <Row id="daily-desk" label="Daily Desk"
      note={<>A morning paper of your desk at 7 AM ET — what needs you, every live watch, your week, new for you, the picks, your names, the market.{!live && auth.authEnabled ? <> Needs an account.</> : null}</>}>
      <Switch on={on} busy={busy} disabled={busy || !live} label="Email me the Daily Desk" onChange={v => set(v)} />
      <span className="ck-acct-word">{on ? <>On{user?.email ? <> · to {user.email}</> : null}</> : live ? 'Off' : 'Sign in to turn it on'}</span>
      <EditionButton />
    </Row>
  );
}
