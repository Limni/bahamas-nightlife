import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Camera, CheckCircle2, Gift, Keyboard, RotateCcw, ScanLine, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCode, parseRedeemCode } from '@/lib/rewards';
import { pointsLabel } from '@/lib/points';
import { Spinner } from '@/components/ui';
import { Button, inputClass, Panel, useFeedback } from './ui';

// ---------------------------------------------------------------------------
// /manage/redeem: staff scan a member's code (or type it), see their balance
// and what they can afford here, and redeem with one tap. Everything is
// checked again in redeem_confirm(); this screen only asks.
// ---------------------------------------------------------------------------

export interface RedeemVenue {
  venue_id: string;
  name: string;
  slug: string;
  cover_url: string | null;
  role: 'manager' | 'staff' | 'admin';
}

interface LookupReward {
  id: string;
  title: string;
  description: string | null;
  cost: number;
  nightly_limit: number | null;
  used_tonight: number;
}

type Lookup =
  | { status: 'ok'; member: string; balance: number; expires_at: string; rewards: LookupReward[] }
  | { status: 'unknown' | 'used' | 'expired' | 'forbidden' | 'not_partner' | 'disabled' | 'signed_out' };

type Confirm =
  | { status: 'redeemed'; member: string; title: string; points: number; balance: number; redemption_id: string }
  | { status: 'insufficient'; balance: number; cost: number }
  | { status: 'limit'; nightly_limit: number }
  | { status: 'no_reward' | 'suspended' }
  | Exclude<Lookup, { status: 'ok' }>;

interface Recent {
  id: string;
  title: string;
  points: number;
  created_at: string;
  voided_at: string | null;
  profiles: { display_name: string } | null;
}

const MESSAGES: Record<string, string> = {
  unknown: 'That code doesn’t exist. Ask them to open a fresh code under Account → My points.',
  used: 'That code was already used. Ask them for a fresh one.',
  expired: 'That code has expired (they last 5 minutes). Ask them to refresh it.',
  forbidden: 'You can’t redeem at this venue.',
  not_partner: 'This venue isn’t taking points right now. Contact the Nassau Nights team.',
  disabled: 'Points are paused at the moment.',
  signed_out: 'Your session ended. Sign in again.',
  no_reward: 'That reward is no longer available.',
  suspended: 'This member’s account is suspended, so their points can’t be used.',
};

const VENUE_KEY = 'redeem:venue';
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'America/Nassau' });

/** Camera scanner (qr-scanner, loaded on demand). Calls onCode once per new code. */
function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'on' | 'off'>('starting');
  const [hint, setHint] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let scanner: { stop: () => void; destroy: () => void } | null = null;
    let alive = true;
    (async () => {
      try {
        const { default: QrScanner } = await import('qr-scanner');
        if (!alive || !video.current) return;
        if (!(await QrScanner.hasCamera())) throw new Error('no camera');
        const s = new QrScanner(
          video.current,
          (result) => {
            const code = parseRedeemCode(result.data);
            if (!code) {
              setHint('That isn’t a Nassau Nights code.');
              return;
            }
            if (code === last.current) return;
            last.current = code;
            setHint(null);
            cb.current(code);
          },
          {
            preferredCamera: 'environment',
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 8,
            returnDetailedScanResult: true,
            // The default looks at the middle two-thirds only; a phone held close
            // to the member's screen fills more than that.
            calculateScanRegion: (v) => {
              const size = Math.round(0.9 * Math.min(v.videoWidth, v.videoHeight));
              return { x: Math.round((v.videoWidth - size) / 2), y: Math.round((v.videoHeight - size) / 2), width: size, height: size, downScaledWidth: 480, downScaledHeight: 480 };
            },
          },
        );
        scanner = s;
        await s.start();
        if (alive) setState('on');
      } catch {
        if (alive) setState('off');
      }
    })();
    return () => {
      alive = false;
      scanner?.stop();
      scanner?.destroy();
    };
  }, []);

  return (
    <div>
      <div className="relative aspect-square sm:aspect-video rounded-2xl overflow-hidden bg-slate-900">
        <video ref={video} className="w-full h-full object-cover" muted playsInline />
        {state !== 'on' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-6 text-slate-300">
            {state === 'starting' ? (
              <Spinner className="w-7 h-7" />
            ) : (
              <>
                <Camera className="w-8 h-8" />
                <p className="text-sm font-bold">No camera here, or it’s blocked. Allow camera access, or type the code below.</p>
              </>
            )}
          </div>
        )}
      </div>
      {hint && <p className="mt-2 text-sm font-bold text-amber-700">{hint}</p>}
    </div>
  );
}

