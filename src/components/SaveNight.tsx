import { Bookmark } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNight, type NightList } from '@/lib/night';

export function SaveNight({ kind, id }: { kind: keyof NightList; id: string }) {
  const { list, toggle, temporary } = useNight();
  const saved = list[kind].includes(id);
  return <div className="flex flex-wrap items-center gap-3 mt-4 text-sm">
    <button type="button" aria-pressed={saved} disabled={!saved && list[kind].length >= 20} onClick={() => toggle(kind, id)} className="flex items-center gap-2 rounded-2xl px-4 py-3 bg-brand-500/15 text-brand-200 font-bold disabled:opacity-50">
      <Bookmark className={`w-4 h-4 ${saved ? 'fill-current' : ''}`} />{saved ? 'Saved to my night' : 'Save to my night'}
    </button>
    <Link to="/night" className="text-brand-300 underline">View my night</Link>
    {list[kind].length >= 20 && !saved && <span role="status">Your list has 20 {kind}. Remove one to add another.</span>}
    {temporary && <span role="status">Saved for this visit only. Share your list to keep it.</span>}
  </div>;
}
