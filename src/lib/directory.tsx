import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, supabaseConfigured } from './supabase';
import type { NightEvent, RatingSummary, Venue, Tag, TagKind } from './types';

// ---------------------------------------------------------------------------
// Directory data: all published venues, upcoming events + the filter vocabularies.
// Nassau-scale data (hundreds of rows) is small enough to load once and
// filter client-side, which keeps search and filters instant. The last
// response is cached in localStorage so repeat visits paint immediately.
// ---------------------------------------------------------------------------

const CACHE_KEY = 'directory:v1';

interface Cached {
  venues: Venue[];
  tags: Tag[];
  ratings?: Record<string, RatingSummary>;
  events?: NightEvent[];
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

interface DirectoryValue {
  venues: Venue[];
  venueById: Map<string, Venue>;
  /** Published events that haven't ended (as of the last fetch), soonest first. */
  events: NightEvent[];
  tags: Tag[];
  tagsOf: (kind: TagKind) => string[];
  /** Star-rating summary per venue id (visible reviews only). */
  ratings: Record<string, RatingSummary>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshRatings: () => Promise<void>;
}

const DirectoryContext = createContext<DirectoryValue | null>(null);

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const cached = useMemo(readCache, []);
  const [venues, setVenues] = useState<Venue[]>(cached?.venues ?? []);
  const [tags, setTags] = useState<Tag[]>(cached?.tags ?? []);
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>(cached?.ratings ?? {});
  const [events, setEvents] = useState<NightEvent[]>(cached?.events ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }
    const [r, t, rt, ev] = await Promise.all([
      supabase.from('venues').select('*').eq('is_published', true).order('name'),
      supabase.from('tags').select('*').order('sort').order('label'),
      supabase.from('venue_ratings').select('*'),
      supabase
        .from('events')
        .select('*')
        .eq('is_published', true)
        // A null end_date is a recurring night with no end.
        .or(`end_date.is.null,end_date.gte.${new Date().toISOString()}`)
        .order('start_date')
        .limit(300),
    ]);
    // Events are optional too (no table yet = no events).
    const nextEvents = (ev.data ?? []) as NightEvent[];
    // Ratings are optional: before the reviews migration runs the view doesn't exist.
    const nextRatings: Record<string, RatingSummary> = {};
    for (const row of (rt.data ?? []) as ({ venue_id: string } & RatingSummary)[]) {
      nextRatings[row.venue_id] = { rating_avg: row.rating_avg, rating_count: row.rating_count };
    }
    if (r.error || t.error) {
      setError((r.error ?? t.error)!.message);
    } else {
      setError(null);
      setVenues(r.data as Venue[]);
      setTags(t.data as Tag[]);
      setRatings(nextRatings);
      setEvents(nextEvents);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ venues: r.data, tags: t.data, ratings: nextRatings, events: nextEvents }));
      } catch {
        /* storage full / private mode */
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    if (!supabaseConfigured) return;
    // Live updates: an edit in the admin console shows up for visitors without a reload.
    const channel = supabase
      .channel('directory')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'venues' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  // Cheap re-fetch of just the summaries, e.g. right after someone posts a review.
  const refreshRatings = useCallback(async () => {
    if (!supabaseConfigured) return;
    const { data } = await supabase.from('venue_ratings').select('*');
    if (!data) return;
    const next: Record<string, RatingSummary> = {};
    for (const row of data as ({ venue_id: string } & RatingSummary)[]) {
      next[row.venue_id] = { rating_avg: row.rating_avg, rating_count: row.rating_count };
    }
    setRatings(next);
  }, []);

  const tagsOf = useCallback((kind: TagKind) => tags.filter((t) => t.kind === kind).map((t) => t.label), [tags]);
  const venueById = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);

  const value = useMemo(
    () => ({ venues, venueById, events, tags, tagsOf, ratings, loading, error, refresh, refreshRatings }),
    [venues, venueById, events, tags, tagsOf, ratings, loading, error, refresh, refreshRatings],
  );
  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

export function useDirectory() {
  const ctx = useContext(DirectoryContext);
  if (!ctx) throw new Error('useDirectory must be used inside <DirectoryProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// User location. Off until something asks for it (the map, or "Near me"), or
// the visitor already granted permission on a previous visit. Once on, a
// single watcher serves every page.
// ---------------------------------------------------------------------------

export interface UserLocation {
  lat: number;
  lng: number;
  accuracy: number;
}

interface LocationValue {
  location: UserLocation | null;
  error: string | null;
  enabled: boolean;
  enable: () => void;
}

const LocationContext = createContext<LocationValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-enable for returning visitors who already allowed location.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') setEnabled(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) {
      setError('Location is not supported on this device.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setError(null);
      },
      (err) =>
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location is blocked. Enable it in your browser settings to see what’s near you.'
            : 'Couldn’t get your location right now.',
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  const enable = useCallback(() => setEnabled(true), []);
  const value = useMemo(() => ({ location, error, enabled, enable }), [location, error, enabled, enable]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useUserLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useUserLocation must be used inside <LocationProvider>');
  return ctx;
}
