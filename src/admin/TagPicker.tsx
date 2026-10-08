import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDirectory } from '@/lib/directory';
import type { TagKind } from '@/lib/types';
import { useFeedback } from './ui';

/**
 * Pick from the managed vocabulary for a tag kind, or add a new option on the
 * spot (it's saved to the tags table, so it shows up in the public filters).
 * `single` turns it into a one-of picker (used for Area).
 */
export function TagPicker({
  kind,
  value,
  onChange,
  single,
}: {
  kind: TagKind;
  value: string[];
  onChange: (next: string[]) => void;
  single?: boolean;
}) {
  const { tagsOf, refresh } = useDirectory();
  const { toast } = useFeedback();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  // Enter submits and the input then blurs — make sure only one of them saves.
  const busy = useRef(false);
  // Keep values that were removed from the vocabulary visible so they can be unticked.
  const options = [...new Set([...tagsOf(kind), ...value])];

  const toggle = (label: string) => {
    if (single) onChange(value.includes(label) ? [] : [label]);
    else onChange(value.includes(label) ? value.filter((v) => v !== label) : [...value, label]);
  };

  const add = async () => {
    if (busy.current) return;
    busy.current = true;
    const label = draft.trim();
    if (!label) return setAdding(false);
    const { error } = await supabase.from('tags').insert({ kind, label, sort: 999 });
    if (error && error.code !== '23505') {
      busy.current = false;
      return toast(error.message, 'error');
    }
    await refresh();
    toggle(label);
    setDraft('');
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((label) => {
        const on = value.includes(label);
        return (
          <button
            key={label}
            type="button"
            onClick={() => toggle(label)}
            className={`px-3 py-1.5 rounded-full text-[13px] font-bold border transition-colors ${
              on ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-brand-300'
            }`}
          >
            {label}
          </button>
        );
      })}
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex items-center gap-1"
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            maxLength={60}
            placeholder={`New ${kind}`}
            className="px-3 py-1.5 rounded-full text-[13px] font-bold border border-brand-400 outline-none w-40"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            busy.current = false;
            setAdding(true);
          }}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] font-bold border border-dashed border-slate-300 text-slate-500 hover:border-brand-400 hover:text-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      )}
    </div>
  );
}
