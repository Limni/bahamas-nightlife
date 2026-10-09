import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarHeart, CalendarPlus, Map as MapIcon } from 'lucide-react';
import { useDirectory } from '@/lib/directory';
import { compareEvents, eventNextStart, isEventEnded, isEventLive, isEventSoon } from '@/lib/events';
import { supabaseConfigured } from '@/lib/supabase';
import { useNow } from '@/lib/useNow';
import type { NightEvent } from '@/lib/types';
import { EventCard } from '@/components/EventCard';
import { EmptyState, Spinner } from '@/components/ui';
import { SetupNotice } from '@/components/SetupNotice';

type Range = 'all' | 'tonight' | 'week' | 'featured';

const WEEK_MS = 7 * 86_400_000;

function Group({ title, eyebrow, events, now }: { title: string; eyebrow?: string; events: NightEvent[]; now: number }) {
  if (events.length === 0) return null;
  return (
    <section className="mt-8">
      {eyebrow && <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand-300 mb-1">{eyebrow}</p>}
      <h2 className="font-display text-xl font-bold text-white mb-4">{title}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {events.map((e) => (
          <EventCard key={e.id} e={e} now={now} wide />
        ))}
      </div>
    </section>
  );
}

/** "/events": highlighted nights, live ones first (Island GO's events list, nightlife edition). */
export default function EventsPage() {
  const { events, loading } = useDirectory();
  const now = useNow();
  const [range, setRange] = useState<Range>('all');

  const groups = useMemo(() => {
    let list = events.filter((e) => !isEventEnded(e, now)).sort(compareEvents(now));
    if (range === 'tonight') list = list.filter((e) => isEventSoon(e, now));
    if (range === 'week') list = list.filter((e) => eventNextStart(e, now) - now < WEEK_MS);
    if (range === 'featured') list = list.filter((e) => e.is_featured);
    const live = list.filter((e) => isEventLive(e, now));
    const tonight = list.filter((e) => !isEventLive(e, now) && isEventSoon(e, now));
    const week = list.filter((e) => !live.includes(e) && !tonight.includes(e) && eventNextStart(e, now) - now < WEEK_MS);
    const later = list.filter((e) => !live.includes(e) && !tonight.includes(e) && !week.includes(e));
    return { live, tonight, week, later, total: list.length };
  }, [events, now, range]);

  const ranges: [Range, string][] = [
    ['all', 'Everything'],
    ['tonight', 'Tonight'],
    ['week', 'Next 7 days'],
    ['featured', 'Featured'],
  ];

  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-6 pb-12">
      <section className="pt-8 md:pt-12">
        <p className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-glow-300">
          <CalendarHeart className="w-4 h-4" /> What’s on
        </p>
        <h1 className="mt-2 font-display text-3xl md:text-5xl font-extrabold text-white tracking-tight">
          Events <span className="text-brand-300 neon-text">in Nassau</span>
        </h1>
        <p className="mt-2 text-night-200 font-semibold md:text-lg max-w-2xl">
          DJ nights, live bands, beach parties and boat cruises. Events that are on right now glow on the map.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {ranges.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={`px-4 py-2 rounded-full text-sm font-extrabold transition-colors ${
                range === key ? 'bg-brand-500 text-white glow-brand' : 'bg-night-900 border border-white/10 text-night-100 hover:border-brand-400/60'
              }`}
            >
              {label}
            </button>
          ))}
          <Link to="/map" className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-extrabold text-brand-300 hover:text-brand-200">
            <MapIcon className="w-4 h-4" /> See them on the map
          </Link>
        </div>
      </section>

      {!supabaseConfigured && <SetupNotice />}

      {loading && events.length === 0 ? (
        <div className="flex justify-center py-24">
          <Spinner className="w-8 h-8" />
        </div>
      ) : groups.total === 0 ? (
        <EmptyState icon={<CalendarHeart className="w-8 h-8" />} title={range === 'all' ? 'No events listed yet' : 'Nothing on for that'}>
          Know about a party, a show or a DJ night?{' '}
          <Link to="/community?kind=event" className="font-bold text-brand-300 underline">
            Tip us off
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          <Group eyebrow="Happening now" title="Live" events={groups.live} now={now} />
          <Group eyebrow="Starting soon" title="Tonight" events={groups.tonight} now={now} />
          <Group title="This week" events={groups.week} now={now} />
          <Group title="Coming up" events={groups.later} now={now} />
        </>
      )}

      <div className="mt-12 flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-3xl bg-night-900 border border-white/10">
        <div>
          <p className="font-extrabold text-white">Throwing a party?</p>
          <p className="text-sm font-semibold text-night-300">Send us the details and a flyer, and we’ll get it listed and on the map.</p>
        </div>
        <Link
          to="/community?kind=event"
          className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-brand-500 text-white font-extrabold hover:bg-brand-400 glow-brand"
        >
          <CalendarPlus className="w-5 h-5" /> Submit an event
        </Link>
      </div>
    </div>
  );
}
