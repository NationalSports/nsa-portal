/* NSA Connect service worker: push notifications only.
 *
 * Deliberately has NO fetch handler and caches nothing. The portal changes often
 * and index.html is served no-cache; an offline cache here could pin reps to an
 * old build. Its only jobs are showing pushes and opening the right screen when
 * one is tapped. Pushes come from netlify/functions/_push.js.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'NSA Connect';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  }));
});

// Open the screen the push points at: reuse an open portal window if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        try { await w.navigate(target); } catch (e) { w.postMessage({ type: 'nsa-open', url: target }); }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
