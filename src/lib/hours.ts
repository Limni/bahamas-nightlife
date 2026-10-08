// Weekly hours-of-operation helpers. Windows are per-weekday in Bahamas local
// time (America/Nassau), so they read the same regardless of the visitor's
// device timezone. A window whose close is before its open runs past midnight.

const BAHAMAS_TZ = 'America/Nassau';

export interface DayHours {
  open: string; // 'HH:MM'
  close: string;
}

/** Weekday index as string key: "0" = Sunday … "6" = Saturday. Missing day = closed. */
export type WeeklyHours = Record<string, DayHours>;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function bahamasParts(date: Date): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BAHAMAS_TZ, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const dow = DAY_NAMES.indexOf(wd);
  return { dow: dow >= 0 ? dow : date.getDay(), minutes: h * 60 + m };
}

function toMinutes(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(':');
  const hh = parseInt(h, 10);
  const mm = parseInt(m ?? '0', 10);
  return Number.isNaN(hh) ? null : hh * 60 + (Number.isNaN(mm) ? 0 : mm);
}

export const hasHours = (h?: WeeklyHours | null): h is WeeklyHours => !!h && Object.keys(h).length > 0;

export function todayIndex(now: number = Date.now()) {
  return bahamasParts(new Date(now)).dow;
}

/** '14:30' -> '2:30 PM', '09:00' -> '9 AM' */
export function formatTime(t?: string | null): string {
  const mins = toMinutes(t);
  if (mins === null) return '';
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

export function dayLabel(day?: DayHours | null): string {
  if (!day) return 'Closed';
  if (day.open === '00:00' && (day.close === '23:59' || day.close === '24:00')) return 'Open 24 hours';
  return `${formatTime(day.open)} – ${formatTime(day.close)}`;
}

export type OpenState =
  | { kind: 'unknown' }
  | { kind: 'open'; closesAt: string }
  | { kind: 'closed'; opensAt: string | null; opensDay: number | null };

/** Open/closed right now, accounting for windows that run past midnight. */
export function openState(h?: WeeklyHours | null, now: number = Date.now()): OpenState {
  if (!hasHours(h)) return { kind: 'unknown' };
  const { dow, minutes } = bahamasParts(new Date(now));

  // Still inside yesterday's past-midnight window?
  const yesterday = h[String((dow + 6) % 7)];
  if (yesterday) {
    const o = toMinutes(yesterday.open);
    const c = toMinutes(yesterday.close);
    if (o !== null && c !== null && c < o && minutes < c) return { kind: 'open', closesAt: yesterday.close };
  }

  const today = h[String(dow)];
  if (today) {
    const o = toMinutes(today.open);
    const c = toMinutes(today.close);
    if (o !== null && c !== null) {
      const overnight = c < o;
      if (minutes >= o && (overnight || minutes < c)) return { kind: 'open', closesAt: today.close };
      if (minutes < o) return { kind: 'closed', opensAt: today.open, opensDay: dow };
    }
  }

  // Next opening in the coming week.
  for (let i = 1; i <= 7; i++) {
    const d = (dow + i) % 7;
    const day = h[String(d)];
    if (day && toMinutes(day.open) !== null) return { kind: 'closed', opensAt: day.open, opensDay: d };
  }
  return { kind: 'closed', opensAt: null, opensDay: null };
}

export function isOpenNow(h?: WeeklyHours | null, now: number = Date.now()) {
  return openState(h, now).kind === 'open';
}

/** Short human status, e.g. "Open · closes 10 PM" / "Closed · opens Tue 11 AM". */
export function openStatusText(state: OpenState, now: number = Date.now()): string {
  if (state.kind === 'unknown') return 'Hours not listed';
  if (state.kind === 'open') {
    return state.closesAt === '23:59' || state.closesAt === '24:00' ? 'Open · until midnight' : `Open · closes ${formatTime(state.closesAt)}`;
  }
  if (!state.opensAt || state.opensDay === null) return 'Closed';
  const today = todayIndex(now);
  const when =
    state.opensDay === today
      ? ''
      : state.opensDay === (today + 1) % 7
        ? 'tomorrow '
        : `${DAY_NAMES[state.opensDay].slice(0, 3)} `;
  return `Closed · opens ${when}${formatTime(state.opensAt)}`;
}
