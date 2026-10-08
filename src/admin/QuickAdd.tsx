import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Camera, ImagePlus, Loader2, MapPin, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { readPhotoGps, uploadMedia } from '@/lib/images';
import { useDirectory } from '@/lib/directory';
import type { PhotoKind } from '@/lib/types';
import { Button, Field, inputClass, Panel, useFeedback } from './ui';
import { LocationField, getDeviceLocation, type LatLng } from './LocationField';
import { TagPicker } from './TagPicker';

interface Queued {
  file: File;
  preview: string;
  kind: PhotoKind;
}

/**
 * Field capture: standing outside a spot, grab GPS + a name + a few photos of
 * the place and its menu, and save it as a draft in one go. Everything else
 * (hours, menu items, description) can be filled in later from the editor.
 */
export default function QuickAdd() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refresh } = useDirectory();
  const { toast } = useFeedback();

  const [name, setName] = useState(params.get('name') ?? '');
  const [area, setArea] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState(params.get('notes') ?? '');
  const [location, setLocation] = useState<LatLng | null>(null);
  const [locationSource, setLocationSource] = useState<'gps' | 'photo' | 'manual' | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const nextKind = useRef<PhotoKind>('gallery');

  // Try for a GPS fix straight away — the whole point is you're standing there.
  useEffect(() => {
    getDeviceLocation()
      .then((pos) => {
        setLocation((cur) => cur ?? { lat: pos.lat, lng: pos.lng });
        setLocationSource((s) => s ?? 'gps');
      })
      .catch(() => {});
  }, []);

  const queueRef = useRef(queue);
  queueRef.current = queue;
  useEffect(() => () => queueRef.current.forEach((q) => URL.revokeObjectURL(q.preview)), []);

  const addFiles = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    const kind = nextKind.current;
    setQueue((q) => [...q, ...list.map((file) => ({ file, preview: URL.createObjectURL(file), kind }))]);
    if (!location) {
      for (const f of list) {
        const gps = await readPhotoGps(f);
        if (gps) {
          setLocation(gps);
          setLocationSource('photo');
          toast('Location taken from the photo’s GPS data');
          break;
        }
      }
    }
  };

  const pick = (kind: PhotoKind, camera: boolean) => {
    nextKind.current = kind;
    (camera ? cameraRef : libraryRef).current?.click();
  };

  const save = async () => {
    if (!name.trim()) return toast('Give the spot a name first.', 'error');
    setSaving('Creating draft…');
    const { data, error } = await supabase
      .from('venues')
      .insert({
        name: name.trim(),
        area: area[0] ?? null,
        categories,
        price_level: price,
        phone: phone.trim() || null,
        description: notes.trim() || null,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        is_published: false,
      })
      .select('id')
      .single();
    if (error || !data) {
      setSaving(null);
      return toast(error?.message ?? 'Could not save', 'error');
    }

    let cover: string | null = null;
    let failed = 0;
    for (const [i, q] of queue.entries()) {
      setSaving(`Uploading photo ${i + 1} of ${queue.length}…`);
      try {
        const { url, path } = await uploadMedia(q.file, `${data.id}/${q.kind}`);
        const { error: rowError } = await supabase
          .from('venue_photos')
          .insert({ venue_id: data.id, kind: q.kind, url, storage_path: path, sort: i + 1 });
        if (rowError) throw rowError;
        if (q.kind === 'gallery') cover ??= url;
      } catch {
        failed++;
      }
    }
    if (cover) await supabase.from('venues').update({ cover_url: cover }).eq('id', data.id);

    // Close the loop when this draft came from a community suggestion.
    const fromSubmission = params.get('from');
    if (fromSubmission) {
      await supabase.from('submissions').update({ status: 'reviewing', admin_note: `Draft created: ${name.trim()}` }).eq('id', fromSubmission);
      window.dispatchEvent(new Event('inbox-changed'));
    }

    setSaving(null);
    refresh();
    toast(failed ? `Draft saved — ${failed} photo(s) failed, retry from the editor.` : 'Draft saved', failed ? 'error' : 'success');
    navigate(`/admin/v/${data.id}`, { replace: true });
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Quick add</h1>
        <p className="text-sm font-semibold text-slate-500">Capture a spot on location. It’s saved as a draft until you publish it.</p>
      </div>

      <Panel title="1 · The basics">
        <div className="space-y-4">
          <Field label="Name *">
            <input className={`${inputClass} text-lg`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Oh Andros" autoFocus />
          </Field>
          <Field label="Area">
            <TagPicker kind="area" single value={area} onChange={setArea} />
          </Field>
          <Field label="Category">
            <TagPicker kind="category" value={categories} onChange={setCategories} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Price">
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrice(price === p ? null : p)}
                    className={`py-2.5 rounded-xl text-sm font-black border ${price === p ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}
                  >
                    {'$'.repeat(p)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Phone">
              <input className={inputClass} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="242-555-0123" />
            </Field>
          </div>
          <Field label="Notes" hint="Becomes the description — tidy it up later.">
            <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering" />
          </Field>
        </div>
      </Panel>

      <Panel
        title="2 · Location"
        action={
          location && (
            <span className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700">
              <MapPin className="w-3.5 h-3.5" /> {locationSource === 'gps' ? 'From GPS' : locationSource === 'photo' ? 'From photo' : 'Set'}
            </span>
          )
        }
      >
        <LocationField
          value={location}
          onChange={(v) => {
            setLocation(v);
            setLocationSource(v ? 'manual' : null);
          }}
        />
      </Panel>

      <Panel title="3 · Photos">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => pick('gallery', true)} className="flex flex-col items-center justify-center gap-1 py-4 rounded-xl bg-brand-600 text-white font-extrabold hover:bg-brand-700">
            <Camera className="w-6 h-6" /> The place
          </button>
          <button type="button" onClick={() => pick('menu', true)} className="flex flex-col items-center justify-center gap-1 py-4 rounded-xl bg-amber-500 text-white font-extrabold hover:bg-amber-600">
            <BookOpen className="w-6 h-6" /> Drinks menu
          </button>
          <button type="button" onClick={() => pick('gallery', false)} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50">
            <ImagePlus className="w-4 h-4" /> From library
          </button>
          <button type="button" onClick={() => pick('menu', false)} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50">
            <ImagePlus className="w-4 h-4" /> Menu from library
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

        {queue.length > 0 && (
          <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-4">
            {queue.map((q, i) => (
              <li key={q.preview} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100">
                <img src={q.preview} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setQueue((list) => list.map((x, j) => (j === i ? { ...x, kind: x.kind === 'menu' ? 'gallery' : 'menu' } : x)))}
                  className={`absolute bottom-1 left-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${q.kind === 'menu' ? 'bg-amber-400 text-amber-950' : 'bg-white/90 text-slate-800'}`}
                  title="Tap to switch between gallery and menu"
                >
                  {q.kind === 'menu' ? 'Menu' : 'Gallery'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(q.preview);
                    setQueue((list) => list.filter((_, j) => j !== i));
                  }}
                  className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white"
                  aria-label="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-4 z-[1000]">
        <Button onClick={save} disabled={!!saving} className="w-full py-4 text-base shadow-xl shadow-brand-600/30">
          {saving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" /> {saving}
            </>
          ) : (
            `Save draft${queue.length ? ` with ${queue.length} photo${queue.length === 1 ? '' : 's'}` : ''}`
          )}
        </Button>
      </div>
    </div>
  );
}
