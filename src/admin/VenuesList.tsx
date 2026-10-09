import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Clock, MapPin, Plus, Search, Star, Martini } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { hasHours } from '@/lib/hours';
import { isFeatured, type Venue } from '@/lib/types';
import { Spinner } from '@/components/ui';
import { inputClass } from './ui';

type Row = Venue & {
  venue_photos: { count: number }[];
  menu_items: { count: number }[];
};

type View = 'all' | 'drafts' | 'live' | 'incomplete';

function missing(r: Row) {
  const photos = r.venue_photos[0]?.count ?? 0;
  return {
    location: r.lat == null || r.lng == null,
    hours: !hasHours(r.hours),
    photos: photos === 0 && !r.cover_url,
    phone: !r.phone,
  };
}

function Gap({ on, icon, label }: { on: boolean; icon: React.ReactNode; label: string }) {
  return (
    <span
      title={on ? `Missing ${label}` : `Has ${label}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
        on ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
      }`}
    >
      {icon}
      {label}
    </span>
  );
}

export default function VenuesList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [menuPhotoCounts, setMenuPhotoCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('all');

  useEffect(() => {
    supabase
      .from('venues')
      .select('*, venue_photos(count), menu_items(count)')
      .order('updated_at', { ascending: false })
      .then(({ data }) => setRows((data as Row[]) ?? []));
    supabase
      .from('venue_photos')
      .select('venue_id')
      .in('kind', ['menu', 'food_menu'])
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        for (const p of data ?? []) counts[p.venue_id] = (counts[p.venue_id] ?? 0) + 1;
        setMenuPhotoCounts(counts);
      });
  }, []);

  const list = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.name} ${r.area ?? ''}`.toLowerCase().includes(q)) return false;
      const m = missing(r);
      const menuMissing = (r.menu_items[0]?.count ?? 0) === 0 && !menuPhotoCounts[r.id];
      if (view === 'drafts') return !r.is_published;
      if (view === 'live') return r.is_published;
      if (view === 'incomplete') return m.location || m.hours || m.photos || menuMissing || m.phone;
      return true;
    });
  }, [rows, query, view, menuPhotoCounts]);

  const counts = useMemo(
    () => ({
      all: rows?.length ?? 0,
      live: rows?.filter((r) => r.is_published).length ?? 0,
      drafts: rows?.filter((r) => !r.is_published).length ?? 0,
    }),
    [rows],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Spots</h1>
          <p className="text-sm font-semibold text-slate-500">
            {counts.live} live · {counts.drafts} drafts
          </p>
        </div>
        <Link
          to="/admin/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-extrabold hover:bg-brand-700 shadow-sm"
        >
          <Plus className="w-4 h-4" /> Quick add
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className={`${inputClass} pl-9`} placeholder="Search by name or area" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-200 text-xs font-extrabold overflow-x-auto no-scrollbar">
          {(
            [
              ['all', `All ${counts.all}`],
              ['live', 'Live'],
              ['drafts', 'Drafts'],
              ['incomplete', 'Needs info'],
            ] as [View, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap ${view === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <Martini className="w-8 h-8 mx-auto text-slate-300" />
          <p className="mt-2 font-extrabold text-slate-700">{rows.length === 0 ? 'No spots yet' : 'Nothing matches'}</p>
          {rows.length === 0 && (
            <p className="text-sm font-semibold text-slate-500 mt-1">
              Head out and tap <b>Quick add</b> at your first spot.
            </p>
          )}
        </div>
      ) : (
        <ul className="grid gap-2">
          {list.map((r) => {
            const m = missing(r);
            const menuMissing = (r.menu_items[0]?.count ?? 0) === 0 && !menuPhotoCounts[r.id];
            return (
              <li key={r.id}>
                <Link to={`/admin/v/${r.id}`} className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200 hover:border-brand-300 hover:shadow-sm transition-all">
                  <div className="w-16 h-16 rounded-xl bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                    {r.cover_url ? <img src={r.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" /> : <Camera className="w-6 h-6 text-slate-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="font-extrabold text-slate-900 truncate">{r.name}</p>
                      {isFeatured(r) && <Star className="w-4 h-4 text-amber-500 fill-current shrink-0" />}
                    </div>
                    <p className="text-xs font-semibold text-slate-500 truncate">
                      {[r.area, r.categories.slice(0, 2).join(', ')].filter(Boolean).join(' · ') || 'No details yet'}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      <Gap on={m.location} icon={<MapPin className="w-3 h-3" />} label="Pin" />
                      <Gap on={m.hours} icon={<Clock className="w-3 h-3" />} label="Hours" />
                      <Gap on={m.photos} icon={<Camera className="w-3 h-3" />} label="Photos" />
                      <Gap on={menuMissing} icon={<Martini className="w-3 h-3" />} label="Drinks" />
                    </div>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-1 rounded-lg text-[11px] font-extrabold uppercase ${
                      r.is_published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {r.is_published ? 'Live' : 'Draft'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
