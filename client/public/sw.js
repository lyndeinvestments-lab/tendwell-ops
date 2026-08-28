// Tendwell Ops Service Worker — offline caching with per-deploy refresh +
// runtime LRU cap.
//
// The BUILD_HASH placeholder below is replaced by script/build.ts with a
// timestamp at build time, so each deploy ships a fresh CACHE_NAME. The
// activate handler already deletes caches whose name != CACHE_NAME, so
// stale caches from older deploys auto-purge on the next visit.
//
// MAX_CACHE_ENTRIES bounds the per-cache entry count to prevent the SW
// from accumulating thousands of stale chunks during a long-lived session
// (e.g. between deploys). When a put pushes past the cap, the oldest
// entries are evicted in insertion order (Cache Storage is FIFO-ordered
// on Chromium/Firefox).
//
// Both changes are best-effort: if BUILD_HASH replacement fails, CACHE_NAME
// stays a valid (non-rotating) string; if trimCache throws, the fetch
// handler continues regardless.
const CACHE_NAME = 'tendwell-__BUILD_HASH__'
const STATIC_ASSETS = ['/', '/index.html']
const MAX_CACHE_ENTRIES = 150

async function trimCache(cacheName) {
  try {
    const cache = await caches.open(cacheName)
    const keys = await cache.keys()
    if (keys.length > MAX_CACHE_ENTRIES) {
      const toDelete = keys.slice(0, keys.length - MAX_CACHE_ENTRIES)
      await Promise.all(toDelete.map(k => cache.delete(k)))
    }
  } catch (_) {
    // best-effort — eviction failure must never break fetch
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  // ONLY same-origin requests are ever cached. The Supabase API lives on the
  // custom domain api.tendwellcleaningco.com, which the old
  // `url.includes('supabase.co')` bypass did not match — so every database
  // READ was served cache-first from this worker while writes (POST/PATCH,
  // non-GET) went through and saved. Result: edits persisted in the DB but
  // the screen kept showing the frozen cached JSON on every device, and even
  // the in-app Refresh button "did nothing" (its refetch was answered from
  // this cache). An origin check cannot rot the way a hostname substring
  // list does: any cross-origin endpoint — Supabase, fonts, analytics,
  // future APIs — goes straight to the network.
  let url
  try { url = new URL(request.url) } catch (_) { return }
  if (url.origin !== self.location.origin) return
  // Same-origin serverless API routes are dynamic — never cache.
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    caches.match(request).then(cached => {
      // Network first for HTML, cache first for assets
      if (request.headers.get('accept')?.includes('text/html')) {
        return fetch(request).then(response => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, clone).then(() => trimCache(CACHE_NAME))
          })
          return response
        }).catch(() => cached || new Response('Offline', { status: 503 }))
      }
      // Cache first for JS/CSS/images
      if (cached) return cached
      return fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, clone).then(() => trimCache(CACHE_NAME))
          })
        }
        return response
      }).catch(() => new Response('', { status: 503 }))
    })
  )
})
