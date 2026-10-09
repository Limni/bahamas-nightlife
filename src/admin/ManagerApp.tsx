import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { CalendarHeart, CalendarPlus, ExternalLink, Martini, Pencil, Store, UserRound, UtensilsCrossed } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDirectory } from '@/lib/directory';
import { useActivity } from '@/lib/activity';
import type { Venue } from '@/lib/types';
import { SetupNotice } from '@/components/SetupNotice';
import { SafeImg, Spinner } from '@/components/ui';
import { FeedbackProvider } from './ui';
import { ConsoleProvider, type ConsoleScope } from './console';
import VenueEditor from './VenueEditor';
import EventsList from './EventsList';
import EventEditor from './EventEditor';

// "/manage": the venue manager section. A member an admin has assigned to one
// or more venues edits them here with the same editors as the admin console,
// scoped to their venues and without the admin-only controls. Lazy-loaded
// like /admin, so none of this ships to ordinary visitors.

const LIGHT = { colorScheme: 'light' } as const;

const NAV = [
  { to: '/manage', label: 'My venues', icon: Store, end: true },
  { to: '/manage/events', label: 'Events', icon: CalendarHeart, end: false },
];

export default function ManagerApp() {
  const { session, loading } = useAuth();
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('venue_managers').select('venues(*)').eq('user_id', userId);
    const list = ((data ?? []) as unknown as { venues: Venue | null }[]).map((r) => r.venues).filter((v): v is Venue => !!v);
    setVenues(list.sort((a, b) => a.name.localeCompare(b.name)));
  }, [userId]);

  useEffect(() => {
    document.title = 'Venue manager — Nassau Nights';
    load();
  }, [load]);

  const venueIds = useMemo(() => (venues ?? []).map((v) => v.id), [venues]);
  const scope = useMemo<ConsoleScope>(
    () => ({ role: 'manager', base: '/manage', venueIds, venuePath: (id) => `/manage/v/${id}` }),
    [venueIds],
  );

  if (!supabaseConfigured) return <SetupNotice />;
  if (!loading && !session) return <Navigate to="/account?next=/manage" replace />;
  if (loading || venues === null) {
    return (
      <div style={LIGHT} className="min-h-dvh flex items-center justify-center bg-slate-100">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <FeedbackProvider>
      <ConsoleProvider value={scope}>
        <div style={LIGHT} className="min-h-dvh bg-slate-100 text-slate-900 pb-[calc(68px+env(safe-area-inset-bottom))] md:pb-0">
          <header className="sticky top-0 z-[1500] bg-slate-900 text-white">
            <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
              <Link to="/manage" className="flex items-center gap-2 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-glow-500 flex items-center justify-center shrink-0">
                  <Martini className="w-4 h-4 text-white" />
                </span>
                <span className="font-display font-black truncate">
                  Venue <span className="text-brand-400 font-bold">manager</span>
                </span>
              </Link>
              <nav className="hidden md:flex items-center gap-1">
                {NAV.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-bold ${isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:text-white'}`
                    }
                  >
                    <Icon className="w-4 h-4" /> {label}
                  </NavLink>
                ))}
              </nav>
              <div className="flex items-center gap-1 shrink-0">
                <a href="/" target="_blank" rel="noreferrer" className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10" title="Open the public site">
                  <ExternalLink className="w-4 h-4" />
                </a>
                <Link to="/account" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-bold text-slate-300 hover:text-white hover:bg-white/10" title="Back to your account">
                  <UserRound className="w-4 h-4" /> <span className="hidden sm:inline">Account</span>
                </Link>
              </div>
            </div>
          </header>

          <main className="max-w-5xl mx-auto px-3 md:px-4 py-4 md:py-6">
            {venues.length === 0 ? (
              <NoVenues />
            ) : (
              <Routes>
                <Route index element={<MyVenues venues={venues} reload={load} />} />
                <Route path="v/:id" element={<OwnVenue ids={venueIds} />} />
                <Route path="events" element={<EventsList />} />
                <Route path="events/:id" element={<EventEditor />} />
                <Route path="*" element={<Navigate to="/manage" replace />} />
              </Routes>
            )}
          </main>

          <nav className="md:hidden fixed bottom-0 inset-x-0 z-[1500] bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
            <div className="h-[68px] grid grid-cols-3">
              {[...NAV, { to: '/account', label: 'Account', icon: UserRound, end: true }].map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => `flex flex-col items-center justify-center gap-1 text-[11px] font-extrabold ${isActive ? 'text-brand-600' : 'text-slate-400'}`}
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </ConsoleProvider>
    </FeedbackProvider>
  );
}

