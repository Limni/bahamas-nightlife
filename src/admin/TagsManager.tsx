import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDirectory } from '@/lib/directory';
import type { Tag, TagKind } from '@/lib/types';
import { Button, inputClass, Panel, useFeedback } from './ui';

const KINDS: { kind: TagKind; title: string; hint: string }[] = [
  { kind: 'vibe', title: 'Vibes', hint: 'The feel of a place — shown as quick filters.' },
  { kind: 'category', title: 'Categories', hint: 'What they serve. The first category on a spot sets its map pin.' },
  { kind: 'area', title: 'Areas', hint: 'Neighbourhoods. Each spot has one.' },
];

function TagList({ kind, title, hint }: { kind: TagKind; title: string; hint: string }) {
  const { tags, venues, refresh } = useDirectory();
  const { toast, confirm } = useFeedback();
  const [draft, setDraft] = useState('');
  const list = tags.filter((t) => t.kind === kind);

  const usage = (label: string) =>
    venues.filter((r) => (kind === 'area' ? r.area === label : kind === 'category' ? r.categories.includes(label) : r.vibes.includes(label))).length;

  const add = async () => {
    const label = draft.trim();
    if (!label) return;
    const sort = list.reduce((m, t) => Math.max(m, t.sort), 0) + 1;
    const { error } = await supabase.from('tags').insert({ kind, label, sort });
    if (error) return toast(error.code === '23505' ? 'That one already exists.' : error.message, 'error');
    setDraft('');
    refresh();
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a: Tag = list[i];
    const b: Tag = list[j];
    // Renumber the whole list so ties from bulk inserts can't make swaps no-ops.
    const reordered = [...list];
    [reordered[i], reordered[j]] = [b, a];
    await Promise.all(reordered.map((t, idx) => (t.sort === idx + 1 ? null : supabase.from('tags').update({ sort: idx + 1 }).eq('id', t.id))));
    refresh();
  };

  const remove = async (t: Tag) => {
    const n = usage(t.label);
    const ok = await confirm({
      title: `Remove “${t.label}”?`,
      body: n ? `${n} live spot(s) use it. They keep the label, but it won’t be offered as a filter.` : undefined,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('tags').delete().eq('id', t.id);
    if (error) return toast(error.message, 'error');
    refresh();
  };

  return (
    <Panel title={title}>
      <p className="text-xs font-semibold text-slate-500 mb-3">{hint}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex gap-2 mb-3"
      >
        <input className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} placeholder={`Add a ${kind}`} />
        <Button type="submit" disabled={!draft.trim()}>
          <Plus className="w-4 h-4" />
        </Button>
      </form>
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
        {list.map((t, i) => (
          <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
            <span className="flex-1 text-sm font-bold text-slate-800">{t.label}</span>
            <span className="text-xs font-bold text-slate-400 w-8 text-right">{usage(t.label) || ''}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move up">
              <ArrowUp className="w-4 h-4" />
            </button>
            <button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move down">
              <ArrowDown className="w-4 h-4" />
            </button>
            <button onClick={() => remove(t)} className="p-1 rounded text-slate-400 hover:text-rose-600" aria-label="Remove">
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function TagsManager() {
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Tags</h1>
        <p className="text-sm font-semibold text-slate-500">The options people filter by. Changes show up on the site immediately.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {KINDS.map((k) => (
          <div key={k.kind} className={k.kind === 'area' ? 'md:col-span-2' : ''}>
            <TagList {...k} />
          </div>
        ))}
      </div>
    </div>
  );
}