export default function Redeem({ venues }: { venues: RedeemVenue[] }) {
  const { toast, confirm } = useFeedback();
  const [params, setParams] = useSearchParams();
  const [venueId, setVenueId] = useState<string>(() => {
    const fromUrl = params.get('venue');
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VENUE_KEY);
    } catch {
      /* private mode */
    }
    return [fromUrl, saved].find((id) => id && venues.some((v) => v.venue_id === id)) ?? venues[0]?.venue_id ?? '';
  });
  const venue = venues.find((v) => v.venue_id === venueId);
  const [code, setCode] = useState<string | null>(() => parseRedeemCode(params.get('code') ?? ''));
  const [typed, setTyped] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<Confirm, { status: 'redeemed' }> | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);

  useEffect(() => {
    try {
      if (venueId) localStorage.setItem(VENUE_KEY, venueId);
    } catch {
      /* private mode */
    }
  }, [venueId]);

  const loadRecent = useCallback(() => {
    if (!venueId) return;
    supabase
      .from('redemptions')
      .select('id, title, points, created_at, voided_at, profiles(display_name)')
      .eq('venue_id', venueId)
      .gte('created_at', new Date(Date.now() - 12 * 3600_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setRecent((data ?? []) as unknown as Recent[]));
  }, [venueId]);
  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // A code (scanned, typed, or from a phone-camera link) → who and what they can afford.
  useEffect(() => {
    if (!code || !venueId) return;
    let alive = true;
    setLookup(null);
    setDone(null);
    setBusy('lookup');
    supabase.rpc('redeem_lookup', { p_venue: venueId, p_code: code }).then(({ data, error }) => {
      if (!alive) return;
      setBusy(null);
      if (error) {
        toast(error.message, 'error');
        setCode(null);
        return;
      }
      setLookup(data as Lookup);
    });
    // The link's ?code= has done its job; keep the URL clean for the next scan.
    if (params.get('code')) {
      params.delete('code');
      setParams(params, { replace: true });
    }
    return () => {
      alive = false;
    };
  }, [code, venueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setCode(null);
    setLookup(null);
    setDone(null);
    setTyped('');
  };

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const c = parseRedeemCode(typed);
    if (!c) return toast('Codes are 8 letters and numbers, like K7Q2 M9XP.', 'error');
    setCode(c);
  };

  const redeem = async (r: LookupReward, member: string) => {
    const ok = await confirm({
      title: `Redeem ${r.title}?`,
      body: `${pointsLabel(r.cost)} from ${member}’s balance. Hand it over once this shows Redeemed.`,
      confirmLabel: `Redeem ${pointsLabel(r.cost)}`,
    });
    if (!ok || !code) return;
    setBusy(r.id);
    const { data, error } = await supabase.rpc('redeem_confirm', { p_venue: venueId, p_code: code, p_reward: r.id });
    setBusy(null);
    if (error) return toast(error.message, 'error');
    const res = data as Confirm;
    if (res.status === 'redeemed') {
      setDone(res);
      setLookup(null);
      loadRecent();
      return;
    }
    if (res.status === 'insufficient') return toast(`Not enough points: they have ${res.balance}, this needs ${res.cost}.`, 'error');
    if (res.status === 'limit') return toast(`They’ve already had this ${res.nightly_limit === 1 ? 'tonight' : `${res.nightly_limit} times tonight`}.`, 'error');
    toast(MESSAGES[res.status] ?? 'Couldn’t redeem that.', 'error');
    if (res.status === 'used' || res.status === 'expired' || res.status === 'unknown') setLookup(res);
  };

  const voidIt = async (r: Recent) => {
    const ok = await confirm({
      title: `Undo ${r.title}?`,
      body: `${pointsLabel(r.points)} go back to ${r.profiles?.display_name ?? 'the member'}. Only for mistakes: the reward wasn’t given.`,
      confirmLabel: 'Undo and refund',
      danger: true,
    });
    if (!ok) return;
    const { data, error } = await supabase.rpc('void_redemption', { p_redemption: r.id });
    if (error) return toast(error.message, 'error');
    const s = (data as { status: string }).status;
    toast(s === 'voided' ? 'Undone: points refunded' : s === 'forbidden' ? 'Too late to undo here (12 hours). Ask the Nassau Nights team.' : 'Already undone');
    loadRecent();
  };

  if (!venue) return null;
  const showScanner = !code && !done;

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-slate-900">Redeem points</h1>
          <p className="text-sm font-semibold text-slate-500">Scan the member’s code from their Nassau Nights account.</p>
        </div>
        {venues.length > 1 && (
          <select
            className={`${inputClass} w-auto max-w-full`}
            value={venueId}
            onChange={(e) => {
              setVenueId(e.target.value);
              reset();
            }}
            aria-label="Venue"
          >
            {venues.map((v) => (
              <option key={v.venue_id} value={v.venue_id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {venues.length === 1 && <p className="-mt-2 text-sm font-extrabold text-brand-700">{venue.name}</p>}

      {showScanner && (
        <Panel title="Scan" action={<ScanLine className="w-5 h-5 text-slate-400" />}>
          <Scanner key={venueId} onCode={setCode} />
          <form onSubmit={submitTyped} className="mt-4 flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Keyboard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                className={`${inputClass} pl-9 font-mono uppercase tracking-widest`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Or type the code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label="Code"
              />
            </div>
            <Button type="submit" variant="secondary" className="shrink-0">
              Look up
            </Button>
          </form>
        </Panel>
      )}

      {code && !done && (
        <Panel
          title={formatCode(code)}
          action={
            <Button variant="ghost" className="px-2.5 py-1.5 whitespace-nowrap" onClick={reset}>
              <RotateCcw className="w-4 h-4" /> Scan another
            </Button>
          }
        >
          {busy === 'lookup' || !lookup ? (
            <Spinner className="w-6 h-6" />
          ) : lookup.status !== 'ok' ? (
            <p className="text-sm font-bold text-rose-700">{MESSAGES[lookup.status]}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="min-w-0">
                  <span className="block text-xs font-extrabold uppercase tracking-wider text-slate-500">Member</span>
                  <span className="block text-lg font-black text-slate-900 truncate">{lookup.member}</span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-xs font-extrabold uppercase tracking-wider text-slate-500">Balance</span>
                  <span className="block text-2xl font-black text-amber-600 tabular-nums">{lookup.balance}</span>
                </span>
              </div>
              {lookup.rewards.length === 0 ? (
                <p className="text-sm font-semibold text-slate-500">
                  No rewards set up here yet.
                  {venue.role !== 'staff' && (
                    <>
                      {' '}
                      <Link to={venue.role === 'admin' ? `/admin/v/${venue.venue_id}#rewards` : `/manage/v/${venue.venue_id}#rewards`} className="font-extrabold text-brand-700 hover:underline">
                        Add rewards
                      </Link>
                    </>
                  )}
                </p>
              ) : (
                <ul className="space-y-2">
                  {lookup.rewards.map((r) => {
                    const short = r.cost - lookup.balance;
                    const maxed = r.nightly_limit !== null && r.used_tonight >= r.nightly_limit;
                    const why = maxed ? (r.nightly_limit === 1 ? 'Already had it tonight' : `Limit ${r.nightly_limit} a night reached`) : short > 0 ? `Needs ${pointsLabel(short)} more` : null;
                    return (
                      <li key={r.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200">
                        <Gift className="w-5 h-5 text-amber-500 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-extrabold text-slate-900 truncate">{r.title}</span>
                          <span className="block text-xs font-semibold text-slate-500">
                            {pointsLabel(r.cost)}
                            {why ? ` · ${why}` : r.description ? ` · ${r.description}` : ''}
                          </span>
                        </span>
                        <Button onClick={() => redeem(r, lookup.member)} disabled={!!why || !!busy} loading={busy === r.id} className="shrink-0">
                          Redeem
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </Panel>
      )}

      {done && (
        <section className="rounded-2xl bg-emerald-50 border border-emerald-200 p-6 text-center">
          <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-600" />
          <p className="mt-2 text-2xl font-black text-emerald-900">Redeemed</p>
          <p className="mt-1 font-extrabold text-slate-900">
            {done.title} for {done.member}
          </p>
          <p className="text-sm font-semibold text-slate-600">
            −{pointsLabel(done.points)} · {pointsLabel(done.balance)} left
          </p>
          <Button className="mt-4" onClick={reset}>
            <ScanLine className="w-4 h-4" /> Scan next
          </Button>
        </section>
      )}

      <Panel title="Last 12 hours">
        {recent.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">No redemptions yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((r) => (
              <li key={r.id} className={`flex items-center gap-3 py-2 ${r.voided_at ? 'opacity-50' : ''}`}>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-bold text-slate-900 truncate">
                    {r.title} · {r.profiles?.display_name ?? 'Member'}
                  </span>
                  <span className="block text-xs font-semibold text-slate-500">
                    {time(r.created_at)} · {pointsLabel(r.points)}
                    {r.voided_at ? ' · undone, refunded' : ''}
                  </span>
                </span>
                {!r.voided_at && (
                  <Button variant="ghost" className="px-2.5 py-1.5 text-slate-500" onClick={() => voidIt(r)} aria-label={`Undo ${r.title}`}>
                    <Undo2 className="w-4 h-4" /> Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
