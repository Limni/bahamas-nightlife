/* Service worker: map tile caching only.
 *
 * Intercepts ONLY basemap tile requests (any provider: /z/x/y.png paths on a
 * known tile host) and serves them cache-first, so
 * panning the map doesn't re-download tiles and gray gaps don't flash over
 * areas already seen (src/lib/tilePrecache.ts seeds the same cache with Nassau
 * at overview zooms). App assets are deliberately never cached here.
 */

const TILE_CACHE = 'map-tiles-v2'; // must match src/lib/tilePrecache.ts
const TILE_HOST = /(^|\.)(stadiamaps\.com|cartocdn\.com|maptiler\.com|openstreetmap\.org|thunderforest\.com)$/;
const TILE_PATH = /\/\d+\/\d+\/\d+(@2x)?\.(png|jpe?g|webp)$/;
// Rough disk ceiling: ~25KB/tile plain, ~60KB retina → worst case ~180MB.
const MAX_TILES = 3000;
const TRIM_EVERY = 50; // amortise the cache.keys() scan
let putsSinceTrim = 0;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((names) =>
        Promise.all(names.filter((n) => n.startsWith('map-tiles-') && n !== TILE_CACHE).map((n) => caches.delete(n)))
      ),
    ])
  )
);

// Drop the a–d load-balancing subdomain so a tile fetched via "a" is still a
// hit when Leaflet later asks "c" for it. Query strings (API keys) are dropped.
const tileKey = (url) => url.protocol + '//' + url.hostname.replace(/^[a-d]\./, '') + url.pathname;

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!TILE_HOST.test(url.hostname) || !TILE_PATH.test(url.pathname)) return;
  event.respondWith(serveTile(event.request, url));
});

async function serveTile(request, url) {
  const cache = await caches.open(TILE_CACHE);
  const key = tileKey(url);
  const cached = await cache.match(key);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(key, response.clone());
    if (++putsSinceTrim >= TRIM_EVERY) {
      putsSinceTrim = 0;
      trimTiles(cache).catch(() => {});
    }
  }
  return response;
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
}
