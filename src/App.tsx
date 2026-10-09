import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DirectoryProvider, LocationProvider } from '@/lib/directory';
import { ActivityProvider } from '@/lib/activity';
import { FiltersProvider } from '@/lib/filters';
import { AuthProvider } from '@/lib/auth';
import { ThemeProvider } from '@/lib/theme';
import { Layout } from '@/components/Layout';
import { Spinner } from '@/components/ui';
import Explore from '@/pages/Explore';

// Leaflet-heavy pages and the admin console load on demand, so the first
// paint of the directory stays light. Admin code never ships to visitors
// unless they open /admin.
const MapPage = lazy(() => import('@/pages/MapPage'));
const VenuePage = lazy(() => import('@/pages/VenuePage'));
const EventsPage = lazy(() => import('@/pages/EventsPage'));
const EventPage = lazy(() => import('@/pages/EventPage'));
const Community = lazy(() => import('@/pages/Community'));
const Account = lazy(() => import('@/pages/Account'));
const AdminApp = lazy(() => import('@/admin/AdminApp'));
const ManagerApp = lazy(() => import('@/admin/ManagerApp'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

const Fallback = () => (
  <div className="flex-1 flex items-center justify-center py-24">
    <Spinner className="w-8 h-8" />
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <ThemeProvider>
      <AuthProvider>
      <DirectoryProvider>
        <LocationProvider>
          <ActivityProvider>
          <FiltersProvider>
            <Suspense fallback={<Fallback />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Explore />} />
                  <Route path="map" element={<MapPage />} />
                  <Route path="v/:slug" element={<VenuePage />} />
                  <Route path="events" element={<EventsPage />} />
                  <Route path="events/:id" element={<EventPage />} />
                  <Route path="community" element={<Community />} />
                  <Route path="account" element={<Account />} />
                </Route>
                <Route path="admin/*" element={<AdminApp />} />
                <Route path="manage/*" element={<ManagerApp />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </FiltersProvider>
          </ActivityProvider>
        </LocationProvider>
      </DirectoryProvider>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
