import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle, CalendarHeart, CarTaxiFront, Clock, ExternalLink, Footprints, LocateFixed, Minus, Phone, Plus, RefreshCw, Route,
  Share2, Shuffle, Sparkles, Users,
} from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { useDirectory, useUserLocation } from '@/lib/directory';
import { useActivity } from '@/lib/activity';
import { useFavorites } from '@/lib/favorites';
import { NEW_PROVIDENCE, formatDistance } from '@/lib/geo';
import { nassauClock } from '@/lib/hours';
import { TILE_ATTRIBUTION, TILE_URL } from '@/lib/markers';
import {
  autoStops, candidates, formatClock, googleMapsUrl, minutesLabel, nassauTime, nightOptions, planCrawl, planFromIds, swapStop,
  type CrawlContext, type CrawlMode, type CrawlPlan, type CrawlRequest,
} from '@/lib/crawl';
import { Chip, SafeImg, Spinner } from '@/components/ui';
import { SetupNotice } from '@/components/SetupNotice';

// "/crawl": plan a bar crawl. The whole request (and the chosen stops) lives
// in the URL, so a plan can be shared and reopens exactly. The visitor's GPS
// is never put in the URL.

const START_OPTIONS = Array.from({ length: 19 }, (_, i) => 960 + i * 30); // 4 PM – 1 AM
const MODES: { value: CrawlMode; label: string; hint: string; icon: typeof Footprints }[] = [
  { value: 'walk', label: 'Walk', hint: 'Spots within walking distance of each other', icon: Footprints },
  { value: 'mix', label: 'Walk + taxi', hint: `Walk short hops, taxi the longer ones`, icon: Route },
  { value: 'taxi', label: 'Taxi', hint: 'Taxi between stops, so anywhere on the island', icon: CarTaxiFront },
];

function readRequest(params: URLSearchParams, defaultNight: string): CrawlRequest {
  const int = (k: string, d: number) => {
    const n = parseInt(params.get(k) ?? '', 10);
    return Number.isFinite(n) ? n : d;
  };
  const start = Math.min(1500, Math.max(960, int('from', 1260)));
  const end = Math.min(start + 420, Math.max(start + 120, int('to', start + 300)));
  const mode = params.get('mode');
  const stops = int('n', 0);
  return {
    night: /^\d{4}-\d{2}-\d{2}$/.test(params.get('night') ?? '') ? params.get('night')! : defaultNight,
    start,
    end,
    party: Math.min(30, Math.max(1, int('party', 4))),
    areas: params.getAll('area'),
    vibes: params.getAll('vibe'),
    maxPrice: params.get('price') ? Math.min(4, Math.max(1, int('price', 4))) : null,
    stops: stops >= 2 && stops <= 6 ? stops : null,
    mode: mode === 'walk' || mode === 'taxi' ? mode : 'mix',
    origin: null,
    first: params.get('first'),
    seed: int('seed', 0),
  };
}

function writeRequest(req: CrawlRequest, near: boolean, stopIds: string[] | null) {
  const p = new URLSearchParams();
  p.set('night', req.night);
  p.set('from', String(req.start));
  p.set('to', String(req.end));
  p.set('party', String(req.party));
  req.areas.forEach((a) => p.append('area', a));
  req.vibes.forEach((v) => p.append('vibe', v));
  if (req.maxPrice) p.set('price', String(req.maxPrice));
  if (req.stops) p.set('n', String(req.stops));
  p.set('mode', req.mode);
  if (req.first) p.set('first', req.first);
  if (req.seed) p.set('seed', String(req.seed));
  if (near) p.set('near', '1');
  if (stopIds) p.set('stops', stopIds.join(','));
  return p;
}

