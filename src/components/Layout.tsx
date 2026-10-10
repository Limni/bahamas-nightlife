import { PageMetadata } from './PageMetadata';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { CalendarHeart, Compass, Map as MapIcon, MessageSquareHeart, Sparkles, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ActivityConsentCard, HereBanner } from './ActivityConsent';

const TABS = [
  { to: '/', label: 'Explore', icon: Compass, end: true },
  { to: '/map', label: 'Map', icon: MapIcon, end: false },
  { to: '/events', label: 'Events', icon: CalendarHeart, end: false },
  { to: '/community', label: 'Community', icon: MessageSquareHeart, end: false },
  { to: '/account', label: 'Account', icon: UserRound, end: false },
];

/** Signed-in members see their initial instead of the generic account icon. */
function TabIcon({ to, Icon, className }: { to: string; Icon: typeof Compass; className: string }) {
  const { profile } = useAuth();
  if (to === '/account' && profile) {
    return (
      <span className={`${className} rounded-full bg-brand-500 text-white text-[11px] font-black flex items-center justify-center`}>
        {profile.display_name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return <Icon className={className} />;
}

function tabLabel(to: string, label: string, name?: string) {
  return to === '/account' && name ? name.split(' ')[0].slice(0, 12) : label;
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand-500 to-glow-500 flex items-center justify-center glow-brand">
        <Sparkles className="w-5 h-5 text-white" />
      </span>
      <span className="font-display font-extrabold text-[1.15rem] tracking-tight leading-none text-white">
        Nassau <span className="text-brand-300 neon-text">Nights</span>
      </span>
    </Link>
  );
}

/** Desktop: top bar. Phones: bottom tab bar (the map page sizes itself around both). */
export function Layout() {
  const { profile } = useAuth();
  return (
    <div className="min-h-dvh flex flex-col">
      <PageMetadata />
      <header className="hidden md:block sticky top-0 z-[1500] h-16 bg-night-950/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-6xl mx-auto h-full px-6 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-1">
            {TABS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-2 rounded-2xl font-bold text-sm transition-colors ${
                    isActive ? 'bg-brand-500 text-white glow-brand' : 'text-night-200 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                <TabIcon to={to} Icon={Icon} className="w-4 h-4" />
                {tabLabel(to, label, profile?.display_name)}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 flex flex-col pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </main>

      <HereBanner />
      <ActivityConsentCard />

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-[1500] bg-night-950/95 backdrop-blur-md border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
        <div className="h-16 grid grid-cols-5">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-extrabold transition-colors ${
                  isActive ? 'text-brand-300' : 'text-night-400'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`px-3.5 py-1 rounded-full transition-colors ${isActive ? 'bg-brand-500/15' : ''}`}>
                    <TabIcon to={to} Icon={Icon} className="w-5 h-5" />
                  </span>
                  {tabLabel(to, label, profile?.display_name)}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
