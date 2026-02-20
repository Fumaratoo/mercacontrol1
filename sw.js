// ── MercaControl Service Worker ──────────────────────────────────────────────
// Supertiendas Cañaveral | v1.0
// Estrategia: Cache-first para assets estáticos, Network-first para datos

const CACHE_NAME = 'mercacontrol-v1';
const OFFLINE_URL = '/index.html';

// Archivos que se cachean al instalar (la app funciona sin internet)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/app.jsx',
  // CDN React — se cachea en primera visita con internet
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
];

// ── INSTALL: cachear assets esenciales ────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando MercaControl...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cacheando assets...');
        // Cachear uno por uno para no fallar si algún CDN no responde
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] No se pudo cachear:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar caches viejos ───────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Eliminando cache viejo:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia inteligente por tipo de recurso ─────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requests que no son GET
  if (request.method !== 'GET') return;

  // Ignorar extensiones de Chrome
  if (url.protocol === 'chrome-extension:') return;

  // Para la app principal: Cache-first, fallback a red, fallback a offline
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.endsWith('.jsx')) {
    event.respondWith(
      caches.match(request)
        .then(cached => {
          if (cached) {
            // Actualizar cache en background (stale-while-revalidate)
            fetch(request)
              .then(response => {
                if (response && response.status === 200) {
                  caches.open(CACHE_NAME).then(cache => cache.put(request, response));
                }
              })
              .catch(() => {});
            return cached;
          }
          return fetch(request)
            .then(response => {
              if (response && response.status === 200) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
              }
              return response;
            })
            .catch(() => caches.match(OFFLINE_URL));
        })
    );
    return;
  }

  // Para CDN (React, Babel, fuentes): Cache-first
  if (url.hostname.includes('unpkg.com') || url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(request)
        .then(cached => cached || fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 503 })))
    );
    return;
  }

  // Para el resto: Network-first con fallback a cache
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request) || caches.match(OFFLINE_URL))
  );
});

// ── BACKGROUND SYNC: enviar registros pendientes al reconectar ────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-registros') {
    console.log('[SW] Background sync: enviando registros pendientes...');
    event.waitUntil(syncRegistrosPendientes());
  }
});

async function syncRegistrosPendientes() {
  // En producción: aquí se conecta con la API de SharePoint/Microsoft Graph
  // Por ahora notifica a la app que puede sincronizar
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_READY', timestamp: Date.now() });
  });
}

// ── PUSH NOTIFICATIONS (futuro) ───────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'MercaControl', {
    body: data.body || 'Nuevo evento en el sistema',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'mercacontrol',
    data: { url: data.url || '/' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});

console.log('[SW] MercaControl Service Worker cargado ✓');
