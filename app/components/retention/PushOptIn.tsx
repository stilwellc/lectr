'use client';

import { useEffect, useState } from 'react';
import { useAccount } from '../../lib/account';
import { currentPushState, enablePush, disablePush, pushConfigured, type PushState } from '../../lib/push';
import { track } from '../../lib/analytics';

/**
 * Notifications opt-in — one row in the /profile Account strip, in the
 * strip's own type (kicker + line + underlined action). Per DEVICE: a push
 * subscription belongs to one browser, and to the signed-in account (the
 * server half, scripts/push-send.ts, reads that account's watched lots and
 * nightly matches).
 *
 * What it promises is exactly what push-send sends (scripts/lib/push-plan):
 * a heads-up about a day and about an hour before a watched lot closes, one
 * when it sells, and one note a night when new lots match the reader's
 * follows or saved searches. Nothing about picks — those are worked out on
 * the device, and the server never sees them.
 *
 * Renders nothing until the build carries the VAPID public key + Supabase
 * (`pushConfigured`), so it is invisible while the feature is inert.
 */
export default function PushOptIn() {
  const { user, authReady, savedIds, signInWithGoogle } = useAccount();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    currentPushState().then(s => { if (!dead) setState(s); });
    return () => { dead = true; };
  }, []);

  if (!pushConfigured || !authReady || state == null || state === 'unconfigured') return null;

  const what = 'a day and an hour before a watched lot closes, when it sells, and when new lots match your follows';

  // signed out: the offer only where there is something to be notified
  // about (lots on the desk) — and the honest reason it needs an account
  if (!user) {
    if (!savedIds.length) return null;
    return (
      <div className="ck-account-in" style={{ borderTop: 'none', paddingTop: 10 }}>
        <span className="kicker">Notifications</span>
        <span>
          A notification on this device {what}. Needs an account — lectr checks your watches on its side ·{' '}
          <button type="button" className="ck-warn-btn ck-account-btn" onClick={() => signInWithGoogle()}>Sign in to turn on</button>
        </span>
      </div>
    );
  }

  const turnOn = async () => {
    setBusy(true); setErr(null);
    try {
      const s = await enablePush();
      setState(s);
      if (s === 'on') track('push_optin');
    } catch (e) {
      setErr((e as Error).message || 'Couldn’t turn notifications on — try again.');
    } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true); setErr(null);
    try { setState(await disablePush()); } catch { setErr('Couldn’t turn notifications off — try again.'); } finally { setBusy(false); }
  };

  let line: React.ReactNode;
  switch (state) {
    case 'on':
      line = <>On for this device: {what} ·{' '}
        <button type="button" className="ck-warn-btn ck-account-btn" disabled={busy} onClick={turnOff}>Turn off</button></>;
      break;
    case 'off':
      line = <>Notify this device {what}. No email, ever ·{' '}
        <button type="button" className="ck-warn-btn ck-account-btn" disabled={busy} onClick={turnOn}>{busy ? 'Asking your browser…' : 'Turn on notifications'}</button></>;
      break;
    case 'ios-install':
      line = <>On iPhone and iPad, Safari only notifies a site on your Home Screen: tap Share, then Add to Home Screen, open lectr from that icon and turn notifications on here (iOS 16.4 or later).</>;
      break;
    case 'denied':
      line = <>Notifications are blocked for lectr in this browser — allow them in the site settings (left of the address bar), then reload.</>;
      break;
    default:
      line = <>This browser can&rsquo;t receive web notifications — new matches still land in Your signals on this page.</>;
  }

  return (
    <div className="ck-account-in" style={{ borderTop: 'none', paddingTop: 10 }}>
      <span className="kicker">Notifications</span>
      <span>{line}</span>
      {err && <span role="alert" style={{ color: 'var(--color-text-secondary)' }}>{err}</span>}
    </div>
  );
}
