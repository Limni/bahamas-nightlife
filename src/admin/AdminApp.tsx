import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import {
  Activity,
  CalendarHeart,
  ChevronDown,
  Coins,
  ExternalLink,
  Inbox as InboxIcon,
  ListChecks,
  LogOut,
  Martini,
  Menu,
  Palette,
  Plus,
  Radio,
  Star,
  Tags,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
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
import RadioAdmin from './RadioAdmin';
import PointsAdmin from './PointsAdmin';
import EventsList from './EventsList';
import EventEditor from './EventEditor';
import ActivityAdmin from './ActivityAdmin';
import UsersAdmin from './UsersAdmin';
import { ADMIN_SCOPE, ConsoleProvider, EDITOR_SCOPE } from './console';

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
        <h1 className="text-xl font-extrabold text-slate-900">This account doesn’t have console access</h1>
        <p className="mt-2 text-sm text-slate-600 font-semibold">
          Signed in as <b>{email}</b>. An admin can make you an editor (spots only) or an admin under Members. To make the first admin, run
          this in the Supabase SQL editor:
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

type NavItem = { to: string; label: string; icon: LucideIcon; hint: string };

const ITEMS = {
  spots: { to: '/admin', label: 'Spots', icon: ListChecks, hint: 'All listings, drafts and gaps' },
  quick: { to: '/admin/new', label: 'Quick add', icon: Plus, hint: 'Capture a new spot in the field' },
  events: { to: '/admin/events', label: 'Events', icon: CalendarHeart, hint: 'One-off and weekly nights' },
  tags: { to: '/admin/tags', label: 'Tags', icon: Tags, hint: 'Venue types, vibes and areas' },
  inbox: { to: '/admin/inbox', label: 'Inbox', icon: InboxIcon, hint: 'Community suggestions' },
  reviews: { to: '/admin/reviews', label: 'Reviews', icon: Star, hint: 'Hide or delete member reviews' },
  users: { to: '/admin/users', label: 'Members', icon: Users, hint: 'Accounts, roles and invites' },
  activity: { to: '/admin/activity', label: 'Activity', icon: Activity, hint: 'Live crowds and visits' },
  points: { to: '/admin/points', label: 'Points & rewards', icon: Coins, hint: 'Amounts, partners, redemptions' },
  theme: { to: '/admin/theme', label: 'Theme', icon: Palette, hint: 'The public site’s look' },
  radio: { to: '/admin/radio', label: 'Radio', icon: Radio, hint: 'Player and stations' },
} satisfies Record<string, NavItem>;

// Eleven sections no longer fit side by side, so admins get four menus.
const GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  { id: 'listings', label: 'Listings', items: [ITEMS.spots, ITEMS.quick, ITEMS.events, ITEMS.tags] },
  { id: 'community', label: 'Community', items: [ITEMS.inbox, ITEMS.reviews, ITEMS.users] },
  { id: 'engagement', label: 'Engagement', items: [ITEMS.activity, ITEMS.points] },
  { id: 'site', label: 'Site', items: [ITEMS.theme, ITEMS.radio] },
];

// Editors get only the spots, as plain links.
const EDITOR_NAV = [ITEMS.spots, ITEMS.quick];
// The phone's 5-slot bottom bar; everything else is under Menu in the header.
const PHONE_TABS = [ITEMS.spots, ITEMS.events, ITEMS.quick, ITEMS.inbox, ITEMS.activity];

// Spots also covers the spot editor (/admin/v/:id), which sits outside its path.
function isActive(to: string, path: string) {
  if (to === '/admin') return path === '/admin' || path === '/admin/' || path.startsWith('/admin/v/');
  return path === to || path.startsWith(to + '/');
}

function Badge({ n, small }: { n: number; small?: boolean }) {
  if (n <= 0) return null;
  return <span className={`px-1.5 rounded-full bg-amber-400 text-amber-950 font-black ${small ? 'text-[10px]' : 'text-[11px]'}`}>{n}</span>;
}

