import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * How many members have favourited each spot (venue_favorite_counts():
 * every spot for admins, their own for managers). Totals only, never who.
 * null until loaded, or when the schema doesn't have favourites yet.
 */
export function useFavoriteCounts() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.rpc('venue_favorite_counts').then(({ data, error }) => {
      if (!alive || error) return;
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as { venue_id: string; favorites: number }[]) map[row.venue_id] = Number(row.favorites);
      setCounts(map);
    });
    return () => {
      alive = false;
    };
  }, []);
  return counts;
}

/** "♥ 12 favourites" (nothing while counts aren't available). */
export function FavoriteCount({ count, short = false, className = '' }: { count: number | undefined | null; short?: boolean; className?: string }) {
  if (count === undefined || count === null) return null;
  const label = short ? String(count) : `${count} favourite${count === 1 ? '' : 's'}`;
  return (
    <span
      className={`inline-flex items-center gap-1 font-extrabold ${count ? 'text-rose-600' : 'text-slate-400'} ${className}`}
      title={`${count} member${count === 1 ? '' : 's'} saved this spot as a favourite`}
    >
      <Heart className={`w-3.5 h-3.5 ${count ? 'fill-current' : ''}`} />
      {label}
    </span>
  );
}
