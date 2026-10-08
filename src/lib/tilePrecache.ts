/* One-time background seeding of Nassau basemap tiles into the service
 * worker's tile cache (public/sw.js), so the map paints instantly at the
 * browsing zooms even in areas the visitor hasn't panned to yet.
 *
 * Scope is deliberately modest: New Providence at z12–15 is ~700 tiles.
 * Deeper zooms are cached organically by the service worker while browsing —
 * seeding the max zoom would be hundreds of thousands of tiles, impractical to
 * store and unfair to the tile provider (it also burns metered credits).
 */
import { tileUrlFor, TILE_URL } from './markers';
import { NEW_PROVIDENCE as BOUNDS } from './geo';

const TILE_CACHE = 'map-tiles-v2'; // must match public/sw.js
// Re-seed when the provider changes.
const DONE_KEY = `tilePrecache:nassau:${TILE_URL}`;

const MIN_ZOOM = 12;
const MAX_ZOOM = 15;
const CONCURRENCY = 6;
const MAX_FAILURES = 20; // offline / blocked — stop quietly and retry next session

const lngToX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const latToY = (lat: number, z: number) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

/** Same normalisation as public/sw.js: drop the a–d load-balancing subdomain. */
const cacheKey = (url: string) => {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname.replace(/^[a-d]\./, '')}${u.pathname}`;
};

export async function precacheNassauTiles(): Promise<void> {
  if (typeof caches === 'undefined') return; // insecure origin / old browser
  try {
    if (localStorage.getItem(DONE_KEY)) return;
  } catch {
    return;
  }
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return; // respect data-saver mode

  const retina = window.devicePixelRatio > 1; // match Leaflet's {r}
  const cache = await caches.open(TILE_CACHE);

  const tiles: string[] = [];
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    for (let x = lngToX(BOUNDS.west, z); x <= lngToX(BOUNDS.east, z); x++) {
      for (let y = latToY(BOUNDS.north, z); y <= latToY(BOUNDS.south, z); y++) tiles.push(tileUrlFor(z, x, y, retina));
    }
  }

  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < tiles.length && failed < MAX_FAILURES) {
      const url = tiles[next++];
      const key = cacheKey(url);
      try {
        if (await cache.match(key)) continue; // resume cheaply after a partial run
        const res = await fetch(url, { mode: 'cors' });
        if (res.ok) await cache.put(key, res);
        else failed++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (failed < MAX_FAILURES) {
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      /* ignore */
    }
  }
}
