// Bar crawl planner (phase 1): picks and orders 2–6 stops for a night out,
// entirely in the browser from data the directory already has. See
// docs/bar-crawl.md for the design and what later phases add.
//
// Travel is estimated from straight-line distance (× a detour factor for
// Nassau's street grid), not a routing engine, so times are approximate and
// the map joins stops with straight dashed lines. Turn-by-turn directions are
// handed to Google Maps.
//
// There is deliberately no "drive" mode: legs are walked or taken by taxi.

import { getDistance } from './geo';
import { nassauClock, openState, hasHours, timeToMinutes } from './hours';
import { isEventLive } from './events';
import type { NightEvent, RatingSummary, Venue, VenueActivity } from './types';

export type CrawlMode = 'walk' | 'mix' | 'taxi';

export interface CrawlRequest {
  /** The night, as Nassau date YYYY-MM-DD (times after midnight belong to it). */
  night: string;
  /** Minutes after that night's midnight; past 1440 is the next morning. */
  start: number;
  end: number;
  party: number;
  areas: string[];
  vibes: string[];
  /** Highest price level (1–4), or null for any. */
  maxPrice: number | null;
  /** Number of stops, or null to fit the time. */
  stops: number | null;
  mode: CrawlMode;
  /** Where they set off from (their GPS), if they asked to start nearby. */
  origin: { lat: number; lng: number } | null;
  /** A spot that must be the first stop ("Start a crawl here"). */
  first: string | null;
  /** Varies the pick between equally good plans ("Shuffle"). */
  seed: number;
}

export interface CrawlContext {
  venues: Venue[];
  events: NightEvent[];
  ratings: Record<string, RatingSummary>;
  activity: Record<string, VenueActivity>;
  /** typical[venueId][dow][hour]: usual crowd (8-week average), Nassau time. */
  typical: Record<string, number[][]>;
  favorites: Set<string>;
}

export interface Leg {
  mode: 'walk' | 'taxi';
  minutes: number;
  metres: number;
}

export interface CrawlStop {
  venue: Venue;
  arrive: number;
  leave: number;
  /** Short "why this one" notes. */
  reasons: string[];
  event: NightEvent | null;
  /** E.g. hours not listed, closes soon after you leave. */
  warning: string | null;
  /** How you get here from the previous stop (or from the origin, for the first). */
  legIn: Leg | null;
}

export interface CrawlPlan {
  stops: CrawlStop[];
  start: number;
  end: number;
}

// ----------------------------------------------------------------------------
// Time (Nassau wall clock <-> timestamps)
// ----------------------------------------------------------------------------

const NASSAU_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Nassau', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function wallClock(t: number) {
  const p = Object.fromEntries(NASSAU_PARTS.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
}

/** Timestamp of `minutes` after midnight starting `night` (YYYY-MM-DD), in Nassau time. */
export function nassauTime(night: string, minutes: number) {
  const [y, m, d] = night.split('-').map(Number);
  const want = Date.UTC(y, m - 1, d) + minutes * 60_000;
  let t = want + 5 * 3600_000; // EST first guess; corrected below for daylight time
  for (let i = 0; i < 2; i++) t += want - wallClock(t);
  return t;
}

/** Nassau date string of a timestamp. */
export function nassauDate(t: number) {
  const p = Object.fromEntries(NASSAU_PARTS.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Tonight and the next six nights. Before 6 AM, "tonight" is still last night. */
export function nightOptions(now = Date.now()) {
  const tonight = nassauDate(now - 6 * 3600_000);
  const [y, m, d] = tonight.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    const value = date.toISOString().slice(0, 10);
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const label = i === 0 ? 'Tonight' : i === 1 ? 'Tomorrow' : `${weekday} ${date.getUTCDate()}`;
    return { value, label, weekday };
  });
}

export const formatClock = (t: number) =>
  new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Nassau', hour: 'numeric', minute: '2-digit' }).replace(':00', '');

/** 1260 -> "9 PM", 1530 -> "1:30 AM" */
export function minutesLabel(mins: number) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

// ----------------------------------------------------------------------------
// Travel estimates
// ----------------------------------------------------------------------------

/** Streets aren't straight lines: Nassau's grid and the harbour add roughly a third. */
const DETOUR = 1.35;
const WALK_M_PER_MIN = 80; // ~4.8 km/h
const TAXI_M_PER_MIN = 400; // ~24 km/h in town
const TAXI_WAIT_MIN = 6; // calling / flagging one down
/** Longest leg we'll suggest walking. */
export const MAX_WALK_MIN = 15;
/** Longest leg in walk-only mode (beyond this it isn't a walking crawl). */
const WALK_ONLY_MAX_MIN = 22;
/** Longest taxi ride between stops: further is a trip across the island, not a crawl. */
const TAXI_MAX_MIN = 22;

