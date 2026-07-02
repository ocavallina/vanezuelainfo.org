// sw.js — Service Worker de VenezuelaInfo (PWA).
// Estrategia:
//  - Navegaciones (paginas): network-first con fallback a caché (y a "/").
//  - Recursos propios (assets/iconos): cache-first con relleno.
//  - Recursos de otros origenes (Leaflet CDN, teselas OSM): se dejan a la red.
const CACHE = 'veninfo-v42';
const SHELL = ['/', '/assets/style.css', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                            .map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN/tiles -> red directa
  if (url.pathname.indexOf('/api/') === 0) return; // JSON dinamico (chat/salas) -> red directa, jamas cache

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (resp) {
        const copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return resp;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match('/'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (resp) {
        const copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return resp;
      });
    })
  );
});
