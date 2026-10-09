import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ClipboardList, Heart, ImagePlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { deleteMedia, uploadMedia } from '@/lib/images';
import type { MenuItem, MenuKind } from '@/lib/types';
import { Button, inputClass, useFeedback } from './ui';

const OTHER: Record<MenuKind, MenuKind> = { drinks: 'food', food: 'drinks' };
const LABEL: Record<MenuKind, string> = { drinks: 'Drinks', food: 'Food' };
const PASTE_EXAMPLE: Record<MenuKind, string> = {
  drinks: 'COCKTAILS:\nSky Juice - 12\nRum Punch | 14 | house rum, tropical juices\n\nBEER:\nKalik 7\nSands 7',
  food: 'BITES:\nConch Fritters - 12\nCracked Conch | 18 | fried, with fries and slaw\n\nPLATES:\nGrilled Snapper 26',
};

type Draft = { section: string; name: string; price: string; description: string };
const EMPTY: Draft = { section: '', name: '', price: '', description: '' };

/**
 * Turn pasted menu text into items. One item per line, price at the end:
 *
 *   COCKTAILS:
 *   Sky Juice - 12
 *   Rum Punch | 14.50 | house rum, tropical juices
 *
 * A line ending in ":" (or with no price and in CAPS) starts a new section.
 */
export function parseMenuText(text: string, defaultSection = 'Menu') {
  let section = defaultSection;
  const out: { section: string; name: string; price: number | null; description: string }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.endsWith(':') || (/^[^a-z]+$/.test(line) && !/\d/.test(line) && line.length < 40)) {
      section = line.replace(/:$/, '').trim();
      // "MAIN COURSES" → "Main courses"; mixed case is kept as typed.
      if (section === section.toUpperCase()) section = section.charAt(0) + section.slice(1).toLowerCase();
      continue;
    }
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length >= 2) {
      const price = parseFloat(parts[1].replace(/[^\d.]/g, ''));
      out.push({ section, name: parts[0], price: Number.isFinite(price) ? price : null, description: parts.slice(2).join(' | ') });
      continue;
    }
    const m = line.match(/^(.*?)[\s.\-–—:]*\$?\s*(\d+(?:\.\d{1,2})?)\s*$/);
    if (m && m[1]) out.push({ section, name: m[1].trim(), price: parseFloat(m[2]), description: '' });
    else out.push({ section, name: line, price: null, description: '' });
  }
  return out;
}

