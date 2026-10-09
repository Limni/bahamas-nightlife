import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Store, UserMinus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';
import { Button, inputClass, Panel, useFeedback } from './ui';

interface Manager {
  user_id: string;
  email: string | null;
  display_name: string;
  created_at: string;
}

interface Found {
  id: string;
  email: string | null;
  display_name: string;
  is_admin: boolean;
  banned_until: string | null;
}

/**
 * Admin: who can manage this venue from /manage. Managers edit the listing,
 * photos, menus and events here, but not publishing, featuring, the slug,
 * the activity radius, reviews or likes.
 */
export function VenueManagersPanel({ venueId, venueName }: { venueId: string; venueName: string }) {
  const { toast, confirm } = useFeedback();
  const [managers, setManagers] = useState<Manager[] | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase.rpc('admin_venue_managers', { p_venue: venueId });
    if (error) toast(error.message, 'error');
    setManagers((data as Manager[]) ?? []);
  };
  useEffect(() => {
    load();
  }, [venueId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search members as the admin types (server-side: name, email or id).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setFound([]);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('admin_list_users', { p_search: q, p_filter: 'all', p_limit: 6, p_offset: 0 });
      setFound((data as Found[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const add = async (m: Found) => {
    setBusy(m.id);
    const { error } = await supabase.from('venue_managers').insert({ venue_id: venueId, user_id: m.id });
    setBusy(null);
    if (error) return toast(error.code === '23505' ? 'They already manage this venue' : error.message, 'error');
    toast(`${m.display_name} can now manage ${venueName}`);
    setQuery('');
    setFound([]);
    load();
  };

  const remove = async (m: Manager) => {
    const ok = await confirm({
      title: `Remove ${m.display_name} as a manager?`,
      body: `They’ll no longer be able to edit ${venueName}. Their member account stays.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setBusy(m.user_id);
    const { error } = await supabase.from('venue_managers').delete().eq('venue_id', venueId).eq('user_id', m.user_id);
    setBusy(null);
    if (error) return toast(error.message, 'error');
    load();
  };

  const isManager = (id: string) => managers?.some((m) => m.user_id === id);

  return (
    <Panel title="Managers" id="managers">
      <div className="space-y-4">
        <p className="text-sm font-semibold text-slate-500">
          Members who can update this spot themselves from <b>Account → Venue manager</b>: details, hours, photos, menus and events. They can’t publish,
          feature, delete it, or touch reviews and likes.
        </p>

        {managers === null ? (
          <Spinner />
        ) : managers.length === 0 ? (
          <p className="text-sm font-semibold text-slate-400">No managers yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {managers.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 p-3">
                <span className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-glow-500 text-white font-black flex items-center justify-center shrink-0">
                  {m.display_name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold text-slate-900 truncate">{m.display_name}</span>
                  <span className="block text-xs font-semibold text-slate-500 truncate">{m.email}</span>
                </span>
                <Button variant="ghost" className="text-rose-600 px-2.5" loading={busy === m.user_id} onClick={() => remove(m)}>
                  <UserMinus className="w-4 h-4" /> Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className={`${inputClass} pl-9`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Add a manager: search members by name or email"
          />
        </div>
        {found.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 -mt-2">
            {found.map((m) => (
              <li key={m.id} className="flex items-center gap-3 p-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold text-slate-900 truncate">{m.display_name}</span>
                  <span className="block text-xs font-semibold text-slate-500 truncate">{m.email}</span>
                </span>
                {isManager(m.id) ? (
                  <span className="text-xs font-extrabold text-emerald-700">Manager</span>
                ) : m.banned_until ? (
                  <span className="text-xs font-extrabold text-rose-600">Suspended</span>
                ) : (
                  <Button variant="secondary" className="px-3 py-1.5" loading={busy === m.id} onClick={() => add(m)}>
                    <Plus className="w-4 h-4" /> Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs font-semibold text-slate-400">
          Not a member yet? <Link to="/admin/users" className="font-extrabold text-brand-700 hover:underline">Invite them</Link> first, then add them here.
        </p>
      </div>
    </Panel>
  );
}

/** Admin, on a member's row: the venues they manage, with add/remove. */
export function MemberVenues({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [rows, setRows] = useState<{ venue_id: string; venues: { id: string; name: string } | null }[] | null>(null);
  const [all, setAll] = useState<{ id: string; name: string; is_published: boolean }[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('venue_managers').select('venue_id, venues(id, name)').eq('user_id', userId);
    setRows((data as unknown as typeof rows) ?? []);
  };
  useEffect(() => {
    load();
    supabase
      .from('venues')
      .select('id, name, is_published')
      .order('name')
      .then(({ data }) => setAll(data ?? []));
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!pick) return;
    setBusy(true);
    const { error } = await supabase.from('venue_managers').insert({ venue_id: pick, user_id: userId });
    setBusy(false);
    if (error) return toast(error.code === '23505' ? 'They already manage that venue' : error.message, 'error');
    setPick('');
    load();
    onChanged();
  };

  const remove = async (venueId: string, name: string) => {
    const ok = await confirm({ title: `Stop them managing ${name}?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('venue_managers').delete().eq('venue_id', venueId).eq('user_id', userId);
    if (error) return toast(error.message, 'error');
    load();
    onChanged();
  };

  const managed = new Set((rows ?? []).map((r) => r.venue_id));

  return (
    <div className="space-y-2">
      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-sm font-semibold text-slate-400">Doesn’t manage any venues.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {rows.map((r) => (
            <li key={r.venue_id} className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-full bg-brand-50 border border-brand-200 text-sm font-bold text-brand-800">
              <Store className="w-3.5 h-3.5" />
              <Link to={`/admin/v/${r.venue_id}`} className="hover:underline">
                {r.venues?.name ?? 'Venue'}
              </Link>
              <button
                type="button"
                onClick={() => remove(r.venue_id, r.venues?.name ?? 'this venue')}
                className="w-6 h-6 rounded-full text-brand-600 hover:bg-brand-100 flex items-center justify-center"
                aria-label={`Remove ${r.venues?.name ?? 'venue'}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <select className={`${inputClass} py-2`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Venue to manage">
          <option value="">Let them manage a venue…</option>
          {all
            .filter((v) => !managed.has(v.id))
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.is_published ? '' : ' (draft)'}
              </option>
            ))}
        </select>
        <Button variant="secondary" loading={busy} disabled={!pick} onClick={add} className="shrink-0">
          <Plus className="w-4 h-4" /> Add
        </Button>
      </div>
    </div>
  );
}