export function legBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }, mode: CrawlMode): Leg | null {
  const metres = getDistance(a.lat, a.lng, b.lat, b.lng) * DETOUR;
  const walk = Math.max(1, Math.round(metres / WALK_M_PER_MIN));
  const taxi = Math.round(TAXI_WAIT_MIN + metres / TAXI_M_PER_MIN);
  if (mode === 'walk') return walk <= WALK_ONLY_MAX_MIN ? { mode: 'walk', minutes: walk, metres } : null;
  if (mode === 'taxi' && metres > 400) return taxi <= TAXI_MAX_MIN ? { mode: 'taxi', minutes: taxi, metres } : null;
  if (walk <= MAX_WALK_MIN || metres <= 400) return { mode: 'walk', minutes: walk, metres };
  return taxi <= TAXI_MAX_MIN ? { mode: 'taxi', minutes: taxi, metres } : null;
}

/**
 * Hassle of a leg in score points: minutes on the move, plus a fixed cost per
 * taxi (finding one, paying), so a crawl clusters unless a spot is worth it.
 */
const legCost = (leg: Leg) => leg.minutes * 0.08 + (leg.mode === 'taxi' ? 1.2 : 0);

/** Arrivals on the next 5 minutes ("10:05 PM", not "10:01 PM"). */
const ceil5 = (t: number) => Math.ceil(t / 300_000) * 300_000;

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------

// How lively a type of place usually is, so a night can build: a bar first, a
// lounge or live music next, the club last. The busiest of a spot's types wins.
const ENERGY: Record<string, number> = {
  'Wine Bar': 1, 'Cocktail Bar': 1.2, 'Rum Bar': 1.2, 'Hotel Bar': 1, 'Beach Bar': 1.3, 'Bar & Grill': 1, 'Fish Fry & Bar': 1.3,
  'Local Bar': 1.3, Pub: 1.4, 'Dive Bar': 1.5, 'Sports Bar': 1.5,
  Lounge: 2, 'Rooftop Bar': 2, 'Live Music': 2.2, 'Hookah Lounge': 2, Karaoke: 2.2,
  Nightclub: 3, Casino: 2.6,
};

function energyOf(v: Venue) {
  let e = Math.max(1, ...v.categories.map((c) => ENERGY[c] ?? 1.5));
  if (v.vibes.includes('Dancing') || v.vibes.includes('DJ Sets')) e = Math.max(e, 2.5);
  return e;
}

const GROUP_TYPES = ['Nightclub', 'Lounge', 'Sports Bar', 'Beach Bar', 'Bar & Grill', 'Fish Fry & Bar', 'Pub'];
const SMALL_TYPES = ['Wine Bar', 'Cocktail Bar'];

