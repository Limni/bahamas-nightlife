import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, MessageSquareText, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDirectory } from '@/lib/directory';
import type { Venue, Review } from '@/lib/types';
import { Spinner, StarInput, Stars } from './ui';

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function ReviewForm({ venue, existing, onSaved, onCancel }: {
  venue: Venue;
  existing: Review | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) return setError('Tap the stars to choose a rating.');
    setBusy(true);
    setError(null);
    const row = { rating, comment: comment.trim() || null };
    const { error: err } = existing
      ? await supabase.from('reviews').update(row).eq('id', existing.id)
      : await supabase.from('reviews').insert({ ...row, venue_id: venue.id });
    setBusy(false);
    if (err) return setError(err.code === '23505' ? 'You’ve already reviewed this spot — edit your review instead.' : err.message);
    onSaved();
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <StarInput value={rating} onChange={setRating} />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        rows={4}
        placeholder={`How were the music, the drinks and the crowd at ${venue.name}?`}
        className="w-full px-4 py-3 rounded-2xl border border-white/10 bg-night-950/70 outline-none focus:border-brand-400 font-medium text-white placeholder:text-night-400 resize-y"
      />
      {error && <p className="text-sm font-bold text-brand-200">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-brand-500 hover:bg-brand-400 text-white font-extrabold glow-brand disabled:opacity-60"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {existing ? 'Save changes' : 'Post review'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-2xl font-extrabold text-brand-200 hover:bg-white/5">
            Cancel
          </button>
        )}
        <span className="ml-auto text-xs font-semibold text-night-400">{comment.length}/2000</span>
      </div>
    </form>
  );
}

/** Ratings summary, the visitor's own review, and everyone else's. */
export function ReviewsSection({ venue }: { venue: Venue }) {
  const { session, profile, loading: authLoading } = useAuth();
  const { refreshRatings } = useDirectory();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const userId = session?.user.id;

  const load = async () => {
    const { data, error } = await supabase
      .from('reviews')
      .select('*, profiles(display_name)')
      .eq('venue_id', venue.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) setLoadError(error.message);
    setReviews((data as Review[]) ?? []);
  };

  useEffect(() => {
    load();
  }, [venue.id, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => (reviews ?? []).filter((r) => !r.is_hidden), [reviews]);
  const mine = useMemo(() => (reviews ?? []).find((r) => r.user_id === userId) ?? null, [reviews, userId]);
  const others = visible.filter((r) => r.user_id !== userId);
  const avg = visible.length ? visible.reduce((s, r) => s + r.rating, 0) / visible.length : 0;
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: visible.filter((r) => r.rating === n).length }));

  const afterChange = () => {
    setEditing(false);
    load();
    refreshRatings();
  };

  const remove = async () => {
    if (!mine) return;
    const { error } = await supabase.from('reviews').delete().eq('id', mine.id);
    if (!error) afterChange();
  };

  if (reviews === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  const nextUrl = encodeURIComponent(`/v/${venue.slug}?tab=reviews`);

  return (
    <div className="grid gap-4 md:grid-cols-5">
      {/* Summary + your review */}
      <div className="md:col-span-2 space-y-4">
        <section className="bg-night-900 rounded-3xl border border-white/10 p-5">
          {visible.length ? (
            <>
              <div className="flex items-end gap-3">
                <span className="font-display text-5xl font-extrabold text-white leading-none">{avg.toFixed(1)}</span>
                <div className="pb-1">
                  <Stars value={avg} size={18} />
                  <p className="text-xs font-bold text-night-300 mt-0.5">
                    {visible.length} review{visible.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5">
                {dist.map(({ n, count }) => (
                  <li key={n} className="flex items-center gap-2 text-xs font-bold text-night-50">
                    <span className="w-3">{n}</span>
                    <span className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                      <span className="block h-full rounded-full bg-amber-400" style={{ width: `${(count / visible.length) * 100}%` }} />
                    </span>
                    <span className="w-6 text-right text-night-300">{count}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-center py-2">
              <MessageSquareText className="w-8 h-8 mx-auto text-brand-300" />
              <p className="font-display text-lg font-bold text-white mt-2">No reviews yet</p>
              <p className="text-sm font-medium text-night-200">Been here? Be the first to rate it.</p>
            </div>
          )}
        </section>

        <section className="bg-gradient-to-br from-brand-500/10 to-glow-500/5 rounded-3xl border border-brand-400/25 p-5">
          <h3 className="font-display text-lg font-bold text-white mb-3">{mine ? 'Your review' : 'Rate this spot'}</h3>
          {authLoading ? (
            <Spinner />
          ) : !session ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-night-200">Sign in to leave a star rating and a comment. It takes a minute and only your name is shown.</p>
              <div className="flex flex-wrap gap-2">
                <Link to={`/account?next=${nextUrl}`} className="px-5 py-2.5 rounded-2xl bg-brand-500 hover:bg-brand-400 text-white text-sm font-extrabold">
                  Sign in
                </Link>
                <Link to={`/account?mode=signup&next=${nextUrl}`} className="px-5 py-2.5 rounded-2xl bg-night-900 border border-white/10 hover:bg-white/5 text-night-100 text-sm font-extrabold">
                  Create account
                </Link>
              </div>
            </div>
          ) : mine && !editing ? (
            <div>
              <Stars value={mine.rating} size={20} />
              {mine.comment && <p className="mt-2 text-sm text-night-100 whitespace-pre-line">{mine.comment}</p>}
              {mine.is_hidden && (
                <p className="mt-2 text-xs font-bold text-brand-200">A moderator hid this review, so only you can see it.</p>
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-night-900 border border-white/10 text-sm font-extrabold text-night-100 hover:bg-white/5">
                  <Pencil className="w-4 h-4" /> Edit
                </button>
                <button onClick={remove} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-extrabold text-brand-300 hover:bg-white/5">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs font-bold text-night-300 mb-2">Posting as {profile?.display_name ?? 'you'}</p>
              <ReviewForm venue={venue} existing={mine} onSaved={afterChange} onCancel={mine ? () => setEditing(false) : undefined} />
            </>
          )}
        </section>
      </div>

      {/* Everyone else */}
      <div className="md:col-span-3">
        {loadError && <p className="mb-3 text-sm font-semibold text-brand-200">Couldn’t load reviews: {loadError}</p>}
        {others.length === 0 ? (
          <p className="text-sm font-semibold text-night-300 bg-night-900 rounded-3xl border border-white/10 p-5">
            {visible.length ? 'No other reviews yet.' : 'Reviews from the community will show up here.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {others.map((r) => {
              const name = r.profiles?.display_name ?? 'Member';
              return (
                <li key={r.id} className="bg-night-900 rounded-3xl border border-white/10 p-5">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-brand-500/15 text-brand-200 font-display font-extrabold flex items-center justify-center shrink-0">
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-white truncate">{name}</p>
                      <p className="text-xs font-semibold text-night-400">
                        {dateLabel(r.created_at)}
                        {r.updated_at.slice(0, 10) !== r.created_at.slice(0, 10) && ' · edited'}
                      </p>
                    </div>
                    <Stars value={r.rating} size={16} />
                  </div>
                  {r.comment && <p className="mt-3 text-[15px] leading-relaxed text-night-100 whitespace-pre-line">{r.comment}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
