import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, CalendarHeart, Clock, ExternalLink, Map as MapIcon, MapPin, Maximize2, Navigation, Share2, Star, Ticket } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDirectory } from '@/lib/directory';
import { useActivity } from '@/lib/activity';
import { eventPosition, eventWhen, isEventEnded, isEventLive, isRecurring, recurrenceLabel } from '@/lib/events';
import { DAY_NAMES, dayLabel, hasHours, todayIndex } from '@/lib/hours';
import { directionsUrl } from '@/lib/geo';
import { eventIcon, TILE_ATTRIBUTION, TILE_URL } from '@/lib/markers';
import type { NightEvent } from '@/lib/types';
import { useNow } from '@/lib/useNow';
import { EventArt, LiveTag } from '@/components/EventCard';
import { EmptyState, HeatBadge, SafeImg, Spinner } from '@/components/ui';
import { Lightbox } from '@/components/Lightbox';

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Nassau', ...opts }).format(new Date(iso));

const ticketHref = (v: string) => (v.startsWith('http') ? v : `https://${v}`);

export default function EventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const now = useNow();
  const { events, venueById, loading } = useDirectory();
  const { heatOf } = useActivity();
  const cached = events.find((e) => e.id === id) ?? null;
  const [fetched, setFetched] = useState<NightEvent | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flyerOpen, setFlyerOpen] = useState(false);
  // A flyer URL that 404s shows nothing rather than a broken image.
  const [flyerFailed, setFlyerFailed] = useState<string | null>(null);

  // The directory only holds upcoming events; past ones (and drafts, for admins) load here.
  useEffect(() => {
    let alive = true;
    setNotFound(false);
    supabase
      .from('events')
      .select('*')
      .eq('id', id!)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        if (data) setFetched(data as NightEvent);
        else setNotFound(true);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const e = fetched ?? cached;

  useEffect(() => {
    if (e) document.title = `${e.title} — Nassau Nights`;
    return () => {
      document.title = 'Nassau Nights — Bars, clubs & events in Nassau';
    };
  }, [e]);

  if (!e) {
    if (notFound && !loading) {
      return (
        <EmptyState icon={<CalendarHeart className="w-8 h-8" />} title="We couldn’t find that event">
          It may have been taken down. <Link to="/events" className="font-bold text-brand-300 underline">See what’s on</Link>
        </EmptyState>
      );
    }
    return (
      <div className="flex justify-center py-24">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  const venue = e.venue_id ? venueById.get(e.venue_id) : undefined;
  const pos = eventPosition(e, venue);
  const live = isEventLive(e, now);
  const ended = isEventEnded(e, now);
  const heat = venue ? heatOf(venue.id) : null;
  const today = todayIndex(now);
  const recurring = isRecurring(e);
  const sameDay = !!e.end_date && fmt(e.start_date, { dateStyle: 'medium' }) === fmt(e.end_date, { dateStyle: 'medium' });
  // A weekly run's last night: its end instant falls in the small hours after it.
  const lastNight = e.end_date ? new Date(new Date(e.end_date).getTime() - 43_200_000).toISOString() : null;

  const share = async () => {
    const url = window.location.href.split('?')[0];
    try {
      if (navigator.share) await navigator.share({ title: e.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      /* dismissed */
    }
  };

  return (
    <div className="w-full pb-12">
      <div className="relative h-64 md:h-96 overflow-hidden bg-night-800">
        <EventArt e={e} className="absolute inset-0 w-full h-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-night-950 via-night-950/10 to-black/30" />
        <div className="absolute top-4 inset-x-4 flex justify-between">
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/events'))}
            className="w-11 h-11 rounded-full bg-night-900/90 backdrop-blur text-white flex items-center justify-center shadow-lg hover:bg-night-800"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button onClick={share} className="w-11 h-11 rounded-full bg-night-900/90 backdrop-blur text-white flex items-center justify-center shadow-lg hover:bg-night-800" aria-label="Share">
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[4000] px-4 py-2 rounded-full bg-brand-500 text-white text-sm font-bold shadow-xl transition-opacity pointer-events-none ${copied ? 'opacity-100' : 'opacity-0'}`}>
        Link copied
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-6">
        <div className={`relative -mt-16 bg-night-900/95 backdrop-blur rounded-3xl p-5 md:p-7 shadow-[0_12px_40px_rgba(0,0,0,0.5)] ${live ? 'neon-edge glow-brand-soft' : 'border border-white/10'}`}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {live && <LiveTag />}
            {e.is_featured && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400 text-amber-950 text-[11px] font-extrabold uppercase tracking-wider">
                <Star className="w-3 h-3 fill-current" /> Featured
              </span>
            )}
            {ended && <span className="px-2.5 py-1 rounded-full bg-white/10 text-night-200 text-[11px] font-extrabold uppercase tracking-wider">Ended</span>}
            {!e.is_published && (
              <span className="px-2.5 py-1 rounded-full bg-white/10 text-night-200 text-[11px] font-extrabold uppercase tracking-wider">Draft — only admins can see this</span>
            )}
          </div>
          <p className={`text-sm font-extrabold uppercase tracking-wider ${live ? 'text-brand-300' : 'text-glow-300'}`}>{ended ? 'Past event' : eventWhen(e, now)}</p>
          <h1 className="mt-1 text-2xl md:text-4xl font-extrabold text-white leading-tight">{e.title}</h1>
          {heat && heat.level !== 'quiet' && (
            <div className="mt-2">
              <HeatBadge heat={heat} showUsual />
            </div>
          )}

          <div className="grid grid-cols-2 sm:flex gap-2 mt-5">
            {pos && (
              <a
                href={directionsUrl(pos.lat, pos.lng)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-sky-400/10 border border-sky-400/25 text-sky-200 font-extrabold text-sm hover:border-sky-400/50"
              >
                <Navigation className="w-5 h-5" /> Directions
              </a>
            )}
            {pos && !ended && (
              <Link
                to={`/map?event=${e.id}`}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-night-100 font-extrabold text-sm hover:border-white/20"
              >
                <MapIcon className="w-5 h-5" /> On map
              </Link>
            )}
            {e.ticket_url && (
              <a
                href={ticketHref(e.ticket_url)}
                target="_blank"
                rel="noreferrer"
                className="col-span-2 flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-brand-500 to-glow-500 text-white font-extrabold text-sm glow-brand hover:brightness-110"
              >
                <Ticket className="w-5 h-5" /> Tickets & info <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5 mt-5">
          <div className="md:col-span-3 space-y-4">
            {e.image_url && flyerFailed !== e.image_url && (
              <button
                onClick={() => setFlyerOpen(true)}
                className="group relative block w-full bg-night-900 rounded-3xl border border-white/10 p-2 hover:border-brand-400/50 transition-colors"
                aria-label={`Open the flyer for ${e.title} full screen`}
              >
                {/* The whole flyer, uncropped (the hero above crops it to a banner). */}
                <img
                  src={e.image_url}
                  alt={`Flyer for ${e.title}`}
                  loading="lazy"
                  decoding="async"
                  onError={() => setFlyerFailed(e.image_url)}
                  className="block w-full h-auto max-h-[80vh] object-contain rounded-2xl"
                />
                <span className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-night-950/80 backdrop-blur text-xs font-extrabold text-white opacity-90 group-hover:opacity-100">
                  <Maximize2 className="w-3.5 h-3.5" /> Tap to expand
                </span>
              </button>
            )}
            {e.description && (
              <section className="bg-night-900 rounded-3xl border border-white/10 p-5">
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-brand-300 mb-3">About</h3>
                <p className="text-night-100 leading-relaxed whitespace-pre-line">{e.description}</p>
              </section>
            )}
            {venue && (
              <Link to={`/v/${venue.slug}`} className="flex items-center gap-4 p-4 bg-night-900 rounded-3xl border border-white/10 hover:border-brand-400/50">
                <SafeImg src={venue.cover_url} name={venue.name} className="w-20 h-20 rounded-2xl shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-extrabold uppercase tracking-widest text-brand-300">Hosted at</p>
                  <p className="font-display text-lg font-bold text-white truncate">{venue.name}</p>
                  <p className="text-sm font-semibold text-night-300 truncate">{[venue.categories[0], venue.area].filter(Boolean).join(' · ')}</p>
                </div>
              </Link>
            )}
          </div>

          <div className="md:col-span-2 space-y-4">
            <section className="bg-night-900 rounded-3xl border border-white/10 p-5">
              <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-widest text-brand-300 mb-3">
                <Clock className="w-4 h-4" /> When
              </h3>
              <p className="text-sm font-bold text-white">
                {recurring
                  ? recurrenceLabel(e.hours, true)
                  : !e.end_date
                    ? `From ${fmt(e.start_date, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                    : sameDay
                      ? `${fmt(e.start_date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${fmt(e.start_date, { hour: 'numeric', minute: '2-digit' })} – ${fmt(e.end_date, { hour: 'numeric', minute: '2-digit' })}`
                      : `${fmt(e.start_date, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} → ${fmt(e.end_date, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
              </p>
              {recurring && (
                <p className="mt-0.5 text-xs font-semibold text-night-300">
                  {new Date(e.start_date).getTime() > now ? 'Starts' : 'Since'} {fmt(e.start_date, { month: 'short', day: 'numeric', year: 'numeric' })}
                  {lastNight ? ` · last night ${fmt(lastNight, { month: 'short', day: 'numeric', year: 'numeric' })}` : ' · until further notice'}
                </p>
              )}
              {hasHours(e.hours) && (
                <ul className="mt-3 space-y-1">
                  {[1, 2, 3, 4, 5, 6, 0].filter((d) => !recurring || e.hours![String(d)]).map((d) => (
                    <li
                      key={d}
                      className={`flex justify-between gap-3 text-sm px-2 py-1 rounded-lg ${d === today ? 'bg-white/5 font-extrabold text-white' : 'font-semibold text-night-300'}`}
                    >
                      <span>{DAY_NAMES[d]}</span>
                      <span>{dayLabel(e.hours![String(d)])}</span>
                    </li>
                  ))}
                </ul>
              )}
              {e.price_note && (
                <p className="mt-3 flex items-center gap-2 text-sm font-bold text-night-100">
                  <Ticket className="w-4 h-4 text-glow-400" /> {e.price_note}
                </p>
              )}
            </section>

            {pos && (
              <section className="bg-night-900 rounded-3xl border border-white/10 p-5">
                <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-widest text-brand-300 mb-3">
                  <MapPin className="w-4 h-4" /> Where
                </h3>
                <div className="h-40 rounded-2xl overflow-hidden mb-3 relative z-0">
                  <MapContainer
                    center={[pos.lat, pos.lng]}
                    zoom={16}
                    zoomControl={false}
                    dragging={false}
                    scrollWheelZoom={false}
                    doubleClickZoom={false}
                    touchZoom={false}
                    attributionControl={false}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} crossOrigin />
                    <Marker position={[pos.lat, pos.lng]} icon={eventIcon(live)} />
                  </MapContainer>
                </div>
                <p className="text-sm font-semibold text-white">{e.address || venue?.address || venue?.area || 'Pinned on the map'}</p>
              </section>
            )}
          </div>
        </div>
      </div>
      {e.image_url && (
        <Lightbox
          images={[{ url: e.image_url, caption: e.title }]}
          index={flyerOpen ? 0 : null}
          onIndex={() => {}}
          onClose={() => setFlyerOpen(false)}
        />
      )}
    </div>
  );
}
