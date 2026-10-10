import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Armchair, ArrowRight, Award, Beer, Building2, CalendarHeart, ChevronLeft, ChevronRight, Crown, Disc3, Drum, Flame, Flower2, Gem, Heart,
  LayoutGrid, List, LocateFixed, MapPin, Martini, Mic, Moon, Music, Radio, Rainbow, SearchX, Shirt, Sparkles, Star, Sun, TrendingUp,
  Users, Waves, X, type LucideIcon,
} from 'lucide-react';
import { useDirectory, useUserLocation } from '@/lib/directory';
import { activeFilterCount, EMPTY_FILTERS, matchesFilters, useFilters, type Filters } from '@/lib/filters';
import { formatDistance, getDistance } from '@/lib/geo';
import { DAY_NAMES, isOpenNow, todayIndex } from '@/lib/hours';
import { pinStyleFor } from '@/lib/markers';
import { hasLocation, isFeatured, priceLabel, type Venue } from '@/lib/types';
import { buzzScore, useActivity } from '@/lib/activity';
import { compareEvents, eventNextStart, isEventEnded, isEventLive, isEventSoon } from '@/lib/events';
import { useNow } from '@/lib/useNow';
import { useSiteTheme } from '@/lib/theme';
import { supabaseConfigured } from '@/lib/supabase';
import { RailCard, VenueCard, VenueRow } from '@/components/VenueCard';
import { EventCard } from '@/components/EventCard';
import { FilterSheet, SearchFilterBar } from '@/components/FilterSheet';
import { EmptyState, HeatBadge } from '@/components/ui';
import { SetupNotice } from '@/components/SetupNotice';
import { Logo } from '@/components/Layout';

type Sort = 'featured' | 'buzzing' | 'popular' | 'rated' | 'nearest' | 'az' | 'newest';
type View = 'grid' | 'list';

const VIBE_ICONS: Record<string, LucideIcon> = {
  'Dancing': Disc3,
  'DJ Sets': Disc3,
  'Live Band': Music,
  'Happy Hour': Beer,
  'Late Night': Moon,
  'Waterfront': Waves,
  'Rooftop Views': Building2,
  'Dress to Impress': Shirt,
  'Laid-back': Armchair,
  'Local Favourite': Award,
  'Date Night': Heart,
  'Group Friendly': Users,
  'Ladies Night': Flower2,
  'Bottle Service': Crown,
  'Outdoor': Sun,
  "Rake 'n' Scrape": Drum,
  'Karaoke Night': Mic,
  'Hidden Gem': Gem,
  'LGBTQ+ Friendly': Rainbow,
};

const VIBE_TONES = [
  'from-brand-600 to-brand-900',
  'from-glow-600 to-night-800',
  'from-[#7c3aed] to-[#2e1065]',
  'from-brand-500 to-glow-700',
  'from-[#be123c] to-[#4c0519]',
  'from-glow-700 to-brand-900',
];

/** Hour of day in Nassau, regardless of the visitor's timezone. */
function nassauHour(now: number) {
  return (
    parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Nassau', hour: '2-digit', hour12: false }).format(new Date(now)), 10) % 24
  );
}

/** Time-of-night greeting plus a one-tap suggestion that fits the hour. */
function moment(now: number): { greeting: string; suggestion: { label: string; key: 'categories' | 'vibes'; value: string } } {
  const hour = nassauHour(now);
  const day = DAY_NAMES[todayIndex(now)];
  const weekend = day === 'Friday' || day === 'Saturday';
  if (hour >= 5 && hour < 12)
    return { greeting: 'Morning after? Plan tonight', suggestion: { label: 'Beach bars', key: 'categories', value: 'Beach Bar' } };
  if (hour >= 12 && hour < 17)
    return { greeting: 'Sun’s out — drinks by the water', suggestion: { label: 'Waterfront', key: 'vibes', value: 'Waterfront' } };
  if (hour >= 17 && hour < 20)
    return { greeting: 'Happy hour in Nassau', suggestion: { label: 'Happy hour', key: 'vibes', value: 'Happy Hour' } };
  if (hour >= 20 && hour < 23)
    return weekend
      ? { greeting: `${day} night — where’s the move?`, suggestion: { label: 'Dancing', key: 'vibes', value: 'Dancing' } }
      : { greeting: `${day} night in Nassau`, suggestion: { label: 'Live bands', key: 'vibes', value: 'Live Band' } };
  return { greeting: 'Late night — the island’s still up', suggestion: { label: 'Open late', key: 'vibes', value: 'Late Night' } };
}

function SectionHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        {eyebrow && <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-300 mb-1">{eyebrow}</p>}
        <h2 className="font-display text-xl md:text-2xl font-bold text-white">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function SeeAll({ onClick, to, children }: { onClick?: () => void; to?: string; children: ReactNode }) {
  const cls = 'shrink-0 inline-flex items-center gap-1 text-sm font-extrabold text-brand-300 hover:text-brand-200';
  return to ? (
    <Link to={to} className={cls}>
      {children} <ArrowRight className="w-4 h-4" />
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {children} <ArrowRight className="w-4 h-4" />
    </button>
  );
}

function Rail({ children }: { children: ReactNode }) {
  // Arrows centre on the cards; the offset skips the pb-3 shadow room below them.
  return (
    <ScrollRow className="flex gap-4 overflow-x-auto no-scrollbar -mx-4 px-4 md:-mx-6 md:px-6 pb-3 snap-x" arrowTop="top-[calc(50%-0.375rem)]">
      {children}
    </ScrollRow>
  );
}

/**
 * Horizontal scroller with left/right arrow buttons, shown only while there's
 * more to see in that direction (a hidden scrollbar alone doesn't say "swipe").
 * `arrowTop` centres the arrows on the row's visual (e.g. the tile circles).
 */
function ScrollRow({ children, className, arrowTop }: { children: ReactNode; className: string; arrowTop: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Children can change without the box resizing (tags load after the cache paints).
  useEffect(() => {
    measure();
  });

  const nudge = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' });
  };
  const arrow =
    'absolute -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-night-800/95 text-white ring-1 ring-white/15 shadow-[0_6px_18px_rgba(0,0,0,0.5)] flex items-center justify-center hover:bg-night-700 active:scale-95 transition';

  return (
    <div className="relative">
      <div ref={ref} className={className}>
        {children}
      </div>
      {more.left && (
        <button onClick={() => nudge(-1)} className={`${arrow} -left-1 md:-left-4 ${arrowTop}`} aria-label="Scroll left">
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      {more.right && (
        <button onClick={() => nudge(1)} className={`${arrow} -right-1 md:-right-4 ${arrowTop}`} aria-label="Scroll right">
          <ChevronRight className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

/** Desktop hero art: a live "board" of where it's busy, else tonight's events, else the scene's mix. */
function LiveBoard({ venues, counts, now }: { venues: Venue[]; counts: [string, number][]; now: number }) {
  const { heatOf, activity } = useActivity();
  const { events } = useDirectory();
  const busy = venues
    .filter((v) => (activity[v.id]?.live_count ?? 0) > 0)
    .sort((a, b) => buzzScore(activity[b.id]) - buzzScore(activity[a.id]))
    .slice(0, 5);
  const tonight = events.filter((e) => isEventSoon(e, now)).sort(compareEvents(now)).slice(0, 5);

  let title = 'Busy right now';
  let rows: ReactNode;
  if (busy.length > 0) {
    rows = busy.map((v) => (
      <li key={v.id}>
        <Link to={`/v/${v.slug}`} className="flex items-baseline gap-2 text-sm hover:text-brand-200">
          <span className="font-bold text-white truncate">{v.name}</span>
          <span className="leader" />
          <HeatBadge heat={heatOf(v.id)} />
        </Link>
      </li>
    ));
  } else if (tonight.length > 0) {
    title = 'On tonight';
    rows = tonight.map((e) => (
      <li key={e.id}>
        <Link to={`/events/${e.id}`} className="flex items-baseline gap-2 text-sm hover:text-brand-200">
          <span className="font-bold text-white truncate">{e.title}</span>
          <span className="leader" />
          <span className={`shrink-0 text-xs font-extrabold ${isEventLive(e, now) ? 'text-brand-300' : 'text-glow-300'}`}>
            {isEventLive(e, now) ? 'LIVE' : new Intl.DateTimeFormat('en-US', { timeZone: 'America/Nassau', hour: 'numeric' }).format(new Date(eventNextStart(e, now)))}
          </span>
        </Link>
      </li>
    ));
  } else {
    title = 'The scene';
    const lines = counts.length > 0 ? counts.slice(0, 6) : (['Nightclub', 'Cocktail Bar', 'Beach Bar', 'Lounge', 'Live Music', 'Rooftop Bar'].map((c) => [c, 0]) as [string, number][]);
    rows = lines.map(([label, n]) => (
      <li key={label} className="flex items-baseline gap-2 text-sm">
        <span className="font-bold text-white">{label}</span>
        <span className="leader" />
        <span className="font-extrabold text-glow-300 text-xs">{n ? `${n} spot${n === 1 ? '' : 's'}` : 'soon'}</span>
      </li>
    ));
  }

  return (
    <div className="hidden lg:block">
      <div className="neon-edge relative ml-auto w-80 rounded-2xl bg-night-950/80 backdrop-blur p-6 pt-5 shadow-2xl">
        <p className="flex items-center justify-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.3em] text-brand-300">
          <Radio className="w-3.5 h-3.5" /> {title}
        </p>
        <p className="text-center font-display text-xl font-extrabold text-white mt-1">New Providence</p>
        <div className="my-3 h-px bg-gradient-to-r from-transparent via-brand-400/60 to-transparent" />
        <ul className="space-y-2.5">{rows}</ul>
        <p className="text-center text-[11px] font-semibold text-night-400 mt-4">Live levels from anonymous phones · updates every minute</p>
      </div>
    </div>
  );
}

export default function Explore() {
  const { venues, events, tagsOf, ratings, loading, error } = useDirectory();
  const { filters, setFilters, toggle } = useFilters();
  const { location, enable: enableLocation, error: locationError } = useUserLocation();
  const { activity, isBusy, consent, setConsent } = useActivity();
  const now = useNow();
  const { theme } = useSiteTheme();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<Sort>('featured');
  const [view, setView] = useState<View>('grid');
  const resultsRef = useRef<HTMLDivElement>(null);

  const distanceTo = (r: Venue) => (location && hasLocation(r) ? getDistance(location.lat, location.lng, r.lat, r.lng) : null);
  const distanceLabel = (r: Venue) => {
    const d = distanceTo(r);
    return d != null ? formatDistance(d) : null;
  };

  const results = useMemo(() => {
    const list = venues.filter((r) => matchesFilters(r, filters, now, isBusy));
    const byName = (a: Venue, b: Venue) => a.name.localeCompare(b.name);
    switch (sort) {
      case 'buzzing':
        return list.sort((a, b) => buzzScore(activity[b.id]) - buzzScore(activity[a.id]) || byName(a, b));
      case 'popular':
        return list.sort((a, b) => (activity[b.id]?.visits_30d ?? 0) - (activity[a.id]?.visits_30d ?? 0) || byName(a, b));
      case 'nearest':
        return list.sort((a, b) => (distanceTo(a) ?? Infinity) - (distanceTo(b) ?? Infinity) || byName(a, b));
      case 'newest':
        return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
      case 'rated': {
        // Bayesian-ish: a 5.0 from one review shouldn't beat a 4.7 from forty.
        const score = (r: Venue) => {
          const s = ratings[r.id];
          return s ? (s.rating_avg * s.rating_count + 3.5 * 3) / (s.rating_count + 3) : 0;
        };
        return list.sort((a, b) => score(b) - score(a) || byName(a, b));
      }
      case 'az':
        return list.sort(byName);
      default:
        return list.sort((a, b) => Number(isFeatured(b, now)) - Number(isFeatured(a, now)) || byName(a, b));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues, filters, now, sort, location, ratings, activity, isBusy]);

  // Browse-mode data (only shown when no search/filters are active).
  const featured = useMemo(() => venues.filter((r) => isFeatured(r, now)), [venues, now]);
  const openNow = useMemo(() => venues.filter((r) => isOpenNow(r.hours, now) && r.hours), [venues, now]);
  const buzzing = useMemo(
    () => venues.filter((r) => (activity[r.id]?.live_count ?? 0) > 0).sort((a, b) => buzzScore(activity[b.id]) - buzzScore(activity[a.id])),
    [venues, activity],
  );
  const popular = useMemo(
    () =>
      venues
        .filter((r) => (activity[r.id]?.visits_30d ?? 0) > 0)
        .sort((a, b) => activity[b.id]!.visits_30d - activity[a.id]!.visits_30d)
        .slice(0, 10),
    [venues, activity],
  );
  const tonight = useMemo(() => events.filter((e) => isEventSoon(e, now)).sort(compareEvents(now)), [events, now]);
  const upcoming = useMemo(() => events.filter((e) => !isEventEnded(e, now)).sort(compareEvents(now)), [events, now]);
  const fresh = useMemo(() => [...venues].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10), [venues]);
  const countBy = (pick: (r: Venue) => string[]) => {
    const m = new Map<string, number>();
    for (const r of venues) for (const v of pick(r)) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const categoryCounts = useMemo(() => countBy((r) => r.categories), [venues]); // eslint-disable-line react-hooks/exhaustive-deps
  const vibeCounts = useMemo(() => countBy((r) => r.vibes), [venues]); // eslint-disable-line react-hooks/exhaustive-deps
  const areaCounts = useMemo(() => countBy((r) => (r.area ? [r.area] : [])), [venues]); // eslint-disable-line react-hooks/exhaustive-deps

  // With listings, only show tags that have spots; before launch, show the vocabulary.
  const withCounts = (labels: string[], counts: Map<string, number>) =>
    (venues.length ? labels.filter((l) => counts.get(l)) : labels).map((l) => [l, counts.get(l) ?? 0] as [string, number]);
  const categories = withCounts(tagsOf('category'), categoryCounts);
  const vibes = withCounts(tagsOf('vibe'), vibeCounts).slice(0, 6);
  const areas = withCounts(tagsOf('area'), areaCounts);
  const topCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);

  const browsing = !filters.q && activeFilterCount(filters) === 0;
  const m = moment(now);
  const suggestionExists = tagsOf(m.suggestion.key === 'categories' ? 'category' : 'vibe').includes(m.suggestion.value);

  const showResults = () => setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  const apply = (patch: Partial<Filters>) => {
    setFilters({ ...EMPTY_FILTERS, ...patch });
    showResults();
  };
  const chooseSort = (s: Sort) => {
    if (s === 'nearest') enableLocation();
    setSort(s);
  };
  const lightUp = () => {
    setConsent('on');
    enableLocation();
  };

  // Removable chips for everything currently narrowing the list.
  const activeChips: { label: string; remove: () => void }[] = [
    ...(filters.q ? [{ label: `“${filters.q}”`, remove: () => setFilters((f) => ({ ...f, q: '' })) }] : []),
    ...(filters.busyNow ? [{ label: 'Buzzing now', remove: () => setFilters((f) => ({ ...f, busyNow: false })) }] : []),
    ...(filters.openNow ? [{ label: 'Open now', remove: () => setFilters((f) => ({ ...f, openNow: false })) }] : []),
    ...filters.prices.map((p) => ({ label: priceLabel(p), remove: () => toggle('prices', p) })),
    ...filters.categories.map((c) => ({ label: c, remove: () => toggle('categories', c) })),
    ...filters.vibes.map((v) => ({ label: v, remove: () => toggle('vibes', v) })),
    ...filters.areas.map((a) => ({ label: a, remove: () => toggle('areas', a) })),
  ];

  // Each number is a shortcut to what it counts.
  const stats: { value: number; label: string; hint: string; onClick?: () => void; to?: string }[] = [
    { value: venues.length, label: venues.length === 1 ? 'spot' : 'spots', hint: 'See all spots', onClick: () => apply({}) },
    { value: openNow.length, label: 'open now', hint: 'Show spots open now', onClick: () => apply({ openNow: true }) },
    { value: buzzing.length, label: 'buzzing', hint: 'Show spots buzzing now', onClick: () => apply({ busyNow: true }) },
    { value: tonight.length, label: tonight.length === 1 ? 'event tonight' : 'events tonight', hint: 'See tonight’s events', to: '/events?range=tonight' },
  ];

  const pill = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-sm font-bold';

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 pb-12">
      {/* ------------------------------------------------------------ Hero */}
      <section className="mt-4 md:mt-8">
        <div className="neon-board relative rounded-[2rem] overflow-hidden text-white px-5 py-7 md:px-10 md:py-12 shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
          <div className="md:hidden mb-6">
            <Logo />
          </div>
          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-8 items-center">
            <div>
              {theme.badge && (
                <p className="mb-3 w-fit flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-extrabold text-white">
                  <theme.badge.icon className="w-3.5 h-3.5 text-glow-300" /> {theme.badge.label}
                </p>
              )}
              <p className="inline-flex items-center gap-2 text-xs md:text-sm font-extrabold uppercase tracking-[0.16em] text-glow-300">
                <Moon className="w-4 h-4" /> {m.greeting}
              </p>
              <h1 className="font-display mt-3 text-[2.2rem] leading-[1.05] md:text-6xl font-extrabold tracking-tight">
                Nassau <span className="text-brand-300 neon-text neon-flicker">after dark.</span>
              </h1>
              <p className="mt-3 md:text-lg font-medium text-night-200 max-w-xl">
                Bars, clubs, beach bars and tonight’s events across New Providence — with live levels showing where it’s buzzing right now.
              </p>

              <div className="mt-6 max-w-xl">
                <SearchFilterBar onOpenFilters={() => setFiltersOpen(true)} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => apply({ busyNow: true })} className={pill}>
                  <span className="heat-dot pulse" style={{ color: 'var(--color-heat-lively)' }} /> Buzzing now
                </button>
                <button onClick={() => apply({ openNow: true })} className={pill}>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 glow-live" /> Open now
                </button>
                <button
                  onClick={() => {
                    chooseSort('nearest');
                    showResults();
                  }}
                  className={pill}
                >
                  <LocateFixed className="w-4 h-4" /> Near me
                </button>
                <Link to="/events" className={pill}>
                  <CalendarHeart className="w-4 h-4" /> Events
                </Link>
                {suggestionExists && (
                  <button
                    onClick={() => apply({ [m.suggestion.key]: [m.suggestion.value] })}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-brand-500 hover:bg-brand-400 text-white text-sm font-extrabold glow-brand"
                  >
                    <Sparkles className="w-4 h-4" /> {m.suggestion.label}
                  </button>
                )}
              </div>

              <div className="mt-8 grid grid-cols-4 gap-2 max-w-lg">
                {stats.map((s) => {
                  const body = (
                    <>
                      <span className="block font-display text-2xl md:text-3xl font-extrabold leading-none group-hover:text-brand-200 transition-colors">{s.value}</span>
                      <span className="flex items-center gap-0.5 text-[10px] md:text-xs font-bold uppercase tracking-wider text-night-300 group-hover:text-night-100 mt-1 transition-colors">
                        {s.label}
                        <ChevronRight className="w-3 h-3 shrink-0 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition" aria-hidden />
                      </span>
                    </>
                  );
                  const cls =
                    'group block text-left border-l-2 border-brand-400/60 hover:border-brand-300 pl-3 py-1 -my-1 rounded-r-lg hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 transition-colors';
                  return s.to ? (
                    <Link key={s.label} to={s.to} className={cls} aria-label={`${s.value} ${s.label}: ${s.hint}`}>
                      {body}
                    </Link>
                  ) : (
                    <button key={s.label} type="button" onClick={s.onClick} className={cls} aria-label={`${s.value} ${s.label}: ${s.hint}`}>
                      {body}
                    </button>
                  );
                })}
              </div>

              {supabaseConfigured && consent === null && !location && (
                <button
                  onClick={lightUp}
                  className="mt-6 w-full max-w-lg flex items-center gap-3 p-3 pr-4 rounded-2xl bg-white/5 border border-white/15 hover:bg-white/10 text-left"
                >
                  <span className="w-10 h-10 shrink-0 rounded-xl bg-brand-500/20 text-brand-300 flex items-center justify-center">
                    <Radio className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold text-white">Help light up the map</span>
                    <span className="block text-xs text-night-300">Share your location anonymously so everyone sees where it’s busy. Only venue totals are ever shown.</span>
                  </span>
                  <ChevronRight className="w-5 h-5 text-night-300 ml-auto shrink-0" />
                </button>
              )}
            </div>
            <LiveBoard venues={venues} counts={topCategories} now={now} />
          </div>
        </div>
      </section>

      {!supabaseConfigured && <SetupNotice />}
      {error && (
        <p className="mt-4 text-sm font-semibold text-rose-200 bg-rose-500/10 border border-rose-400/30 rounded-2xl px-4 py-3">
          Couldn’t refresh the directory: {error}
        </p>
      )}

      {browsing && (
        <>
          {/* ------------------------------------------------ Events tonight */}
          {(tonight.length > 0 || upcoming.length > 0) && (
            <section className="mt-10">
              <SectionHeader
                eyebrow={tonight.some((e) => isEventLive(e, now)) ? 'Live now' : 'Highlighted events'}
                title={tonight.length > 0 ? 'Happening tonight' : 'Coming up'}
                action={<SeeAll to="/events">All events</SeeAll>}
              />
              <Rail>
                {(tonight.length > 0 ? tonight : upcoming).slice(0, 10).map((e) => (
                  <EventCard key={e.id} e={e} now={now} />
                ))}
              </Rail>
            </section>
          )}

          {/* ------------------------------------------------- Buzzing now */}
          {buzzing.length > 0 && (
            <section className="mt-10">
              <SectionHeader
                eyebrow="Live activity"
                title="Buzzing right now"
                action={
                  <SeeAll
                    onClick={() => {
                      setSort('buzzing');
                      apply({ busyNow: true });
                    }}
                  >
                    See all {buzzing.length}
                  </SeeAll>
                }
              />
              <Rail>
                {buzzing.slice(0, 12).map((r) => (
                  <RailCard key={r.id} r={r} now={now} />
                ))}
              </Rail>
            </section>
          )}

          {/* ------------------------------------------------ Category tiles */}
          {categories.length > 0 && (
            <section className="mt-10">
              <SectionHeader eyebrow="Pick your scene" title="What’s the move tonight?" />
              <ScrollRow
                className="flex gap-3 md:gap-4 overflow-x-auto no-scrollbar -mx-4 px-4 md:-mx-6 md:px-6 pt-1 pb-2"
                arrowTop="top-[40px] md:top-[44px]"
              >
                {categories.map(([label, n]) => {
                  const style = pinStyleFor([label]);
                  return (
                    <button key={label} onClick={() => apply({ categories: [label] })} className="group shrink-0 self-start w-[5.5rem] md:w-24 text-center">
                      <span
                        className="mx-auto w-[4.5rem] h-[4.5rem] md:w-20 md:h-20 rounded-full flex items-center justify-center ring-2 ring-white/15 group-hover:-translate-y-1 transition-all"
                        style={{ backgroundColor: style.color, boxShadow: `0 0 24px -4px ${style.color}` }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="30"
                          height="30"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          dangerouslySetInnerHTML={{ __html: style.glyph }}
                        />
                      </span>
                      <span className="block mt-2 text-[13px] font-extrabold text-white leading-tight">{label}</span>
                      {n > 0 && <span className="block text-[11px] font-bold text-night-400">{n}</span>}
                    </button>
                  );
                })}
              </ScrollRow>
            </section>
          )}

          {/* --------------------------------------------- Popular this month */}
          {popular.length >= 3 && (
            <section className="mt-10">
              <SectionHeader
                eyebrow="Most visited"
                title="Popular this month"
                action={
                  <SeeAll
                    onClick={() => {
                      setSort('popular');
                      showResults();
                    }}
                  >
                    Ranking
                  </SeeAll>
                }
              />
              <Rail>
                {popular.map((r, i) => (
                  <RailCard key={r.id} r={r} now={now} caption={`#${i + 1} · ${[r.categories[0], r.area].filter(Boolean).join(' · ')}`} />
                ))}
              </Rail>
            </section>
          )}

          {/* -------------------------------------------------- Open right now */}
          {openNow.length > 0 && (
            <section className="mt-10">
              <SectionHeader eyebrow="Doors open" title="Open right now" action={<SeeAll onClick={() => apply({ openNow: true })}>See all {openNow.length}</SeeAll>} />
              <Rail>
                {openNow.slice(0, 12).map((r) => (
                  <RailCard key={r.id} r={r} now={now} />
                ))}
              </Rail>
            </section>
          )}

          {/* --------------------------------------------------------- Featured */}
          {featured.length > 0 && (
            <section className="mt-10">
              <SectionHeader eyebrow="VIP list" title="Featured spots" />
              <Rail>
                {featured.map((r) => (
                  <div key={r.id} className="w-[80%] sm:w-80 shrink-0 snap-start">
                    <VenueCard r={r} now={now} distance={distanceLabel(r)} />
                  </div>
                ))}
              </Rail>
            </section>
          )}

          {/* ---------------------------------------------- Vibe collections */}
          {vibes.length > 0 && (
            <section className="mt-10">
              <SectionHeader eyebrow="Collections" title="Find your vibe" />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                {vibes.map(([label, n], i) => {
                  const Icon = VIBE_ICONS[label] ?? Sparkles;
                  return (
                    <button
                      key={label}
                      onClick={() => apply({ vibes: [label] })}
                      className={`group relative overflow-hidden text-left rounded-[1.5rem] p-4 md:p-5 min-h-28 md:min-h-36 bg-gradient-to-br ${VIBE_TONES[i % VIBE_TONES.length]} text-white ring-1 ring-white/10 hover:-translate-y-0.5 hover:ring-white/30 transition-all`}
                    >
                      <Icon className="absolute -right-3 -bottom-3 w-24 h-24 md:w-28 md:h-28 text-white/10 group-hover:scale-110 group-hover:-rotate-6 transition-transform duration-500" />
                      <span className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center">
                        <Icon className="w-5 h-5" />
                      </span>
                      <span className="block font-display text-base md:text-lg font-bold mt-3 leading-tight">{label}</span>
                      <span className="block text-xs font-bold text-white/70 mt-0.5">{n ? `${n} spot${n === 1 ? '' : 's'}` : 'Coming soon'}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* -------------------------------------------------- Fresh additions */}
          {fresh.length >= 3 && (
            <section className="mt-10">
              <SectionHeader eyebrow="Just added" title="Fresh on the scene" />
              <Rail>
                {fresh.map((r) => (
                  <RailCard
                    key={r.id}
                    r={r}
                    now={now}
                    caption={`Added ${new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${r.area ? ` · ${r.area}` : ''}`}
                  />
                ))}
              </Rail>
            </section>
          )}

          {/* ------------------------------------------------------------ Areas */}
          {areas.length > 0 && (
            <section className="mt-10">
              <SectionHeader eyebrow="Around the island" title="Explore by neighbourhood" />
              <div className="flex flex-wrap gap-2">
                {areas.map(([label, n]) => (
                  <button
                    key={label}
                    onClick={() => apply({ areas: [label] })}
                    className="inline-flex items-center gap-2 pl-3 pr-2 py-2 rounded-full bg-night-900 border border-white/10 text-sm font-bold text-night-50 hover:border-brand-400/60 hover:bg-night-800 transition-colors"
                  >
                    <MapPin className="w-4 h-4 text-brand-400" />
                    {label}
                    {n > 0 && <span className="px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-200 text-xs font-extrabold">{n}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ---------------------------------------------------------- All spots */}
      <section ref={resultsRef} className="mt-10 scroll-mt-4 md:scroll-mt-20">
        <SectionHeader eyebrow={browsing ? 'The full directory' : 'Your search'} title={browsing ? 'All spots' : 'Matching spots'} />

        <div className="sticky top-0 md:top-16 z-[1000] -mx-4 px-4 md:-mx-6 md:px-6 py-2.5 bg-night-950/90 backdrop-blur-md border-b border-white/10 mb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-extrabold text-night-50">{loading ? 'Loading…' : `${results.length} ${results.length === 1 ? 'spot' : 'spots'}`}</p>
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-0.5 bg-night-900 rounded-xl p-1 border border-white/10 text-xs font-extrabold overflow-x-auto no-scrollbar max-w-[calc(100vw-2rem)]">
                {(
                  [
                    ['featured', 'Top picks', null],
                    ['buzzing', 'Buzzing', Flame],
                    ['popular', 'Popular', TrendingUp],
                    ['rated', 'Top rated', Star],
                    ['nearest', 'Nearest', LocateFixed],
                    ['az', 'A–Z', null],
                    ['newest', 'New', null],
                  ] as [Sort, string, LucideIcon | null][]
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    onClick={() => chooseSort(key)}
                    className={`shrink-0 whitespace-nowrap px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors ${
                      sort === key ? 'bg-brand-500 text-white' : 'text-night-200 hover:bg-white/5'
                    }`}
                  >
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                    {label}
                  </button>
                ))}
              </div>
              <div className="hidden sm:flex items-center gap-0.5 bg-night-900 rounded-xl p-1 border border-white/10">
                {(
                  [
                    ['grid', LayoutGrid],
                    ['list', List],
                  ] as [View, LucideIcon][]
                ).map(([key, Icon]) => (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    aria-label={`${key} view`}
                    aria-pressed={view === key}
                    className={`p-1.5 rounded-lg ${view === key ? 'bg-brand-500 text-white' : 'text-night-200 hover:bg-white/5'}`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>
          {activeChips.length > 0 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2.5">
              {activeChips.map((c) => (
                <button
                  key={c.label}
                  onClick={c.remove}
                  className="shrink-0 inline-flex items-center gap-1 pl-3 pr-2 py-1 rounded-full bg-brand-500 text-white text-xs font-extrabold hover:bg-brand-400"
                >
                  {c.label} <X className="w-3.5 h-3.5" />
                </button>
              ))}
              <button onClick={() => setFilters(EMPTY_FILTERS)} className="shrink-0 px-3 py-1 text-xs font-extrabold text-brand-300 hover:text-brand-200 underline underline-offset-2">
                Clear all
              </button>
            </div>
          )}
        </div>

        {sort === 'nearest' && locationError && (
          <p className="mb-4 text-sm font-semibold text-night-100 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">{locationError}</p>
        )}
        {(sort === 'buzzing' || filters.busyNow) && buzzing.length === 0 && !loading && (
          <p className="mb-4 text-sm font-semibold text-night-200 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
            Nobody’s showing up on the live map yet. Live levels come from people sharing their location anonymously —{' '}
            {consent === 'on' ? 'thanks for being one of them.' : (
              <button onClick={lightUp} className="font-extrabold text-brand-300 underline underline-offset-2">
                be one of them
              </button>
            )}
          </p>
        )}

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="rounded-[1.75rem] bg-night-900 border border-white/10 overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-night-800" />
                <div className="p-4 space-y-2">
                  <div className="h-5 w-2/3 bg-night-800 rounded" />
                  <div className="h-4 w-1/2 bg-night-800 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          venues.length === 0 ? (
            <EmptyState icon={<Martini className="w-8 h-8" />} title="The doors are just opening">
              Spots are being added now. Know a great place?{' '}
              <Link to="/community?kind=new_spot" className="font-bold text-brand-300 underline">
                Suggest it
              </Link>
              .
            </EmptyState>
          ) : (
            <EmptyState icon={<SearchX className="w-8 h-8" />} title="Nothing matches that">
              Try removing a filter or two.{' '}
              <Link to="/community?kind=new_spot" className="font-bold text-brand-300 underline">
                Missing a spot?
              </Link>
            </EmptyState>
          )
        ) : view === 'list' ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {results.map((r) => (
              <VenueRow key={r.id} r={r} now={now} distance={distanceLabel(r)} />
            ))}
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((r) => (
              <VenueCard key={r.id} r={r} now={now} distance={distanceLabel(r)} />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------ Community CTA */}
      <section className="mt-14">
        <div className="relative overflow-hidden rounded-[2rem] neon-edge bg-night-900 p-6 md:p-10 flex flex-col md:flex-row md:items-center gap-6">
          <Martini className="absolute -right-6 -top-6 w-40 h-40 text-brand-500/10 rotate-12" />
          <div className="relative flex-1">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-glow-300">Built with the community</p>
            <h2 className="font-display text-xl md:text-2xl font-extrabold text-white mt-1">Know a spot or a party we’re missing?</h2>
            <p className="mt-2 font-medium text-night-200 max-w-xl">
              New hours, a new cover charge, a DJ night coming up — or the hole-in-the-wall rum bar everyone should know about. Send it in and we’ll get it listed.
            </p>
          </div>
          <div className="relative flex flex-col sm:flex-row gap-2 shrink-0">
            <Link
              to="/community?kind=new_spot"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-brand-500 text-white font-extrabold hover:bg-brand-400 glow-brand"
            >
              <Star className="w-4 h-4" /> Suggest a spot
            </Link>
            <Link
              to="/community?kind=event"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-white/5 text-white font-extrabold hover:bg-white/10 border border-white/15"
            >
              <CalendarHeart className="w-4 h-4" /> Tip us an event
            </Link>
          </div>
        </div>
      </section>

      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} resultCount={results.length} />
    </div>
  );
}
