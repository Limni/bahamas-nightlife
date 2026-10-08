import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase, supabaseConfigured } from './supabase';
import { useUserLocation } from './directory';
import { getDistance, NEW_PROVIDENCE } from './geo';
import type { VenueActivity } from './types';

// ---------------------------------------------------------------------------
// Live activity. Two halves:
//
//  1. Reporting. With the visitor's OK and location on, the open site sends an
//     anonymous ping (report_presence) every ~2 minutes. The server matches it
//     to a venue geofence and stores only "this device is at venue X" — never
//     coordinates. The device id is random and rotates every night (6 AM
//     Nassau), so it can't be tied to a person or followed day to day.
//
//  2. Reading. venue_activity() returns, per venue, phones there now and the
//     usual count for this weekday + hour (8-week average). It is re-fetched
//     every minute, when the tab comes back, and whenever venue_live changes
//     over Realtime — so levels move while you watch.
// ---------------------------------------------------------------------------

const CONSENT_KEY = 'activity:consent';
const DEVICE_KEY = 'activity:device';
const CACHE_KEY = 'activity:v1';

const PING_EVERY_MS = 120_000;
const PING_MIN_GAP_MS = 50_000; // the server ignores pings under 45 s apart
const MOVED_M = 75; // a move this big pings early (walking to the next bar)
const REFRESH_MS = 60_000;
const CACHE_MAX_AGE_MS = 10 * 60_000; // older live data is misleading, not helpful

export type Consent = 'on' | 'off' | null;

function readConsent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

/** The "night" a timestamp belongs to in Nassau: the date of (now − 6 h). */
function nightKey(now: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Nassau' }).format(new Date(now - 6 * 3600_000));
}

function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Anonymous per-browser id, rotated every night. */
function deviceId(now = Date.now()): string {
  const night = nightKey(now);
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null') as { id: string; night: string } | null;
    if (saved?.night === night && saved.id) return saved.id;
    const id = randomUuid();
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ id, night }));
    return id;
  } catch {
    return randomUuid(); // private mode: a fresh id per page load still works
  }
}

// Only ping from (roughly) New Providence; elsewhere can't match a venue.
const SLACK = 0.05;
const onIsland = (lat: number, lng: number) =>
  lat <= NEW_PROVIDENCE.north + SLACK && lat >= NEW_PROVIDENCE.south - SLACK && lng >= NEW_PROVIDENCE.west - SLACK && lng <= NEW_PROVIDENCE.east + SLACK;

function readCache(): Record<string, VenueActivity> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { at: number; rows: Record<string, VenueActivity> } | null;
    return raw && Date.now() - raw.at < CACHE_MAX_AGE_MS ? raw.rows : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Heat: turning counts into something people read at a glance.
// ---------------------------------------------------------------------------

export type HeatLevel = 'quiet' | 'chill' | 'lively' | 'packed';
export type VsUsual = 'busier' | 'usual' | 'quieter' | null;

export interface Heat {
  level: HeatLevel;
  label: string;
  /** CSS colour (a var) for dots, halos and bars. */
  color: string;
  /** 0–1: how full compared to the venue's busiest usual hour. */
  score: number;
  vsUsual: VsUsual;
  /** What this hour is usually like, for venues with history. */
  usual: HeatLevel | null;
}

// Until a venue has history, this many phones counts as "full". Keeps one
// early group from reading as "packed" at a 300-person club.
const PEAK_FLOOR = 6;

export const HEAT_META: Record<HeatLevel, { label: string; color: string }> = {
  quiet: { label: 'Quiet', color: 'var(--color-night-400)' },
  chill: { label: 'Chilled', color: 'var(--color-heat-chill)' },
  lively: { label: 'Lively', color: 'var(--color-heat-lively)' },
  packed: { label: 'Packed', color: 'var(--color-heat-packed)' },
};

function levelFor(count: number, scale: number): HeatLevel {
  if (count <= 0) return 'quiet';
  const s = count / scale;
  return s < 0.35 ? 'chill' : s < 0.7 ? 'lively' : 'packed';
}

export function heatFor(a: VenueActivity | undefined): Heat {
  const live = a?.live_count ?? 0;
  const typical = a?.typical_now ?? 0;
  const scale = Math.max(a?.peak_avg ?? 0, PEAK_FLOOR);
  const level = levelFor(live, scale);
  let vsUsual: VsUsual = null;
  if (typical >= 1) {
    const ratio = live / typical;
    vsUsual = ratio > 1.3 ? 'busier' : ratio < 0.7 ? 'quieter' : 'usual';
  } else if (live >= 2) {
    vsUsual = 'busier'; // a crowd at an hour that's normally empty
  }
  return {
    level,
    ...HEAT_META[level],
    score: Math.min(1, live / scale),
    vsUsual,
    usual: a && a.peak_avg > 0 ? levelFor(Math.round(typical), scale) : null,
  };
}

export const VS_USUAL_TEXT: Record<Exclude<VsUsual, null>, string> = {
  busier: 'Busier than usual',
  usual: 'About as busy as usual',
  quieter: 'Quieter than usual',
};

