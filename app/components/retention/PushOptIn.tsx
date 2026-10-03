'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/account';
import { currentPushState, enablePush, disablePush, pushConfigured, type PushState } from '../../lib/push';
import { track } from '../../lib/analytics';

const CSS = `
.lectr-push { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; }
.lectr-push-copy { flex: 1 1 320px; min-width: 0; }
.lectr-push-copy p { margin: 4px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--color-text-secondary); }
.lectr-push-state { font-size: 12.5px; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.lectr-push-err { font-size: 12.5px; color: var(--color-down-text); margin: 8px 0 0; }
`;

/**
 * Close alerts opt-in — signed-in only, per DEVICE (a push subscription
 * belongs to one browser). Renders nothing until the build carries the VAPID
 * public key + Supabase, so it is invisible while the feature is inert.
 */
export default function PushOptIn() {
  const { user, authReady } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    currentPushState().then(s => { if (!dead) setState(s); });
    return () => { dead = true; };
  }, []);

  if (!pushConfigured || !authReady || !user || state == null || state === 'unconfigured') return null;

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

  let body: React.ReactNode;
  let action: React.ReactNode = null;
  switch (state) {
    case 'on':
      body = <p>On for this device: a notification about a day and about an hour before each watched lot closes, and one when it hammers, with lectr&rsquo;s forecast beside the price.</p>;
      action = <button className="ray-call-btn ray-call-btn-quiet" disabled={busy} onClick={turnOff}>Turn off</button>;
      break;
    case 'off':
      body = <p>Get a notification about a day and about an hour before a watched lot closes, and when it hammers, with lectr&rsquo;s forecast beside the price. This device only. No email, ever.</p>;
      action = <button className="ray-call-btn ray-call-btn-primary" style={{ border: 'none', cursor: 'pointer' }} disabled={busy} onClick={turnOn}>{busy ? 'Asking your browser…' : 'Turn on notifications'}</button>;
      break;
    case 'ios-install':
      body = <p>On iPhone and iPad, Safari only delivers notifications to a site on your Home Screen. Tap Share, then <b>Add to Home Screen</b>, open lectr from that icon, and turn notifications on here (iOS 16.4 or later).</p>;
      break;
    case 'denied':
      body = <p>Notifications are blocked for lectr in this browser. Allow them in the site settings (the icon left of the address bar), then reload this page.</p>;
      break;
    default:
      body = <p>This browser can&rsquo;t receive web notifications. Hammer-day alerts still land in your inbox on this page.</p>;
  }

  return (
    <section className="rail ray-enter" aria-label="Close alerts" style={{ paddingBlock: '30px 6px' }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="lectr-push">
        <div className="lectr-push-copy">
          <h2 className="ray-h2" style={{ margin: 0 }}>Close alerts</h2>
          {body}
          {err && <p className="lectr-push-err" role="alert">{err}</p>}
        </div>
        {action}
      </div>
    </section>
  );
}
