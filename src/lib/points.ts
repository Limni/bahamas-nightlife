import { useCallback, useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';

// ---------------------------------------------------------------------------
// Points: earned for check-ins (once per spot per night, after staying DWELL
// minutes) and for applied suggestions. The database decides everything
// (check_in(), the submissions trigger); this module only asks and displays.
// ---------------------------------------------------------------------------

export interface PointsConfig {
  enabled: boolean;
  checkIn: number;
  checkInMax: number;
  update: number;
  newSpot: number;
}

/** Mirrors the 4-minute stay in check_in(). Change them together. */
export const CHECK_IN_DWELL_S = 240;

let configPromise: Promise<PointsConfig | null> | null = null;

/** Site-wide points settings, fetched once per page load. Null = the schema isn't there yet (feature hidden). */
export function loadPointsConfig(force = false): Promise<PointsConfig | null> {
  if (!supabaseConfigured) return Promise.resolve(null);
  if (!configPromise || force) {
    configPromise = Promise.resolve(
      supabase
        .from('site_settings')
        .select('points_enabled, points_check_in, points_check_in_max, points_update, points_new_spot')
        .maybeSingle(),
    ).then(({ data, error }) =>
      error || !data
        ? null
        : {
            enabled: !!data.points_enabled,
            checkIn: data.points_check_in,
            checkInMax: data.points_check_in_max,
            update: data.points_update,
            newSpot: data.points_new_spot,
          },
    );
  }
  return configPromise;
}

export function usePointsConfig() {
  const [config, setConfig] = useState<PointsConfig | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadPointsConfig().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

/** The Nassau "night" (6 AM to 6 AM) as YYYY-MM-DD, matching points_night() in SQL. */
export function nassauNight(at = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Nassau', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(at - 6 * 3600_000),
  );
}

export const pointsLabel = (n: number) => `${n} point${Math.abs(n) === 1 ? '' : 's'}`;

export type CheckInResult =
  | { status: 'started' | 'wait'; wait_s: number; points: number }
  | { status: 'confirmed'; points: number; balance: number }
  | { status: 'already'; points: number }
  | { status: 'too_far'; distance_m: number }
  | { status: 'inaccurate'; accuracy_m: number | null }
  | { status: 'nightly_limit'; max: number }
  | { status: 'signed_out' | 'suspended' | 'disabled' | 'unknown' }
  | { status: 'no_location'; denied: boolean }
  | { status: 'error'; message: string };

function track(name: string, params: Record<string, unknown>) {
  try {
    (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.('event', name, params);
  } catch {
    /* blocked */
  }
}

/** One fresh, precise fix. Only sent to check_in(); never stored. */
function currentFix(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  });
}

export async function checkIn(venueId: string): Promise<CheckInResult> {
  let pos: GeolocationPosition;
  try {
    pos = await currentFix();
  } catch (e) {
    return { status: 'no_location', denied: (e as GeolocationPositionError)?.code === 1 };
  }
  const { data, error } = await supabase.rpc('check_in', {
    p_venue: venueId,
    p_lat: pos.coords.latitude,
    p_lng: pos.coords.longitude,
    p_accuracy: pos.coords.accuracy,
  });
  if (error) return { status: 'error', message: error.message };
  const result = data as CheckInResult;
  if (result.status === 'started') track('check_in_start', { venue_id: venueId });
  if (result.status === 'confirmed') track('check_in', { venue_id: venueId, points: result.points });
  return result;
}

export interface MyCheckIn {
  id: string;
  started_at: string;
  confirmed_at: string | null;
  points: number;
}

/** The signed-in member's check-in at this spot tonight, if any. */
export function useTonightsCheckIn(venueId: string, userId: string | undefined) {
  const [row, setRow] = useState<MyCheckIn | null | undefined>(undefined);
  const reload = useCallback(() => {
    if (!userId || !supabaseConfigured) {
      setRow(null);
      return;
    }
    supabase
      .from('check_ins')
      .select('id, started_at, confirmed_at, points')
      .eq('venue_id', venueId)
      .eq('user_id', userId)
      .eq('night', nassauNight())
      .maybeSingle()
      .then(({ data, error }) => setRow(error ? null : ((data as MyCheckIn | null) ?? null)));
  }, [venueId, userId]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { row, reload };
}

export interface LedgerRow {
  id: string;
  points: number;
  reason: 'check_in' | 'update' | 'adjust' | 'redeem';
  note: string | null;
  created_at: string;
  venues: { name: string; slug: string } | null;
}

export interface MyPoints {
  balance: number;
  earned: number;
  check_ins: number;
  updates: number;
}

export function useMyPoints(userId: string | undefined) {
  const [summary, setSummary] = useState<MyPoints | null>(null);
  const [history, setHistory] = useState<LedgerRow[]>([]);
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    let alive = true;
    Promise.all([
      supabase.rpc('my_points'),
      supabase
        .from('points_ledger')
        .select('id, points, reason, note, created_at, venues(name, slug)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(15),
    ]).then(([s, h]) => {
      if (!alive) return;
      if (s.error || h.error) return setAvailable(false);
      setAvailable(true);
      const first = (s.data as MyPoints[] | null)?.[0];
      setSummary(first ?? { balance: 0, earned: 0, check_ins: 0, updates: 0 });
      setHistory((h.data ?? []) as unknown as LedgerRow[]);
    });
    return () => {
      alive = false;
    };
  }, [userId, tick]);
  return { summary, history, available, reload };
}
