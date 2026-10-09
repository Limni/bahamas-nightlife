import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarHeart, MapPinOff, Plus, Repeat, Search, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { compareEvents, eventPosition, eventWhen, isEventEnded, isEventLive, isRecurring } from '@/lib/events';
import type { NightEvent, Venue } from '@/lib/types';
import { useNow } from '@/lib/useNow';
import { Spinner } from '@/components/ui';
import { inputClass } from './ui';
import { useConsole } from './console';

type View = 'upcoming' | 'live' | 'drafts' | 'past';

type Row = NightEvent & { venues: Pick<Venue, 'id' | 'name' | 'lat' | 'lng'> | null };

/** All events, drafts and past ones included. */
export default function EventsList() {
  const now = useNow();
  const { base, venueIds } = useConsole();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [view, setView] = useState<View>('upcoming');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let q = supabase.from('events').select('*, venues(id, name, lat, lng)').order('start_date', { ascending: false }).limit(500);
    // A manager sees the events at their venues (RLS would also show everyone's published ones).
    if (venueIds) q = q.in('venue_id', venueIds);
    q.then(({ data }) => setRows((data as Row[]) ?? []));
  }, [venueIds]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    let list = rows.filter((e) => !q || `${e.title} ${e.venues?.name ?? ''}`.toLowerCase().includes(q));
    if (view === 'upcoming') list = list.filter((e) => e.is_published && !isEventEnded(e, now)).sort(compareEvents(now));
    if (view === 'live') list = list.filter((e) => e.is_published && isEventLive(e, now));
    if (view === 'drafts') list = list.filter((e) => !e.is_published);
    if (view === 'past') list = list.filter((e) => isEventEnded(e, now));
    return list;
  }, [rows, view, query, now]);

  const counts = useMemo(() => {
    const r = rows ?? [];
    return {
      upcoming: r.filter((e) => e.is_published && !isEventEnded(e, now)).length,
      live: r.filter((e) => e.is_published && isEventLive(e, now)).length,
      drafts: r.filter((e) => !e.is_published).length,
      past: r.filter((e) => isEventEnded(e, now)).length,
    };
  }, [rows, now]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Events</h1>
          <p className="text-sm font-semibold text-slate-500">Highlighted nights. Live ones pulse on the public map.</p>
        </div>
        <Link
          to={`${base}/events/new`}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-extrabold hover:bg-brand-700 shadow-sm"
        >
          <Plus className="w-4 h-4" /> New event
        </Link>
      </div>

      <label className="relative block">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input className={`${inputClass} pl-10`} placeholder="Search events or venues" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {(
          [
            ['upcoming', 'Upcoming'],
            ['live', 'Live now'],
            ['drafts', 'Drafts'],
            ['past', 'Past'],
          ] as [View, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-extrabold ${view === key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}
          >
            {label} <span className="opacity-60">{counts[key]}</span>
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center py-16">
          <CalendarHeart className="w-8 h-8 mx-auto text-slate-300" />
          <p className="mt-2 font-extrabold text-slate-700">Nothing here</p>
          <p className="text-sm font-semibold text-slate-500">Add a DJ night, a live band or a beach party with “New event”.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((e) => {
            const live = isEventLive(e, now);
            const pinned = eventPosition(e, (e.venues ?? undefined) as Venue | undefined) !== null;
            return (
              <li key={e.id}>
                <Link to={`${base}/events/${e.id}`} className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200 hover:border-brand-300 hover:shadow-sm transition-all">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-gradient-to-br from-brand-500 to-glow-500 shrink-0">
                    {e.image_url && <img src={e.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-slate-900 truncate">{e.title}</p>
                    <p className="text-sm font-semibold text-slate-500 truncate">
                      {isEventEnded(e, now) ? new Date(e.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : eventWhen(e, now)}
                      {e.venues && ` · ${e.venues.name}`}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {live && <span className="px-1.5 py-0.5 rounded-md bg-brand-600 text-white text-[10px] font-extrabold uppercase">Live</span>}
                      {!e.is_published && <span className="px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-600 text-[10px] font-extrabold uppercase">Draft</span>}
                      {isRecurring(e) && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-brand-50 text-brand-700 text-[10px] font-extrabold uppercase">
                          <Repeat className="w-3 h-3" /> {e.end_date ? 'Weekly' : 'Weekly · no end'}
                        </span>
                      )}
                      {e.is_featured && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase">
                          <Star className="w-3 h-3" /> Featured
                        </span>
                      )}
                      {!pinned && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase">
                          <MapPinOff className="w-3 h-3" /> No pin
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
