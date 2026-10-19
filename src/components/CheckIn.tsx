import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, Loader2, MapPinCheck, Timer } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useUserLocation } from '@/lib/directory';
import { formatDistance, getDistance } from '@/lib/geo';
import { CHECK_IN_DWELL_S, checkIn, pointsLabel, usePointsConfig, useTonightsCheckIn, type CheckInResult } from '@/lib/points';
import type { Venue } from '@/lib/types';

// ---------------------------------------------------------------------------
// "Check in" on a venue page: earns points once per spot per night. The first
// tap starts it; the point lands after a few minutes' stay, confirmed with a
// second fix (automatic while the page stays open). Hidden when points are
// off, and when we already know the visitor is nowhere near.
// ---------------------------------------------------------------------------

/** Farther than this (when location is already on), the card would only be noise. */
const HIDE_BEYOND_M = 1500;

type Note = { tone: 'warn' | 'info'; text: string } | null;

function explain(r: CheckInResult, venue: Venue, finishing: boolean): Note {
  switch (r.status) {
    case 'too_far':
      return {
        tone: 'warn',
        text: finishing
          ? `Looks like you’ve left ${venue.name} (about ${formatDistance(r.distance_m)} away). Come back tonight to finish checking in.`
          : `You’re about ${formatDistance(r.distance_m)} from ${venue.name}. Check in once you’re there.`,
      };
    case 'inaccurate':
      return {
        tone: 'warn',
        text: `Your location is only accurate to ${r.accuracy_m ? `±${formatDistance(r.accuracy_m)}` : 'a rough area'}. Turn on precise location or step outside, then try again.`,
      };
    case 'nightly_limit':
      return { tone: 'info', text: `You’ve checked in at ${r.max} spots tonight, the nightly limit. See you tomorrow!` };
    case 'no_location':
      return {
        tone: 'warn',
        text: r.denied
          ? 'Allow location for this site to check in. It’s only used to confirm you’re here, never stored.'
          : 'Couldn’t get your location. Try again in a moment.',
      };
    case 'suspended':
      return { tone: 'warn', text: 'Your account is suspended, so it can’t earn points right now.' };
    case 'disabled':
      return { tone: 'info', text: 'Points are paused at the moment.' };
    case 'unknown':
      return { tone: 'warn', text: 'This spot can’t take check-ins yet.' };
    case 'error':
      return { tone: 'warn', text: 'Something went wrong. Please try again.' };
    default:
      return null;
  }
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'America/Nassau' });

export function CheckInCard({ venue, className = '' }: { venue: Venue; className?: string }) {
  const config = usePointsConfig();
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const { row, reload } = useTonightsCheckIn(venue.id, uid);
  const { location } = useUserLocation();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [earned, setEarned] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  // Finish automatically only for a check-in started (or resumed) in this tab.
  const autoFinish = useRef(false);

  useEffect(() => {
    if (row && !row.confirmed_at) setReadyAt(Date.parse(row.started_at) + CHECK_IN_DWELL_S * 1000);
  }, [row]);

  useEffect(() => {
    if (!readyAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [readyAt]);

  const run = useCallback(
    async (finishing: boolean) => {
      setBusy(true);
      setNote(null);
      const r = await checkIn(venue.id);
      setBusy(false);
      if (r.status === 'started' || r.status === 'wait') {
        setReadyAt(Date.now() + r.wait_s * 1000);
        autoFinish.current = true;
      } else if (r.status === 'confirmed') {
        setReadyAt(null);
        setEarned(r.points);
        reload();
      } else if (r.status === 'already') {
        setReadyAt(null);
        reload();
      } else {
        setNote(explain(r, venue, finishing));
      }
    },
    [venue, reload],
  );

  // The stay is over: confirm with a fresh fix while the page is open.
  const ready = readyAt !== null && now >= readyAt;
  useEffect(() => {
    if (!ready || busy || !autoFinish.current || document.visibilityState !== 'visible') return;
    autoFinish.current = false;
    run(true);
    // `now` re-checks each second, so returning to a hidden tab still finishes it.
  }, [ready, busy, run, now]);

  if (!config?.enabled || loading || (uid && row === undefined)) return null;
  const confirmed = row?.confirmed_at || earned !== null;
  const pending = !confirmed && readyAt !== null;
  if (!confirmed && !pending && location && getDistance(location.lat, location.lng, venue.lat!, venue.lng!) > HIDE_BEYOND_M) return null;

  const pts = config.checkIn;
  const shell = `rounded-2xl border p-4 flex items-start gap-3 ${className}`;

  if (confirmed) {
    const got = earned ?? row?.points ?? pts;
    return (
      <div className={`${shell} bg-emerald-400/10 border-emerald-400/25`}>
        <MapPinCheck className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-white">{earned !== null ? `+${pointsLabel(got)}! You’re checked in.` : 'Checked in tonight'}</p>
          <p className="text-sm font-semibold text-night-200">
            {got > 0 ? `${pointsLabel(got)} for ${venue.name}. ` : ''}
            <Link to="/account#points" className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2">
              See your points
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (!uid) {
    return (
      <div className={`${shell} bg-white/5 border-white/10`}>
        <Coins className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-white">Here tonight? Check in and earn {pointsLabel(pts)}</p>
          <p className="text-sm font-semibold text-night-300">Points will unlock rewards at participating bars.</p>
        </div>
        <Link
          to={`/account?next=${encodeURIComponent(`/v/${venue.slug}`)}`}
          className="shrink-0 px-3.5 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-white text-sm font-extrabold"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const left = readyAt ? Math.max(0, Math.ceil((readyAt - now) / 1000)) : 0;
  return (
    <div className={`${shell} bg-white/5 ${pending ? 'border-amber-400/30' : 'border-white/10'}`}>
      {pending ? <Timer className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" /> : <Coins className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />}
      <div className="min-w-0 flex-1">
        {pending ? (
          <>
            <p className="font-extrabold text-white">{left > 0 ? 'Checking you in…' : 'Ready to finish checking in'}</p>
            <p className="text-sm font-semibold text-night-200">
              {left > 0
                ? `Stay a few minutes: ${pts === 1 ? 'your point arrives' : `your ${pts} points arrive`} at ${clock(readyAt!)} (${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}). Keep this page open, or tap Finish when you come back.`
                : `Tap Finish to confirm you’re still at ${venue.name}.`}
            </p>
          </>
        ) : (
          <>
            <p className="font-extrabold text-white">Here tonight? Check in for {pointsLabel(pts)}</p>
            <p className="text-sm font-semibold text-night-300">
              Once per spot per night. Your location only confirms you’re here and is never stored.
            </p>
          </>
        )}
        {note && <p className={`mt-2 text-sm font-bold ${note.tone === 'warn' ? 'text-amber-300' : 'text-night-100'}`}>{note.text}</p>}
      </div>
      {(!pending || left === 0) && (
        <button
          type="button"
          onClick={() => run(pending)}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 disabled:opacity-60 text-white text-sm font-extrabold glow-brand-soft"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPinCheck className="w-4 h-4" />}
          {busy ? 'Finding you…' : pending ? 'Finish' : 'Check in'}
        </button>
      )}
    </div>
  );
}
