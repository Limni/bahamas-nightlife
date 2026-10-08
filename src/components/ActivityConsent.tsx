import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Radio, ShieldCheck, X } from 'lucide-react';
import { useActivity } from '@/lib/activity';
import { useDirectory, useUserLocation } from '@/lib/directory';
import { supabaseConfigured } from '@/lib/supabase';

const PRIVACY_LINE =
  'We only record which venue you’re at — never your location — under a random ID that resets every night. Only totals are shown, and never for fewer than 2 people.';

/**
 * Asks once, the first time location is on: may this browser report
 * anonymously which venue it's at? Nothing is sent until the visitor agrees.
 */
export function ActivityConsentCard() {
  const { consent, setConsent } = useActivity();
  const { location } = useUserLocation();
  const { pathname } = useLocation();
  if (!supabaseConfigured || consent !== null || !location) return null;
  // The account page has the full toggle; don't stack the two.
  if (pathname.startsWith('/account')) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        className="fixed z-[2500] inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] md:inset-x-auto md:right-6 md:bottom-6 md:w-[380px]"
        role="dialog"
        aria-label="Share live activity"
      >
        <div className="neon-edge rounded-3xl bg-night-900/95 backdrop-blur-md p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 shrink-0 rounded-2xl bg-brand-500/15 text-brand-300 flex items-center justify-center">
              <Radio className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="font-display font-bold text-white">Help light up the map</p>
              <p className="mt-1 text-sm text-night-200 leading-snug">
                Share your location anonymously while the site is open, so everyone can see which spots are buzzing right now.
              </p>
              <p className="mt-2 flex gap-1.5 text-xs text-night-300 leading-snug">
                <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                {PRIVACY_LINE}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setConsent('on')}
              className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-brand-500 to-glow-500 text-white text-sm font-extrabold hover:brightness-110"
            >
              Count me in
            </button>
            <button onClick={() => setConsent('off')} className="px-4 py-2.5 rounded-2xl text-sm font-extrabold text-night-200 hover:bg-white/5">
              No thanks
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** The on/off switch with the full explanation (Account page). */
export function ActivitySharingToggle() {
  const { consent, setConsent, here } = useActivity();
  const { venueById } = useDirectory();
  const { error } = useUserLocation();
  const on = consent === 'on';
  return (
    <section id="activity" className="bg-night-900 rounded-[1.75rem] border border-white/10 p-5 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-white">
            <Radio className="w-5 h-5 text-brand-300" /> Live activity sharing
          </h2>
          <p className="mt-1.5 text-sm text-night-200">
            While this site is open on your phone, it tells us anonymously which venue you’re at, so the map can show how busy places are and
            how that compares with a usual night.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="Share live activity"
          onClick={() => setConsent(on ? 'off' : 'on')}
          className={`relative shrink-0 w-14 h-8 rounded-full transition-colors ${on ? 'bg-brand-500 glow-brand' : 'bg-night-700'}`}
        >
          <span className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
        </button>
      </div>
      <ul className="mt-4 space-y-1.5 text-xs text-night-300">
        <li className="flex gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" /> {PRIVACY_LINE}
        </li>
        <li className="flex gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" /> Not tied to your account. Nothing is sent when the site is closed or this is off.
        </li>
      </ul>
      {on && here && (
        <p className="mt-3 text-sm font-bold text-brand-200">You’re counted at {venueById.get(here)?.name ?? 'a venue'} right now.</p>
      )}
      {on && error && <p className="mt-3 text-sm font-bold text-amber-300">{error}</p>}
    </section>
  );
}

/** "You're at X" — a small thank-you while this device counts toward a venue. */
export function HereBanner() {
  const { here } = useActivity();
  const { venueById } = useDirectory();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const venue = here ? venueById.get(here) : undefined;
  if (!venue || dismissed === here || pathname.startsWith('/map')) return null;
  return (
    <div className="fixed z-[1400] left-3 bottom-[calc(76px+env(safe-area-inset-bottom))] md:left-auto md:right-6 md:bottom-6 flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full bg-night-900/95 backdrop-blur ring-1 ring-brand-400/40 glow-brand-soft text-xs font-extrabold text-white">
      <span className="heat-dot pulse text-brand-400" />
      <Link to={`/v/${venue.slug}`} className="hover:text-brand-200 truncate max-w-[60vw]">
        You’re at {venue.name}
      </Link>
      <button onClick={() => setDismissed(here)} className="p-1 rounded-full hover:bg-white/10" aria-label="Dismiss">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
