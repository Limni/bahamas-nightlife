import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gift, MapPinCheck, MessageSquarePlus, ScanLine, SlidersHorizontal, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { loadPointsConfig } from '@/lib/points';
import { Spinner } from '@/components/ui';
import { Button, Field, inputClass, Panel, Toggle, useFeedback } from './ui';

// ---------------------------------------------------------------------------
// /admin/points: how many points things earn, who has the most, and the
// latest awards. Balances are sums of points_ledger rows; adjustments are
// rows too (with a note the member sees), so nothing is ever overwritten.
// ---------------------------------------------------------------------------

interface Settings {
  points_enabled: boolean;
  points_check_in: number;
  points_check_in_max: number;
  points_update: number;
  points_new_spot: number;
}

interface Leader {
  user_id: string;
  display_name: string;
  balance: number;
  check_ins: number;
  updates: number;
  last_at: string;
}

interface Entry {
  id: string;
  points: number;
  reason: 'check_in' | 'update' | 'adjust' | 'redeem';
  note: string | null;
  created_at: string;
  profiles: { display_name: string } | null;
  venues: { id: string; name: string } | null;
}

interface PartnerRow {
  venue_id: string;
  is_active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  venues: { id: string; name: string; is_published: boolean } | null;
}

interface RedemptionRow {
  id: string;
  title: string;
  points: number;
  created_at: string;
  voided_at: string | null;
  venue_id: string | null;
  profiles: { display_name: string } | null;
  venues: { name: string } | null;
}

const MISSING = 'Points aren’t in the database yet. Re-run supabase/schema.sql.';
const REASON_ICON = { check_in: MapPinCheck, update: MessageSquarePlus, adjust: SlidersHorizontal, redeem: Gift };
const REASON_LABEL = { check_in: 'Check-in', update: 'Suggestion applied', adjust: 'Adjustment', redeem: 'Redeemed' };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function NumberField({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Math.round(Number(e.target.value)))}
        className={inputClass}
      />
    </Field>
  );
}

function AdjustRow({ leader, onDone }: { leader: Leader; onDone: () => void }) {
  const { toast } = useFeedback();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = Math.round(Number(amount));
    if (!n || Math.abs(n) > 1000) return toast('Enter a number like 5 or -3 (up to 1000).', 'error');
    setBusy(true);
    const { error } = await supabase.rpc('admin_adjust_points', { p_user: leader.user_id, p_points: n, p_note: note.trim() || null });
    setBusy(false);
    if (error) return toast(error.message, 'error');
    toast(`${n > 0 ? '+' : ''}${n} for ${leader.display_name}`);
    onDone();
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[7rem_1fr_auto] gap-2 pt-2">
      <input className={inputClass} inputMode="numeric" placeholder="+5 or -3" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Points" />
      <input className={inputClass} maxLength={200} placeholder="Note they’ll see (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      <Button onClick={save} loading={busy}>
        Adjust
      </Button>
    </div>
  );
}

