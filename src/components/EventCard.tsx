import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Star, Ticket } from 'lucide-react';
import type { NightEvent, Venue } from '@/lib/types';
import { eventWhen, isEventLive } from '@/lib/events';
import { EVENT_GLYPH } from '@/lib/markers';
import { useDirectory } from '@/lib/directory';

/** The event's flyer, or a neon placeholder when it has none (or it fails to load). */
export function EventArt({ e, className = '' }: { e: NightEvent; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (e.image_url && failed !== e.image_url) {
    return (
      <img
        src={e.image_url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(e.image_url)}
        className={`object-cover ${className}`}
      />
    );
  }
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-brand-700 via-night-800 to-glow-800 flex items-center justify-center ${className}`}>
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.4) 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="relative w-1/3 max-w-20 aspect-square text-white/85 neon-text"
        dangerouslySetInnerHTML={{ __html: EVENT_GLYPH }}
      />
    </div>
  );
}

export function LiveTag({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-500 text-white text-[11px] font-extrabold uppercase tracking-wider glow-brand ${className}`}>
      <span className="heat-dot pulse text-white" style={{ width: 6, height: 6 }} /> Live
    </span>
  );
}

const placeOf = (e: NightEvent, venue: Venue | undefined) => venue?.name ?? e.address ?? null;

/** Event card. `wide` is the Events-page layout; the default fits rails. */
export function EventCard({ e, now, wide }: { e: NightEvent; now: number; wide?: boolean }) {
  const { venueById } = useDirectory();
  const venue = e.venue_id ? venueById.get(e.venue_id) : undefined;
  const live = isEventLive(e, now);
  const place = placeOf(e, venue);
  return (
    <Link
      to={`/events/${e.id}`}
      className={`group block shrink-0 snap-start rounded-[1.5rem] overflow-hidden bg-night-900 border transition-all hover:-translate-y-0.5 ${
        live ? 'neon-edge border-transparent glow-brand-soft' : 'border-white/10 hover:border-brand-400/50'
      } ${wide ? 'w-full flex flex-col sm:flex-row' : 'w-72 sm:w-80'}`}
    >
      <div className={`relative overflow-hidden bg-night-800 ${wide ? 'aspect-[16/9] sm:aspect-auto sm:w-56 shrink-0' : 'aspect-[16/9]'}`}>
        <EventArt e={e} className="absolute inset-0 w-full h-full group-hover:scale-[1.04] transition-transform duration-700" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          {live && <LiveTag />}
          {e.is_featured && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400 text-amber-950 text-[11px] font-extrabold uppercase tracking-wider shadow">
              <Star className="w-3 h-3 fill-current" /> Featured
            </span>
          )}
        </div>
      </div>
      <div className="p-4 flex-1 min-w-0">
        <p className={`text-xs font-extrabold uppercase tracking-wider ${live ? 'text-brand-300' : 'text-glow-300'}`}>{eventWhen(e, now)}</p>
        <h3 className="mt-1 font-display text-base font-bold text-white leading-snug line-clamp-2">{e.title}</h3>
        {place && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-night-200 min-w-0 max-w-full">
            <MapPin className="w-3.5 h-3.5 shrink-0 text-brand-400" />
            <span className="truncate">{place}</span>
          </p>
        )}
        {wide && e.description && <p className="mt-2 text-sm text-night-300 line-clamp-2">{e.description}</p>}
        {e.price_note && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-night-300">
            <Ticket className="w-3.5 h-3.5 text-glow-400" /> {e.price_note}
          </p>
        )}
      </div>
    </Link>
  );
}
