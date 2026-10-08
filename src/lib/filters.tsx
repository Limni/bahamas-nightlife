import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Venue } from './types';
import { isOpenNow } from './hours';

// Search + filter state shared by the Explore list and the Map, so switching
// tabs keeps what you picked. Persisted for the browser session.

export interface Filters {
  q: string;
  categories: string[];
  vibes: string[];
  areas: string[];
  prices: number[];
  openNow: boolean;
  /** Only venues with people there right now (live activity). */
  busyNow: boolean;
}

export const EMPTY_FILTERS: Filters = { q: '', categories: [], vibes: [], areas: [], prices: [], openNow: false, busyNow: false };

const STORAGE_KEY = 'filters:v1';

export function activeFilterCount(f: Filters) {
  return f.categories.length + f.vibes.length + f.areas.length + f.prices.length + (f.openNow ? 1 : 0) + (f.busyNow ? 1 : 0);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Within a group (e.g. two categories) any match counts; across groups every
 * group must match. Search terms must all appear somewhere in the listing.
 */
export function matchesFilters(r: Venue, f: Filters, now = Date.now(), isBusy?: (venueId: string) => boolean) {
  if (f.categories.length && !r.categories.some((c) => f.categories.includes(c))) return false;
  if (f.vibes.length && !r.vibes.some((v) => f.vibes.includes(v))) return false;
  if (f.areas.length && (!r.area || !f.areas.includes(r.area))) return false;
  if (f.prices.length && (!r.price_level || !f.prices.includes(r.price_level))) return false;
  if (f.openNow && !isOpenNow(r.hours, now)) return false;
  if (f.busyNow && !isBusy?.(r.id)) return false;
  const q = norm(f.q.trim());
  if (q) {
    const hay = norm([r.name, r.description, r.area, r.address, ...r.categories, ...r.vibes].filter(Boolean).join(' '));
    if (!q.split(/\s+/).every((term) => hay.includes(term))) return false;
  }
  return true;
}

interface FiltersValue {
  filters: Filters;
  setFilters: (next: Filters | ((prev: Filters) => Filters)) => void;
  toggle: <K extends 'categories' | 'vibes' | 'areas' | 'prices'>(key: K, value: Filters[K][number]) => void;
  clear: () => void;
}

const FiltersContext = createContext<FiltersValue | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? { ...EMPTY_FILTERS, ...JSON.parse(raw) } : EMPTY_FILTERS;
    } catch {
      return EMPTY_FILTERS;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);

  const toggle = useCallback<FiltersValue['toggle']>((key, value) => {
    setFilters((prev) => {
      const list = prev[key] as (string | number)[];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...prev, [key]: next };
    });
  }, []);

  const clear = useCallback(() => setFilters((prev) => ({ ...EMPTY_FILTERS, q: prev.q })), []);

  const value = useMemo(() => ({ filters, setFilters, toggle, clear }), [filters, toggle, clear]);
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used inside <FiltersProvider>');
  return ctx;
}