/** Deterministic pseudo-random in [0, 1) from a seed and a string, for Shuffle. */
function jitter(seed: number, key: string) {
  let h = seed ^ 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

interface Scored {
  score: number;
  reasons: string[];
  event: NightEvent | null;
  warning: string | null;
}

/** Spots that pass the hard filters (pin, area, price), whatever the time. */
export function candidates(req: CrawlRequest, ctx: CrawlContext) {
  return ctx.venues.filter(
    (v) =>
      v.lat != null &&
      v.lng != null &&
      (req.areas.length === 0 || (v.area != null && req.areas.includes(v.area)) || v.id === req.first) &&
      (req.maxPrice == null || v.price_level == null || v.price_level <= req.maxPrice || v.id === req.first),
  );
}

/** When `v` closes after `t` (timestamp), or null when its hours aren't listed or it's shut at `t`. */
function closingAfter(v: Venue, t: number) {
  const s = openState(v.hours, t);
  if (s.kind !== 'open') return null;
  const close = timeToMinutes(s.closesAt) ?? 0;
  const now = nassauClock(t).minutes;
  return t + (((close - now + 1440) % 1440) || 1440) * 60_000;
}

/** How good `v` is as stop `index` of `count`, arriving at `arrive` and leaving at `leave`. Null = can't go. */
function scoreStop(v: Venue, arrive: number, leave: number, index: number, count: number, req: CrawlRequest, ctx: CrawlContext): Scored | null {
  const reasons: string[] = [];
  let warning: string | null = null;
  let score = 0;

  if (hasHours(v.hours)) {
    if (openState(v.hours, arrive + 5 * 60_000).kind !== 'open') return null;
    if (openState(v.hours, leave - 10 * 60_000).kind !== 'open') return null;
  } else {
    score -= 1.5;
    warning = 'Hours aren’t listed: call ahead.';
  }

  const rating = ctx.ratings[v.id];
  if (rating?.rating_count) {
    const weighted = (rating.rating_avg * rating.rating_count + 3.5 * 3) / (rating.rating_count + 3);
    score += (weighted - 3.5) * 1.2;
    if (rating.rating_avg >= 4.3 && rating.rating_count >= 3) reasons.push(`★ ${rating.rating_avg.toFixed(1)} from ${rating.rating_count} reviews`);
  }

  if (ctx.favorites.has(v.id)) {
    score += 1.5;
    reasons.push('One of your favourites');
  }

  const vibeHits = req.vibes.filter((x) => v.vibes.includes(x));
  if (vibeHits.length) {
    score += Math.min(2, vibeHits.length);
    reasons.push(vibeHits.join(' · '));
  }

  // Usual crowd while they're there (the popular-times data).
  const { dow, minutes } = nassauClock(arrive + 30 * 60_000);
  const usual = ctx.typical[v.id]?.[dow]?.[Math.floor(minutes / 60)] ?? 0;
  const peak = Math.max(ctx.activity[v.id]?.peak_avg ?? 0, 6);
  if (usual > 0) {
    score += Math.min(1, usual / peak) * 1.5;
    if (usual >= 3 && usual / peak >= 0.6) reasons.push(`Usually lively around ${formatClock(arrive + 30 * 60_000)}`);
  }
  const visits = ctx.activity[v.id]?.visits_30d ?? 0;
  if (visits >= 10) score += Math.min(1, visits / 100);

  // Something on while they're there.
  const mid = arrive + (leave - arrive) / 2;
  const event = ctx.events.find((e) => e.venue_id === v.id && (isEventLive(e, arrive + 10 * 60_000) || isEventLive(e, mid))) ?? null;
  if (event) {
    score += 2.5;
    reasons.unshift(event.title);
  }

  // Groups: places with room and a group-friendly reputation.
  if (req.party >= 6) {
    if (v.vibes.includes('Group Friendly')) {
      score += 1.2;
      reasons.push('Group friendly');
    }
    if (v.categories.some((c) => GROUP_TYPES.includes(c))) score += 0.5;
    if (v.categories.every((c) => SMALL_TYPES.includes(c))) score -= 0.6;
  }

  // Build the night: lower-key first, the liveliest last.
  const want = count === 1 ? 2 : 1 + (2 * index) / (count - 1);
  score -= Math.abs(energyOf(v) - want) * 0.8;
  if (minutes >= 60 && minutes < 360 && v.vibes.includes('Late Night')) score += 0.5;

  // The first plan is the best one; "Try another route" (seed > 0) shakes it up.
  if (req.seed) score += jitter(req.seed, v.id) * 2;
  return { score, reasons: reasons.slice(0, 3), event, warning };
}

// ----------------------------------------------------------------------------
// Planning
// ----------------------------------------------------------------------------

/** Minutes at each stop, given the window and the number of stops. */
function dwellFor(req: CrawlRequest, count: number) {
  const travel = (count - 1) * (req.mode === 'walk' ? 10 : 14);
  return Math.max(30, Math.min(120, (req.end - req.start - travel) / count));
}

export const autoStops = (req: Pick<CrawlRequest, 'start' | 'end'>) => Math.max(2, Math.min(6, Math.round((req.end - req.start) / 60)));

interface State {
  ids: string[];
  stops: CrawlStop[];
  score: number;
  depart: number;
  last: { lat: number; lng: number } | null;
}

/** Beam search: build the night stop by stop, keeping the best partial plans. */
function search(
  req: CrawlRequest, ctx: CrawlContext, count: number, pool: Venue[], fixed: (string | null)[] = [], dwellMin = dwellFor(req, count),
): CrawlPlan | null {
  const start = nassauTime(req.night, req.start);
  const end = nassauTime(req.night, req.end);
  const dwell = dwellMin * 60_000;
  const WIDTH = 30;
  let beam: State[] = [{ ids: [], stops: [], score: 0, depart: start, last: req.origin }];

  for (let i = 0; i < count; i++) {
    const next: State[] = [];
    const choices = fixed[i] ? pool.filter((v) => v.id === fixed[i]) : pool;
    for (const s of beam) {
      for (const v of choices) {
        if (s.ids.includes(v.id)) continue;
        const pos = { lat: v.lat!, lng: v.lng! };
        const leg = s.last ? legBetween(s.last, pos, req.mode) : null;
        if (s.last && !leg) continue;
        // The first stop starts on time; getting there from the origin is on top.
        const arrive = i === 0 ? start : ceil5(s.depart + (leg?.minutes ?? 0) * 60_000);
        // The last stop runs to the end of the night, or to closing if that's earlier.
        let leave = ceil5(arrive + dwell);
        if (i === count - 1) {
          const closes = hasHours(v.hours) ? closingAfter(v, arrive + 5 * 60_000) : null;
          leave = Math.max(arrive + 30 * 60_000, closes ? Math.min(end, closes) : end);
        }
        if (arrive + 25 * 60_000 > end) continue;
        const scored = scoreStop(v, arrive, leave, i, count, req, ctx);
        if (!scored) continue;
        const prevType = s.stops[s.stops.length - 1]?.venue.categories[0];
        const repeat = prevType && prevType === v.categories[0] ? 0.4 : 0;
        next.push({
          ids: [...s.ids, v.id],
          stops: [...s.stops, { venue: v, arrive, leave, reasons: scored.reasons, event: scored.event, warning: scored.warning, legIn: leg }],
          score: s.score + scored.score - (leg ? legCost(leg) : 0) - repeat,
          depart: leave,
          last: pos,
        });
      }
    }
    if (next.length === 0) return null;
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, WIDTH);
  }
  return { stops: beam[0].stops, start, end };
}

