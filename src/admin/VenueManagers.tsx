import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Store, UserMinus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui';
import { Button, inputClass, Panel, useFeedback } from './ui';

type Role = 'manager' | 'staff';

interface Manager {
  user_id: string;
  email: string | null;
  display_name: string;
  role: Role;
  created_at: string;
}

const ROLE_LABEL: Record<Role, string> = { manager: 'Manager', staff: 'Staff' };

interface Found {
  id: string;
  email: string | null;
  display_name: string;
  is_admin: boolean;
  banned_until: string | null;
}

/**
 * Admin: who can manage this venue from /manage. Managers edit the listing,
 * photos, menus, events and (at reward partners) the rewards, but not
 * publishing, featuring, the slug, the activity radius, reviews or likes.
 * Staff only scan members' codes to redeem points (bartenders).
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

  const add = async (m: Found, role: Role) => {
    setBusy(m.id);
    const { error } = await supabase.from('venue_managers').insert({ venue_id: venueId, user_id: m.id, role });
    setBusy(null);
    if (error) return toast(error.code === '23505' ? 'They’re already on this venue' : error.message, 'error');
    toast(role === 'staff' ? `${m.display_name} can now redeem points at ${venueName}` : `${m.display_name} can now manage ${venueName}`);
    setQuery('');
    setFound([]);
    load();
  };

  const setRole = async (m: Manager, role: Role) => {
    setBusy(m.user_id);
    const { error } = await supabase.from('venue_managers').update({ role }).eq('venue_id', venueId).eq('user_id', m.user_id);
    setBusy(null);
    if (error) return toast(error.message, 'error');
    load();
  };

  const remove = async (m: Manager) => {
    const ok = await confirm({
      title: `Remove ${m.display_name} from ${venueName}?`,
      body: m.role === 'staff' ? 'They’ll no longer be able to redeem points here. Their member account stays.' : `They’ll no longer be able to edit ${venueName}. Their member account stays.`,
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

  const roleOf = (id: string) => managers?.find((m) => m.user_id === id)?.role;

  return (
    <Panel title="Managers & staff" id="managers">
      <div className="space-y-4">
        <p className="text-sm font-semibold text-slate-500">
          <b>Managers</b> update this spot themselves from <b>Account → Venue manager</b>: details, hours, photos, menus, events and its rewards. They
          can’t publish, feature, delete it, or touch reviews and likes. <b>Staff</b> (bartenders) only scan members’ codes to redeem points.
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
                <select
                  className="shrink-0 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700"
                  value={m.role}
                  disabled={busy === m.user_id}
                  onChange={(e) => setRole(m, e.target.value as Role)}
                  aria-label={`${m.display_name}'s role`}
                >
                  <option value="manager">Manager</option>
                  <option value="staff">Staff</option>
                </select>
                <Button variant="ghost" className="text-rose-600 px-2.5" loading={busy === m.user_id} onClick={() => remove(m)} aria-label={`Remove ${m.display_name}`}>
                  <UserMinus className="w-4 h-4" />
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
            placeholder="Add someone: search members by name or email"
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
                {roleOf(m.id) ? (
                  <span className="text-xs font-extrabold text-emerald-700">{ROLE_LABEL[roleOf(m.id)!]}</span>
                ) : m.banned_until ? (
                  <span className="text-xs font-extrabold text-rose-600">Suspended</span>
                ) : (
                  <span className="flex gap-1.5 shrink-0">
                    <Button variant="secondary" className="px-3 py-1.5" loading={busy === m.id} onClick={() => add(m, 'manager')}>
                      <Plus className="w-4 h-4" /> Manager
                    </Button>
                    <Button variant="secondary" className="px-3 py-1.5" disabled={busy === m.id} onClick={() => add(m, 'staff')}>
                      <Plus className="w-4 h-4" /> Staff
                    </Button>
                  </span>
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
  const [rows, setRows] = useState<{ venue_id: string; role: Role; venues: { id: string; name: string } | null }[] | null>(null);
  const [role, setRole] = useState<Role>('manager');
  const [all, setAll] = useState<{ id: string; name: string; is_published: boolean }[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('venue_managers').select('venue_id, role, venues(id, name)').eq('user_id', userId);
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
    const { error } = await supabase.from('venue_managers').insert({ venue_id: pick, user_id: userId, role });
    setBusy(false);
    if (error) return toast(error.code === '23505' ? 'They’re already on that venue' : error.message, 'error');
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
              {r.role === 'staff' && <span className="text-[11px] font-extrabold uppercase text-brand-500">staff</span>}
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
        <select className={`${inputClass} py-2 min-w-0`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Venue to manage">
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
        <select className={`${inputClass} py-2 w-auto shrink-0`} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
          <option value="manager">Manager</option>
          <option value="staff">Staff</option>
        </select>
        <Button variant="secondary" loading={busy} disabled={!pick} onClick={add} className="shrink-0">
          <Plus className="w-4 h-4" /> Add
        </Button>
      </div>
    </div>
  );
}
