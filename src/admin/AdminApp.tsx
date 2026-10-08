import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Link } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Activity, CalendarHeart, ExternalLink, Inbox as InboxIcon, ListChecks, LogOut, Palette, Plus, Star, Tags, Martini } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { SetupNotice } from '@/components/SetupNotice';
import { Spinner } from '@/components/ui';
import { Button, FeedbackProvider, inputClass } from './ui';
import VenuesList from './VenuesList';
import QuickAdd from './QuickAdd';
import VenueEditor from './VenueEditor';
import Inbox from './Inbox';
import TagsManager from './TagsManager';
import ReviewsModeration from './ReviewsModeration';
import ThemeSettings from './ThemeSettings';
import EventsList from './EventsList';
import EventEditor from './EventEditor';
import ActivityAdmin from './ActivityAdmin';

// The public site is dark; the console is a light, functional tool.
const LIGHT = { colorScheme: 'light' } as const;

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  };

  return (
    <div style={LIGHT} className="min-h-dvh flex items-center justify-center p-4 bg-slate-100">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-7 space-y-4">
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-glow-500 flex items-center justify-center">
            <Martini className="w-5 h-5 text-white" />
          </span>
          <div>
            <p className="font-display font-black text-lg text-slate-900 leading-none">Nassau Nights</p>
            <p className="text-xs font-bold text-slate-500">Admin console</p>
          </div>
        </div>
        <input className={inputClass} type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={inputClass} type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
        <Button type="submit" loading={busy} className="w-full py-3">
          Sign in
        </Button>
      </form>
    </div>
  );
}

function NotAdmin({ email }: { email?: string }) {
  return (
    <div style={LIGHT} className="min-h-dvh flex items-center justify-center p-4 bg-slate-100">
      <div className="max-w-md bg-white rounded-3xl shadow-xl p-7">
        <h1 className="text-xl font-extrabold text-slate-900">This account isn’t an admin yet</h1>
        <p className="mt-2 text-sm text-slate-600 font-semibold">
          Signed in as <b>{email}</b>. To grant access, run this in the Supabase SQL editor:
        </p>
        <pre className="mt-3 p-3 rounded-xl bg-slate-900 text-emerald-300 text-xs overflow-x-auto">
          {`insert into public.admins (user_id)\nselect id from auth.users\nwhere email = '${email ?? 'you@example.com'}';`}
        </pre>
        <Button variant="secondary" className="mt-4" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

// `phone`: in the 5-slot bottom bar; the rest sit as icons in the phone header.
const NAV = [
  { to: '/admin', label: 'Spots', icon: ListChecks, end: true, phone: true },
  { to: '/admin/events', label: 'Events', icon: CalendarHeart, end: false, phone: true },
  { to: '/admin/new', label: 'Quick add', icon: Plus, end: false, phone: true },
  { to: '/admin/inbox', label: 'Inbox', icon: InboxIcon, end: false, phone: true },
  { to: '/admin/activity', label: 'Activity', icon: Activity, end: false, phone: true },
  { to: '/admin/reviews', label: 'Reviews', icon: Star, end: false, phone: false },
  { to: '/admin/tags', label: 'Tags', icon: Tags, end: false, phone: false },
  { to: '/admin/theme', label: 'Theme', icon: Palette, end: false, phone: false },
];


function Shell({ session }: { session: Session }) {
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    const load = () =>
      supabase
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new')
        .then(({ count }) => setInboxCount(count ?? 0));
    load();
    const id = setInterval(load, 60_000);
    window.addEventListener('inbox-changed', load);
    return () => {
      clearInterval(id);
      window.removeEventListener('inbox-changed', load);
    };
  }, []);

  return (
    <div style={LIGHT} className="min-h-dvh bg-slate-100 text-slate-900 pb-[calc(68px+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-[1500] bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to="/admin" className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-glow-500 flex items-center justify-center shrink-0">
              <Martini className="w-4 h-4 text-white" />
            </span>
            <span className="font-display font-black truncate md:hidden xl:inline">Nassau Nights <span className="text-brand-400 font-bold">Admin</span></span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap ${isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:text-white'}`
                }
              >
                <Icon className="w-4 h-4" /> {label}
                {to === '/admin/inbox' && inboxCount > 0 && (
                  <span className="ml-0.5 px-1.5 rounded-full bg-amber-400 text-amber-950 text-[11px] font-black">{inboxCount}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1 shrink-0">
            {NAV.filter((n) => !n.phone).map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={label}
                className={({ isActive }) => `md:hidden p-2 rounded-lg ${isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
              >
                <Icon className="w-4 h-4" />
              </NavLink>
            ))}
            <a href="/" target="_blank" rel="noreferrer" className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10" title="Open public site">
              <ExternalLink className="w-4 h-4" />
            </a>
            <button onClick={() => supabase.auth.signOut()} className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10" title={`Sign out ${session.user.email}`}>
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3 md:px-4 py-4 md:py-6">
        <Routes>
          <Route index element={<VenuesList />} />
          <Route path="new" element={<QuickAdd />} />
          <Route path="v/:id" element={<VenueEditor />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="reviews" element={<ReviewsModeration />} />
          <Route path="tags" element={<TagsManager />} />
          <Route path="theme" element={<ThemeSettings />} />
          <Route path="events" element={<EventsList />} />
          <Route path="events/:id" element={<EventEditor />} />
          <Route path="activity" element={<ActivityAdmin />} />
        </Routes>
      </main>

      {/* Phone tab bar — the console is built to be used in the field. */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-[1500] bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="h-[68px] grid grid-cols-5">
          {NAV.filter((n) => n.phone).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center gap-1 text-[11px] font-extrabold ${isActive ? 'text-brand-600' : 'text-slate-400'}`
              }
            >
              {to === '/admin/new' ? (
                <span className="w-11 h-11 -mt-3 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-lg shadow-brand-600/30">
                  <Icon className="w-6 h-6" />
                </span>
              ) : (
                <Icon className="w-5 h-5" />
              )}
              {label}
              {to === '/admin/inbox' && inboxCount > 0 && (
                <span className="absolute top-2 left-1/2 ml-2 px-1.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-black">{inboxCount}</span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    document.title = 'Admin — Nassau Nights';
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setIsAdmin(null);
    if (!session) return;
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supabaseConfigured) return <SetupNotice />;
  if (session === undefined || (session && isAdmin === null)) {
    return (
      <div style={LIGHT} className="min-h-dvh flex items-center justify-center bg-slate-100">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }
  if (!session) return <Login />;
  if (!isAdmin) return <NotAdmin email={session.user.email} />;

  return (
    <FeedbackProvider>
      <Shell session={session} />
    </FeedbackProvider>
  );
}
