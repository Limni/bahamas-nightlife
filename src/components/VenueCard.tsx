import { Link } from 'react-router-dom';
import { MapPin, Navigation, Star } from 'lucide-react';
import type { Venue } from '@/lib/types';
import { isFeatured } from '@/lib/types';
import { openState } from '@/lib/hours';
import { useDirectory } from '@/lib/directory';
import { useActivity } from '@/lib/activity';
import { HeatBadge, HeatPill, OpenBadge, Price, RatingBadge, SafeImg } from './ui';

function OpenPill({ r, now }: { r: Venue; now: number }) {
  const s = openState(r.hours, now);
  if (s.kind === 'unknown') return null;
  const open = s.kind === 'open';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold backdrop-blur ring-1 ring-white/10 ${
        open ? 'bg-night-950/80 text-emerald-300' : 'bg-night-950/70 text-white/75'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${open ? 'bg-emerald-400 glow-live' : 'bg-night-400'}`} />
      {open ? 'Open now' : 'Closed'}
    </span>
  );
}

function Cover({ r, className = '' }: { r: Venue; className?: string }) {
  return <SafeImg src={r.cover_url} name={r.name} className={`w-full h-full group-hover:scale-[1.04] transition-transform duration-700 ${className}`} />;
}

/** Main directory card: photo-led, with live activity over the photo. */
export function VenueCard({ r, distance, now }: { r: Venue; distance?: string | null; now: number }) {
  const featured = isFeatured(r, now);
  const rating = useDirectory().ratings[r.id];
  const heat = useActivity().heatOf(r.id);
  return (
    <Link
      to={`/v/${r.slug}`}
      className={`group flex flex-col bg-night-900 rounded-[1.75rem] overflow-hidden border border-white/10 hover:border-brand-400/50 hover:-translate-y-1 hover:glow-brand-soft transition-all duration-300 ${featured ? 'neon-edge' : ''}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-night-800">
        <Cover r={r} />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-night-900 via-night-900/40 to-transparent pointer-events-none" />
        {featured && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400 text-amber-950 text-[11px] font-extrabold uppercase tracking-wider shadow">
            <Star className="w-3 h-3 fill-current" /> Featured
          </span>
        )}
        {distance && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-night-950/80 backdrop-blur text-white text-xs font-extrabold ring-1 ring-white/10">
            <Navigation className="w-3 h-3" /> {distance}
          </span>
        )}
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5">
          <HeatPill heat={heat} />
          <OpenPill r={r} now={now} />
        </div>
      </div>
      <div className="flex-1 flex flex-col p-4 pt-3">
        <div className="flex items-baseline gap-2">
          <h3 className="font-display text-[1.05rem] font-bold text-white leading-tight">{r.name}</h3>
          <span className="leader" aria-hidden />
          <Price level={r.price_level} className="text-sm shrink-0" />
        </div>
        <p className="text-sm font-semibold text-night-200 mt-1 truncate">{r.categories.length > 0 ? r.categories.join(' · ') : 'Bar'}</p>
        {(r.area || rating) && (
          <div className="flex items-center justify-between gap-3 mt-1.5">
            {r.area ? (
              <p className="inline-flex items-center gap-1 text-xs font-bold text-night-300 min-w-0">
                <MapPin className="w-3.5 h-3.5 shrink-0 text-brand-400" />
                <span className="truncate">{r.area}</span>
              </p>
            ) : (
              <span />
            )}
            <RatingBadge summary={rating} className="shrink-0" />
          </div>
        )}
        {heat.level !== 'quiet' && heat.vsUsual && heat.vsUsual !== 'usual' && (
          <div className="mt-2">
            <HeatBadge heat={heat} showUsual />
          </div>
        )}
        {r.vibes.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto pt-3">
            {r.vibes.slice(0, 3).map((v) => (
              <span key={v} className="text-[11px] font-bold text-brand-200 bg-brand-500/10 border border-brand-400/15 px-2 py-0.5 rounded-md">
                {v}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

/** Compact row for the list view. */
export function VenueRow({ r, distance, now }: { r: Venue; distance?: string | null; now: number }) {
  const rating = useDirectory().ratings[r.id];
  const heat = useActivity().heatOf(r.id);
  return (
    <Link
      to={`/v/${r.slug}`}
      className="group flex items-center gap-4 p-3 bg-night-900 rounded-2xl border border-white/10 hover:border-brand-400/50 transition-all"
    >
      <div className="relative w-24 h-24 sm:w-28 sm:h-24 rounded-xl overflow-hidden shrink-0 bg-night-800">
        <Cover r={r} />
        {isFeatured(r, now) && (
          <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-amber-400 text-amber-950 flex items-center justify-center shadow">
            <Star className="w-3 h-3 fill-current" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="font-display text-base font-bold text-white leading-tight truncate">{r.name}</h3>
          <span className="leader hidden sm:block" aria-hidden />
          <Price level={r.price_level} className="text-sm shrink-0 ml-auto sm:ml-0" />
        </div>
        <p className="text-sm font-semibold text-night-200 truncate">
          {[r.categories.slice(0, 2).join(' · '), r.area].filter(Boolean).join('  ·  ')}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
          <HeatBadge heat={heat} />
          <RatingBadge summary={rating} />
          <OpenBadge hours={r.hours} now={now} compact />
          {distance && <span className="text-xs font-extrabold text-night-300">{distance}</span>}
        </div>
      </div>
    </Link>
  );
}

/** Small card for horizontal rails ("Buzzing right now", "Fresh on the scene"). */
export function RailCard({ r, now, caption }: { r: Venue; now: number; caption?: string }) {
  const rating = useDirectory().ratings[r.id];
  const heat = useActivity().heatOf(r.id);
  return (
    <Link to={`/v/${r.slug}`} className="group block w-60 sm:w-64 shrink-0 snap-start">
      <div className="relative aspect-[5/4] rounded-[1.5rem] overflow-hidden bg-night-800 ring-1 ring-white/10 group-hover:ring-brand-400/60 transition">
        <Cover r={r} />
        <div className="absolute inset-0 bg-gradient-to-t from-night-950/90 via-night-950/10 to-transparent" />
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {heat.level !== 'quiet' ? <HeatPill heat={heat} /> : <OpenPill r={r} now={now} />}
        </div>
        {rating && (
          <span className="absolute top-3 right-3 px-2 py-1 rounded-full bg-night-950/80 backdrop-blur ring-1 ring-white/10">
            <RatingBadge summary={rating} />
          </span>
        )}
        <div className="absolute bottom-0 inset-x-0 p-3.5 text-white">
          <h3 className="font-display text-base font-bold leading-tight drop-shadow">{r.name}</h3>
          <p className="text-xs font-semibold text-white/80 truncate mt-0.5">{caption ?? [r.categories[0], r.area].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
    </Link>
  );
}
