import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, ImagePlus, Loader2, Star, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { deleteMedia, readPhotoGps, uploadMedia } from '@/lib/images';
import type { Photo, PhotoKind } from '@/lib/types';
import { useFeedback } from './ui';

/**
 * Upload + manage one venue's photos of one kind (gallery or menu).
 * "Take photo" opens the rear camera directly on phones; "Library" allows
 * picking many at once. Photos are compressed in the browser before upload.
 */
export function PhotoManager({
  venueId,
  kind,
  coverUrl,
  onSetCover,
  onGpsFound,
}: {
  venueId: string;
  kind: PhotoKind;
  coverUrl?: string | null;
  onSetCover?: (url: string | null) => void;
  /** Called with EXIF coordinates from the first uploaded photo that has them. */
  onGpsFound?: (pos: { lat: number; lng: number }) => void;
}) {
  const { toast, confirm } = useFeedback();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase
      .from('venue_photos')
      .select('*')
      .eq('venue_id', venueId)
      .eq('kind', kind)
      .order('sort')
      .order('created_at');
    setPhotos((data as Photo[]) ?? []);
  };

  useEffect(() => {
    load();
  }, [venueId, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (list.length === 0) return;
    setProgress({ done: 0, total: list.length });

    if (onGpsFound) {
      for (const f of list) {
        const gps = await readPhotoGps(f);
        if (gps) {
          onGpsFound(gps);
          break;
        }
      }
    }

    let sort = (photos ?? []).reduce((m, p) => Math.max(m, p.sort), 0);
    let failed = 0;
    let firstUrl: string | null = null;
    for (const file of list) {
      try {
        const { url, path } = await uploadMedia(file, `${venueId}/${kind}`);
        const { error } = await supabase
          .from('venue_photos')
          .insert({ venue_id: venueId, kind, url, storage_path: path, sort: ++sort });
        if (error) throw error;
        firstUrl ??= url;
      } catch (e) {
        failed++;
        console.error(e);
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setProgress(null);
    await load();
    // First gallery photo of a spot with no cover becomes the cover automatically.
    if (kind === 'gallery' && !coverUrl && firstUrl && onSetCover) onSetCover(firstUrl);
    if (failed) toast(`${failed} of ${list.length} photos failed to upload.`, 'error');
    else toast(`${list.length} photo${list.length === 1 ? '' : 's'} added`);
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!photos) return;
    const j = index + dir;
    if (j < 0 || j >= photos.length) return;
    const next = [...photos];
    [next[index], next[j]] = [next[j], next[index]];
    const renumbered = next.map((p, i) => ({ ...p, sort: i + 1 }));
    setPhotos(renumbered);
    await Promise.all(
      [renumbered[index], renumbered[j]].map((p) => supabase.from('venue_photos').update({ sort: p.sort }).eq('id', p.id)),
    );
  };

  const saveCaption = async (photo: Photo, caption: string) => {
    if ((photo.caption ?? '') === caption) return;
    const { error } = await supabase.from('venue_photos').update({ caption: caption || null }).eq('id', photo.id);
    if (error) toast(error.message, 'error');
    else setPhotos((list) => list?.map((p) => (p.id === photo.id ? { ...p, caption: caption || null } : p)) ?? null);
  };

  const remove = async (photo: Photo) => {
    const ok = await confirm({ title: 'Delete this photo?', body: 'It will be removed from the site.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('venue_photos').delete().eq('id', photo.id);
    if (error) return toast(error.message, 'error');
    await deleteMedia(photo.storage_path);
    if (coverUrl === photo.url) onSetCover?.(null);
    setPhotos((list) => list?.filter((p) => p.id !== photo.id) ?? null);
    toast('Photo deleted');
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={!!progress}
          className="flex items-center justify-center gap-2 py-4 rounded-xl bg-brand-600 text-white font-extrabold hover:bg-brand-700 disabled:opacity-60"
        >
          <Camera className="w-5 h-5" /> Take photo
        </button>
        <button
          type="button"
          onClick={() => libraryRef.current?.click()}
          disabled={!!progress}
          className="flex items-center justify-center gap-2 py-4 rounded-xl bg-white border-2 border-dashed border-brand-300 text-brand-700 font-extrabold hover:bg-brand-50 disabled:opacity-60"
        >
          <ImagePlus className="w-5 h-5" /> Library
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      </div>

      {progress && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs font-extrabold text-slate-600 mb-1">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…
            </span>
            <span>
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {photos === null ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : photos.length === 0 ? (
        <p className="text-sm font-semibold text-slate-400 text-center py-4">
          No {kind === 'menu' ? 'menu photos' : 'photos'} yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((p, i) => {
            const isCover = coverUrl === p.url;
            return (
              <li key={p.id} className={`rounded-xl overflow-hidden border-2 ${isCover ? 'border-amber-400' : 'border-slate-200'} bg-white`}>
                <div className="relative aspect-square bg-slate-100">
                  <img src={p.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                  {isCover && (
                    <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-black uppercase">Cover</span>
                  )}
                </div>
                <input
                  defaultValue={p.caption ?? ''}
                  onBlur={(e) => saveCaption(p, e.target.value.trim())}
                  placeholder="Caption"
                  className="w-full px-2 py-1.5 text-xs font-semibold border-b border-slate-100 outline-none focus:bg-brand-50"
                />
                <div className="flex items-center justify-between px-1 py-1">
                  <div className="flex">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move earlier">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === photos.length - 1} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move later">
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex">
                    {kind === 'gallery' && onSetCover && !isCover && (
                      <button type="button" onClick={() => onSetCover(p.url)} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50" title="Use as cover photo">
                        <Star className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" onClick={() => remove(p)} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50" aria-label="Delete photo">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
