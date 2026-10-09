import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowLeft, CalendarHeart, Camera, Clock, ExternalLink, Globe, ImageOff, AtSign, ThumbsUp, Map as MapIcon,
  MapPin, Martini, MessageSquarePlus, Navigation, Phone, Radio, Share2, Star, UtensilsCrossed,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDirectory } from '@/lib/directory';
import { DAY_NAMES, dayLabel, hasHours, todayIndex } from '@/lib/hours';
import { directionsUrl } from '@/lib/geo';
import { pinIcon, pinStyleFor, TILE_ATTRIBUTION, TILE_URL } from '@/lib/markers';
import { hasLocation, isFeatured, type MenuItem, type MenuKind, type Photo, type Venue } from '@/lib/types';
import { useNow } from '@/lib/useNow';
import { useActivity } from '@/lib/activity';
import { compareEvents, isEventEnded } from '@/lib/events';
import { Lightbox, type LightboxImage } from '@/components/Lightbox';
import { EmptyState, HeatBadge, OpenBadge, Price, SafeImg, Spinner, Stars } from '@/components/ui';
import { ReviewsSection } from '@/components/Reviews';
import { LikeSignInPrompt, MenuSections, useMenuLikes } from '@/components/MenuList';
import { PopularTimes } from '@/components/PopularTimes';
import { EventCard } from '@/components/EventCard';

// 'menu' is the drinks menu (its URL, ?tab=menu, predates the food menu).
type Tab = 'overview' | 'menu' | 'food' | 'photos' | 'reviews';

