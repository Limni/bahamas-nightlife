export const NASSAU: [number, number] = [25.0443, -77.3504];

// New Providence (Nassau) bounding box: the map's zoom-out/pan limit and the tile precache area.
export const NEW_PROVIDENCE = { north: 25.11, south: 24.96, west: -77.6, east: -77.25 };

/** Haversine distance in metres. */
export function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Bahamians mostly think in miles; short hops read better in feet.
export function formatDistance(metres: number) {
  const miles = metres / 1609.344;
  if (miles < 0.1) return `${Math.round(metres * 3.28084)} ft`;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

export const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
