import L from 'leaflet';
import type { HeatLevel } from './activity';

// Map pin styling — the same circular glyph markers as Island GO, keyed by a
// venue's primary category. Unknown categories (added later from the admin
// console) get a stable colour from the palette so they still look distinct.

const G = {
  martini: '<path d="M8 22h8"/><path d="M12 11v11"/><path d="m19 3-7 8-7-8Z"/>',
  wine: '<path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>',
  beer: '<path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z"/><path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  mic: '<path d="m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12"/><path d="M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5"/><circle cx="16" cy="7" r="5"/>',
  sofa: '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/><path d="M12 4v9"/>',
  palm: '<path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4"/><path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3"/><path d="M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35"/><path d="M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14"/>',
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  tv: '<path d="m17 2-5 5-5-5"/><rect width="20" height="15" x="2" y="7" rx="2"/>',
  dice: '<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>',
  smoke: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
  bell: '<path d="M3 20a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1Z"/><path d="M20 16a8 8 0 1 0-16 0"/><path d="M12 4v4"/><path d="M10 4h4"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  fish: '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/>',
  partyPopper: '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
  // Hand-drawn below (lucide has no disco ball or rum bottle).
  discoBall: '<path d="M12 2v3"/><circle cx="12" cy="13" r="8"/><path d="M4 13h16"/><path d="M12 5c-2.5 2.5-3.5 5-3.5 8s1 5.5 3.5 8"/><path d="M12 5c2.5 2.5 3.5 5 3.5 8s-1 5.5-3.5 8"/><path d="M5.5 8.5h13"/><path d="M5.5 17.5h13"/>',
  bottle: '<path d="M10 2h4"/><path d="M10.5 2v4.5c-2 1-3.5 2.6-3.5 5V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-8.5c0-2.4-1.5-4-3.5-5V2"/><path d="M7 14h10"/>',
};

/** The glyph used for event pins and event placeholders. */
export const EVENT_GLYPH = G.partyPopper;

export interface PinStyle {
  color: string;
  glyph: string;
}

const CATEGORY_STYLES: Record<string, PinStyle> = {
  'Nightclub': { color: '#d946ef', glyph: G.discoBall },
  'Cocktail Bar': { color: '#f43f5e', glyph: G.martini },
  'Lounge': { color: '#8b5cf6', glyph: G.sofa },
  'Beach Bar': { color: '#06b6d4', glyph: G.palm },
  'Rooftop Bar': { color: '#6366f1', glyph: G.building },
  'Live Music': { color: '#f97316', glyph: G.music },
  'Sports Bar': { color: '#22c55e', glyph: G.tv },
  'Pub': { color: '#d97706', glyph: G.beer },
  'Wine Bar': { color: '#be123c', glyph: G.wine },
  'Rum Bar': { color: '#b45309', glyph: G.bottle },
  'Karaoke': { color: '#ec4899', glyph: G.mic },
  'Casino': { color: '#ca8a04', glyph: G.dice },
  'Hookah Lounge': { color: '#a855f7', glyph: G.smoke },
  'Dive Bar': { color: '#78716c', glyph: G.beer },
  'Fish Fry & Bar': { color: '#0284c7', glyph: G.fish },
  'Hotel Bar': { color: '#0ea5e9', glyph: G.bell },
  'Bar & Grill': { color: '#ef4444', glyph: G.flame },
};

const FALLBACK_COLORS = ['#d946ef', '#06b6d4', '#8b5cf6', '#f43f5e', '#f97316', '#6366f1', '#22c55e', '#eab308'];
export const DEFAULT_PIN: PinStyle = { color: '#f72fb0', glyph: G.martini };

export function pinStyleFor(categories: string[] | null | undefined): PinStyle {
  const primary = categories?.[0];
  if (!primary) return DEFAULT_PIN;
  const known = CATEGORY_STYLES[primary];
  if (known) return known;
  let hash = 0;
  for (const ch of primary) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return { color: FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length], glyph: G.martini };
}

