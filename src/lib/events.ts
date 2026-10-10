// Event timing + placement helpers. Timing follows Island GO's events: an
// event is live while now is inside start..end AND inside today's weekly
// window (when it has one), all in Bahamas time via lib/hours.
//
// Recurring nights ("Ladies Night every Friday") are events with weekly hours
// and usually no end_date. Sorting and "tonight" use the next session, not
// start_date, which for a long-running weekly night is months in the past.

import { DAY_NAMES, dayLabel, formatTime, hasHours, openState, todayIndex, type WeeklyHours } from './hours';
import { addDays, nassauDate, nassauInstant } from './nassauTime';
import type { NightEvent, Venue } from './types';

const DAY_MS = 86_400_000;
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

const endTime = (e: Pick<NightEvent, 'end_date'>) => (e.end_date ? new Date(e.end_date).getTime() : Infinity);

/** Weekly hours over a run longer than a day, or with no end: shown as "Every Fri". */
export function isRecurring(e: Pick<NightEvent, 'start_date' | 'end_date' | 'hours'>) {
  return hasHours(e.hours) && endTime(e) - new Date(e.start_date).getTime() > DAY_MS;
}

/** "Every Fri", "Every Fri & Sat", "Every night"; `long` spells the days out. */
export function recurrenceLabel(hours: WeeklyHours | null | undefined, long = false) {
  const days = MON_FIRST.filter((d) => hours?.[String(d)]);
  if (days.length === 7) return 'Every night';
  const names = days.map((d) => (long ? DAY_NAMES[d] : DAY_NAMES[d].slice(0, 3)));
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  return `Every ${list}`;
}

/** The event's whole run has finished. */
export function isEventEnded(e: Pick<NightEvent, 'end_date'>, now = Date.now()) {
  return now > endTime(e);
}

export function isEventInDateRange(e: Pick<NightEvent, 'start_date' | 'end_date'>, now = Date.now()) {
  return now >= new Date(e.start_date).getTime() && now <= endTime(e);
}

/** Live = within the date range AND within today's hours (true when no hours are set). */
export function isEventLive(e: Pick<NightEvent, 'start_date' | 'end_date' | 'hours'>, now = Date.now()) {
  if (!isEventInDateRange(e, now)) return false;
  return !hasHours(e.hours) || openState(e.hours, now).kind === 'open';
}

/**
 * The next session: `at` is when it starts (now, if live) and `opensAt` the
 * 'HH:MM' it opens for weekly events (labels use it, so a DST change between
 * now and then can't shift the printed time). Null when no session is left.
 */
export function nextSession(e: NightEvent, now = Date.now()): { at: number; opensAt: string | null } | null {
  const start = new Date(e.start_date).getTime();
  const end = endTime(e);
  if (!hasHours(e.hours)) return now <= end ? { at: Math.max(start, now), opensAt: null } : null;
  const t = Math.max(now, start);
  if (t > end) return null;
  if (openState(e.hours, t).kind === 'open') return { at: t, opensAt: null };
  // Calendar days have 23/25 hours at DST boundaries; never add fixed day milliseconds.
  for (let days = 0; days <= 14; days++) {
    const date = addDays(nassauDate(t), days);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    const window = e.hours[String(day)];
    if (!window) continue;
    const at = nassauInstant(date, window.open);
    if (at !== null && at >= t && at <= end) return { at, opensAt: window.open };
  }
  return null;
}

/** When the next session starts (Infinity when none is left); the sort key for upcoming lists. */
export const eventNextStart = (e: NightEvent, now = Date.now()) => nextSession(e, now)?.at ?? Infinity;

/** Starts (or has a session) within the next `hours` hours — "tonight". */
export function isEventSoon(e: NightEvent, now = Date.now(), hours = 18) {
  if (isEventEnded(e, now)) return false;
  if (isEventLive(e, now)) return true;
  return eventNextStart(e, now) - now <= hours * 3600_000;
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
 * "Sat, Oct 12 · 9 PM", "Oct 10 – Oct 20", and for recurring nights
 * "Every Fri · 10 PM" / "Tonight · 10 PM · every Fri".
 */
export function eventWhen(e: NightEvent, now = Date.now()): string {
  const start = new Date(e.start_date);
  const end = e.end_date ? new Date(e.end_date) : null;
  const multiDay = !end || end.getTime() - start.getTime() > DAY_MS;
  const time = (d: Date) => fmt(d, { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  const date = (d: Date) => fmt(d, { month: 'short', day: 'numeric' });

  if (isEventLive(e, now)) {
    if (hasHours(e.hours)) {
      const s = openState(e.hours, now);
      if (s.kind === 'open') return `Live now · until ${formatTime(s.closesAt)}`;
    }
    if (!end) return 'Live now';
    return multiDay ? `Live now · until ${date(end)}` : `Live now · until ${time(end)}`;
  }

  const today = nassauDay(now);
  const tomorrow = nassauDay(Date.parse(`${addDays(nassauDate(now), 1)}T12:00:00Z`));

  if (isRecurring(e)) {
    const pattern = recurrenceLabel(e.hours);
    // A bounded run says when it stops; an open-ended one which nights it repeats.
    const tail = end ? `until ${date(new Date(end.getTime() - DAY_MS / 2))}` : pattern.replace('Every', 'every');
    const next = nextSession(e, now);
    if (!next) return end ? `${pattern} · ${tail}` : pattern;
    const at = next.opensAt ? formatTime(next.opensAt) : time(new Date(next.at));
    if (nassauDay(next.at) === today) return `Tonight · ${at} · ${tail}`;
    if (nassauDay(next.at) === tomorrow) return `Tomorrow · ${at} · ${tail}`;
    if (start.getTime() - now > 6 * DAY_MS) return `${pattern} from ${date(start)} · ${at}`;
    return end ? `${pattern} · ${at} · ${tail}` : `${pattern} · ${at}`;
  }

  if (multiDay) {
    if (!end) return start.getTime() <= now ? 'Ongoing' : `From ${date(start)}`;
    const range = `${date(start)} – ${date(end)}`;
    if (hasHours(e.hours) && start.getTime() <= now) {
      const todayHours = e.hours[String(todayIndex(now))];
      return todayHours ? `Tonight ${dayLabel(todayHours)} · runs ${range}` : `Runs ${range}`;
    }
    return range;
  }

  const startT = start.getTime();
  if (nassauDay(startT) === today) return `Tonight · ${time(start)}`;
  if (nassauDay(startT) === tomorrow) return `Tomorrow · ${time(start)}`;
  if (startT - now < 6 * DAY_MS) return `${fmt(start, { weekday: 'long' })} · ${time(start)}`;
  return `${fmt(start, { weekday: 'short', month: 'short', day: 'numeric' })} · ${time(start)}`;
}

/** Sort key: live first, then featured, then soonest next session. */
export function compareEvents(now = Date.now()) {
  return (a: NightEvent, b: NightEvent) =>
    Number(isEventLive(b, now)) - Number(isEventLive(a, now)) ||
    Number(b.is_featured) - Number(a.is_featured) ||
    eventNextStart(a, now) - eventNextStart(b, now) ||
    new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
}