/** Usual crowd per venue for the night's two weekdays (popular-times data), paged past PostgREST's row cap. */
function useTypical(night: string, venueIds: string[]) {
  const [typical, setTypical] = useState<Record<string, number[][]>>({});
  const key = venueIds.join(',');
  useEffect(() => {
    if (!supabaseConfigured || venueIds.length === 0) return;
    let alive = true;
    const dow = nassauClock(nassauTime(night, 720)).dow;
    (async () => {
      const grid: Record<string, number[][]> = {};
      for (let from = 0; from < 20_000; from += 1000) {
        const { data, error } = await supabase
          .from('venue_typical')
          .select('venue_id, dow, hour, avg_visitors')
          .in('dow', [dow, (dow + 1) % 7])
          .in('venue_id', venueIds)
          .range(from, from + 999);
        if (error || !data) break;
        for (const r of data as { venue_id: string; dow: number; hour: number; avg_visitors: number }[]) {
          grid[r.venue_id] ??= Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
          grid[r.venue_id][r.dow][r.hour] = r.avg_visitors;
        }
        if (data.length < 1000) break;
      }
      if (alive) setTypical(grid);
    })();
    return () => {
      alive = false;
    };
  }, [night, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return typical;
}

export default function CrawlPage() {
  const [params, setParams] = useSearchParams();
  const nights = useMemo(() => nightOptions(), []);
  const { venues, events, ratings, tagsOf, loading } = useDirectory();
  const { activity } = useActivity();
  const { ids: favoriteIds } = useFavorites();
  const { location, enable, error: locationError } = useUserLocation();

  const [req, setReq] = useState<CrawlRequest>(() => readRequest(params, nights[0].value));
  const [near, setNear] = useState(params.get('near') === '1');
  const [plan, setPlan] = useState<CrawlPlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [swapped, setSwapped] = useState<Record<number, string[]>>({});
  const [copied, setCopied] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Plan a bar crawl — Nassau Nights';
  }, []);
  useEffect(() => {
    if (near) enable();
  }, [near, enable]);

  const origin =
    near && location && location.lat < NEW_PROVIDENCE.north && location.lat > NEW_PROVIDENCE.south && location.lng > NEW_PROVIDENCE.west && location.lng < NEW_PROVIDENCE.east
      ? { lat: location.lat, lng: location.lng }
      : null;

  const pinned = useMemo(() => venues.filter((v) => v.lat != null && v.lng != null), [venues]);
  const areaCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of pinned) if (v.area) c[v.area] = (c[v.area] ?? 0) + 1;
    return c;
  }, [pinned]);
  const areas = tagsOf('area').filter((a) => areaCounts[a]);
  const vibes = tagsOf('vibe');
  const firstVenue = req.first ? venues.find((v) => v.id === req.first) : undefined;

  const pool = useMemo(() => candidates({ ...req, origin }, { venues: pinned } as CrawlContext), [req, pinned]); // eslint-disable-line react-hooks/exhaustive-deps
  const typical = useTypical(req.night, useMemo(() => pool.map((v) => v.id), [pool]));
  const ctx: CrawlContext = useMemo(
    () => ({ venues: pinned, events, ratings, activity, typical, favorites: new Set(favoriteIds) }),
    [pinned, events, ratings, activity, typical, favoriteIds],
  );

  const run = (next: CrawlRequest, scroll = true) => {
    const full = { ...next, origin };
    const res = planCrawl(full, ctx);
    setSwapped({});
    if (res.plan) {
      setPlan(res.plan);
      setMessage(res.note);
      setParams(writeRequest(next, near, res.plan.stops.map((s) => s.venue.id)), { replace: true });
    } else {
      setPlan(null);
      setMessage(res.reason);
      setParams(writeRequest(next, near, null), { replace: true });
    }
    if (scroll) setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  // A shared link with stops reopens that exact plan once the directory is in.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || loading || pinned.length === 0) return;
    const ids = params.get('stops')?.split(',').filter(Boolean);
    if (!ids?.length) return;
    restored.current = true;
    const rebuilt = planFromIds(ids, { ...req, origin }, ctx);
    if (rebuilt) setPlan(rebuilt);
    else run(req, false);
  }, [loading, pinned.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof CrawlRequest>(k: K, v: CrawlRequest[K]) => setReq((r) => ({ ...r, [k]: v }));
  const toggle = (k: 'areas' | 'vibes', v: string) => setReq((r) => ({ ...r, [k]: r[k].includes(v) ? r[k].filter((x) => x !== v) : [...r[k], v] }));

  const swap = (index: number) => {
    if (!plan) return;
    const tried = [...(swapped[index] ?? []), plan.stops[index].venue.id];
    const next = swapStop(plan, index, { ...req, origin }, ctx, tried);
    if (!next) {
      setMessage(`Nothing else fits stop ${index + 1} at that time.`);
      return;
    }
    setMessage(null);
    setSwapped((s) => ({ ...s, [index]: tried }));
    setPlan(next);
    setParams(writeRequest(req, near, next.stops.map((s) => s.venue.id)), { replace: true });
  };

  const share = async () => {
    const url = window.location.href;
    const title = 'Our bar crawl — Nassau Nights';
    try {
      if (navigator.share) return await navigator.share({ title, url });
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* dismissed */
    }
  };

  if (!supabaseConfigured) return <SetupNotice />;

  const endOptions = Array.from({ length: 11 }, (_, i) => req.start + 120 + i * 30).filter((m) => m <= 1800);
  const stopsShown = req.stops ?? autoStops(req);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-10">
      <header className="neon-board rounded-[2rem] p-6 md:p-8 text-white">
        <p className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-glow-300">
          <Route className="w-4 h-4" /> Bar crawl planner
        </p>
        <h1 className="mt-2 text-3xl md:text-4xl font-extrabold leading-tight">Plan your night out.</h1>
        <p className="mt-2 text-night-200 font-medium max-w-2xl">
          Tell us when, who and where. We’ll pick spots that are open while you’re there, start you somewhere easy and save the liveliest for
          last, with tonight’s events and the usual crowds worked in.
        </p>
        {firstVenue && (
          <p className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-sm font-bold">
            Starting at {firstVenue.name}
            <button onClick={() => set('first', null)} className="text-night-300 hover:text-white" aria-label="Don’t start there">
              ×
            </button>
          </p>
        )}
      </header>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-6 items-start">
        {/* ---------------------------------------------------------- form */}
        <form
          className="bg-night-900 rounded-[1.75rem] border border-white/10 p-5 space-y-5 lg:sticky lg:top-24"
          onSubmit={(e) => {
            e.preventDefault();
            run(req);
          }}
        >
          <Field label="When">
            <div className="flex gap-2 overflow-x-auto no-scrollbar max-w-full -mx-1 px-1">
              {nights.map((n) => (
                <Chip key={n.value} size="sm" active={req.night === n.value} onClick={() => set('night', n.value)}>
                  {n.label}
                </Chip>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Select
                label="From"
                value={req.start}
                onChange={(v) => setReq((r) => ({ ...r, start: v, end: Math.min(v + 420, Math.max(v + 120, r.end)) }))}
                options={START_OPTIONS.map((m) => [m, minutesLabel(m)])}
              />
              <Select label="Until" value={req.end} onChange={(v) => set('end', v)} options={endOptions.map((m) => [m, minutesLabel(m)])} />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Party size">
              <div className="flex items-center gap-1 bg-white/5 rounded-xl border border-white/10 p-1 w-fit">
                <Stepper onClick={() => set('party', Math.max(1, req.party - 1))} label="Fewer people" icon={Minus} />
                <span className="min-w-[3.5rem] text-center font-extrabold text-white inline-flex items-center justify-center gap-1">
                  <Users className="w-4 h-4 text-brand-300" /> {req.party}
                </span>
                <Stepper onClick={() => set('party', Math.min(30, req.party + 1))} label="More people" icon={Plus} />
              </div>
            </Field>
            <Field label="Stops">
              <select
                value={req.stops ?? 0}
                onChange={(e) => set('stops', Number(e.target.value) || null)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white font-bold"
              >
                <option value={0}>Auto ({autoStops(req)})</option>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} stops
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Getting around">
            <div className="grid grid-cols-3 gap-2">
              {MODES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set('mode', value)}
                  aria-pressed={req.mode === value}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-extrabold transition-colors ${
                    req.mode === value ? 'bg-brand-500/20 border-brand-400/60 text-white' : 'bg-white/5 border-white/10 text-night-200 hover:border-white/20'
                  }`}
                >
                  <Icon className="w-5 h-5" /> {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs font-semibold text-night-300">{MODES.find((m) => m.value === req.mode)?.hint}. No driving: never drink and drive.</p>
          </Field>

          <Field label="Areas" hint={req.areas.length ? undefined : 'Anywhere'}>
            <div className="flex flex-wrap gap-1.5">
              {areas.map((a) => (
                <Chip key={a} size="sm" active={req.areas.includes(a)} onClick={() => toggle('areas', a)}>
                  {a} <span className="opacity-60">{areaCounts[a]}</span>
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Vibe" hint="Optional">
            <div className="flex flex-wrap gap-1.5">
              {vibes.map((v) => (
                <Chip key={v} size="sm" active={req.vibes.includes(v)} onClick={() => toggle('vibes', v)}>
                  {v}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Budget">
            <div className="flex flex-wrap gap-1.5">
              <Chip size="sm" active={req.maxPrice === null} onClick={() => set('maxPrice', null)}>
                Any
              </Chip>
              {[1, 2, 3].map((p) => (
                <Chip key={p} size="sm" active={req.maxPrice === p} onClick={() => set('maxPrice', p)}>
                  {'$'.repeat(p)} or less
                </Chip>
              ))}
            </div>
          </Field>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={near} onChange={(e) => setNear(e.target.checked)} className="mt-1 w-4 h-4 accent-brand-500" />
            <span className="text-sm font-semibold text-night-100">
              <span className="inline-flex items-center gap-1 font-extrabold text-white">
                <LocateFixed className="w-4 h-4 text-glow-300" /> Start near me
              </span>
              <span className="block text-xs text-night-300">
                {near && locationError ? locationError : near && !origin ? 'Finding you… (only works on New Providence)' : 'Counts the trip to the first stop. Your location isn’t shared in links.'}
              </span>
            </span>
          </label>

          <button
            type="submit"
            disabled={loading && venues.length === 0}
            className="w-full py-3.5 rounded-2xl font-extrabold text-white bg-gradient-to-r from-brand-500 to-glow-500 glow-brand hover:brightness-110 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            <Sparkles className="w-5 h-5" /> Plan my crawl
          </button>
          <p className="text-xs font-semibold text-night-400 text-center">
            {pool.length} spot{pool.length === 1 ? '' : 's'} to choose from · {stopsShown} stops, {minutesLabel(req.start)} – {minutesLabel(req.end)}
          </p>
        </form>

        {/* ------------------------------------------------------- results */}
        <div ref={resultsRef} className="min-w-0 scroll-mt-24 space-y-4">
          {message && (
            <p className="flex items-start gap-2 p-4 rounded-2xl bg-amber-400/10 border border-amber-400/30 text-sm font-semibold text-amber-100">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" /> {message}
            </p>
          )}
          {!plan ? (
            !message && (
              <div className="hidden lg:flex flex-col items-center justify-center text-center h-80 rounded-[1.75rem] border border-dashed border-white/15 text-night-300 p-8">
                {loading ? <Spinner /> : <Route className="w-10 h-10 text-brand-400" />}
                <p className="mt-3 font-display text-lg font-bold text-white">Your route shows up here</p>
                <p className="mt-1 text-sm font-semibold">Pick a night and tap “Plan my crawl”.</p>
              </div>
            )
          ) : (
            <PlanView plan={plan} req={req} party={req.party} origin={origin} onSwap={swap} />
          )}
          {plan && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <a
                href={googleMapsUrl(plan, origin)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 py-3 rounded-2xl bg-sky-400/10 border border-sky-400/30 text-sky-100 font-extrabold text-sm hover:border-sky-400/60"
              >
                <ExternalLink className="w-4 h-4" /> Directions in Google Maps
              </a>
              <button
                onClick={share}
                className="inline-flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 text-night-100 font-extrabold text-sm hover:border-white/25"
              >
                <Share2 className="w-4 h-4" /> {copied ? 'Link copied' : 'Share with the group'}
              </button>
              <button
                onClick={() => {
                  // Bump the seed until the stops actually change (a few tries; small areas may have one good route).
                  const current = plan.stops.map((s) => s.venue.id).join();
                  let next = { ...req, seed: req.seed + 1 };
                  for (let i = 0; i < 12; i++) {
                    const res = planCrawl({ ...next, origin }, ctx);
                    if (!res.plan || res.plan.stops.map((s) => s.venue.id).join() !== current) break;
                    next = { ...next, seed: next.seed + 1 };
                  }
                  setReq(next);
                  run(next, false);
                }}
                className="inline-flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/5 border border-white/10 text-night-100 font-extrabold text-sm hover:border-white/25"
              >
                <Shuffle className="w-4 h-4" /> Try another route
              </button>
            </div>
          )}
          {plan && (
            <p className="text-xs font-semibold text-night-400 leading-relaxed">
              Times are estimates from straight-line distances, and hours can change, so check before you head out. Drink responsibly: stick
              together, take a taxi for the longer hops, and never drink and drive.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-extrabold uppercase tracking-widest text-brand-300">
        {label} {hint && <span className="normal-case tracking-normal font-bold text-night-400">· {hint}</span>}
      </p>
      {children}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: number; onChange: (v: number) => void; options: [number, string][] }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <span className="block text-[11px] font-bold text-night-400 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white font-bold"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stepper({ onClick, label, icon: Icon }: { onClick: () => void; label: string; icon: typeof Plus }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="w-9 h-9 rounded-lg text-night-100 hover:bg-white/10 flex items-center justify-center">
      <Icon className="w-4 h-4" />
    </button>
  );
}

function LegRow({ leg, fromYou = false }: { leg: NonNullable<CrawlPlan['stops'][number]['legIn']>; fromYou?: boolean }) {
  const walk = leg.mode === 'walk';
  const Icon = walk ? Footprints : CarTaxiFront;
  return (
    <div className="flex items-center gap-2 pl-5 py-1 text-xs font-extrabold text-night-300">
      <span className={`w-px h-6 ${walk ? 'border-l-2 border-dashed border-glow-400/60' : 'border-l-2 border-amber-300/60'}`} />
      <Icon className={`w-4 h-4 ${walk ? 'text-glow-300' : 'text-amber-300'}`} />
      {walk ? `${leg.minutes} min walk` : `Taxi · about ${leg.minutes} min`} · {formatDistance(leg.metres)}
      {fromYou && <span className="text-night-400 font-bold">from you</span>}
    </div>
  );
}

function PlanView({
  plan, req, party, origin, onSwap,
}: {
  plan: CrawlPlan; req: CrawlRequest; party: number; origin: { lat: number; lng: number } | null; onSwap: (i: number) => void;
}) {
  const walkMin = plan.stops.reduce((n, s) => n + (s.legIn?.mode === 'walk' ? s.legIn.minutes : 0), 0);
  const taxis = plan.stops.filter((s) => s.legIn?.mode === 'taxi').length;
  const last = plan.stops[plan.stops.length - 1];
  return (
    <section className="bg-night-900 rounded-[1.75rem] border border-white/10 overflow-hidden">
      <div className="p-5 border-b border-white/10">
        <h2 className="font-display text-xl font-bold text-white">
          {plan.stops.length} stops, {formatClock(plan.stops[0].arrive)} – {formatClock(last.leave)}
        </h2>
        <p className="mt-1 text-sm font-semibold text-night-300 flex flex-wrap gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1"><Users className="w-4 h-4" /> {party} {party === 1 ? 'person' : 'people'}</span>
          {walkMin > 0 && <span className="inline-flex items-center gap-1"><Footprints className="w-4 h-4" /> {walkMin} min walking</span>}
          {taxis > 0 && <span className="inline-flex items-center gap-1"><CarTaxiFront className="w-4 h-4" /> {taxis} taxi ride{taxis === 1 ? '' : 's'}</span>}
          {req.areas.length > 0 && <span>{req.areas.join(', ')}</span>}
        </p>
      </div>
      <CrawlMap plan={plan} origin={origin} />
      <ol className="p-4 md:p-5">
        {plan.stops.map((s, i) => (
          <li key={s.venue.id}>
            {s.legIn && <LegRow leg={s.legIn} fromYou={i === 0} />}
            <div className="flex gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/10">
              <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-night-800">
                <SafeImg src={s.venue.cover_url} name={s.venue.name} className="w-full h-full" />
                <span className="absolute top-1 left-1 w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-black flex items-center justify-center glow-brand">
                  {i + 1}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/v/${s.venue.slug}`} className="font-display font-bold text-white hover:text-brand-200 leading-tight">
                    {s.venue.name}
                  </Link>
                  <button onClick={() => onSwap(i)} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-extrabold text-night-300 hover:text-white hover:bg-white/10" title="Pick another spot for this stop">
                    <RefreshCw className="w-3.5 h-3.5" /> Swap
                  </button>
                </div>
                <p className="text-xs font-semibold text-night-300 truncate">
                  {[s.venue.categories.slice(0, 2).join(' · '), s.venue.area].filter(Boolean).join(' — ')}
                </p>
                <p className="mt-1 inline-flex items-center gap-1 text-sm font-extrabold text-glow-200">
                  <Clock className="w-3.5 h-3.5" /> {formatClock(s.arrive)} – {formatClock(s.leave)}
                </p>
                {(s.event || s.reasons.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {s.reasons.map((r) => (
                      <span
                        key={r}
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md ${
                          s.event?.title === r ? 'bg-brand-500/20 text-brand-100 border border-brand-400/30' : 'bg-white/5 text-night-200 border border-white/10'
                        }`}
                      >
                        {s.event?.title === r && <CalendarHeart className="w-3 h-3" />}
                        {r}
                      </span>
                    ))}
                  </div>
                )}
                {s.warning && <p className="mt-1.5 text-xs font-bold text-amber-300">{s.warning}</p>}
                {party >= 8 && s.venue.phone && (
                  <a href={`tel:${s.venue.phone.replace(/[^\d+]/g, '')}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-extrabold text-emerald-300">
                    <Phone className="w-3.5 h-3.5" /> Big group: call ahead
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const stopIcon = (n: number) =>
  L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:9999px;background:var(--color-brand-500);color:#fff;font-weight:900;font-size:14px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 0 14px var(--color-brand-500)">${n}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

const youIcon = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:9999px;background:var(--color-glow-400);border:3px solid #fff;box-shadow:0 0 12px var(--color-glow-400)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join(';');
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 16);
    else map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 17 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Numbered stops joined by straight lines: dashed for walks, solid for taxis (no street routing yet). */
function CrawlMap({ plan, origin }: { plan: CrawlPlan; origin: { lat: number; lng: number } | null }) {
  const pts = plan.stops.map((s) => [s.venue.lat!, s.venue.lng!] as [number, number]);
  const all = origin ? [[origin.lat, origin.lng] as [number, number], ...pts] : pts;
  return (
    <div className="h-64 md:h-80 border-b border-white/10 isolate">
      <MapContainer center={pts[0]} zoom={15} className="w-full h-full" scrollWheelZoom={false} attributionControl>
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} crossOrigin />
        <FitBounds points={all} />
        {plan.stops.map((s, i) => {
          const from = i === 0 ? (origin ? [origin.lat, origin.lng] : null) : pts[i - 1];
          if (!from || !s.legIn) return null;
          const walk = s.legIn.mode === 'walk';
          return (
            <Polyline
              key={`leg-${s.venue.id}`}
              positions={[from as [number, number], pts[i]]}
              pathOptions={{ color: walk ? '#22d3ee' : '#fcd34d', weight: 4, opacity: 0.85, dashArray: walk ? '6 8' : undefined }}
            />
          );
        })}
        {origin && <Marker position={[origin.lat, origin.lng]} icon={youIcon} />}
        {plan.stops.map((s, i) => (
          <Marker key={s.venue.id} position={pts[i]} icon={stopIcon(i + 1)} title={s.venue.name} />
        ))}
      </MapContainer>
    </div>
  );
}
