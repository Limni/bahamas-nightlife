import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useDirectory } from '@/lib/directory';

export function PageMetadata() {
  const { pathname } = useLocation();
  const { venues, events } = useDirectory();
  useEffect(() => {
    const venue = venues.find(v => pathname === `/v/${v.slug}`);
    const event = events.find(e => pathname === `/events/${e.id}`);
    const title = venue?.name || event?.title || ({ '/events': 'Events in Nassau', '/night': 'My night out', '/community': 'Community', '/account': 'Your account', '/map': 'Nassau nightlife map' } as Record<string,string>)[pathname] || 'Bars, clubs & events in Nassau';
    const description = venue?.description || event?.description || (venue ? `${venue.name}: ${venue.categories.join(', ')} in ${venue.area || 'Nassau'}. Hours, menus and directions.` : 'Find bars, clubs, beach bars and events in Nassau, Bahamas. Save your favorites and plan a night out.');
    const url = `https://nassaunights.com${pathname === '/' ? '/' : pathname.replace(/\/$/, '')}`;
    const candidateImage = venue?.cover_url || event?.image_url;
    const image = /^https:\/\//i.test(candidateImage || '') ? candidateImage! : 'https://nassaunights.com/icons/icon-512.png';
    const eventVenue = venues.find(v => v.id === event?.venue_id);
    const weekly = event?.hours && Object.keys(event.hours).length > 0;
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    document.title = `${title} — Nassau Nights`;
    const meta = (key: string, content: string) => {
      const attr = key.startsWith('og:') ? 'property' : 'name';
      let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!tag) { tag = document.createElement('meta'); tag.setAttribute(attr, key); document.head.append(tag); }
      tag.content = content;
    };
    meta('description', description.slice(0, 200));
    meta('og:title', document.title); meta('og:description', description.slice(0, 200));
    meta('og:image', image); meta('og:url', url); meta('og:type', 'website');
    meta('twitter:card', 'summary_large_image'); meta('twitter:title', document.title); meta('twitter:description', description.slice(0,200)); meta('twitter:image', image);
    meta('robots', ['/account', '/night'].includes(pathname) ? 'noindex,follow' : 'index,follow');
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
    canonical.href = url;
    // A prerendered detail's structured data must not linger after client navigation.
    document.querySelector('script[data-page-schema]')?.remove();
    if (venue || event) {
      const tag = document.createElement('script'); tag.type = 'application/ld+json'; tag.dataset.pageSchema = '';
      tag.textContent = JSON.stringify(venue ? { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: venue.name, url, image, description, address: venue.address || venue.area || 'Nassau, Bahamas' } : { '@context': 'https://schema.org', '@type': weekly ? 'EventSeries' : 'Event', name: event!.title, url, image, description, ...(weekly ? { eventSchedule: Object.entries(event!.hours!).map(([day, hours]) => ({ '@type':'Schedule', repeatFrequency:'P1W', byDay:`https://schema.org/${days[+day]}`, startTime:hours.open, endTime:hours.close, scheduleTimezone:'America/Nassau' })) } : { startDate: event!.start_date, endDate: event!.end_date }), location: { '@type':'Place', name:eventVenue?.name || event!.address || 'Nassau', address:event!.address || eventVenue?.address || eventVenue?.area || 'Nassau, Bahamas' } });
      document.head.append(tag);
    }
  }, [pathname, venues, events]);
  return null;
}
