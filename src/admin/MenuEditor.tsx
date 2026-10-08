import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Pencil, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { MenuItem } from '@/lib/types';
import { Button, inputClass, useFeedback } from './ui';

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

export function MenuEditor({ venueId }: { venueId: string }) {
  const { toast, confirm } = useFeedback();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('menu_items').select('*').eq('venue_id', venueId).order('sort').order('name');
    setItems((data as MenuItem[]) ?? []);
  };
  useEffect(() => {
    load();
  }, [venueId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      : await supabase.from('menu_items').insert({ ...row, venue_id: venueId, sort: nextSort() });
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
    setItems((list) => list?.filter((i) => i.id !== item.id) ?? null);
  };

  const parsed = useMemo(() => parseMenuText(bulkText, draft.section || 'Menu'), [bulkText, draft.section]);
  const importBulk = async () => {
    if (parsed.length === 0) return;
    setSaving(true);
    let sort = nextSort();
    const { error } = await supabase.from('menu_items').insert(
      parsed.map((p) => ({ venue_id: venueId, section: p.section, name: p.name, price: p.price, description: p.description || null, sort: sort++ })),
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
          <input className={inputClass} placeholder={`Section (${sections[sections.length - 1] ?? 'Menu'})`} list={`sections-${venueId}`} value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })} />
          <datalist id={`sections-${venueId}`}>
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
            placeholder={'COCKTAILS:\nSky Juice - 12\nRum Punch | 14 | house rum, tropical juices\n\nBEER:\nKalik 7\nSands 7'}
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
        <p className="text-sm font-semibold text-slate-400 text-center py-2">No menu items yet. Menu photos work too — add them above.</p>
      ) : (
        grouped.map(([section, list]) => (
          <div key={section}>
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-1">{section}</h4>
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
              {list.map((item) => (
                <li key={item.id} className={`flex items-center gap-2 px-3 py-2 ${editingId === item.id ? 'bg-brand-50' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900 truncate">{item.name}</p>
                    {item.description && <p className="text-xs text-slate-500 truncate">{item.description}</p>}
                  </div>
                  {item.price != null && <span className="text-sm font-extrabold text-brand-700">${Number(item.price).toFixed(2)}</span>}
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
    </div>
  );
}
