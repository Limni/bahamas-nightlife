import { Link } from 'react-router-dom';
import { ChevronRight, MapPin, Ticket } from 'lucide-react';
import type { NightEvent, Venue } from '@/lib/types';
import { eventPosition, eventWhen, isEventLive } from '@/lib/events';
import { useActivity } from '@/lib/activity';
import type { UserLocation } from '@/lib/directory';
import { DirectionsTile, DraggableSheet, primaryAction } from './VenueDrawer';
import { EventArt, LiveTag } from './EventCard';
import { HeatBadge } from './ui';

/** Map sheet for an event pin (Island GO's EventDrawer, without check-ins). */
export function EventDrawer({
  event,
  venue,
  location,
  now,
  onClose,
}: {
  event: NightEvent | null;
  venue: Venue | undefined;
  location: UserLocation | null;
  now: number;
  onClose: () => void;
}) {
  const e = event;
  const { heatOf } = useActivity();
  const pos = e ? eventPosition(e, venue) : null;
  const live = e ? isEventLive(e, now) : false;
  const heat = venue ? heatOf(venue.id) : null;

  return (
    <DraggableSheet
      openKey={e?.id ?? null}
      onClose={onClose}
      footer={
        e && (
          <>
            {pos && <DirectionsTile lat={pos.lat} lng={pos.lng} location={location} />}
            <Link to={`/events/${e.id}`} className={primaryAction}>
              Event details <ChevronRight className="w-5 h-5" />
            </Link>
          </>
        )
      }
    >
      {e && (
        <>
          <div className="relative -mx-6 -mt-1 mb-4 aspect-[16/7] overflow-hidden">
            <EventArt e={e} className="absolute inset-0 w-full h-full" />
            <div className="absolute inset-0 bg-gradient-to-t from-night-900 to-transparent" />
            {live && <LiveTag className="absolute top-3 left-4" />}
          </div>
          <p className={`text-xs font-extrabold uppercase tracking-wider ${live ? 'text-brand-300' : 'text-glow-300'}`}>{eventWhen(e, now)}</p>
          <h2 className="mt-1 text-xl font-extrabold text-white leading-tight pr-8">{e.title}</h2>
          {(venue || e.address) && (
            <p className="mt-2 flex items-start gap-2 text-sm font-semibold text-night-100">
              <MapPin className="w-4 h-4 text-brand-400 mt-0.5 shrink-0" />
              {venue ? (
                <Link to={`/v/${venue.slug}`} className="hover:text-brand-200 underline underline-offset-2">
                  {venue.name}
                </Link>
              ) : (
                <span>{e.address}</span>
              )}
            </p>
          )}
          {heat && heat.level !== 'quiet' && (
            <div className="mt-2">
              <HeatBadge heat={heat} showUsual />
            </div>
          )}
          {e.price_note && (
            <p className="mt-2 flex items-center gap-2 text-sm font-bold text-night-200">
              <Ticket className="w-4 h-4 text-glow-400" /> {e.price_note}
            </p>
          )}
          {e.description && <p className="mt-3 text-night-200 leading-relaxed line-clamp-4">{e.description}</p>}
        </>
      )}
    </DraggableSheet>
  );
}