const svg = (glyph: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>`;

// Halo size per level. Keyed by level (not the exact count) so the minute-by-
// minute refresh only swaps icons when a venue actually changes level.
const HEAT_HALO: Record<Exclude<HeatLevel, 'quiet'>, { size: number; color: string }> = {
  chill: { size: 66, color: 'var(--color-heat-chill)' },
  lively: { size: 88, color: 'var(--color-heat-lively)' },
  packed: { size: 112, color: 'var(--color-heat-packed)' },
};

function buildIcon(style: PinStyle, selected: boolean, featured: boolean, heat: HeatLevel) {
  const ring = selected
    ? `<div class="marker-glow-ring" style="border-color:${featured ? '#f59e0b' : style.color}"></div>`
    : '';
  const star = featured ? '<div class="marker-star">★</div>' : '';
  const halo =
    heat === 'quiet'
      ? ''
      : `<div class="marker-heat ${heat}" style="--heat-color:${HEAT_HALO[heat].color};--heat-size:${HEAT_HALO[heat].size}px"></div>`;
  const html = `<div class="marker-circle${selected ? ' selected' : ''}${featured ? ' featured' : ''}" style="background-color:${style.color}">
    ${halo}${ring}${star}${svg(style.glyph)}
  </div>`;
  return L.divIcon({ html, className: 'custom-icon', iconSize: [44, 44], iconAnchor: [22, 44] });
}

// Unselected icons are shared; the selected one is built on demand since only one is selected at a time.
const iconCache = new Map<string, L.DivIcon>();

export function pinIcon(style: PinStyle, selected = false, featured = false, heat: HeatLevel = 'quiet') {
  if (selected) return buildIcon(style, true, featured, heat);
  const key = `${style.color}|${style.glyph}|${featured}|${heat}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = buildIcon(style, false, featured, heat);
    iconCache.set(key, icon);
  }
  return icon;
}

// Event pins, after Island GO: a live event flashes a neon ring (and a LIVE
// tag); an upcoming one sits as a dimmed pin until it starts. An event hosted
// at a listed venue shares that venue's spot, so it's drawn as a smaller badge
// on the venue pin's top-right shoulder instead of covering it.
function buildEventIcon(live: boolean, selected: boolean, attached: boolean) {
  const size = attached ? 32 : 44;
  const cls = `marker-circle ${live ? 'event-live' : 'event-dim'}${selected ? ' selected' : ''}${attached ? ' mini' : ''}`;
  const ring = live
    ? '<div class="marker-glow-ring event-ring"></div>'
    : selected
      ? '<div class="marker-glow-ring" style="border-color:white"></div>'
      : '';
  const badge = live && !attached ? '<div class="marker-badge">Live</div>' : '';
  const html = `<div class="${cls}">${ring}${svg(G.partyPopper)}${badge}</div>`;
  return L.divIcon({
    html,
    className: 'custom-icon',
    iconSize: [size, size],
    // Attached: the badge's top-left sits 6 px right of and 62 px above the
    // venue's anchor, overlapping the pin's upper-right edge.
    iconAnchor: attached ? [-6, 62] : [22, 44],
  });
}

const eventIcons = new Map<string, L.DivIcon>();

export function eventIcon(live: boolean, selected = false, attached = false) {
  const key = `${live}|${selected}|${attached}`;
  let icon = eventIcons.get(key);
  if (!icon) {
    icon = buildEventIcon(live, selected, attached);
    eventIcons.set(key, icon);
  }
  return icon;
}

export const meIcon = L.divIcon({
  html: '<div class="pulsing-location-marker"><div class="pulsing-dot"></div></div>',
  className: 'custom-icon',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Basemap. Stadia Maps' "Alidade Smooth Dark" — a quiet dark style that lets
// the neon pins and heat halos carry the map. (CARTO's free tiles, used by
// Island GO, now need an API key.) Stadia works on localhost with no key; for
// a live domain, register it (or add ?api_key=...) at stadiamaps.com.
// Override both values in .env.local to switch providers.
export const TILE_URL: string =
  import.meta.env.VITE_MAP_TILE_URL || 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png';
export const TILE_ATTRIBUTION: string =
  import.meta.env.VITE_MAP_ATTRIBUTION ||
  '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Expand a Leaflet {s}/{z}/{x}/{y}{r} template to a concrete tile URL. */
export function tileUrlFor(z: number, x: number, y: number, retina: boolean) {
  return TILE_URL.replace('{s}', 'abcd'[(x + y) % 4])
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', retina ? '@2x' : '');
}
