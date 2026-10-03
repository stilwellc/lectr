'use client';

/**
 * Browser push for saved lots — the client half. The server half is
 * scripts/push-send.ts (24h + 1h before close, and the hammer result).
 *
 * INERT until BOTH exist at build time: the Supabase env vars (auth + the
 * register RPC from migration 0008) and NEXT_PUBLIC_VAPID_PUBLIC_KEY. Without
 * them `pushConfigured` is false and the opt-in UI renders nothing.
 *
 * Platform truth (said in the UI, not hidden):
 *  - iPhone / iPad: Safari delivers web push ONLY to a site added to the Home
 *    Screen (iOS 16.4+) and opened from there. In a Safari tab PushManager is
 *    absent — we say "add to Home Screen first" instead of a dead button.
 *  - a denied permission can only be undone in the browser's site settings.
 */
import { supabase } from './supabase';

const VAPID_PUBLIC = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
export const pushConfigured = !!(VAPID_PUBLIC && supabase);

export type PushState =
  | 'unconfigured'   // no VAPID key / no Supabase in this build
  | 'unsupported'    // the browser has no Push API
  | 'ios-install'    // iOS/iPadOS Safari tab: must add to Home Screen first
  | 'denied'         // the user blocked notifications for lectr
  | 'off'            // supported, not subscribed on this device
  | 'on';            // subscribed on this device

/** base64url (VAPID public key) → bytes for applicationServerKey */
export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** iOS / iPadOS (iPadOS 13+ reports as Mac with touch). Feature questions
 *  only — nothing here is stored or sent. */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function hasPushApi(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  return existing || navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function currentPushState(): Promise<PushState> {
  if (!pushConfigured) return 'unconfigured';
  if (!hasPushApi()) return isAppleMobile() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch { return 'off'; }
}

/** Ask permission, subscribe this device, register it to the signed-in
 *  account. Resolves to the new state, or throws a user-readable Error. */
export async function enablePush(): Promise<PushState> {
  if (!pushConfigured || !supabase) return 'unconfigured';
  if (!hasPushApi()) return isAppleMobile() && !isStandalone() ? 'ios-install' : 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm === 'denied') return 'denied';
  if (perm !== 'granted') return 'off'; // dismissed — ask again next click
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) });
  }
  const j = sub.toJSON();
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth,
  });
  if (error) {
    // keep browser and server in agreement: no row, no subscription
    await sub.unsubscribe().catch(() => {});
    throw new Error(/limit reached/i.test(error.message)
      ? 'Notifications are already on for 10 devices — turn one off first.'
      : 'Couldn’t turn notifications on — try again.');
  }
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!hasPushApi()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    // best effort: a row left behind is pruned by push-send on its first 404/410
    if (supabase) await supabase.rpc('unregister_push_subscription', { p_endpoint: endpoint });
  }
  return 'off';
}
