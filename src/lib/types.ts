import type { WeeklyHours } from './hours';

export interface Venue {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  categories: string[];
  vibes: string[];
  area: string | null;
  price_level: number | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  hours: WeeklyHours | null;
  hours_note: string | null;
  cover_url: string | null;
  /** Activity geofence around the pin, metres. */
  radius_m: number;
  is_published: boolean;
  is_featured: boolean;
  featured_until: string | null;
  google_place_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PhotoKind = 'gallery' | 'menu';

export interface Photo {
  id: string;
  venue_id: string;
  kind: PhotoKind;
  url: string;
  storage_path: string | null;
  caption: string | null;
  sort: number;
  created_at: string;
}

export interface MenuItem {
  id: string;
  venue_id: string;
  section: string;
  name: string;
  description: string | null;
  price: number | null;
  sort: number;
}

export type TagKind = 'category' | 'vibe' | 'area';

export interface Tag {
  id: string;
  kind: TagKind;
  label: string;
  sort: number;
}

export type SubmissionKind = 'new_spot' | 'update' | 'closed' | 'event' | 'other';
export type SubmissionStatus = 'new' | 'reviewing' | 'done' | 'dismissed';

export interface Submission {
  id: string;
  kind: SubmissionKind;
  venue_id: string | null;
  venue_name: string | null;
  fields: string[];
  message: string;
  contact_name: string | null;
  contact_email: string | null;
  credit_ok: boolean;
  photo_paths: string[];
  status: SubmissionStatus;
  admin_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

export const SUBMISSION_KIND_LABELS: Record<SubmissionKind, string> = {
  new_spot: 'New spot',
  update: 'Info update',
  closed: 'Closed / moved',
  event: 'Event tip',
  other: 'Other',
};

/** A featured flag only counts while its end date (if any) is in the future. */
export function isFeatured(r: Pick<Venue, 'is_featured' | 'featured_until'>, now = Date.now()) {
  if (!r.is_featured) return false;
  return !r.featured_until || new Date(r.featured_until).getTime() > now;
}

export const priceLabel = (level: number | null | undefined) => (level ? '$'.repeat(level) : '');

export const hasLocation = (r: Pick<Venue, 'lat' | 'lng'>): r is { lat: number; lng: number } =>
  typeof r.lat === 'number' && typeof r.lng === 'number';

export interface Profile {
  id: string;
  display_name: string;
  created_at: string;
}

export interface Review {
  id: string;
  venue_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
  profiles?: { display_name: string } | null;
}

export interface RatingSummary {
  rating_avg: number;
  rating_count: number;
}

/** A highlighted night (ported from Island GO's events). */
export interface NightEvent {
  id: string;
  title: string;
  description: string | null;
  /** Host venue; the event uses its pin unless it has its own lat/lng. */
  venue_id: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  start_date: string;
  /** Null = repeats every week (per `hours`) until an admin ends it. */
  end_date: string | null;
  /** Optional weekly windows inside the date range (same format as venue hours); set = a weekly/recurring event. */
  hours: WeeklyHours | null;
  image_url: string | null;
  image_path: string | null;
  price_note: string | null;
  ticket_url: string | null;
  is_published: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
}

/** One row of venue_activity(): live phones vs. the venue's usual. */
export interface VenueActivity {
  venue_id: string;
  /** Phones at the venue right now (0 when under 2, for privacy). */
  live_count: number;
  /** Average visitors for this weekday + hour over the last 8 weeks. */
  typical_now: number;
  /** The venue's busiest usual hour of the week (scale for "how full"). */
  peak_avg: number;
  visits_30d: number;
}
