// =============================================================================
// Seed Nassau Nights with real venues from Google Maps (Places API, New).
//
// Sweeps New Providence with Text Search, maps each place onto the directory's
// fields and tag vocabularies, and inserts it as an unpublished DRAFT so you
// can review it in /admin before it goes live.
//
//   npm run seed:google -- --dry-run                 # preview, writes nothing
//   npm run seed:google -- --dry-run --out spots.json
//   npm run seed:google                              # insert drafts
//   npm run seed:google -- --min-reviews 10          # skip barely-reviewed spots
//   npm run seed:google -- --cache places.json       # reuse one sweep across runs
//
// Env (.env.local or .env; never commit these, never prefix them with VITE_):
//   GOOGLE_MAPS_API_KEY        key with "Places API (New)" enabled
//   SUPABASE_SERVICE_ROLE_KEY  Project Settings → API → service_role (bypasses RLS)
//   VITE_SUPABASE_URL          already set for the app
//
// Safe to re-run: places already imported (by google_place_id) are skipped, and
// spots you added by hand are linked rather than duplicated when the name
// matches within ~250 m. Nothing you've edited is ever overwritten.
// Run supabase/schema.sql first so the google_place_id column exists.
// =============================================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import type { WeeklyHours } from '../src/lib/hours.ts';

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    publish: { type: 'boolean', default: false },
    'min-reviews': { type: 'string', default: '0' },
    query: { type: 'string', multiple: true },
    out: { type: 'string' },
    'max-depth': { type: 'string', default: '4' }, // 4 → cells down to ≈ 550 m
    // Save the raw Google results here, or reuse them if the file exists, so
    // re-running after a mapping tweak costs no API requests.
    cache: { type: 'string' },
  },
});

const DRY_RUN = args['dry-run'];
const MIN_REVIEWS = Number(args['min-reviews']);
const MAX_DEPTH = Number(args['max-depth']);
// "bar" alone misses clubs and lounges that Google files under other types.
const QUERIES = args.query?.length ? args.query : ['bar', 'night club', 'lounge or rooftop bar'];

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? (DRY_RUN ? process.env.VITE_SUPABASE_ANON_KEY : undefined);

