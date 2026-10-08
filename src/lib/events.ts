// Event timing + placement helpers. Timing follows Island GO's events: an
// event is live while now is inside start..end AND inside today's weekly
// window (when it has one), all in Bahamas time via lib/hours.

import { dayLabel, formatTime, hasHours, openState, todayIndex } from './hours';
import type { NightEvent, Venue } from './types';

const DAY_MS = 86_400_000;

/** The event's whole run has finished. */
export function isEventEnded(e: Pick<NightEvent, 'end_date'>, now = Date.now()) {
  return now > new Date(e.end_date).getTime();
}

export function isEventInDateRange(e: Pick<NightEvent, 'start_date' | 'end_date'>, now = Date.now()) {
  return now >= new Date(e.start_date).getTime() && now <= new Date(e.end_date).getTime();
}

/** Live = within the date range AND within today's hours (true when no hours are set). */
export function isEventLive(e: Pick<NightEvent, 'start_date' | 'end_date' | 'hours'>, now = Date.now()) {
  if (!isEventInDateRange(e, now)) return false;
  return !hasHours(e.hours) || openState(e.hours, now).kind === 'open';
}

/** Starts (or has a session) within the next `hours` hours — "tonight". */
export function isEventSoon(e: NightEvent, now = Date.now(), hours = 18) {
  if (isEventEnded(e, now)) return false;
  if (isEventLive(e, now)) return true;
  const start = new Date(e.start_date).getTime();
  if (start > now) return start - now <= hours * 3600_000;
  // A multi-day run that's between sessions: does today's window open later?
  if (!hasHours(e.hours)) return false;
  const s = openState(e.hours, now);
  return s.kind === 'closed' && s.opensDay === todayIndex(now);
}

/** Where the event is: its own pin, else its venue's. */
export function eventPosition(e: NightEvent, venue: Venue | undefined): { lat: number; lng: number } | null {
  if (typeof e.lat === 'number' && typeof e.lng === 'number') return { lat: e.lat, lng: e.lng };
  if (venue && typeof venue.lat === 'number' && typeof venue.lng === 'number') return { lat: venue.lat, lng: venue.lng };
  return null;
}

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Nassau', ...opts }).format(d);

const nassauDay = (t: number) => fmt(new Date(t), { year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Human "when" for cards: "Live now · until 2 AM", "Tonight · 10 PM",
 * "Sat, Oct 12 · 9 PM", "Oct 10 – Oct 20".
 */
export function eventWhen(e: NightEvent, now = Date.now()): string {
  const start = new Date(e.start_date);
  const end = new Date(e.end_date);
  const multiDay = end.getTime() - start.getTime() > DAY_MS;
  const time = (d: Date) => fmt(d, { hour: 'numeric', minute: '2-digit' }).replace(':00', '');

  if (isEventLive(e, now)) {
    if (hasHours(e.hours)) {
      const s = openState(e.hours, now);
      if (s.kind === 'open') return `Live now · until ${formatTime(s.closesAt)}`;
    }
    return multiDay ? `Live now · until ${fmt(end, { month: 'short', day: 'numeric' })}` : `Live now · until ${time(end)}`;
  }

  if (multiDay) {
    const range = `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric' })}`;
    if (hasHours(e.hours) && start.getTime() <= now) {
      const today = e.hours[String(todayIndex(now))];
      return today ? `Tonight ${dayLabel(today)} · runs ${range}` : `Runs ${range}`;
    }
    return range;
  }

  const startT = start.getTime();
  const today = nassauDay(now);
  if (nassauDay(startT) === today) return `Tonight · ${time(start)}`;
  if (nassauDay(startT) === nassauDay(now + DAY_MS)) return `Tomorrow · ${time(start)}`;
  if (startT - now < 6 * DAY_MS) return `${fmt(start, { weekday: 'long' })} · ${time(start)}`;
  return `${fmt(start, { weekday: 'short', month: 'short', day: 'numeric' })} · ${time(start)}`;
}

/** Sort key: live first, then featured, then soonest start. */
export function compareEvents(now = Date.now()) {
  return (a: NightEvent, b: NightEvent) =>
    Number(isEventLive(b, now)) - Number(isEventLive(a, now)) ||
    Number(b.is_featured) - Number(a.is_featured) ||
    new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
}
