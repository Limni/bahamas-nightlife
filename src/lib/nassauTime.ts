const parts = (at: number) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Nassau', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date(at)).map(p => [p.type, p.value]));

export function nassauDate(at: number) {
  const p = parts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Resolve local wall time using the offsets on both sides of a clock change.
 * Repeated times use the first occurrence; nonexistent spring times are skipped. */
export function nassauInstant(date: string, time: string): number | null {
  if (time === '24:00') return nassauInstant(addDays(date, 1), '00:00');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall)) return null;
  const offsets = new Set<number>();
  for (const delta of [-36, 0, 36]) {
    const probe = wall + delta * 3600_000;
    const p = parts(probe);
    offsets.add(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - probe);
  }
  const candidates = [...offsets].map(offset => wall - offset).filter(at => {
    const p = parts(at);
    return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time;
  });
  return candidates.length ? Math.min(...candidates) : null;
}
