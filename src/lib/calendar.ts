import type { NightEvent, Venue } from './types';
import { nextSession } from './events';
import { addDays, nassauDate, nassauInstant } from './nassauTime';
import { timeToMinutes } from './hours';

const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const stamp = (at: number) => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// RFC 5545 folds at 75 octets, including non-ASCII event names.
function fold(line: string) {
  const encoder = new TextEncoder();
  let result = '', width = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (width + size > 75) { result += '\r\n '; width = 1; }
    result += char; width += size;
  }
  return result;
}

export function eventCalendar(event: NightEvent, venue: Venue | undefined, now = Date.now()) {
  const next = nextSession(event, now);
  if (!next) return null;
  let start = next.at, end = event.end_date ? Date.parse(event.end_date) : null;
  if (event.hours && Object.keys(event.hours).length) {
    // Look back one calendar day to recover the start of an active overnight session.
    for (const date of [addDays(nassauDate(next.at), -1), nassauDate(next.at)]) {
      const window = event.hours[String(new Date(`${date}T12:00:00Z`).getUTCDay())];
      if (!window) continue;
      const o = nassauInstant(date, window.open);
      const c = nassauInstant(addDays(date, (timeToMinutes(window.close) ?? 0) <= (timeToMinutes(window.open) ?? 0) ? 1 : 0), window.close);
      if (o !== null && c !== null && o <= next.at && next.at < c) { start = Math.max(o, Date.parse(event.start_date)); end = end === null ? c : Math.min(end, c); break; }
    }
  } else start = Date.parse(event.start_date);
  if (end === null || end <= start) return null;
  const url = `https://nassaunights.com/events/${encodeURIComponent(event.id)}`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nassau Nights//Night out//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${event.id}-${stamp(start)}@nassaunights.com`, `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape([event.description, 'Times are scheduled in Nassau, Bahamas.', url].filter(Boolean).join('\n'))}`,
    `LOCATION:${escape([venue?.name, event.address || venue?.address || venue?.area].filter(Boolean).join(', '))}`,
    `URL:${url}`, 'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}
