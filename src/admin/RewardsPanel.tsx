import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Gift, Plus, ScanLine, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Reward } from '@/lib/rewards';
import { Spinner } from '@/components/ui';
import { useConsole } from './console';
import { Button, Field, inputClass, Panel, Toggle, useFeedback } from './ui';

// ---------------------------------------------------------------------------
// The venue editor's Rewards panel. Admins switch the sponsorship on (dates
// and a private note about the deal); while it runs, the venue's managers
// set the rewards and their point costs themselves. Editors never see this.
// ---------------------------------------------------------------------------

interface Partner {
  venue_id: string;
  is_active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  note: string | null;
}

type Draft = { title: string; description: string; cost: string; nightly_limit: string };
const EMPTY: Draft = { title: '', description: '', cost: '', nightly_limit: '' };

function toDraft(r: Reward): Draft {
  return { title: r.title, description: r.description ?? '', cost: String(r.cost), nightly_limit: r.nightly_limit ? String(r.nightly_limit) : '' };
}

/** Validates and converts a draft; returns a message on a problem. */
function fromDraft(d: Draft): { title: string; description: string | null; cost: number; nightly_limit: number | null } | string {
  const title = d.title.trim();
  const cost = Math.round(Number(d.cost));
  const limit = d.nightly_limit.trim() ? Math.round(Number(d.nightly_limit)) : null;
  if (!title) return 'Give the reward a name, like “Free rum punch”.';
  if (!Number.isFinite(cost) || cost < 1 || cost > 100000) return 'Cost must be 1 to 100,000 points.';
  if (limit !== null && (!Number.isFinite(limit) || limit < 1 || limit > 20)) return 'Limit per night must be 1 to 20, or empty for no limit.';
  return { title: title.slice(0, 60), description: d.description.trim().slice(0, 200) || null, cost, nightly_limit: limit };
}

