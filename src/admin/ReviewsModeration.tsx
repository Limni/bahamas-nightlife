import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, MessageSquareText, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDirectory } from '@/lib/directory';
import type { Review } from '@/lib/types';
import { Spinner, Stars } from '@/components/ui';
import { Button, useFeedback } from './ui';

type Row = Review & { venues: { id: string; name: string; slug: string } | null };
type View = 'all' | 'low' | 'hidden';

/** Latest member reviews, with hide/unhide (keeps it for the author) and delete. */
export default function ReviewsModeration() {
  const { toast, confirm } = useFeedback();
  const { refreshRatings } = useDirectory();
  const [view, setView] = useState<View>('all');
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = async () => {
    let q = supabase
      .from('reviews')
      .select('*, profiles(display_name), venues(id, name, slug)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (view === 'hidden') q = q.eq('is_hidden', true);
    if (view === 'low') q = q.lte('rating', 2);
    const { data, error } = await q;
    if (error) toast(error.message, 'error');
    setRows((data as Row[]) ?? []);
  };

  useEffect(() => {
    setRows(null);
    load();
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const setHidden = async (r: Row, hidden: boolean) => {
    const { error } = await supabase.from('reviews').update({ is_hidden: hidden }).eq('id', r.id);
    if (error) return toast(error.message, 'error');
    toast(hidden ? 'Review hidden — only the author can see it now' : 'Review visible again');
    refreshRatings();
    load();
  };

  const remove = async (r: Row) => {
    const ok = await confirm({
      title: 'Delete this review?',
      body: 'It’s removed for everyone, including the author. Hiding is usually enough.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('reviews').delete().eq('id', r.id);
    if (error) return toast(error.message, 'error');
    refreshRatings();
    load();
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Reviews</h1>
        <p className="text-sm font-semibold text-slate-500">Member ratings and comments. Hidden reviews don’t count towards a spot’s rating.</p>
      </div>
      <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-200 text-xs font-extrabold w-fit">
        {(
          [
            ['all', 'Latest'],
            ['low', '1–2 stars'],
            ['hidden', 'Hidden'],
          ] as [View, string][]
        ).map(([key, label]) => (
          <button key={key} onClick={() => setView(key)} className={`px-3 py-1.5 rounded-lg ${view === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <MessageSquareText className="w-8 h-8 mx-auto text-slate-300" />
          <p className="mt-2 font-extrabold text-slate-600">No reviews here</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className={`bg-white rounded-2xl border p-4 ${r.is_hidden ? 'border-dashed border-slate-300 opacity-75' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Stars value={r.rating} size={15} />
                <span className="font-extrabold text-slate-900">{r.profiles?.display_name ?? 'Member'}</span>
                <span className="text-slate-400 text-sm font-semibold">on</span>
                {r.venues ? (
                  <Link to={`/admin/v/${r.venues.id}`} className="font-extrabold text-brand-700 hover:underline">
                    {r.venues.name}
                  </Link>
                ) : (
                  <span className="font-bold text-slate-400">removed spot</span>
                )}
                {r.is_hidden && <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-600 text-[11px] font-extrabold uppercase">Hidden</span>}
                <span className="ml-auto text-xs font-semibold text-slate-400">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
              {r.comment ? (
                <p className="mt-2 text-[15px] text-slate-800 whitespace-pre-line">{r.comment}</p>
              ) : (
                <p className="mt-2 text-sm italic text-slate-400">Rating only, no comment</p>
              )}
              <div className="flex gap-2 mt-3">
                {r.is_hidden ? (
                  <Button variant="secondary" onClick={() => setHidden(r, false)}>
                    <Eye className="w-4 h-4" /> Unhide
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setHidden(r, true)}>
                    <EyeOff className="w-4 h-4" /> Hide
                  </Button>
                )}
                <Button variant="ghost" onClick={() => remove(r)} className="text-rose-600">
                  <Trash2 className="w-4 h-4" /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
