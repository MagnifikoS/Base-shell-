/**
 * Service Worker — Restaurant OS
 * 
 * STRATEGY: Network-first for all navigation requests.
 * This prevents stale HTML from being served after deployments,
 * which would cause "chunk not found" errors and crash the app.
 */

const CACHE_NAME = 'restaurant-os-v2';

self.addEventListener('install', (event) => {
  // Skip waiting — activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean up ALL old caches on activation
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (Supabase API, etc.)
  if (url.origin !== self.location.origin) return;

  // Navigation requests (HTML pages) — ALWAYS network-first
  // This is critical: after a new deploy, we MUST get the new index.html
  // with updated chunk references, not a stale cached version
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // JS/CSS assets (hashed filenames) — cache-first (immutable once deployed)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          // Cache the new asset for future use
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
