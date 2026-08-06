// Minimal service worker — exists mainly to satisfy PWA installability
// requirements. This app is a live dashboard, not a static site, so we
// deliberately don't cache API responses; just pass everything through to
// the network normally.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