/** 0–1 sort key: live level first, then how far above its usual. */
export function buzzScore(a: VenueActivity | undefined) {
  if (!a || a.live_count <= 0) return 0;
  const h = heatFor(a);
  const lift = a.typical_now >= 1 ? Math.min(2, a.live_count / a.typical_now) / 2 : 0.5;
  return h.score * 0.75 + lift * 0.25;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ActivityValue {
  activity: Record<string, VenueActivity>;
  heatOf: (venueId: string) => Heat;
  /** People there right now (for the "Buzzing now" filter). */
  isBusy: (venueId: string) => boolean;
  /** False until the first venue_activity() response (or a fresh cache). */
  loaded: boolean;
  consent: Consent;
  setConsent: (c: Exclude<Consent, null>) => void;
  /** The venue this device is currently counted at, if any. */
  here: string | null;
  refresh: () => void;
}

const ActivityContext = createContext<ActivityValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { location, enable } = useUserLocation();
  const [activity, setActivity] = useState<Record<string, VenueActivity>>(readCache);
  const [loaded, setLoaded] = useState(() => Object.keys(readCache()).length > 0);
  const [consent, setConsentState] = useState<Consent>(readConsent);
  const [here, setHere] = useState<string | null>(null);

  // ---- reading -----------------------------------------------------------
  const inFlight = useRef(false);
  const fetchActivity = useCallback(async () => {
    if (!supabaseConfigured || inFlight.current) return;
    inFlight.current = true;
    const { data, error } = await supabase.rpc('venue_activity');
    inFlight.current = false;
    // Before the activity schema is applied the RPC doesn't exist: show nothing.
    if (error || !data) {
      setLoaded(true);
      return;
    }
    const rows: Record<string, VenueActivity> = {};
    for (const row of data as VenueActivity[]) rows[row.venue_id] = row;
    setActivity(rows);
    setLoaded(true);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows }));
    } catch {
      /* storage full / private mode */
    }
  }, []);

  const debounce = useRef<number | undefined>(undefined);
  const refresh = useCallback(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(fetchActivity, 1500);
  }, [fetchActivity]);

  useEffect(() => {
    fetchActivity();
    if (!supabaseConfigured) return;
    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchActivity();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchActivity();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Someone arrived or left somewhere → refetch (debounced: a busy Saturday
    // can produce a burst of changes).
    const channel = supabase
      .channel('venue-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'venue_live' }, () => refresh())
      .subscribe();
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(debounce.current);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [fetchActivity, refresh]);

  // ---- reporting ---------------------------------------------------------
  const latest = useRef(location);
  latest.current = location;
  const lastSent = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const hereRef = useRef<string | null>(null);

  const report = useCallback(async () => {
    const loc = latest.current;
    if (!loc || !onIsland(loc.lat, loc.lng)) return;
    lastSent.current = { at: Date.now(), lat: loc.lat, lng: loc.lng };
    const { data, error } = await supabase.rpc('report_presence', {
      p_device: deviceId(),
      p_lat: loc.lat,
      p_lng: loc.lng,
      p_accuracy: Number.isFinite(loc.accuracy) ? Math.round(loc.accuracy) : null,
    });
    if (error) return;
    const next = (data as string | null) ?? null;
    if (next !== hereRef.current) {
      // Our own arrival/departure changes a count: show it without waiting.
      hereRef.current = next;
      setHere(next);
      refresh();
    }
  }, [refresh]);

  const sharing = consent === 'on' && supabaseConfigured;

  // Sharing on → make sure the location watcher is running.
  useEffect(() => {
    if (sharing) enable();
  }, [sharing, enable]);

  useEffect(() => {
    if (!sharing) {
      hereRef.current = null;
      setHere(null);
      return;
    }
    const maybeSend = () => {
      const loc = latest.current;
      if (!loc || document.visibilityState !== 'visible') return;
      const last = lastSent.current;
      const since = last ? Date.now() - last.at : Infinity;
      const moved = last ? getDistance(last.lat, last.lng, loc.lat, loc.lng) : Infinity;
      if (since >= PING_EVERY_MS || (since >= PING_MIN_GAP_MS && moved >= MOVED_M)) report();
    };
    maybeSend();
    const id = window.setInterval(maybeSend, 20_000);
    document.addEventListener('visibilitychange', maybeSend);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', maybeSend);
    };
    // A fresh fix re-runs this so the first ping goes out as soon as there is one.
  }, [sharing, report, location !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const setConsent = useCallback((c: Exclude<Consent, null>) => {
    setConsentState(c);
    try {
      localStorage.setItem(CONSENT_KEY, c);
    } catch {
      /* private mode: consent lasts for this page view */
    }
  }, []);

  const heatOf = useCallback((venueId: string) => heatFor(activity[venueId]), [activity]);
  const isBusy = useCallback((venueId: string) => (activity[venueId]?.live_count ?? 0) > 0, [activity]);

  const value = useMemo(
    () => ({ activity, heatOf, isBusy, loaded, consent, setConsent, here, refresh: fetchActivity }),
    [activity, heatOf, isBusy, loaded, consent, setConsent, here, fetchActivity],
  );
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error('useActivity must be used inside <ActivityProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Popular times: the 8-week average per weekday + hour for one venue.
// ---------------------------------------------------------------------------

/** typical[dow][hour] in Nassau time, or null while loading / without history. */
export function usePopularTimes(venueId: string | undefined) {
  const [typical, setTypical] = useState<number[][] | null>(null);
  useEffect(() => {
    setTypical(null);
    if (!venueId || !supabaseConfigured) return;
    let alive = true;
    supabase
      .from('venue_typical')
      .select('dow, hour, avg_visitors')
      .eq('venue_id', venueId)
      .then(({ data }) => {
        if (!alive || !data?.length) return;
        const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
        for (const r of data as { dow: number; hour: number; avg_visitors: number }[]) grid[r.dow][r.hour] = r.avg_visitors;
        setTypical(grid);
      });
    return () => {
      alive = false;
    };
  }, [venueId]);
  return typical;
}