/** One menu row: icon, label and a hint line, plus the inbox count. */
function MenuItem({ item, path, inboxCount }: { item: NavItem; path: string; inboxCount: number }) {
  const on = isActive(item.to, path);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={on ? 'page' : undefined}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${on ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`}
    >
      <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
        <Icon className="w-[18px] h-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-extrabold">
          {item.label}
          {item.to === ITEMS.inbox.to && <Badge n={inboxCount} />}
        </span>
        <span className="block text-xs font-semibold text-slate-500 truncate">{item.hint}</span>
      </span>
    </Link>
  );
}

function Shell({ session, role }: { session: Session; role: 'admin' | 'editor' }) {
  const [inboxCount, setInboxCount] = useState(0);
  // The open desktop menu (a group id), or 'phone' for the phone menu.
  const [open, setOpen] = useState<string | null>(null);
  const { pathname } = useLocation();
  const editor = role === 'editor';
  const tabs = editor ? PHONE_TABS.filter((t) => EDITOR_NAV.includes(t)) : PHONE_TABS;

  useEffect(() => {
    if (editor) return;
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
  }, [editor]);

  // Picking a section (or the back button) closes any open menu.
  useEffect(() => {
    setOpen(null);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const current = GROUPS.flatMap((g) => g.items).find((i) => isActive(i.to, pathname));

  return (
    <div style={LIGHT} className="min-h-dvh bg-slate-100 text-slate-900 pb-[calc(68px+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-[1500] bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to="/admin" className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-glow-500 flex items-center justify-center shrink-0">
              <Martini className="w-4 h-4 text-white" />
            </span>
            <span className="font-display font-black truncate md:hidden lg:inline">
              {/* Narrow phones keep just "Admin" so the Menu button fits beside it. */}
              <span className="hidden min-[440px]:inline lg:inline">Nassau Nights </span>
              <span className="text-brand-400 font-bold">{editor ? 'Editor' : 'Admin'}</span>
            </span>
          </Link>
          {editor ? (
            <nav className="hidden md:flex items-center gap-1">
              {EDITOR_NAV.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap ${isActive(to, pathname) ? 'bg-white/15 text-white' : 'text-slate-300 hover:text-white'}`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </Link>
              ))}
            </nav>
          ) : (
            <nav className="hidden md:flex items-center gap-1" aria-label="Console sections">
              {GROUPS.map((g) => {
                const here = g.items.some((i) => isActive(i.to, pathname));
                const isOpen = open === g.id;
                const count = g.items.includes(ITEMS.inbox) ? inboxCount : 0;
                return (
                  <div key={g.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : g.id)}
                      aria-expanded={isOpen}
                      aria-haspopup="true"
                      className={`relative z-[2] flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap ${
                        here || isOpen ? 'bg-white/15 text-white' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {g.label}
                      {here && current && <span className="hidden xl:inline font-semibold text-slate-300">· {current.label}</span>}
                      <Badge n={count} />
                      <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="absolute left-0 top-full mt-2 z-[2] w-72 p-1.5 rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl text-slate-900">
                        {g.items.map((item) => (
                          <MenuItem key={item.to} item={item} path={pathname} inboxCount={inboxCount} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          )}
          <div className="flex items-center gap-1 shrink-0">
            {!editor && (
              <button
                type="button"
                onClick={() => setOpen(open === 'phone' ? null : 'phone')}
                aria-expanded={open === 'phone'}
                aria-haspopup="true"
                className={`md:hidden flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-lg text-sm font-bold ${open === 'phone' ? 'bg-white/15 text-white' : 'text-slate-200 hover:bg-white/10'}`}
              >
                {open === 'phone' ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />} Menu
              </button>
            )}
            <a href="/" target="_blank" rel="noreferrer" className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10" title="Open public site">
              <ExternalLink className="w-4 h-4" />
            </a>
            <button onClick={() => supabase.auth.signOut()} className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10" title={`Sign out ${session.user.email}`}>
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* An invisible layer under the open menu, so a click anywhere else closes it. Inside the header, so it
            stacks above the page but below the menu buttons (z-[2]). */}
        {open && open !== 'phone' && <div className="fixed inset-0 z-[1]" onClick={() => setOpen(null)} />}
      </header>

      {/* Phones: every section, grouped, dropping down under the header (above the bottom bar). */}
      {open === 'phone' && (
        <div className="md:hidden fixed inset-0 top-14 z-[1600]" role="dialog" aria-label="Console sections">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(null)} />
          <div className="relative max-h-full overflow-y-auto bg-white rounded-b-3xl shadow-2xl px-2 pt-2 pb-4">
            {GROUPS.map((g) => (
              <section key={g.id} className="pt-2">
                <p className="px-3 pb-1 text-[11px] font-black uppercase tracking-wider text-slate-400">{g.label}</p>
                <div className="grid grid-cols-1 min-[420px]:grid-cols-2">
                  {g.items.map((item) => (
                    <MenuItem key={item.to} item={item} path={pathname} inboxCount={inboxCount} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-3 md:px-4 py-4 md:py-6">
        {editor ? (
          <Routes>
            <Route index element={<VenuesList />} />
            <Route path="new" element={<QuickAdd />} />
            <Route path="v/:id" element={<VenueEditor />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        ) : (
        <Routes>
          <Route index element={<VenuesList />} />
          <Route path="new" element={<QuickAdd />} />
          <Route path="v/:id" element={<VenueEditor />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="reviews" element={<ReviewsModeration />} />
          <Route path="tags" element={<TagsManager />} />
          <Route path="theme" element={<ThemeSettings />} />
          <Route path="radio" element={<RadioAdmin />} />
          <Route path="points" element={<PointsAdmin />} />
          <Route path="events" element={<EventsList />} />
          <Route path="events/:id" element={<EventEditor />} />
          <Route path="activity" element={<ActivityAdmin />} />
          <Route path="users" element={<UsersAdmin meId={session.user.id} />} />
        </Routes>
        )}
      </main>

      {/* Phone tab bar — the console is built to be used in the field. */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-[1500] bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className={`h-[68px] grid ${editor ? 'grid-cols-2' : 'grid-cols-5'}`}>
          {tabs.map(({ to, label, icon: Icon }) => {
            const on = isActive(to, pathname);
            return (
              <Link
                key={to}
                to={to}
                aria-current={on ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-extrabold ${on ? 'text-brand-600' : 'text-slate-400'}`}
              >
                {to === ITEMS.quick.to ? (
                  <span className="w-11 h-11 -mt-3 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-lg shadow-brand-600/30">
                    <Icon className="w-6 h-6" />
                  </span>
                ) : (
                  <Icon className="w-5 h-5" />
                )}
                {label}
                {to === ITEMS.inbox.to && inboxCount > 0 && (
                  <span className="absolute top-2 left-1/2 ml-2">
                    <Badge n={inboxCount} small />
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // null while checking; 'none' = signed in without console access.
  const [role, setRole] = useState<'admin' | 'editor' | 'none' | null>(null);

  useEffect(() => {
    document.title = 'Admin — Nassau Nights';
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setRole(null);
    if (!session) return;
    Promise.all([supabase.rpc('is_admin'), supabase.rpc('is_editor')]).then(([a, e]) =>
      setRole(a.data === true ? 'admin' : e.data === true ? 'editor' : 'none'),
    );
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supabaseConfigured) return <SetupNotice />;
  if (session === undefined || (session && role === null)) {
    return (
      <div style={LIGHT} className="min-h-dvh flex items-center justify-center bg-slate-100">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }
  if (!session) return <Login />;
  if (role !== 'admin' && role !== 'editor') return <NotAdmin email={session.user.email} />;

  return (
    <FeedbackProvider>
      <ConsoleProvider value={role === 'editor' ? EDITOR_SCOPE : ADMIN_SCOPE}>
        <Shell session={session} role={role} />
      </ConsoleProvider>
    </FeedbackProvider>
  );
}