export default function PointsAdmin() {
  const { toast } = useFeedback();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaders, setLeaders] = useState<Leader[] | null>(null);
  const [latest, setLatest] = useState<Entry[]>([]);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [rewardCounts, setRewardCounts] = useState<Record<string, number>>({});
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const { confirm } = useFeedback();

  const loadActivity = useCallback(() => {
    supabase.rpc('admin_points_leaders', { p_limit: 50 }).then(({ data }) => setLeaders((data as Leader[]) ?? []));
    supabase
      .from('points_ledger')
      .select('id, points, reason, note, created_at, profiles(display_name), venues(id, name)')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setLatest((data ?? []) as unknown as Entry[]));
    // Rewards (absent until the schema is re-run: these just come back empty).
    supabase
      .from('reward_partners')
      .select('venue_id, is_active, starts_on, ends_on, venues(id, name, is_published)')
      .then(({ data }) => setPartners(((data ?? []) as unknown as PartnerRow[]).sort((a, b) => (a.venues?.name ?? '').localeCompare(b.venues?.name ?? ''))));
    supabase
      .from('rewards')
      .select('venue_id')
      .eq('is_active', true)
      .then(({ data }) => {
        const c: Record<string, number> = {};
        for (const r of (data ?? []) as { venue_id: string }[]) c[r.venue_id] = (c[r.venue_id] ?? 0) + 1;
        setRewardCounts(c);
      });
    supabase
      .from('redemptions')
      .select('id, title, points, created_at, voided_at, venue_id, profiles(display_name), venues(name)')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setRedemptions((data ?? []) as unknown as RedemptionRow[]));
  }, []);

  const voidRedemption = async (r: RedemptionRow) => {
    const ok = await confirm({
      title: `Undo ${r.title}?`,
      body: `Refunds ${r.points} points to ${r.profiles?.display_name ?? 'the member'}.`,
      confirmLabel: 'Undo and refund',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('void_redemption', { p_redemption: r.id });
    if (error) return toast(error.message, 'error');
    toast('Refunded');
    loadActivity();
  };

  useEffect(() => {
    supabase
      .from('site_settings')
      .select('points_enabled, points_check_in, points_check_in_max, points_update, points_new_spot')
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) return setMissing(true);
        setSettings(data as Settings);
        loadActivity();
      });
  }, [loadActivity]);

  const save = async (next: Settings) => {
    const bad =
      next.points_check_in < 0 || next.points_check_in > 20 ||
      next.points_check_in_max < 1 || next.points_check_in_max > 20 ||
      next.points_update < 0 || next.points_update > 50 ||
      next.points_new_spot < 0 || next.points_new_spot > 50 ||
      Object.values(next).some((v) => typeof v === 'number' && !Number.isFinite(v));
    if (bad) return toast('Check-ins: 0–20 points, 1–20 a night. Suggestions: 0–50 points.', 'error');
    setSaving(true);
    const { data, error } = await supabase.from('site_settings').update(next).eq('id', true).select('points_enabled');
    setSaving(false);
    if (error) return toast(error.message, 'error');
    if (!data?.length) return toast('Nothing was saved. Re-run supabase/schema.sql to create the settings row.', 'error');
    setSettings(next);
    loadPointsConfig(true);
    toast(next.points_enabled ? 'Points settings saved' : 'Points are off: no check-ins or awards until you switch them back on');
  };

  if (missing) {
    return (
      <div className="max-w-3xl mx-auto">
        <Panel title="Points">
          <p className="text-sm font-semibold text-slate-600">{MISSING}</p>
        </Panel>
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner className="w-7 h-7" />
      </div>
    );
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Points</h1>
        <p className="text-sm font-semibold text-slate-500">
          Members earn points for checking in at spots and for suggestions you apply in the Inbox, and spend them on rewards at partner bars.
        </p>
      </div>

      <Panel title="How points are earned">
        <div className="space-y-4">
          <Toggle
            checked={settings.points_enabled}
            onChange={(v) => save({ ...settings, points_enabled: v })}
            label="Points are on"
            hint="Off hides Check in and points everywhere and pauses new awards. Balances are kept."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NumberField label="Points per check-in" hint="Once per spot per night, after a 4-minute stay." value={settings.points_check_in} min={0} max={20} onChange={(n) => set('points_check_in', n)} />
            <NumberField label="Check-ins per night" hint="Spots a member can check in at per night." value={settings.points_check_in_max} min={1} max={20} onChange={(n) => set('points_check_in_max', n)} />
            <NumberField label="Applied update (default)" hint="Info updates, closures, event tips. You can change it per suggestion." value={settings.points_update} min={0} max={50} onChange={(n) => set('points_update', n)} />
            <NumberField label="Applied new spot (default)" value={settings.points_new_spot} min={0} max={50} onChange={(n) => set('points_new_spot', n)} />
          </div>
          <Button onClick={() => save(settings)} loading={saving}>
            Save
          </Button>
        </div>
      </Panel>

      <Panel
        title="Reward partners"
        action={
          <Link to="/manage/redeem" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-extrabold text-slate-700 bg-slate-100 hover:bg-slate-200">
            <ScanLine className="w-4 h-4" /> Scanner
          </Link>
        }
      >
        <p className="text-sm font-semibold text-slate-500 mb-3">
          Make a spot a partner in its editor (<b>Rewards</b> panel): dates, deal notes, and its rewards. Its managers can then set rewards themselves, and staff
          you add under <b>Managers &amp; staff</b> scan members’ codes.
        </p>
        {partners.length === 0 ? (
          <p className="text-sm font-semibold text-slate-400">No partners yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {partners.map((p) => {
              const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Nassau' });
              const live = p.is_active && !!p.venues?.is_published && (!p.starts_on || p.starts_on <= today) && (!p.ends_on || p.ends_on >= today);
              return (
                <li key={p.venue_id} className="flex items-center gap-3 py-2.5">
                  <Gift className={`w-4 h-4 shrink-0 ${live ? 'text-amber-500' : 'text-slate-300'}`} />
                  <span className="min-w-0 flex-1">
                    <Link to={`/admin/v/${p.venue_id}#rewards`} className="block font-extrabold text-slate-900 truncate hover:text-brand-700">
                      {p.venues?.name ?? 'Venue'}
                    </Link>
                    <span className="block text-xs font-semibold text-slate-500">
                      {rewardCounts[p.venue_id] ?? 0} reward{rewardCounts[p.venue_id] === 1 ? '' : 's'}
                      {p.ends_on ? ` · until ${p.ends_on}` : ''}
                      {live ? '' : ' · not taking points today'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Recent redemptions">
        {redemptions.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {redemptions.map((r) => (
              <li key={r.id} className={`flex items-center gap-3 py-2 ${r.voided_at ? 'opacity-50' : ''}`}>
                <Gift className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-bold text-slate-900 truncate">
                    {r.profiles?.display_name ?? 'Member'} · {r.title} · {r.venues?.name ?? 'Venue'}
                  </span>
                  <span className="block text-xs font-semibold text-slate-500">
                    {when(r.created_at)} · {r.points} points{r.voided_at ? ' · undone, refunded' : ''}
                  </span>
                </span>
                {!r.voided_at && (
                  <Button variant="ghost" className="px-2.5 py-1.5 text-slate-500" onClick={() => voidRedemption(r)} aria-label={`Undo ${r.title}`}>
                    <Undo2 className="w-4 h-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Top members">
        {leaders === null ? (
          <Spinner className="w-6 h-6" />
        ) : leaders.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">No points earned yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {leaders.map((l, i) => (
              <li key={l.user_id} className="py-2.5">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-right text-xs font-extrabold text-slate-400">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold text-slate-900 truncate">{l.display_name}</span>
                    <span className="block text-xs font-semibold text-slate-500">
                      {l.check_ins} check-in{l.check_ins === 1 ? '' : 's'} · {l.updates} applied suggestion{l.updates === 1 ? '' : 's'} · last {when(l.last_at)}
                    </span>
                  </span>
                  <span className="font-black text-amber-600 tabular-nums">{l.balance}</span>
                  <Button variant="ghost" className="px-2.5 py-1.5" onClick={() => setAdjusting(adjusting === l.user_id ? null : l.user_id)}>
                    Adjust
                  </Button>
                </div>
                {adjusting === l.user_id && (
                  <AdjustRow
                    leader={l}
                    onDone={() => {
                      setAdjusting(null);
                      loadActivity();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Latest">
        {latest.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {latest.map((e) => {
              const Icon = REASON_ICON[e.reason];
              return (
                <li key={e.id} className="flex items-center gap-3 py-2">
                  <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-bold text-slate-900 truncate">
                      {e.profiles?.display_name ?? 'Member'} · {REASON_LABEL[e.reason]}
                      {e.venues && (
                        <>
                          {' · '}
                          <Link to={`/admin/v/${e.venues.id}`} className="hover:text-brand-700">
                            {e.venues.name}
                          </Link>
                        </>
                      )}
                    </span>
                    <span className="block text-xs font-semibold text-slate-500 truncate">
                      {when(e.created_at)}
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                  </span>
                  <span className={`font-extrabold tabular-nums ${e.points > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                    {e.points > 0 ? `+${e.points}` : e.points}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