function NoVenues() {
  return (
    <div className="max-w-md mx-auto text-center py-16 bg-white rounded-3xl border border-slate-200 px-6">
      <Store className="w-10 h-10 mx-auto text-slate-300" />
      <h1 className="mt-3 text-xl font-black text-slate-900">No venues to manage yet</h1>
      <p className="mt-2 text-sm font-semibold text-slate-500">
        Own or run a spot on Nassau Nights? Ask the team to add you as its manager, and it’ll show up here.
      </p>
      <Link to="/community?kind=other" className="mt-5 inline-flex px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-extrabold hover:bg-brand-700">
        Contact the team
      </Link>
    </div>
  );
}

/** Only the member's own venues open in the editor. */
function OwnVenue({ ids }: { ids: string[] }) {
  const { id } = useParams();
  if (!id || !ids.includes(id)) {
    return (
      <div className="text-center py-16">
        <p className="font-extrabold text-slate-700">That isn’t one of your venues.</p>
        <Link to="/manage" className="text-brand-600 font-bold">Back to my venues</Link>
      </div>
    );
  }
  return <VenueEditor />;
}

function MyVenues({ venues, reload }: { venues: Venue[]; reload: () => void }) {
  const { ratings, events } = useDirectory();
  const { heatOf } = useActivity();
  // Pick up name/cover changes made in the editor.
  useEffect(() => {
    reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">My venues</h1>
        <p className="text-sm font-semibold text-slate-500">
          Keep your listing fresh: details, hours, photos, drinks and food menus, and your events. Changes go live as soon as you save.
        </p>
      </div>
      <ul className="space-y-3">
        {venues.map((v) => {
          const rating = ratings[v.id];
          const heat = heatOf(v.id);
          const upcoming = events.filter((e) => e.venue_id === v.id).length;
          return (
            <li key={v.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="flex gap-4 p-4">
                <div className="w-24 h-24 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                  <SafeImg src={v.cover_url} name={v.name} className="w-full h-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black text-slate-900 truncate">{v.name}</h2>
                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold uppercase ${v.is_published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                      {v.is_published ? 'Live' : 'Draft'}
                    </span>
                  </div>
                  {v.area && <p className="text-sm font-semibold text-slate-500 truncate">{v.area}</p>}
                  <p className="mt-1 text-xs font-bold text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                    <span>{rating?.rating_count ? `★ ${rating.rating_avg.toFixed(1)} · ${rating.rating_count} reviews` : 'No reviews yet'}</span>
                    {heat.level !== 'quiet' && <span style={{ color: heat.color }}>● {heat.label} now</span>}
                    <span>{upcoming ? `${upcoming} upcoming event${upcoming === 1 ? '' : 's'}` : 'No upcoming events'}</span>
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-slate-100 text-sm font-extrabold">
                <Link to={`/manage/v/${v.id}`} className="flex items-center justify-center gap-1.5 py-3 text-brand-700 hover:bg-brand-50">
                  <Pencil className="w-4 h-4" /> Edit details
                </Link>
                <Link to={`/manage/v/${v.id}#menu`} className="flex items-center justify-center gap-1.5 py-3 text-slate-700 hover:bg-slate-50 border-l border-slate-100">
                  <UtensilsCrossed className="w-4 h-4" /> Menus
                </Link>
                <Link to={`/manage/events/new?venue=${v.id}`} className="flex items-center justify-center gap-1.5 py-3 text-slate-700 hover:bg-slate-50 border-t sm:border-t-0 sm:border-l border-slate-100">
                  <CalendarPlus className="w-4 h-4" /> New event
                </Link>
                <a href={`/v/${v.slug}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 py-3 text-slate-700 hover:bg-slate-50 border-t sm:border-t-0 border-l border-slate-100">
                  <ExternalLink className="w-4 h-4" /> View page
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs font-semibold text-slate-400">
        Reviews and likes come from visitors, so they can’t be changed here. To publish a draft, take a listing down or ask about featured placement,
        contact the Nassau Nights team.
      </p>
    </div>
  );
}
