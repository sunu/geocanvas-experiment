/*
 * The app's service worker (plans/plan-018.md). The build prepends VERSION and PRECACHE (vite.config.ts,
 * src/pwa/precache.ts) and serves it at /sw.js. It only makes the app itself load fast and without a network:
 * - pages: from the network, else (offline, or no answer within NETWORK_MS) the page cached at install;
 * - /assets/*: from the cache, else the network, then kept: their names carry content hashes, so they never change;
 * - everything else (the board's socket, /monty, /uploads, map tiles, …) is not touched.
 * A new version waits until the person reloads from the app's notice (src/pwa/register.ts), so a tab never runs a mix
 * of two builds.
 */

const CACHE = `ttx-app-${VERSION}`
/** Caches of this worker start with this; others in the origin (e.g. the World Bank boundaries') are left alone. */
const PREFIX = 'ttx-app-'
/** How long a page waits for the network before the cached one is used: a slow connection is the common case. */
const NETWORK_MS = 4000

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate') event.respondWith(page(request))
  else if (url.pathname.startsWith('/assets/')) event.respondWith(asset(request))
})

/** The app has one page; every navigation is it (rooms are in the hash). */
async function page(request) {
  const cache = await caches.open(CACHE)
  const network = fetch(request).then((response) => {
    if (response.ok) void cache.put('/', response.clone())
    return response
  })
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_MS))
  const first = await Promise.race([network.catch(() => undefined), timeout])
  if (first) return first
  return (await cache.match('/')) ?? network
}

async function asset(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) void cache.put(request, response.clone())
  return response
}