function RewardForm({ initial, onSave, onCancel, saving }: { initial: Draft; onSave: (d: Draft) => void; onCancel: () => void; saving: boolean }) {
  const [d, setD] = useState(initial);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <div className="space-y-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-3">
        <Field label="Reward">
          <input className={inputClass} value={d.title} onChange={set('title')} maxLength={60} placeholder="Free rum punch" />
        </Field>
        <Field label="Cost (points)">
          <input className={inputClass} value={d.cost} onChange={set('cost')} inputMode="numeric" placeholder="20" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-3">
        <Field label="Details (optional)">
          <input className={inputClass} value={d.description} onChange={set('description')} maxLength={200} placeholder="House rum punch, any night" />
        </Field>
        <Field label="Per night" hint="Per member; empty = no limit">
          <input className={inputClass} value={d.nightly_limit} onChange={set('nightly_limit')} inputMode="numeric" placeholder="1" />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => onSave(d)} loading={saving}>
          Save reward
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function RewardsPanel({ venueId, venueName }: { venueId: string; venueName: string }) {
  const { role, base } = useConsole();
  const isAdmin = role === 'admin';
  const { toast, confirm } = useFeedback();
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined);
  const [isPartner, setIsPartner] = useState<boolean | null>(null);
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // reward id or 'new'
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Partner>({ venue_id: venueId, is_active: true, starts_on: null, ends_on: null, note: null });

  const load = useCallback(async () => {
    const [p, live, list, used] = await Promise.all([
      isAdmin ? supabase.from('reward_partners').select('*').eq('venue_id', venueId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      supabase.rpc('is_reward_partner', { p_venue: venueId }),
      supabase.from('rewards').select('*').eq('venue_id', venueId).order('sort').order('cost'),
      supabase
        .from('redemptions')
        .select('reward_id')
        .eq('venue_id', venueId)
        .is('voided_at', null)
        .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString()),
    ]);
    if (live.error || list.error) return setMissing(true);
    setIsPartner(live.data === true);
    setRewards((list.data ?? []) as Reward[]);
    const c: Record<string, number> = {};
    for (const r of (used.data ?? []) as { reward_id: string | null }[]) if (r.reward_id) c[r.reward_id] = (c[r.reward_id] ?? 0) + 1;
    setCounts(c);
    if (isAdmin) {
      const row = (p.data as Partner | null) ?? null;
      setPartner(row);
      setForm(row ?? { venue_id: venueId, is_active: true, starts_on: null, ends_on: null, note: null });
    }
  }, [venueId, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const savePartner = async (on: boolean) => {
    setBusy('partner');
    if (!on) {
      const ok = await confirm({
        title: `End ${venueName}’s rewards?`,
        body: 'Members can’t redeem here any more and its rewards are hidden (kept for later). Past redemptions stay.',
        confirmLabel: 'End partnership',
        danger: true,
      });
      if (!ok) return setBusy(null);
      const { error } = await supabase.from('reward_partners').delete().eq('venue_id', venueId);
      setBusy(null);
      if (error) return toast(error.message, 'error');
      toast('Rewards ended for this venue');
      return load();
    }
    if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) {
      setBusy(null);
      return toast('The end date is before the start date.', 'error');
    }
    const { error } = await supabase
      .from('reward_partners')
      .upsert({ venue_id: venueId, is_active: form.is_active, starts_on: form.starts_on || null, ends_on: form.ends_on || null, note: form.note?.trim() || null });
    setBusy(null);
    if (error) return toast(error.message, 'error');
    toast(partner ? 'Partnership saved' : `${venueName} is now a reward partner`);
    load();
  };

  const saveReward = async (d: Draft, existing?: Reward) => {
    const v = fromDraft(d);
    if (typeof v === 'string') return toast(v, 'error');
    setBusy(existing?.id ?? 'new');
    const { error } = existing
      ? await supabase.from('rewards').update(v).eq('id', existing.id)
      : await supabase.from('rewards').insert({ ...v, venue_id: venueId, sort: (rewards?.length ?? 0) + 1 });
    setBusy(null);
    if (error) return toast(error.code === '42501' ? 'Rewards can only be changed while the venue is a reward partner.' : error.message, 'error');
    setEditing(null);
    toast(existing ? 'Reward saved' : 'Reward added');
    load();
  };

  const toggleActive = async (r: Reward) => {
    const { error } = await supabase.from('rewards').update({ is_active: !r.is_active }).eq('id', r.id);
    if (error) return toast(error.message, 'error');
    load();
  };

  const remove = async (r: Reward) => {
    const ok = await confirm({ title: `Delete ${r.title}?`, body: 'Past redemptions keep their record. To pause it instead, switch it off.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('rewards').delete().eq('id', r.id);
    if (error) return toast(error.message, 'error');
    load();
  };

  const move = async (i: number, dir: -1 | 1) => {
    if (!rewards) return;
    const j = i + dir;
    if (j < 0 || j >= rewards.length) return;
    const next = [...rewards];
    [next[i], next[j]] = [next[j], next[i]];
    setRewards(next);
    await Promise.all(next.map((r, k) => (r.sort === k + 1 ? null : supabase.from('rewards').update({ sort: k + 1 }).eq('id', r.id))));
    load();
  };

  return (
    <Panel title="Rewards" id="rewards" action={<Gift className="w-5 h-5 text-amber-500" />}>
      {missing ? (
        <p className="text-sm font-semibold text-slate-500">Rewards aren’t in the database yet. Re-run supabase/schema.sql.</p>
      ) : isPartner === null || rewards === null ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {isAdmin ? (
            <div className="space-y-3 p-3 rounded-xl border border-slate-200">
              <Toggle
                checked={!!partner}
                onChange={(on) => savePartner(on)}
                label="Reward partner"
                hint="Part of a sponsorship: members can spend points here and its managers set the rewards."
              />
              {partner && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Starts (optional)">
                      <input type="date" className={inputClass} value={form.starts_on ?? ''} onChange={(e) => setForm({ ...form, starts_on: e.target.value || null })} />
                    </Field>
                    <Field label="Ends (optional)" hint="Rewards stop after this day.">
                      <input type="date" className={inputClass} value={form.ends_on ?? ''} onChange={(e) => setForm({ ...form, ends_on: e.target.value || null })} />
                    </Field>
                  </div>
                  <Field label="Deal notes (admins only)">
                    <textarea
                      className={`${inputClass} resize-y`}
                      rows={2}
                      maxLength={500}
                      value={form.note ?? ''}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                      placeholder="Package, contact, what they fund…"
                    />
                  </Field>
                  <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Active" hint="Pause redemptions without ending the deal." />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" loading={busy === 'partner'} onClick={() => savePartner(true)}>
                      Save partnership
                    </Button>
                    <span className={`text-xs font-extrabold ${isPartner ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {isPartner ? 'Taking points now' : 'Not taking points today (paused, outside its dates, or the spot is a draft)'}
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : (
            !isPartner && (
              <p className="text-sm font-semibold text-slate-500">
                Members earn points for checking in and can spend them at bars that partner with Nassau Nights.{' '}
                <Link to="/community?kind=other" className="font-extrabold text-brand-700 hover:underline">
                  Ask us about a rewards sponsorship
                </Link>{' '}
                to offer rewards at {venueName}.
              </p>
            )
          )}

          {(isPartner || (isAdmin && partner) || rewards.length > 0) && (
            <>
              <p className="text-sm font-semibold text-slate-500">
                Set what points buy here. Members see these on the spot’s page; staff redeem them by scanning the member’s code.
              </p>
              {rewards.length === 0 && editing !== 'new' && <p className="text-sm font-semibold text-slate-400">No rewards yet.</p>}
              <ul className="space-y-2">
                {rewards.map((r, i) =>
                  editing === r.id ? (
                    <li key={r.id}>
                      <RewardForm initial={toDraft(r)} saving={busy === r.id} onCancel={() => setEditing(null)} onSave={(d) => saveReward(d, r)} />
                    </li>
                  ) : (
                    <li key={r.id} className={`flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 ${r.is_active ? '' : 'opacity-60'}`}>
                      <button type="button" onClick={() => setEditing(r.id)} className="min-w-0 flex-1 text-left">
                        <span className="block font-extrabold text-slate-900 truncate">{r.title}</span>
                        <span className="block text-xs font-semibold text-slate-500 truncate">
                          {r.cost} points
                          {r.nightly_limit ? ` · ${r.nightly_limit} a night` : ''}
                          {` · ${counts[r.id] ?? 0} redeemed in 30 days`}
                          {r.is_active ? '' : ' · off'}
                        </span>
                      </button>
                      <button type="button" onClick={() => toggleActive(r)} className="px-2 py-1 rounded-lg text-xs font-extrabold text-slate-600 hover:bg-slate-100">
                        {r.is_active ? 'Turn off' : 'Turn on'}
                      </button>
                      <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${r.title} up`}>
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button type="button" disabled={i === rewards.length - 1} onClick={() => move(i, 1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${r.title} down`}>
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => remove(r)} className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50" aria-label={`Delete ${r.title}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ),
                )}
              </ul>
              {editing === 'new' ? (
                <RewardForm initial={EMPTY} saving={busy === 'new'} onCancel={() => setEditing(null)} onSave={(d) => saveReward(d)} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setEditing('new')} disabled={!isPartner && !isAdmin}>
                    <Plus className="w-4 h-4" /> Add a reward
                  </Button>
                  {isPartner && (
                    <Link
                      to={`/manage/redeem?venue=${venueId}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-extrabold text-slate-700 bg-slate-100 hover:bg-slate-200"
                    >
                      <ScanLine className="w-4 h-4" /> Open the scanner
                    </Link>
                  )}
                </div>
              )}
              {base === '/manage' && (
                <p className="text-xs font-semibold text-slate-400">Bartenders can scan without editing your listing: ask the team to add them as staff.</p>
              )}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