export type PlanResult = { plan: CrawlPlan; note: string | null } | { plan: null; reason: string };

export function planCrawl(req: CrawlRequest, ctx: CrawlContext): PlanResult {
  const pool = candidates(req, ctx);
  // A "start here" spot without a pin can't be routed: plan without it.
  if (req.first && !pool.some((v) => v.id === req.first)) req = { ...req, first: null };
  if (pool.length === 0) return { plan: null, reason: 'No spots match those areas and budget yet. Try another area or any budget.' };
  const wanted = req.stops ?? autoStops(req);
  // If that many stops don't fit (spots close early that night), try shorter
  // stays before fewer stops.
  for (let count = wanted; count >= 2; count--) {
    const full = dwellFor(req, count);
    for (const dwell of [...new Set([full, Math.min(full, 60), Math.min(full, 45)])]) {
      const plan = search(req, ctx, count, pool, [req.first], dwell);
      if (!plan) continue;
      const finish = plan.stops[plan.stops.length - 1].leave;
      const note =
        count < wanted
          ? `Only ${count} stops fit: not enough spots are open then. Try a longer night or more areas.`
          : finish < plan.end - 15 * 60_000
            ? `Spots close early that night, so this crawl ends around ${formatClock(finish)}.`
            : null;
      return { plan, note };
    }
  }
  if (req.mode === 'walk') return { plan: null, reason: 'No walkable route fits. Try “Walk + taxi”, more areas, or other times.' };
  return { plan: null, reason: 'Not enough spots are open then. Try other times, more areas, or any budget.' };
}

/** Rebuild a shared plan from its stop ids (times recomputed). Null if a spot is gone or closed. */
export function planFromIds(ids: string[], req: CrawlRequest, ctx: CrawlContext): CrawlPlan | null {
  const pool = ctx.venues.filter((v) => ids.includes(v.id) && v.lat != null && v.lng != null);
  if (pool.length !== ids.length) return null;
  return search(req, ctx, ids.length, pool, ids);
}

/**
 * Replace stop `index` with the next-best spot (skipping `exclude`), keeping
 * the others. Null when nothing else fits there.
 */
export function swapStop(plan: CrawlPlan, index: number, req: CrawlRequest, ctx: CrawlContext, exclude: string[]): CrawlPlan | null {
  const ids = plan.stops.map((s) => s.venue.id);
  const others = plan.stops.filter((_, i) => i !== index).map((s) => s.venue);
  const swapPool = candidates(req, ctx).filter((v) => !ids.includes(v.id) && !exclude.includes(v.id));
  return search(req, ctx, ids.length, [...others, ...swapPool], ids.map((id, i) => (i === index ? null : id)));
}

/** Google Maps directions through every stop (it does the turn-by-turn). */
export function googleMapsUrl(plan: CrawlPlan, origin: { lat: number; lng: number } | null) {
  const pts = plan.stops.map((s) => `${s.venue.lat},${s.venue.lng}`);
  const from = origin ? `${origin.lat},${origin.lng}` : pts[0];
  const rest = origin ? pts : pts.slice(1);
  const params = new URLSearchParams({ api: '1', origin: from, destination: rest[rest.length - 1] ?? from });
  if (rest.length > 1) params.set('waypoints', rest.slice(0, -1).join('|'));
  const allWalk = plan.stops.every((s) => !s.legIn || s.legIn.mode === 'walk');
  params.set('travelmode', allWalk ? 'walking' : 'driving');
  return `https://www.google.com/maps/dir/?${params}`;
}