if (!GOOGLE_KEY) fail('GOOGLE_MAPS_API_KEY is not set.');
if (!SUPABASE_URL || !SUPABASE_KEY) {
  fail('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the service-role key is needed to insert drafts).');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// -----------------------------------------------------------------------------
// Google Places (New) — Text Search
// -----------------------------------------------------------------------------

interface LatLng { latitude: number; longitude: number }
interface Box { low: LatLng; high: LatLng }
interface Point { day: number; hour: number; minute: number }

interface Place {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: LatLng;
  types?: string[];
  primaryType?: string;
  priceLevel?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { periods?: { open: Point; close?: Point }[]; weekdayDescriptions?: string[] };
  businessStatus?: string;
  editorialSummary?: { text: string };
  userRatingCount?: number;
  outdoorSeating?: boolean;
  liveMusic?: boolean;
}

const FIELDS = [
  'id', 'displayName', 'formattedAddress', 'shortFormattedAddress', 'location', 'types', 'primaryType',
  'priceLevel', 'nationalPhoneNumber', 'websiteUri', 'regularOpeningHours', 'businessStatus',
  'editorialSummary', 'userRatingCount', 'outdoorSeating', 'liveMusic',
];
const FIELD_MASK = [...FIELDS.map((f) => `places.${f}`), 'nextPageToken'].join(',');

// New Providence, with a little margin. Paradise Island is inside this box.
const NEW_PROVIDENCE: Box = {
  low: { latitude: 24.98, longitude: -77.56 },
  high: { latitude: 25.1, longitude: -77.26 },
};
const START_CELL_DEG = 0.04; // ≈ 4.4 km
const MAX_RESULTS_PER_QUERY = 60; // Text Search stops paginating after 3 pages of 20

let requestCount = 0;

async function searchText(textQuery: string, box: Box, pageToken?: string): Promise<{ places: Place[]; nextPageToken?: string }> {
  for (let attempt = 0; ; attempt++) {
    requestCount++;
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY!, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({
        textQuery,
        pageSize: 20,
        pageToken,
        languageCode: 'en',
        regionCode: 'BS',
        locationRestriction: { rectangle: box },
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { places?: Place[]; nextPageToken?: string };
      return { places: json.places ?? [], nextPageToken: json.nextPageToken };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    fail(`Places API ${res.status}: ${await res.text()}`);
  }
}

/** All pages for one query in one cell. `saturated` means Google had more than it would return. */
async function searchCell(textQuery: string, box: Box) {
  const places: Place[] = [];
  let token: string | undefined;
  do {
    const page = await searchText(textQuery, box, token);
    places.push(...page.places);
    token = page.nextPageToken;
  } while (token && places.length < MAX_RESULTS_PER_QUERY);
  return { places, saturated: !!token || places.length >= MAX_RESULTS_PER_QUERY };
}

function splitBox(box: Box, step: number): Box[] {
  const cells: Box[] = [];
  for (let lat = box.low.latitude; lat < box.high.latitude - 1e-9; lat += step) {
    for (let lng = box.low.longitude; lng < box.high.longitude - 1e-9; lng += step) {
      cells.push({
        low: { latitude: lat, longitude: lng },
        high: { latitude: Math.min(lat + step, box.high.latitude), longitude: Math.min(lng + step, box.high.longitude) },
      });
    }
  }
  return cells;
}

/** Sweep a cell; busy cells (downtown, Cable Beach) are split into quarters until nothing is cut off. */
async function sweep(textQuery: string, box: Box, size: number, depth: number, found: Map<string, Place>) {
  const { places, saturated } = await searchCell(textQuery, box);
  for (const p of places) found.set(p.id, p);
  if (saturated && depth < MAX_DEPTH) {
    for (const cell of splitBox(box, size / 2)) await sweep(textQuery, cell, size / 2, depth + 1, found);
  } else if (saturated) {
    console.warn(`  ! cell near ${box.low.latitude.toFixed(3)},${box.low.longitude.toFixed(3)} still has more than ${MAX_RESULTS_PER_QUERY} results; raise --max-depth to dig deeper`);
  }
}

// -----------------------------------------------------------------------------
// Filtering
// -----------------------------------------------------------------------------

const NIGHT_TYPES = new Set([
  'bar', 'pub', 'wine_bar', 'night_club', 'bar_and_grill', 'cocktail_bar', 'lounge_bar', 'sports_bar', 'irish_pub',
  'hookah_bar', 'beer_garden', 'brewpub', 'brewery', 'karaoke', 'casino', 'live_music_venue', 'dance_hall', 'comedy_club',
]);
// Places that sell drinks but aren't a night out (a hotel itself is skipped;
// its bar usually has its own listing).
const NOT_NIGHTLIFE = new Set([
  'lodging', 'hotel', 'resort_hotel', 'motel', 'gas_station', 'grocery_store', 'supermarket', 'convenience_store',
  'liquor_store', 'marina', 'shopping_mall', 'store', 'catering_service', 'coffee_shop', 'bakery',
]);

// Google files plenty of package stores and restaurants under "bar". Their
// names give them away; a restaurant that also says bar/lounge/club stays.
const LIQUOR_STORE = /\b(liquors?|liqour|liquorstore|spirits|wholesale)\b/i;
const NIGHT_WORD = /\b(bar|lounge|club|pub|tavern|saloon|disco)\b/i;
const FOOD_WORD = /\b(restaurant|caf[eé]|grill|kitchen|diner|eatery|bistro|pizza|bakery|take ?away)\b/i;

function keep(p: Place): string | null {
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return p.businessStatus.toLowerCase();
  if (!p.displayName?.text || !p.location) return 'missing name/location';
  if (p.primaryType && NOT_NIGHTLIFE.has(p.primaryType)) return p.primaryType;
  const name = p.displayName.text;
  // "Nestor's Wholesale Bar and Lounge" is a hangout; "Quick Fix Liquors" is a shop.
  if (LIQUOR_STORE.test(name) && !/\blounge\b/i.test(name)) return 'liquor store (by name)';
  if (FOOD_WORD.test(name) && !NIGHT_WORD.test(name)) return 'restaurant (by name)';
  if (!(p.primaryType && NIGHT_TYPES.has(p.primaryType)) && !p.types?.some((t) => NIGHT_TYPES.has(t))) return 'not a bar or club';
  if ((p.userRatingCount ?? 0) < MIN_REVIEWS) return 'too few reviews';
  return null;
}

// -----------------------------------------------------------------------------
// Mapping onto the directory's fields
// -----------------------------------------------------------------------------

// Google type → category tag label (supabase/schema.sql starter vocabulary).
const CATEGORY_BY_TYPE: Record<string, string> = {
  night_club: 'Nightclub',
  dance_hall: 'Nightclub',
  cocktail_bar: 'Cocktail Bar',
  lounge_bar: 'Lounge',
  hookah_bar: 'Hookah Lounge',
  sports_bar: 'Sports Bar',
  pub: 'Pub',
  irish_pub: 'Pub',
  brewpub: 'Pub',
  beer_garden: 'Pub',
  wine_bar: 'Wine Bar',
  karaoke: 'Karaoke',
  casino: 'Casino',
  live_music_venue: 'Live Music',
  bar_and_grill: 'Bar & Grill',
};

// Google has no beach-bar, rum-bar or rooftop types, so lean on the name.
const CATEGORY_BY_NAME: [RegExp, string][] = [
  [/\b(beach|sand|tiki|shack)\b/i, 'Beach Bar'],
  [/\brum\b/i, 'Rum Bar'],
  [/\b(rooftop|sky ?bar|skyline)\b/i, 'Rooftop Bar'],
  [/\blounge\b/i, 'Lounge'],
  [/\b(club|disco)\b/i, 'Nightclub'],
  [/\bfish fry\b/i, 'Fish Fry & Bar'],
  [/\bkaraoke\b/i, 'Karaoke'],
  [/\b(jazz|live music)\b/i, 'Live Music'],
  [/\bsports?\b/i, 'Sports Bar'],
  [/\bcocktails?\b/i, 'Cocktail Bar'],
  [/\b(wine|vino)\b/i, 'Wine Bar'],
  [/\b(pub|tavern|taproom|brew)/i, 'Pub'],
  [/\bhookah\b/i, 'Hookah Lounge'],
  [/\bcasino\b/i, 'Casino'],
  [/\bgrill\b/i, 'Bar & Grill'],
];

// Rough centres for the starter area tags. A spot gets the nearest one within
// AREA_RADIUS_M; anything further out is left blank for you to fill in.
const AREA_CENTRES: [string, number, number][] = [
  ['Downtown / Bay Street', 25.0772, -77.3425],
  ['Arawak Cay (Fish Fry)', 25.0788, -77.3585],
  ['Cable Beach', 25.0745, -77.3995],
  ['West Bay Street', 25.0770, -77.3700],
  ["Potter's Cay", 25.0765, -77.3295],
  ['East Bay Street', 25.0735, -77.3165],
  ['Eastern Road', 25.0605, -77.2855],
  ['Village Road', 25.0625, -77.3115],
  ['Palmdale', 25.0645, -77.3445],
  ['Sandyport', 25.0705, -77.4425],
  ['Love Beach', 25.0665, -77.4855],
  ['Old Fort Bay / Lyford Cay', 25.0315, -77.5155],
  ['Carmichael', 25.0245, -77.3755],
  ['Prince Charles', 25.0475, -77.2955],
  ['Airport Area', 25.0395, -77.4645],
];
const AREA_RADIUS_M = 2200;

const PRICE: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function areaFor(lat: number, lng: number, allowed: Set<string>): string | null {
  // Paradise Island sits just across the harbour from Bay Street, so go by the shoreline, not distance.
  if (lat >= 25.0805 && lng >= -77.35 && lng <= -77.27) return allowed.has('Paradise Island') ? 'Paradise Island' : null;
  let best: string | null = null;
  let bestD = AREA_RADIUS_M;
  for (const [label, aLat, aLng] of AREA_CENTRES) {
    const d = distanceM(lat, lng, aLat, aLng);
    if (d < bestD && allowed.has(label)) [best, bestD] = [label, d];
  }
  return best;
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const cleanSpaces = (s: string) => s.replace(/[   ]/g, ' ');

/**
 * Google periods → { "0": {open, close}, … }. The directory stores one window
 * per day, so split days (lunch + dinner) become first-open → last-close, and
 * the real breakdown goes in hours_note.
 */
function toHours(oh: Place['regularOpeningHours']): { hours: WeeklyHours | null; note: string | null } {
  const periods = oh?.periods ?? [];
  if (!periods.length) return { hours: null, note: null };

  if (periods.length === 1 && !periods[0].close) {
    const always: WeeklyHours = {};
    for (let d = 0; d < 7; d++) always[d] = { open: '00:00', close: '23:59' };
    return { hours: always, note: null };
  }

  const byDay = new Map<number, { open: number; close: string }[]>();
  for (const { open, close } of periods) {
    const list = byDay.get(open.day) ?? [];
    list.push({ open: open.hour * 60 + open.minute, close: close ? hhmm(close.hour, close.minute) : '23:59' });
    byDay.set(open.day, list);
  }

  const hours: WeeklyHours = {};
  const splitDays: string[] = [];
  for (const [day, windows] of byDay) {
    windows.sort((a, b) => a.open - b.open);
    const first = windows[0];
    hours[day] = { open: hhmm(Math.floor(first.open / 60), first.open % 60), close: windows[windows.length - 1].close };
    if (windows.length > 1) splitDays.push(DAY_NAMES[day]);
  }

  const descs = (oh?.weekdayDescriptions ?? []).map(cleanSpaces);
  const note = splitDays.length
    ? `Closed between sessions. ${splitDays.map((d) => descs.find((s) => s.startsWith(d)) ?? d).join('; ')}`
    : null;
  return { hours, note };
}

function formatPhone(raw?: string): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : raw;
}

/** Plenty of Nassau spots list a Facebook or Instagram page as their "website". */
function splitWebsite(uri?: string) {
  const out = { website: null as string | null, instagram: null as string | null, facebook: null as string | null };
  if (!uri) return out;
  try {
    const url = new URL(uri);
    const host = url.hostname.replace(/^www\./, '');
    if (host.endsWith('instagram.com')) {
      const handle = url.pathname.split('/').filter(Boolean)[0];
      out.instagram = handle ? `@${handle}` : uri;
    } else if (host.endsWith('facebook.com') || host === 'fb.com') {
      out.facebook = uri;
    } else {
      out.website = uri;
    }
  } catch {
    out.website = uri;
  }
  return out;
}

function toRow(p: Place, tags: Record<'category' | 'vibe' | 'area', Set<string>>) {
  const name = p.displayName!.text.trim().slice(0, 120);
  const { latitude: lat, longitude: lng } = p.location!;

  const categories = new Set<string>();
  for (const [re, label] of CATEGORY_BY_NAME) if (re.test(name)) categories.add(label);
  for (const t of [p.primaryType, ...(p.types ?? [])]) {
    const label = t && CATEGORY_BY_TYPE[t];
    if (label) categories.add(label);
  }
  // A plain "bar" with no better clue is a neighbourhood bar, not a cocktail bar.
  if (categories.size === 0 && (p.primaryType === 'bar' || p.types?.includes('bar'))) categories.add('Local Bar');

  // Only the attributes that actually tell spots apart — "good for groups"
  // is true for nearly everything on Google.
  const vibes = new Set<string>();
  if (p.outdoorSeating) vibes.add('Outdoor');
  if (p.liveMusic) vibes.add('Live Band');
  if (p.primaryType === 'night_club') vibes.add('Dancing');

  const { hours, note } = toHours(p.regularOpeningHours);
  const address = (p.shortFormattedAddress ?? p.formattedAddress ?? '').replace(/,?\s*The Bahamas$/i, '') || null;

  return {
    google_place_id: p.id,
    name,
    description: p.editorialSummary?.text ?? null,
    categories: [...categories].filter((c) => tags.category.has(c)),
    vibes: [...vibes].filter((v) => tags.vibe.has(v)),
    area: areaFor(lat, lng, tags.area),
    price_level: (p.priceLevel && PRICE[p.priceLevel]) || null,
    phone: formatPhone(p.nationalPhoneNumber),
    ...splitWebsite(p.websiteUri),
    address,
    lat,
    lng,
    hours,
    hours_note: note,
    is_published: args.publish,
  };
}

type Row = ReturnType<typeof toRow>;

// -----------------------------------------------------------------------------
// Matching against what's already in the directory
// -----------------------------------------------------------------------------

interface Existing { id: string; name: string; lat: number | null; lng: number | null; google_place_id: string | null }

const normalize = (s: string) =>
  s.normalize('NFKD').toLowerCase().replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/\b(the|bar|grill|lounge|club|pub)\b/g, '').replace(/[^a-z0-9]/g, '');

/** A hand-added spot with the same name in roughly the same place. */
function findManualMatch(row: Row, existing: Existing[]): Existing | undefined {
  const n = normalize(row.name);
  if (!n) return undefined;
  return existing.find((e) => {
    if (e.google_place_id) return false;
    const en = normalize(e.name);
    const near = e.lat != null && e.lng != null && distanceM(row.lat, row.lng, e.lat, e.lng) < 150;
    // Short names ("Anuk" vs Google's "Anuk West") only link when the pins are close.
    const prefix = Math.min(en.length, n.length) >= 3 && (en.startsWith(n) || n.startsWith(en));
    const sameName = en === n || (Math.min(en.length, n.length) >= 5 && (en.includes(n) || n.includes(en))) || (prefix && near);
    if (!sameName) return false;
    return e.lat == null || e.lng == null ? en === n : distanceM(row.lat, row.lng, e.lat, e.lng) < 250;
  });
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const probe = await supabase.from('venues').select('id, name, lat, lng, google_place_id');
  if (probe.error) {
    if (/google_place_id/.test(probe.error.message)) fail('The google_place_id column is missing. Re-run supabase/schema.sql in the SQL Editor first.');
    fail(`Supabase: ${probe.error.message}`);
  }
  const existing = probe.data as Existing[];
  if (DRY_RUN && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('(dry run with the anon key: drafts are invisible, so duplicate detection only sees published spots)\n');
  }

  const { data: tagRows, error: tagErr } = await supabase.from('tags').select('kind, label');
  if (tagErr) fail(`Supabase: ${tagErr.message}`);
  const tags = { category: new Set<string>(), vibe: new Set<string>(), area: new Set<string>() };
  for (const t of tagRows as { kind: keyof typeof tags; label: string }[]) tags[t.kind]?.add(t.label);

  const found = new Map<string, Place>();
  if (args.cache && existsSync(args.cache)) {
    for (const p of JSON.parse(readFileSync(args.cache, 'utf8')) as Place[]) found.set(p.id, p);
    console.log(`Loaded ${found.size} places from ${args.cache} (no API requests).`);
  } else {
    for (const q of QUERIES) {
      console.log(`Searching "${q}" across New Providence…`);
      for (const cell of splitBox(NEW_PROVIDENCE, START_CELL_DEG)) await sweep(q, cell, START_CELL_DEG, 1, found);
      console.log(`  ${found.size} unique places so far (${requestCount} API requests)`);
    }
    if (args.cache) {
      writeFileSync(args.cache, JSON.stringify([...found.values()]));
      console.log(`  saved raw results to ${args.cache}`);
    }
  }

  const skipped = new Map<string, number>();
  const rows: Row[] = [];
  for (const p of found.values()) {
    const reason = keep(p);
    if (reason) skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
    else rows.push(toRow(p, tags));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const known = new Set(existing.map((e) => e.google_place_id).filter(Boolean));
  const fresh: Row[] = [];
  const links: { id: string; name: string; row: Row }[] = [];
  let alreadyImported = 0;
  for (const row of rows) {
    if (known.has(row.google_place_id)) {
      alreadyImported++;
      continue;
    }
    const match = findManualMatch(row, existing);
    if (match) {
      links.push({ id: match.id, name: match.name, row });
      match.google_place_id = row.google_place_id; // don't link two places to one spot
    } else {
      fresh.push(row);
    }
  }

  console.log(`\n${found.size} places found, ${rows.length} look like bars, clubs and lounges.`);
  for (const [reason, n] of [...skipped].sort((a, b) => b[1] - a[1])) console.log(`  skipped ${n} × ${reason}`);
  console.log(`  ${alreadyImported} already imported, ${links.length} match spots you added by hand, ${fresh.length} new.\n`);

  for (const r of fresh) {
    const bits = [r.area ?? 'no area', r.categories.join(', ') || 'no category', r.price_level ? '$'.repeat(r.price_level) : '', r.hours ? 'hours' : 'no hours'];
    console.log(`  + ${r.name}  ·  ${bits.filter(Boolean).join(' · ')}`);
  }
  for (const l of links) console.log(`  = ${l.name}  ↔  ${l.row.name} (link only, your edits are kept)`);

  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ new: fresh, link: links.map((l) => ({ id: l.id, name: l.name, google: l.row })) }, null, 2));
    console.log(`\nWrote ${args.out}`);
  }

  if (DRY_RUN) {
    console.log(`\nDry run: nothing written. ${requestCount} Places API requests used.`);
    return;
  }

  for (let i = 0; i < fresh.length; i += 100) {
    const { error } = await supabase
      .from('venues')
      .upsert(fresh.slice(i, i + 100), { onConflict: 'google_place_id', ignoreDuplicates: true });
    if (error) fail(`Insert failed: ${error.message}`);
  }
  for (const l of links) {
    const { error } = await supabase.from('venues').update({ google_place_id: l.row.google_place_id }).eq('id', l.id);
    if (error) console.warn(`  ! couldn't link ${l.name}: ${error.message}`);
  }

  const state = args.publish ? 'published' : 'drafts (review them in /admin, then switch on Published)';
  console.log(`\nInserted ${fresh.length} spots as ${state}; linked ${links.length}. ${requestCount} Places API requests used.`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fail(msg: string): never {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

await main();