/** One venue's drinks or food menu: items (each with an optional photo), added one by one or pasted. */
export function MenuEditor({ venueId, menu }: { venueId: string; menu: MenuKind }) {
  const { toast, confirm } = useFeedback();
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const photoFor = useRef<MenuItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('menu_items').select('*').eq('venue_id', venueId).eq('menu', menu).order('sort').order('name');
    setItems((data as MenuItem[]) ?? []);
  };
  useEffect(() => {
    load();
  }, [venueId, menu]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(() => [...new Set((items ?? []).map((i) => i.section))], [items]);
  const grouped = useMemo(() => sections.map((s) => [s, (items ?? []).filter((i) => i.section === s)] as const), [sections, items]);
  const nextSort = () => (items ?? []).reduce((m, i) => Math.max(m, i.sort), 0) + 1;

  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    const row = {
      section: draft.section.trim() || sections[sections.length - 1] || 'Menu',
      name: draft.name.trim(),
      price: draft.price.trim() ? parseFloat(draft.price.replace(/[^\d.]/g, '')) : null,
      description: draft.description.trim() || null,
    };
    const { error } = editingId
      ? await supabase.from('menu_items').update(row).eq('id', editingId)
      : await supabase.from('menu_items').insert({ ...row, venue_id: venueId, menu, sort: nextSort() });
    setSaving(false);
    if (error) return toast(error.message, 'error');
    // Keep the section so a run of items in the same section is quick to enter.
    setDraft({ ...EMPTY, section: row.section });
    setEditingId(null);
    load();
  };

  const startEdit = (item: MenuItem) => {
    setEditingId(item.id);
    setDraft({ section: item.section, name: item.name, price: item.price?.toString() ?? '', description: item.description ?? '' });
  };

  const remove = async (item: MenuItem) => {
    const ok = await confirm({ title: `Delete “${item.name}”?`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('menu_items').delete().eq('id', item.id);
    if (error) return toast(error.message, 'error');
    await deleteMedia(item.photo_path);
    setItems((list) => list?.filter((i) => i.id !== item.id) ?? null);
  };

  const move = async (item: MenuItem) => {
    const { error } = await supabase.from('menu_items').update({ menu: OTHER[menu] }).eq('id', item.id);
    if (error) return toast(error.message, 'error');
    toast(`Moved to the ${LABEL[OTHER[menu]].toLowerCase()} menu`);
    setItems((list) => list?.filter((i) => i.id !== item.id) ?? null);
  };

  const pickPhoto = (item: MenuItem) => {
    photoFor.current = item;
    fileRef.current?.click();
  };

  const uploadPhoto = async (file: File) => {
    const item = photoFor.current;
    if (!item) return;
    setUploadingId(item.id);
    try {
      const { url, path } = await uploadMedia(file, `${venueId}/items`);
      const { error } = await supabase.from('menu_items').update({ photo_url: url, photo_path: path }).eq('id', item.id);
      if (error) {
        await deleteMedia(path);
        throw error;
      }
      await deleteMedia(item.photo_path);
      setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, photo_url: url, photo_path: path } : i)) ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploadingId(null);
    }
  };

  const removePhoto = async (item: MenuItem) => {
    const ok = await confirm({ title: `Remove the photo of “${item.name}”?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('menu_items').update({ photo_url: null, photo_path: null }).eq('id', item.id);
    if (error) return toast(error.message, 'error');
    await deleteMedia(item.photo_path);
    setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, photo_url: null, photo_path: null } : i)) ?? null);
  };

  const parsed = useMemo(() => parseMenuText(bulkText, draft.section || 'Menu'), [bulkText, draft.section]);
  const importBulk = async () => {
    if (parsed.length === 0) return;
    setSaving(true);
    let sort = nextSort();
    const { error } = await supabase.from('menu_items').insert(
      parsed.map((p) => ({ venue_id: venueId, menu, section: p.section, name: p.name, price: p.price, description: p.description || null, sort: sort++ })),
    );
    setSaving(false);
    if (error) return toast(error.message, 'error');
    toast(`${parsed.length} items added`);
    setBulkText('');
    setBulkOpen(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
        <div className="grid grid-cols-[1fr_6.5rem] gap-2">
          <input className={inputClass} placeholder="Item name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <input className={inputClass} placeholder="Price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <input className={inputClass} placeholder={`Section (${sections[sections.length - 1] ?? 'Menu'})`} list={`sections-${venueId}-${menu}`} value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })} />
          <datalist id={`sections-${venueId}-${menu}`}>
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input className={inputClass} placeholder="Description (optional)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} loading={saving} disabled={!draft.name.trim()}>
            {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {editingId ? 'Save item' : 'Add item'}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={() => { setEditingId(null); setDraft({ ...EMPTY, section: draft.section }); }}>
              <X className="w-4 h-4" /> Cancel
            </Button>
          )}
          <Button variant="secondary" onClick={() => setBulkOpen((o) => !o)} className="ml-auto">
            <ClipboardList className="w-4 h-4" /> Paste a menu
          </Button>
        </div>
      </div>

      {bulkOpen && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-600">
            One item per line with the price at the end. Lines ending in “:” start a section. Use “Name | price | description” for descriptions.
          </p>
          <textarea
            className={`${inputClass} font-mono text-sm`}
            rows={8}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={PASTE_EXAMPLE[menu]}
          />
          {parsed.length > 0 && (
            <p className="text-xs font-extrabold text-brand-700">
              {parsed.length} items in {new Set(parsed.map((p) => p.section)).size} section(s) ready to add
            </p>
          )}
          <Button onClick={importBulk} loading={saving} disabled={parsed.length === 0}>
            Add {parsed.length || ''} items
          </Button>
        </div>
      )}

      {items === null ? null : items.length === 0 ? (
        <p className="text-sm font-semibold text-slate-400 text-center py-2">No {LABEL[menu].toLowerCase()} items yet. Menu photos work too; add them above.</p>
      ) : (
        grouped.map(([section, list]) => (
          <div key={section}>
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-1">{section}</h4>
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
              {list.map((item) => (
                <li key={item.id} className={`flex items-center gap-2 px-3 py-2 ${editingId === item.id ? 'bg-brand-50' : ''}`}>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => pickPhoto(item)}
                      disabled={uploadingId === item.id}
                      title={item.photo_url ? 'Replace photo' : 'Add a photo'}
                      className="w-12 h-12 rounded-lg overflow-hidden border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-slate-400 hover:border-brand-400 hover:text-brand-600"
                    >
                      {uploadingId === item.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : item.photo_url ? (
                        <img src={item.photo_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImagePlus className="w-4 h-4" />
                      )}
                    </button>
                    {item.photo_url && uploadingId !== item.id && (
                      <button
                        type="button"
                        onClick={() => removePhoto(item)}
                        aria-label="Remove photo"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900 truncate">{item.name}</p>
                    {item.description && <p className="text-xs text-slate-500 truncate">{item.description}</p>}
                  </div>
                  {item.like_count > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-xs font-extrabold text-rose-500" title={`${item.like_count} likes`}>
                      <Heart className="w-3.5 h-3.5 fill-current" /> {item.like_count}
                    </span>
                  )}
                  {item.price != null && <span className="text-sm font-extrabold text-brand-700">${Number(item.price).toFixed(2)}</span>}
                  <button type="button" onClick={() => move(item)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50" aria-label={`Move to ${LABEL[OTHER[menu]]}`} title={`Move to the ${LABEL[OTHER[menu]].toLowerCase()} menu`}>
                    <ArrowLeftRight className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => startEdit(item)} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50" aria-label="Edit">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => remove(item)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50" aria-label="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadPhoto(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
