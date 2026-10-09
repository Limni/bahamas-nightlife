import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Flame, Heart, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { MenuItem } from '@/lib/types';
import type { LightboxImage } from './Lightbox';
import { SafeImg } from './ui';

const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;

// "Fan favourite": the most-liked items of a menu, once they have a few likes.
// At most a third of the menu (and 3), so the badge still means something.
const FAN_MIN_LIKES = 3;
const FAN_TOP = 3;

/**
 * Likes on menu items for the signed-in member: which ones they like (RLS
 * only returns their own rows) and optimistic counts on top of like_count.
 */
export function useMenuLikes(items: MenuItem[]) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [needSignIn, setNeedSignIn] = useState(false);
  const ids = useMemo(() => items.map((i) => i.id), [items]);

  useEffect(() => {
    setCounts({});
    if (!userId || ids.length === 0) {
      setMine(new Set());
      return;
    }
    let alive = true;
    supabase
      .from('menu_item_likes')
      .select('item_id')
      .in('item_id', ids)
      .then(({ data }) => {
        if (alive) setMine(new Set((data ?? []).map((r) => r.item_id as string)));
      });
    return () => {
      alive = false;
    };
  }, [userId, ids]);

  const countOf = useCallback((item: MenuItem) => counts[item.id] ?? item.like_count, [counts]);

  const toggle = async (item: MenuItem) => {
    if (!userId) return setNeedSignIn(true);
    const liked = mine.has(item.id);
    const before = countOf(item);
    const apply = (on: boolean, count: number) => {
      setMine((s) => {
        const next = new Set(s);
        if (on) next.add(item.id);
        else next.delete(item.id);
        return next;
      });
      setCounts((c) => ({ ...c, [item.id]: count }));
    };
    apply(!liked, Math.max(0, before + (liked ? -1 : 1)));
    const { error } = liked
      ? await supabase.from('menu_item_likes').delete().eq('item_id', item.id).eq('user_id', userId)
      : await supabase.from('menu_item_likes').insert({ item_id: item.id });
    // 23505: already liked (another tab) — the like stands.
    if (error && error.code !== '23505') apply(liked, before);
  };

  return { liked: (item: MenuItem) => mine.has(item.id), countOf, toggle, needSignIn, dismissSignIn: () => setNeedSignIn(false) };
}

type Likes = ReturnType<typeof useMenuLikes>;

/** Shown when a signed-out visitor taps a heart. */
export function LikeSignInPrompt({ likes, what }: { likes: Likes; what: string }) {
  const location = useLocation();
  if (!likes.needSignIn) return null;
  const next = encodeURIComponent(location.pathname + location.search);
  return (
    <div className="flex items-center gap-3 p-4 rounded-2xl bg-brand-500/10 border border-brand-400/30">
      <Heart className="w-5 h-5 text-brand-300 shrink-0" />
      <p className="flex-1 text-sm font-semibold text-night-100">
        <Link to={`/account?next=${next}`} className="font-extrabold text-brand-200 underline">
          Sign in
        </Link>{' '}
        or{' '}
        <Link to={`/account?mode=signup&next=${next}`} className="font-extrabold text-brand-200 underline">
          create an account
        </Link>{' '}
        to like {what}.
      </p>
      <button onClick={likes.dismissSignIn} className="p-1 rounded-lg text-night-300 hover:text-white" aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/** A menu (drinks or food) by section: leader-line prices, item photos and hearts. */
export function MenuSections({
  items,
  likes,
  idPrefix,
  onOpenImages,
}: {
  items: MenuItem[];
  likes: Likes;
  idPrefix: string;
  onOpenImages: (images: LightboxImage[], index: number) => void;
}) {
  const sections = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of items) {
      const key = item.section || 'Menu';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  const favourites = useMemo(
    () =>
      new Set(
        items
          .filter((i) => likes.countOf(i) >= FAN_MIN_LIKES)
          .sort((a, b) => likes.countOf(b) - likes.countOf(a))
          .slice(0, Math.min(FAN_TOP, Math.max(1, Math.floor(items.length / 3))))
          .map((i) => i.id),
      ),
    [items, likes],
  );

  // Every item photo in this menu, so the lightbox can swipe through them.
  const withPhotos = useMemo(() => items.filter((i) => i.photo_url), [items]);
  const openPhoto = (item: MenuItem) =>
    onOpenImages(
      withPhotos.map((i) => ({ url: i.photo_url!, caption: i.price != null ? `${i.name} · ${money(Number(i.price))}` : i.name })),
      withPhotos.findIndex((i) => i.id === item.id),
    );

  return (
    <>
      {sections.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
          {sections.map(([name]) => (
            <a
              key={name}
              href={`#${idPrefix}-${encodeURIComponent(name)}`}
              className="shrink-0 px-3 py-1.5 rounded-full bg-night-900 border border-white/10 text-xs font-extrabold text-night-100 hover:bg-white/5"
            >
              {name}
            </a>
          ))}
        </div>
      )}
      {sections.map(([name, list]) => (
        <section key={name} id={`${idPrefix}-${encodeURIComponent(name)}`} className="bg-night-900 rounded-3xl border border-white/10 p-5 scroll-mt-36">
          <h3 className="font-display text-xl font-extrabold text-white mb-1 text-center">{name}</h3>
          <div className="mx-auto mb-2 w-16 h-0.5 bg-gradient-to-r from-brand-500 to-glow-400 rounded glow-brand" />
          <ul>
            {list.map((item) => {
              const liked = likes.liked(item);
              const count = likes.countOf(item);
              return (
                <li key={item.id} className="py-3 flex items-center gap-3">
                  {item.photo_url && (
                    <button
                      onClick={() => openPhoto(item)}
                      className="w-16 h-16 md:w-20 md:h-20 rounded-2xl overflow-hidden bg-white/5 shrink-0 border border-white/10"
                      aria-label={`Photo of ${item.name}`}
                    >
                      <SafeImg src={item.photo_url} name={item.name} className="w-full h-full hover:scale-105 transition-transform" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-base font-extrabold text-white">{item.name}</p>
                      <span className="leader" aria-hidden />
                      {item.price != null && <span className="font-extrabold text-glow-300 shrink-0">{money(Number(item.price))}</span>}
                    </div>
                    {item.description && <p className="text-sm text-night-300 font-medium italic mt-0.5">{item.description}</p>}
                    {favourites.has(item.id) && (
                      <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-200 text-[11px] font-extrabold uppercase tracking-wider">
                        <Flame className="w-3 h-3" /> Fan favourite
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => likes.toggle(item)}
                    aria-pressed={liked}
                    aria-label={liked ? `Unlike ${item.name}` : `Like ${item.name}`}
                    className={`shrink-0 w-11 flex flex-col items-center gap-0.5 py-1 rounded-xl transition-colors ${
                      liked ? 'text-brand-300' : 'text-night-400 hover:text-brand-200'
                    }`}
                  >
                    <Heart className={`w-5 h-5 transition-transform ${liked ? 'fill-current scale-110' : ''}`} />
                    <span className="text-[11px] font-extrabold tabular-nums min-h-[1em]">{count > 0 ? count : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
