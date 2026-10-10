import { useSyncExternalStore, useMemo } from 'react';
export interface NightList { venues: string[]; events: string[] }
const KEY = 'night:v1';
const EMPTY = '{"venues":[],"events":[]}';
let memory: string | null = null;
let temporary = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const clean = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[a-z0-9-]{1,80}$/i.test(id)))].slice(0, 20) : [];
export function parseNight(raw: string | null): NightList {
  try { const parsed = JSON.parse(raw || EMPTY); return { venues: clean(parsed?.venues), events: clean(parsed?.events) }; }
  catch { return { venues: [], events: [] }; }
}
function snapshot() {
  if (memory === null) { try { memory = localStorage.getItem(KEY) || EMPTY; } catch { memory = EMPTY; temporary = true; } }
  return memory;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const sync = (e: StorageEvent) => { if (e.key === KEY || e.key === null) { memory = null; emit(); } };
  window.addEventListener('storage', sync);
  return () => { listeners.delete(listener); window.removeEventListener('storage', sync); };
}
export function useNight() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const list = useMemo(() => parseNight(raw), [raw]);
  const save = (next: NightList) => {
    memory = JSON.stringify(parseNight(JSON.stringify(next)));
    try { localStorage.setItem(KEY, memory); temporary = false; } catch { temporary = true; }
    emit();
  };
  const toggle = (kind: keyof NightList, id: string) => {
    const current = parseNight(snapshot());
    save({ ...current, [kind]: current[kind].includes(id) ? current[kind].filter(x => x !== id) : [...current[kind], id] });
  };
  return { list, save, toggle, temporary };
}
export function sharedNight(search: string): NightList | null {
  const p = new URLSearchParams(search);
  if (!p.has('venues') && !p.has('events')) return null;
  return { venues: clean((p.get('venues') || '').split(',')), events: clean((p.get('events') || '').split(',')) };
}
export function nightUrl(list: NightList, origin = 'https://nassaunights.com') {
  const params = new URLSearchParams({ venues: list.venues.join(','), events: list.events.join(',') });
  return `${origin}/night?${params}`;
}
