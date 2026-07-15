// sw.js — Service Worker de VenezuelaInfo (PWA).
// Estrategia:
//  - Navegaciones (paginas): network-first con fallback a caché (y a "/").
//  - Recursos propios (assets/iconos): cache-first con relleno.
//  - Recursos de otros origenes (Leaflet CDN, teselas OSM): se dejan a la red.
const CACHE = 'veninfo-v67';
const SHELL = ['/', '/calculadora', '/assets/style.css?v=67', '/icon.svg', '/icon-192.png', '/icon-calc.svg', '/icon-calc-192.png', '/icon-calc-512.png', '/manifest-calc.webmanifest'];

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

// Web Push: muestra la notificacion cuando llega un push del servidor.
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  var title = d.t || 'VenezuelaInfo';
  var opts = {
    body: d.b || '',
    data: { url: d.u || '/' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'veninfo'
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// Al tocar la notificacion: enfoca una pestana existente o abre la URL.
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var u = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
      for (var i = 0; i < cs.length; i++) {
        if (cs[i].url.indexOf(u) !== -1 && 'focus' in cs[i]) { return cs[i].focus(); }
      }
      return self.clients.openWindow(u);
    })
  );
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
