import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Trash2, Video } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { deleteMedia } from '@/lib/images';
import { isVideo, type EventMedia } from '@/lib/types';
import { MediaStill } from '@/components/Media';
import { useFeedback } from './ui';
import { useConsole } from './console';
import { MediaProgress, useMediaUploader } from './MediaUpload';

/**
 * An event's flyers and short videos (event_media), in order. The first flyer
 * is the event's main image on cards, the map and the banner (a trigger copies
 * it to events.image_url); the event page shows them all.
 */
export function EventMediaManager({ eventId, onChange }: { eventId: string; onChange?: () => void }) {
  const { toast, confirm } = useFeedback();
  const isAdmin = useConsole().role === 'admin';
  const [items, setItems] = useState<EventMedia[] | null>(null);
  const [missing, setMissing] = useState(false);
  const flyerRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const uploader = useMediaUploader({ folder: `events/${eventId}`, allowVideo: true });
  const busy = uploader.progress !== null;

  const load = async () => {
    const { data, error } = await supabase.from('event_media').select('*').eq('event_id', eventId).order('sort').order('created_at');
    // The table arrives with a schema.sql re-run; until then say so instead of failing.
    setMissing(!!error && /event_media/.test(error.message));
    setItems((data as EventMedia[]) ?? []);
  };

  useEffect(() => {
    load();
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files: FileList | null) => {
    let sort = (items ?? []).reduce((m, p) => Math.max(m, p.sort), 0);
    const added = await uploader.run([...(files ?? [])], async (m) => {
      const { trimmed: _, ...row } = m;
      const { error } = await supabase.from('event_media').insert({ event_id: eventId, ...row, sort: ++sort });
      if (error) {
        await deleteMedia(m.storage_path, m.poster_path);
        throw error;
      }
    });
    if (added === 0) return;
    await load();
    onChange?.();
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!items) return;
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j], next[index]];
    const renumbered = next.map((p, i) => ({ ...p, sort: i + 1 }));
    setItems(renumbered);
    await Promise.all(
      [renumbered[index], renumbered[j]].map((p) => supabase.from('event_media').update({ sort: p.sort }).eq('id', p.id)),
    );
    onChange?.();
  };

  const saveCaption = async (m: EventMedia, caption: string) => {
    if ((m.caption ?? '') === caption) return;
    const { error } = await supabase.from('event_media').update({ caption: caption || null }).eq('id', m.id);
    if (error) toast(error.message, 'error');
    else setItems((list) => list?.map((p) => (p.id === m.id ? { ...p, caption: caption || null } : p)) ?? null);
  };

  const remove = async (m: EventMedia) => {
    const what = isVideo(m) ? 'video' : 'flyer';
    const ok = await confirm({ title: `Delete this ${what}?`, body: 'It will be removed from the event.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('event_media').delete().eq('id', m.id);
    if (error) return toast(error.message, 'error');
    await deleteMedia(m.storage_path, m.poster_path);
    setItems((list) => list?.filter((p) => p.id !== m.id) ?? null);
    onChange?.();
    toast(what === 'video' ? 'Video deleted' : 'Flyer deleted');
  };

  if (missing) {
    return (
      <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
        {isAdmin
          ? 'Flyers and videos need a database update: re-run supabase/schema.sql in the Supabase SQL Editor, then reload.'
          : 'Flyers can’t be added just yet. Please try again later.'}
      </p>
    );
  }

  const firstFlyer = items?.find((m) => !isVideo(m));

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          type="button"
          onClick={() => flyerRef.current?.click()}
          disabled={busy}
          className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-brand-600 text-white font-extrabold hover:bg-brand-700 disabled:opacity-60"
        >
          <ImagePlus className="w-5 h-5" /> Add flyers
        </button>
        <button
          type="button"
          onClick={() => videoRef.current?.click()}
          disabled={busy}
          className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white border-2 border-dashed border-brand-300 text-brand-700 font-extrabold hover:bg-brand-50 disabled:opacity-60"
        >
          <Video className="w-5 h-5" /> Add a video
        </button>
        <input ref={flyerRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      </div>

      <MediaProgress progress={uploader.progress} />

      {items === null ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm font-semibold text-slate-400 text-center py-4">
          No flyers yet. Add one or more flyers, plus short videos (up to 30 s).
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((m, i) => {
              const main = m === firstFlyer || (!firstFlyer && i === 0);
              return (
                <li key={m.id} className={`rounded-xl overflow-hidden border-2 ${main ? 'border-brand-400' : 'border-slate-200'} bg-white`}>
                  <div className="relative aspect-[4/5] bg-slate-100">
                    <MediaStill m={m} className="w-full h-full" />
                    {main && (
                      <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full bg-brand-600 text-white text-[10px] font-black uppercase">Main</span>
                    )}
                  </div>
                  <input
                    defaultValue={m.caption ?? ''}
                    onBlur={(e) => saveCaption(m, e.target.value.trim())}
                    placeholder="Caption"
                    maxLength={200}
                    className="w-full px-2 py-1.5 text-xs font-semibold border-b border-slate-100 outline-none focus:bg-brand-50"
                  />
                  <div className="flex items-center justify-between px-1 py-1">
                    <div className="flex">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move earlier">
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move later">
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                    <button type="button" onClick={() => remove(m)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50" aria-label={isVideo(m) ? 'Delete video' : 'Delete flyer'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs font-semibold text-slate-400">
            The first flyer (“Main”) is the event’s picture on cards and the map. The event page shows them all in this order.
          </p>
        </>
      )}
    </div>
  );
}

/** Every storage file of an event's media, for deleting the event. */
export async function eventMediaPaths(eventId: string) {
  const { data } = await supabase.from('event_media').select('storage_path, poster_path').eq('event_id', eventId);
  return (data ?? []).flatMap((m) => [m.storage_path, m.poster_path]);
}
