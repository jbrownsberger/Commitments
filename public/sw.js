/**
 * Minimal service worker for Web Push fallback.
 * Safari with Declarative Web Push can display notifications without this;
 * other browsers parse the same declarative JSON and call showNotification.
 */
/* eslint-disable no-restricted-globals */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try {
      data = { notification: { title: 'TaskTriage', body: event.data?.text() || '' } };
    } catch {
      data = {};
    }
  }

  // Declarative payload: { web_push: 8030, notification: { title, body, navigate, ... } }
  // Also accept a bare notification object for flexibility.
  const n = data.notification || data;
  const title = n.title || 'TaskTriage';
  const options = {
    body: n.body || '',
    icon: n.icon || '/logo.png',
    badge: n.badge || '/logo.png',
    data: { url: n.navigate || '/' },
    silent: !!n.silent,
    lang: n.lang || 'en-US',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          try {
            await client.focus();
            if ('navigate' in client && url) {
              try { await client.navigate(url); } catch { /* ignore */ }
            }
            return;
          } catch { /* try next */ }
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
