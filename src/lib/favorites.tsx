import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Heart, X } from 'lucide-react';
import { supabase, supabaseConfigured } from './supabase';
import { useAuth } from './auth';

// Favourite spots for the signed-in member (venue_favorites; RLS returns only
// their own rows). Shared by every heart on the site and the Account list.
//
// A signed-out tap shows a sign-in prompt and remembers the spot (in this
// tab), so it is saved as soon as they sign in.

const PENDING_KEY = 'favorites:pending';

interface FavoritesValue {
  /** False until the schema has the table; hearts hide themselves. */
  available: boolean;
  /** Favourited venue ids, most recent first. */
  ids: string[];
  isFavorite: (venueId: string) => boolean;
  toggle: (venueId: string) => void;
}

const FavoritesContext = createContext<FavoritesValue>({ available: false, ids: [], isFavorite: () => false, toggle: () => {} });

const readPending = () => {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
};
const writePending = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(PENDING_KEY, id);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode: the spot just isn't remembered */
  }
};

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [available, setAvailable] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let alive = true;
    // Signed out this still runs (and returns nothing): it tells us whether the table exists.
    supabase
      .from('venue_favorites')
      .select('venue_id')
      .order('created_at', { ascending: false })
      .then(async ({ data, error }) => {
        if (!alive) return;
        setAvailable(!error);
        let list = error || !userId ? [] : (data ?? []).map((r) => r.venue_id as string);
        const pending = userId ? readPending() : null;
        if (pending && !error) {
          writePending(null);
          if (!list.includes(pending)) {
            const res = await supabase.from('venue_favorites').insert({ venue_id: pending });
            if (!res.error || res.error.code === '23505') list = [pending, ...list];
          }
        }
        if (alive) setIds(list);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    if (userId) setPrompt(false);
  }, [userId]);

  // The prompt steps aside on its own after a while.
  useEffect(() => {
    if (!prompt) return;
    const t = setTimeout(() => setPrompt(false), 8000);
    return () => clearTimeout(t);
  }, [prompt]);

  const set = useMemo(() => new Set(ids), [ids]);
  const isFavorite = useCallback((id: string) => set.has(id), [set]);

  const toggle = useCallback(
    async (venueId: string) => {
      if (!userId) {
        writePending(venueId);
        setPrompt(true);
        return;
      }
      const on = !set.has(venueId);
      setIds((list) => (on ? [venueId, ...list.filter((i) => i !== venueId)] : list.filter((i) => i !== venueId)));
      const { error } = on
        ? await supabase.from('venue_favorites').insert({ venue_id: venueId })
        : await supabase.from('venue_favorites').delete().eq('venue_id', venueId).eq('user_id', userId);
      // 23505: already a favourite (another tab), so it stands. Anything else: undo.
      if (error && error.code !== '23505') {
        setIds((list) => (on ? list.filter((i) => i !== venueId) : [venueId, ...list]));
      }
    },
    [userId, set],
  );

  const value = useMemo(() => ({ available, ids, isFavorite, toggle }), [available, ids, isFavorite, toggle]);

  return (
    <FavoritesContext.Provider value={value}>
      {children}
      {prompt && (
        <SignInPrompt
          onClose={(dismissed) => {
            if (dismissed) writePending(null);
            setPrompt(false);
          }}
        />
      )}
    </FavoritesContext.Provider>
  );
}

export const useFavorites = () => useContext(FavoritesContext);

function SignInPrompt({ onClose }: { onClose: (dismissed: boolean) => void }) {
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  return (
    <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-6 z-[4500] flex justify-center px-4 pointer-events-none">
      <div role="status" className="pointer-events-auto w-full max-w-md flex items-center gap-3 p-4 rounded-2xl bg-night-900 border border-brand-400/40 shadow-[0_12px_40px_rgb(0,0,0,0.6)]">
        <Heart className="w-5 h-5 text-brand-300 fill-brand-400/40 shrink-0" />
        <p className="flex-1 text-sm font-semibold text-night-100">
          <Link to={`/account?next=${next}`} onClick={() => onClose(false)} className="font-extrabold text-brand-200 underline">
            Sign in
          </Link>{' '}
          or{' '}
          <Link to={`/account?mode=signup&next=${next}`} onClick={() => onClose(false)} className="font-extrabold text-brand-200 underline">
            create an account
          </Link>{' '}
          to save your favourite spots.
        </p>
        <button onClick={() => onClose(true)} className="p-1 rounded-lg text-night-300 hover:text-white" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
