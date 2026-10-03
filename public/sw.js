/* lectr service worker — web push for saved lots, nothing else.
 *
 * Deliberately NO fetch handler and NO cache: the site is a static export
 * whose data versions nightly, and an offline cache here would only serve
 * stale prices. This worker exists to receive pushes from
 * scripts/push-send.ts and to open the lot when one is tapped.
 *
 * Payload contract (JSON): { title, body, url, tag }
 *   url  — a same-origin path ("/lot?id=abc"); anything else opens /profile
 *   tag  — collapses repeats for the same lot × kind on the device
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function safePath(u) {
  try {
    const url = new URL(u, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : '/profile';
  } catch (_) {
    return '/profile';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data && event.data.text() }; }
  const title = String(data.title || 'lectr').slice(0, 120);
  const options = {
    body: String(data.body || '').slice(0, 300),
    tag: data.tag ? String(data.tag).slice(0, 120) : undefined,
    icon: '/brand/lectr-icon-512.png',
    badge: '/icon.png',
    data: { url: safePath(data.url || '/profile') },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/profile';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        await w.focus();
        if ('navigate' in w) return w.navigate(path).catch(() => self.clients.openWindow(path));
        return;
      }
    }
    return self.clients.openWindow(path);
  })());
});
