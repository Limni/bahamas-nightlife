import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, QrCode } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { pointsLabel, usePointsConfig } from '@/lib/points';
import { useVenueRewards } from '@/lib/rewards';
import type { Venue } from '@/lib/types';
import { RedeemCodeSheet } from './RedeemCode';

/** "Rewards here" on a partner venue's page: what points buy, and the member's code. */
export function RewardsHere({ venue, className = '' }: { venue: Venue; className?: string }) {
  const config = usePointsConfig();
  const rewards = useVenueRewards(venue.id);
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  if (!config?.enabled || rewards.length === 0) return null;

  return (
    <section className={`rounded-3xl border border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-transparent p-5 ${className}`}>
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-white">
        <Gift className="w-5 h-5 text-amber-300" /> Rewards here
      </h2>
      <p className="mt-1 text-sm font-semibold text-night-300">Spend your Nassau Nights points at {venue.name}.</p>
      <ul className="mt-3 space-y-2">
        {rewards.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 p-3 rounded-2xl bg-white/5 border border-white/10">
            <span className="min-w-0">
              <span className="block font-extrabold text-white">{r.title}</span>
              {(r.description || r.nightly_limit) && (
                <span className="block text-xs font-semibold text-night-300">
                  {r.description}
                  {r.description && r.nightly_limit ? ' · ' : ''}
                  {r.nightly_limit ? `${r.nightly_limit === 1 ? 'Once' : `Up to ${r.nightly_limit} times`} a night` : ''}
                </span>
              )}
            </span>
            <span className="shrink-0 px-2.5 py-1 rounded-full bg-amber-400/15 text-amber-200 text-xs font-extrabold">{pointsLabel(r.cost)}</span>
          </li>
        ))}
      </ul>
      {session ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl bg-amber-400 hover:bg-amber-300 text-night-950 font-extrabold"
        >
          <QrCode className="w-5 h-5" /> Show my code at the bar
        </button>
      ) : (
        <Link
          to={`/account?next=${encodeURIComponent(`/v/${venue.slug}`)}`}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white font-extrabold"
        >
          Sign in to earn and use points
        </Link>
      )}
      <RedeemCodeSheet open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