const instagramUrl = (v: string) => (v.startsWith('http') ? v : `https://instagram.com/${v.replace(/^@/, '')}`);
const facebookUrl = (v: string) => (v.startsWith('http') ? v : `https://facebook.com/${v}`);
const websiteUrl = (v: string) => (v.startsWith('http') ? v : `https://${v}`);
const prettyUrl = (v: string) => v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
function PhotoGrid({ photos, onOpen }: { photos: Photo[]; onOpen: (i: number) => void }) {
  return (
    <div className="columns-2 md:columns-3 gap-3 [&>*]:mb-3">
      {photos.map((p, i) => (
        <button key={p.id} onClick={() => onOpen(i)} className="block w-full rounded-2xl overflow-hidden bg-white/5 break-inside-avoid group">
          <img src={p.url} alt={p.caption ?? ''} loading="lazy" decoding="async" className="w-full h-auto group-hover:scale-[1.03] transition-transform duration-500" />
        </button>
      ))}
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-night-900 rounded-3xl border border-white/10 p-5">
      <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-widest text-brand-300 mb-3">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

export default function VenuePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const now = useNow();
  const { venues, events, ratings, loading: dirLoading } = useDirectory();
  const { heatOf } = useActivity();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });

  const cachedVenue = venues.find((r) => r.slug === slug) ?? null;
  const [fetched, setFetched] = useState<Venue | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const r = fetched ?? cachedVenue;

  useEffect(() => {
    let alive = true;
    setLoadingDetail(true);
    setNotFound(false);
    (async () => {
      const { data } = await supabase.from('venues').select('*').eq('slug', slug!).maybeSingle();
      if (!alive) return;
      if (!data) {
        setNotFound(true);
        setLoadingDetail(false);
        return;
      }
      setFetched(data as Venue);
      const [p, m] = await Promise.all([
        supabase.from('venue_photos').select('*').eq('venue_id', data.id).order('sort').order('created_at'),
        supabase.from('menu_items').select('*').eq('venue_id', data.id).order('sort').order('name'),
      ]);
      if (!alive) return;
      setPhotos((p.data as Photo[]) ?? []);
      setMenu((m.data as MenuItem[]) ?? []);
      setLoadingDetail(false);
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    if (r) document.title = `${r.name} — Nassau Nights`;
    return () => {
      document.title = 'Nassau Nights — Bars, clubs & events in Nassau';
    };
  }, [r]);

  const gallery = useMemo(() => photos.filter((p) => p.kind === 'gallery'), [photos]);
  const menuPhotos = useMemo(() => photos.filter((p) => p.kind === 'menu'), [photos]);
  const foodPhotos = useMemo(() => photos.filter((p) => p.kind === 'food_menu'), [photos]);
  const drinks = useMemo(() => menu.filter((i) => i.menu !== 'food'), [menu]);
  const food = useMemo(() => menu.filter((i) => i.menu === 'food'), [menu]);
  const likes = useMenuLikes(menu);

  if (!r) {
    if (notFound && !dirLoading) {
      return (
        <EmptyState icon={<Martini className="w-8 h-8" />} title="We couldn’t find that spot">
          It may have been renamed or removed. <Link to="/" className="font-bold text-brand-300 underline">Back to the directory</Link>
        </EmptyState>
      );
    }
    return (
      <div className="flex justify-center py-24">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  const hero = r.cover_url ?? gallery[0]?.url ?? null;
  const today = todayIndex(now);
  const openPhotos = (list: Photo[], index: number) =>
    setLightbox({ images: list.map((p) => ({ url: p.url, caption: p.caption })), index });

  const share = async () => {
    const url = window.location.href.split('?')[0];
    try {
      if (navigator.share) await navigator.share({ title: r.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      /* dismissed */
    }
  };

  const rating = ratings[r.id];
  const heat = heatOf(r.id);
  const upcoming = events.filter((e) => e.venue_id === r.id && !isEventEnded(e, now)).sort(compareEvents(now));
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'menu', label: 'Drinks', count: drinks.length + menuPhotos.length || undefined },
    // Food only shows up when there's a food menu (most bars have none).
    ...(food.length || foodPhotos.length || tab === 'food' ? [{ key: 'food' as Tab, label: 'Food', count: food.length + foodPhotos.length || undefined }] : []),
    { key: 'photos', label: 'Photos', count: gallery.length || undefined },
    { key: 'reviews', label: 'Reviews', count: rating?.rating_count || undefined },
  ];

  const renderMenu = (kind: MenuKind) => {
    const items = kind === 'food' ? food : drinks;
    const pics = kind === 'food' ? foodPhotos : menuPhotos;
    const noun = kind === 'food' ? 'food' : 'drinks';
    if (loadingDetail) return <div className="flex justify-center py-16"><Spinner /></div>;
    if (items.length === 0 && pics.length === 0) {
      return (
        <EmptyState icon={kind === 'food' ? <UtensilsCrossed className="w-8 h-8" /> : <Martini className="w-8 h-8" />} title={`No ${noun} menu yet`}>
          Got a photo of their menu?{' '}
          <Link to={`/community?kind=update&venue=${r.id}&field=menu`} className="font-bold text-brand-300 underline">
            Send it in
          </Link>{' '}
          and we’ll add it.
        </EmptyState>
      );
    }
    return (
      <div className="space-y-6">
        <LikeSignInPrompt likes={likes} what={kind === 'food' ? 'dishes' : 'drinks'} />
        {items.length > 0 && <MenuSections items={items} likes={likes} idPrefix={kind} onOpenImages={(images, index) => setLightbox({ images, index })} />}
        {pics.length > 0 && (
          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-widest text-brand-300 mb-3">Menu photos</h3>
            <PhotoGrid photos={pics} onOpen={(i) => openPhotos(pics, i)} />
          </div>
        )}
        <p className="text-xs font-semibold text-night-400">Prices in BSD and may change; check with the venue. Tap ♥ on the ones you love.</p>
      </div>
    );
  };

  return (
    <div className="w-full pb-12">
      {/* Hero */}
      <div className="relative h-64 md:h-96 bg-white/10 overflow-hidden">
        <SafeImg src={hero} name={r.name} lazy={false} className="w-full h-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-night-950 via-night-950/10 to-black/30" />
        <div className="absolute top-4 inset-x-4 flex justify-between">
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="w-11 h-11 rounded-full bg-night-900/90 backdrop-blur text-night-100 flex items-center justify-center shadow-lg hover:bg-night-900"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button onClick={share} className="w-11 h-11 rounded-full bg-night-900/90 backdrop-blur text-night-100 flex items-center justify-center shadow-lg hover:bg-night-900" aria-label="Share">
            <Share2 className="w-5 h-5" />
          </button>
        </div>
        {gallery.length > 0 && (
          <button
            onClick={() => setTab('photos')}
            className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/55 backdrop-blur text-white text-xs font-extrabold hover:bg-black/70"
          >
            <Camera className="w-4 h-4" /> {gallery.length} photos
          </button>
        )}
      </div>
      <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[4000] px-4 py-2 rounded-full bg-brand-500 text-white text-sm font-bold shadow-xl transition-opacity pointer-events-none ${copied ? 'opacity-100' : 'opacity-0'}`}>
        Link copied
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-6">
        {/* Title card */}
        <div className="relative -mt-12 bg-night-900/95 backdrop-blur rounded-3xl border border-white/10 shadow-[0_12px_40px_rgb(0,0,0,0.5)] p-5 md:p-7">
          {isFeatured(r, now) && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 mb-2 rounded-full bg-amber-400/15 text-amber-300 text-[11px] font-extrabold uppercase tracking-wider">
              <Star className="w-3 h-3 fill-current" /> Featured
            </span>
          )}
          {!r.is_published && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 mb-2 ml-1 rounded-full bg-white/10 text-night-200 text-[11px] font-extrabold uppercase tracking-wider">
              Draft — only admins can see this
            </span>
          )}
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{r.name}</h1>
            <Price level={r.price_level} className="text-xl shrink-0 mt-1" />
          </div>
          <p className="mt-1 font-semibold text-night-200">
            {[r.categories.join(' · '), r.area].filter(Boolean).join('  —  ')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <HeatBadge heat={heat} showUsual />
            <OpenBadge hours={r.hours} now={now} />
          </div>
          <div className="mt-2">
            <button onClick={() => setTab('reviews')} className="inline-flex items-center gap-2 text-sm font-extrabold text-night-50 hover:text-brand-200">
              {rating?.rating_count ? (
                <>
                  <Stars value={rating.rating_avg} size={17} />
                  {rating.rating_avg.toFixed(1)}
                  <span className="font-bold text-night-300 underline underline-offset-2">
                    {rating.rating_count} review{rating.rating_count === 1 ? '' : 's'}
                  </span>
                </>
              ) : (
                <>
                  <Stars value={0} size={17} />
                  <span className="font-bold text-night-300 underline underline-offset-2">Be the first to review</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-3 sm:flex gap-2 mt-5">
            {r.phone && (
              <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-4 py-3 rounded-2xl bg-emerald-400/10 border border-emerald-400/25 text-emerald-300 font-extrabold text-sm hover:border-emerald-400/50">
                <Phone className="w-5 h-5" /> Call
              </a>
            )}
            {hasLocation(r) && (
              <a href={directionsUrl(r.lat, r.lng)} target="_blank" rel="noreferrer" className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-4 py-3 rounded-2xl bg-sky-400/10 border border-sky-400/25 text-sky-200 font-extrabold text-sm hover:border-sky-400/50">
                <Navigation className="w-5 h-5" /> Directions
              </a>
            )}
            {hasLocation(r) && (
              <Link to={`/map?focus=${r.id}`} className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-night-100 font-extrabold text-sm hover:border-white/20">
                <MapIcon className="w-5 h-5" /> On map
              </Link>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="sticky top-0 md:top-16 z-[900] -mx-4 px-4 md:mx-0 md:px-0 mt-5 py-2 bg-night-950/90 backdrop-blur-md">
          <div className="flex gap-1 bg-night-900 rounded-2xl p-1 border border-white/10 w-full sm:w-fit">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 sm:flex-none px-2.5 sm:px-5 py-2.5 rounded-xl text-sm font-extrabold transition-colors ${
                  tab === t.key ? 'bg-brand-500 text-white' : 'text-night-200 hover:bg-white/5'
                }`}
              >
                {t.label}
                {t.count ? <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-brand-100' : 'text-night-400'}`}>{t.count}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {tab === 'overview' && (
            <div className="grid gap-4 md:grid-cols-5">
              <div className="md:col-span-3 space-y-4">
                <Card title="Live activity" icon={<Radio className="w-4 h-4" />}>
                  <PopularTimes venueId={r.id} now={now} />
                </Card>

                {upcoming.length > 0 && (
                  <Card title="Upcoming here" icon={<CalendarHeart className="w-4 h-4" />}>
                    <div className="space-y-3">
                      {upcoming.slice(0, 4).map((e) => (
                        <EventCard key={e.id} e={e} now={now} wide />
                      ))}
                    </div>
                  </Card>
                )}

                {(r.description || r.vibes.length > 0) && (
                  <Card title="About" icon={<Martini className="w-4 h-4" />}>
                    {r.description && <p className="text-night-100 leading-relaxed whitespace-pre-line">{r.description}</p>}
                    {r.vibes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {r.vibes.map((v) => (
                          <span key={v} className="text-xs font-bold text-brand-200 bg-white/5 px-3 py-1 rounded-full border border-white/10">
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </Card>
                )}

                {gallery.length > 0 && (
                  <Card title="Photos" icon={<Camera className="w-4 h-4" />}>
                    <div className="grid grid-cols-3 gap-2">
                      {gallery.slice(0, 6).map((p, i) => (
                        <button key={p.id} onClick={() => openPhotos(gallery, i)} className="aspect-square rounded-xl overflow-hidden bg-white/5">
                          <img src={p.url} alt={p.caption ?? ''} loading="lazy" className="w-full h-full object-cover hover:scale-105 transition-transform" />
                        </button>
                      ))}
                    </div>
                    {gallery.length > 6 && (
                      <button onClick={() => setTab('photos')} className="mt-3 text-sm font-extrabold text-brand-300 hover:text-night-100">
                        See all {gallery.length} photos →
                      </button>
                    )}
                  </Card>
                )}

                {(drinks.length + menuPhotos.length > 0 || food.length + foodPhotos.length > 0) && (
                  <div className={`grid gap-3 ${drinks.length + menuPhotos.length > 0 && food.length + foodPhotos.length > 0 ? 'sm:grid-cols-2' : ''}`}>
                    {(
                      [
                        ['menu', 'See the drinks menu', drinks.length, menuPhotos.length, 'from-brand-500 to-glow-500'],
                        ['food', 'See the food menu', food.length, foodPhotos.length, 'from-glow-500 to-brand-500'],
                      ] as const
                    )
                      .filter(([, , items, pics]) => items + pics > 0)
                      .map(([key, label, items, pics, gradient]) => (
                        <button
                          key={key}
                          onClick={() => setTab(key)}
                          className={`w-full flex items-center justify-between gap-3 p-5 rounded-3xl bg-gradient-to-r ${gradient} text-white glow-brand hover:brightness-110`}
                        >
                          <span className="text-left">
                            <span className="block text-lg font-extrabold">{label}</span>
                            <span className="block text-sm font-semibold text-white/85">
                              {[items && `${items} items`, pics && `${pics} menu photos`].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <ExternalLink className="w-6 h-6 shrink-0" />
                        </button>
                      ))}
                  </div>
                )}
              </div>

              <div className="md:col-span-2 space-y-4">
                <Card title="Hours" icon={<Clock className="w-4 h-4" />}>
                  {hasHours(r.hours) ? (
                    <ul className="space-y-1">
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                        <li
                          key={d}
                          className={`flex justify-between gap-3 text-sm px-2 py-1 rounded-lg ${
                            d === today ? 'bg-white/5 font-extrabold text-night-50' : 'font-semibold text-night-300'
                          }`}
                        >
                          <span>{DAY_NAMES[d]}</span>
                          <span className={r.hours![String(d)] ? '' : 'text-rose-400'}>{dayLabel(r.hours![String(d)])}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm font-semibold text-night-300">Hours haven’t been added yet.</p>
                  )}
                  {r.hours_note && <p className="mt-3 text-xs font-semibold text-night-300">{r.hours_note}</p>}
                </Card>

                <Card title="Location" icon={<MapPin className="w-4 h-4" />}>
                  {hasLocation(r) && (
                    <div className="h-40 rounded-2xl overflow-hidden mb-3 relative z-0">
                      <MapContainer
                        center={[r.lat, r.lng]}
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
                        <Marker position={[r.lat, r.lng]} icon={pinIcon(pinStyleFor(r.categories))} />
                      </MapContainer>
                    </div>
                  )}
                  <p className="text-sm font-semibold text-white">{r.address || r.area || 'Address not listed yet'}</p>
                  {hasLocation(r) && (
                    <a href={directionsUrl(r.lat, r.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-2 text-sm font-extrabold text-brand-300 hover:text-night-100">
                      Get directions <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </Card>

                {(r.phone || r.website || r.instagram || r.facebook) && (
                  <Card title="Contact" icon={<Phone className="w-4 h-4" />}>
                    <ul className="space-y-2.5 text-sm font-bold">
                      {r.phone && (
                        <li>
                          <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 text-night-100 hover:text-brand-200">
                            <Phone className="w-4 h-4 text-brand-400" /> {r.phone}
                          </a>
                        </li>
                      )}
                      {r.website && (
                        <li>
                          <a href={websiteUrl(r.website)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-night-100 hover:text-brand-200 break-all">
                            <Globe className="w-4 h-4 text-brand-400 shrink-0" /> {prettyUrl(r.website)}
                          </a>
                        </li>
                      )}
                      {r.instagram && (
                        <li>
                          <a href={instagramUrl(r.instagram)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-night-100 hover:text-brand-200 break-all">
                            <AtSign className="w-4 h-4 text-brand-400 shrink-0" /> {r.instagram.startsWith('http') ? prettyUrl(r.instagram) : `@${r.instagram.replace(/^@/, '')}`}
                          </a>
                        </li>
                      )}
                      {r.facebook && (
                        <li>
                          <a href={facebookUrl(r.facebook)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-night-100 hover:text-brand-200 break-all">
                            <ThumbsUp className="w-4 h-4 text-brand-400 shrink-0" /> {prettyUrl(r.facebook)}
                          </a>
                        </li>
                      )}
                    </ul>
                  </Card>
                )}
              </div>
            </div>
          )}

          {(tab === 'menu' || tab === 'food') && renderMenu(tab === 'food' ? 'food' : 'drinks')}

          {tab === 'photos' &&
            (loadingDetail ? (
              <div className="flex justify-center py-16"><Spinner /></div>
            ) : gallery.length === 0 ? (
              <EmptyState icon={<ImageOff className="w-8 h-8" />} title="No photos yet">
                Been here recently?{' '}
                <Link to={`/community?kind=update&venue=${r.id}&field=photos`} className="font-bold text-brand-300 underline">
                  Share a few photos
                </Link>
                .
              </EmptyState>
            ) : (
              <PhotoGrid photos={gallery} onOpen={(i) => openPhotos(gallery, i)} />
            ))}

          {tab === 'reviews' && <ReviewsSection venue={r} />}
        </div>

        {/* Community corrections */}
        <div className="mt-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-3xl bg-amber-400/10 border border-amber-400/25">
          <div>
            <p className="font-extrabold text-amber-100">Something out of date?</p>
            <p className="text-sm font-semibold text-amber-200/80">
              New hours, prices or a closed door? Let us know and we’ll update it. Last updated{' '}
              {new Date(r.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.
            </p>
          </div>
          <Link
            to={`/community?kind=update&venue=${r.id}`}
            className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-amber-400 text-amber-950 font-extrabold hover:bg-amber-300"
          >
            <MessageSquarePlus className="w-5 h-5" /> Suggest an edit
          </Link>
        </div>
      </div>

      <Lightbox
        images={lightbox?.images ?? []}
        index={lightbox?.index ?? null}
        onIndex={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}
