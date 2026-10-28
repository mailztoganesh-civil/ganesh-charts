/* Forex CRT moved to /forex-crt/forex/. This worker clears the old caches and removes itself. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith("forex-crt")).map(x => caches.delete(x))))
  .then(() => self.registration.unregister()).then(() => self.clients.matchAll()).then(cs => cs.forEach(c => c.navigate(c.url)))));
