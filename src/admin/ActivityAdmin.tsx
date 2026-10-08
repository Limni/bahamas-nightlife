import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { HEAT_META, heatFor, VS_USUAL_TEXT } from '@/lib/activity';
import type { Venue, VenueActivity } from '@/lib/types';
import { Spinner } from '@/components/ui';
import { Button, Panel } from './ui';

interface Hourly {
  venue_id: string;
  hour_start: string;
  visitors: number;
  arrivals: number;
}

const hourLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Nassau', hour: 'numeric' }).format(new Date(iso)).replace(' ', '').toLowerCase();

/** Live counts per venue, the last 24 hours of tallies and 30-day visits. */
export default function ActivityAdmin() {
  const [rows, setRows] = useState<VenueActivity[] | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [hourly, setHourly] = useState<Hourly[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [a, v, h] = await Promise.all([
      supabase.rpc('venue_activity'),
      supabase.from('venues').select('*').order('name'),
      supabase.from('venue_hourly').select('*').gte('hour_start', since).order('hour_start'),
    ]);
    setLoading(false);
    if (a.error) {
      setError(a.error.message);
      setRows([]);
      return;
    }
    setError(null);
    setRows((a.data as VenueActivity[]) ?? []);
    setVenues((v.data as Venue[]) ?? []);
    setHourly((h.data as Hourly[]) ?? []);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const byVenue = useMemo(() => new Map((rows ?? []).map((r) => [r.venue_id, r])), [rows]);

  // Total visitors per hour across all venues, oldest → newest, 24 buckets.
  const series = useMemo(() => {
    const start = Math.floor(Date.now() / 3600_000) * 3600_000 - 23 * 3600_000;
    const buckets = Array.from({ length: 24 }, (_, i) => ({ t: new Date(start + i * 3600_000).toISOString(), v: 0 }));
    for (const h of hourly) {
      const i = Math.round((Date.parse(h.hour_start) - start) / 3600_000);
      if (i >= 0 && i < 24) buckets[i].v += h.visitors;
    }
    return buckets;
  }, [hourly]);
  const max = Math.max(1, ...series.map((s) => s.v));

  const table = useMemo(
    () =>
      venues
        .filter((v) => v.is_published)
        .map((v) => ({ v, a: byVenue.get(v.id) }))
        .sort((x, y) => (y.a?.live_count ?? 0) - (x.a?.live_count ?? 0) || (y.a?.visits_30d ?? 0) - (x.a?.visits_30d ?? 0) || x.v.name.localeCompare(y.v.name)),
    [venues, byVenue],
  );

  const liveTotal = (rows ?? []).reduce((s, r) => s + r.live_count, 0);
  const buzzing = (rows ?? []).filter((r) => r.live_count > 0).length;
  const visits30 = (rows ?? []).reduce((s, r) => s + r.visits_30d, 0);
  const focus = hover !== null ? series[hover] : series[series.length - 1];

  if (rows === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Activity</h1>
          <p className="text-sm font-semibold text-slate-500">Anonymous presence from visitors who turned on live activity sharing. Refreshes every minute.</p>
        </div>
        <Button variant="secondary" onClick={load} loading={loading}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {error && (
        <p className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm font-bold text-amber-900">
          Activity isn’t set up in the database yet ({error}). Re-run <code>supabase/schema.sql</code>.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Phones counted now', liveTotal],
          ['Venues buzzing', buzzing],
          ['Visits, last 30 days', visits30],
          ['Venues with history', (rows ?? []).filter((r) => r.peak_avg > 0).length],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-3xl font-black text-slate-900">{value}</p>
            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <Panel title="Visitors per hour, last 24 hours">
        <p className="text-sm font-semibold text-slate-600 min-h-5">
          <b className="text-slate-900">{focus.v}</b> visitor{focus.v === 1 ? '' : 's'} counted · {hourLabel(focus.t)}
        </p>
        <div className="mt-3 h-28 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
          {series.map((s, i) => (
            <button
              key={s.t}
              type="button"
              aria-label={`${hourLabel(s.t)}: ${s.v} visitors`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              className="flex-1 h-full flex items-end"
            >
              <span
                className={`block w-full rounded-t-[4px] ${hover === i ? 'bg-brand-500' : 'bg-brand-400/70'}`}
                style={{ height: `${Math.max(s.v ? 4 : 1.5, (s.v / max) * 100)}%` }}
              />
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-[2px] text-[10px] font-bold text-slate-400">
          {series.map((s, i) => (
            <span key={s.t} className="flex-1 text-center">
              {i % 4 === 0 ? hourLabel(s.t) : ''}
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="By venue">
        {table.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">No published venues yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-4 md:-mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                  <th className="px-4 md:px-5 py-2">Venue</th>
                  <th className="px-2 py-2">Now</th>
                  <th className="px-2 py-2 text-right">Live</th>
                  <th className="px-2 py-2 text-right">Usual now</th>
                  <th className="px-2 py-2 text-right">30-day visits</th>
                  <th className="px-4 md:px-5 py-2 text-right">Radius</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {table.map(({ v, a }) => {
                  const heat = heatFor(a);
                  return (
                    <tr key={v.id} className="font-semibold text-slate-700">
                      <td className="px-4 md:px-5 py-2.5">
                        <Link to={`/admin/v/${v.id}`} className="font-extrabold text-slate-900 hover:text-brand-700">
                          {v.name}
                        </Link>
                        {v.lat == null && <span className="ml-1.5 text-[10px] font-extrabold uppercase text-amber-700">no pin</span>}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs font-extrabold" style={{ color: heat.level === 'quiet' ? '#94a3b8' : heat.color }}>
                          <span className="w-2 h-2 rounded-full" style={{ background: 'currentColor' }} />
                          {HEAT_META[heat.level].label}
                        </span>
                        {heat.vsUsual && heat.level !== 'quiet' && <span className="block text-[11px] text-slate-400">{VS_USUAL_TEXT[heat.vsUsual]}</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{a?.live_count ?? 0}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{(a?.typical_now ?? 0).toFixed(1)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{a?.visits_30d ?? 0}</td>
                      <td className="px-4 md:px-5 py-2.5 text-right tabular-nums text-slate-500">{v.radius_m} m</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="flex gap-3 p-4 rounded-2xl bg-white border border-slate-200 text-sm font-semibold text-slate-600">
        <Activity className="w-5 h-5 text-brand-600 shrink-0" />
        <p>
          A phone counts at a venue after 4 minutes inside its radius and drops off 15 minutes after its last ping. Under 2 people shows as 0 everywhere
          (including here), so nobody is singled out. Live levels decay as phones ping; for exact decay while it’s quiet, schedule{' '}
          <code className="px-1 bg-slate-100 rounded">activity_housekeeping()</code> with pg_cron (see the end of <code className="px-1 bg-slate-100 rounded">schema.sql</code>).
        </p>
      </div>
    </div>
  );
}
