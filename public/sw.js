// SIMBLIP service worker — makes the app installable and keeps the shell
// working offline. Strategy: network-first with cache fallback for same-
// origin GETs (API calls are never cached). Notebook content itself lives
// in localStorage / the self-hosted Postgres gateway (/api/pg), not here.

const CACHE = 'simblip-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
        }
        return response
      })
      .catch(() =>
        caches.match(request).then(
          (hit) =>
            hit ??
            // Navigations fall back to the cached workspace shell.
            (request.mode === 'navigate' ? caches.match('/notebook') : undefined) ??
            Response.error()
        )
      )
  )
})
